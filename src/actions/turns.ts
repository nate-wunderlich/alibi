/**
 * Turn actions: guess, showCard, endTurn, accuse (docs/GAME_RULES.md; R33).
 *
 * R33: after a guess resolves, the player on turn either accuses or ends the
 * turn. A turn cannot end without a guess, and there is one guess per turn.
 *
 * The rules come from src/game/rules.ts (resolveGuess, nextTurn,
 * checkAccusation, seriesWinner); these actions only check who may act and
 * write the results. Every action checks the caller itself (actions bypass RBAC).
 */

import type { ActionHandler, ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import { portraitsEnabled } from '../server/portraits'
import { templateConfession } from '../server/narration'
import { templateAlibi } from '../game/alibis'
import {
  alibiDue,
  checkAccusation,
  nextTurn,
  pickAlibiCard,
  resolveGuess,
  seriesWinner,
  type Card,
  type Player,
  type Triple,
} from '../game/rules'
import {
  action,
  loadCards,
  loadGame,
  loadHandIds,
  loadRound,
  must,
  readTriple,
  refuse,
  requireSeat,
  textParam,
  userInSeat,
  type Game,
  type RevealedAlibi,
  type Round,
} from './helpers'
import { loadAnswers, prepareRound, queueMediaJob } from './rounds'

/** Load a round that is being played, its game, and the caller's seat; refuse otherwise. */
async function loadPlayingRound(tools: ActionTools, roundId: string, userId: string) {
  const round = await loadRound(tools, roundId)
  const game = await loadGame(tools, round.gameId)
  const seat = requireSeat(game, userId)
  if (round.status !== 'playing') refuse('This round is not being played.')
  return { round, game, seat }
}

/** Refuse unless it is the caller's turn and no card choice is pending. */
function requireTurn(round: Round, userId: string): void {
  if (round.turnUserId !== userId) refuse('It is not your turn.')
  if (round.pendingGuessId !== '') refuse('Wait for your opponent to choose which card to show.')
}

/** The round's solution. Only actions read it; no client can (R29). */
async function loadSolution(tools: ActionTools, roundId: string): Promise<Triple> {
  const found = must(await tools.query('solution', { where: { roundId }, limit: 1 }), 'Loading the solution')
  if (found.records.length === 0) throw new Error('The solution is missing for this round.')
  const d = found.records[0].data
  return { suspect: String(d.suspect), weapon: String(d.weapon), location: String(d.location) }
}

/**
 * guess({ roundId, suspect, weapon, location }): the player on turn names
 * three cards. The opponent's hand decides the result (rules.resolveGuess):
 * none -> 'none'; one match -> 'shown', and the guesser receives that card;
 * two or three -> 'pending' until the opponent picks one with showCard.
 */
const guess = action(async ({ userId, params, tools }) => {
  const roundId = textParam(params, 'roundId')
  const { round, game, seat } = await loadPlayingRound(tools, roundId, userId)
  requireTurn(round, userId)
  if (round.guessedThisTurn) refuse('You have already guessed this turn. Accuse or end your turn.')

  const cards = await loadCards(tools, roundId)
  const triple = readTriple(params, cards)
  const opponentId = userInSeat(game, nextTurn(seat))
  const opponentHand: Card[] = (await loadHandIds(tools, roundId, opponentId)).map(
    (id) => cards.find((c) => c.id === id)!,
  )
  const outcome = resolveGuess(triple, opponentHand)

  const earlier = must(await tools.query('guesses', { where: { roundId }, limit: 500 }), 'Counting guesses')
  const result = outcome.type === 'none' ? 'none' : outcome.type === 'auto' ? 'shown' : 'pending'
  const { recordId: guessId } = must(
    await tools.create('guesses', { roundId, byUserId: userId, ...triple, result, seq: earlier.records.length + 1 }),
    'Recording the guess',
  )

  if (outcome.type === 'auto') {
    must(
      await tools.create('shown_cards', { guessId, roundId, toUserId: userId, cardId: outcome.card.id }),
      'Showing the card',
    )
  }
  must(
    await tools.update('rounds', roundId, {
      guessedThisTurn: 1,
      pendingGuessId: outcome.type === 'choose' ? guessId : '',
    }),
    'Updating the round',
  )
  return { guessId, result }
})

/**
 * showCard({ guessId, cardId }): the guesser's opponent picks which matching
 * card to show. The card must be in their hand and in the guess.
 */
const showCard = action(async ({ userId, params, tools }) => {
  const guessId = textParam(params, 'guessId')
  const cardId = textParam(params, 'cardId')

  const found = await tools.get<Record<string, unknown>>('guesses', guessId)
  if (!found.success) refuse('That guess does not exist.')
  const g = found.data.record.data
  const roundId = String(g.roundId)
  const { round, game, seat } = await loadPlayingRound(tools, roundId, userId)
  const guesserId = String(g.byUserId)

  if (guesserId !== userInSeat(game, nextTurn(seat))) refuse('Only the opponent of the guesser shows a card.')
  if (g.result !== 'pending' || round.pendingGuessId !== guessId) refuse('This guess is not waiting for a card.')
  if (![g.suspect, g.weapon, g.location].includes(cardId)) refuse('That card is not part of the guess.')
  if (!(await loadHandIds(tools, roundId, userId)).includes(cardId)) refuse('That card is not in your hand.')

  must(await tools.create('shown_cards', { guessId, roundId, toUserId: guesserId, cardId }), 'Showing the card')
  must(await tools.update('guesses', guessId, { result: 'shown' }), 'Updating the guess')
  must(await tools.update('rounds', roundId, { pendingGuessId: '' }), 'Updating the round')
  return { guessId }
})

/**
 * R41: draw the alibi due after a turn, on the server only. rules.pickAlibiCard
 * picks a card from the round starter's hand that is not public yet (face up
 * or drawn before); its text is read from the server-only alibiTexts. Returns
 * the round's alibis with the new one appended, or unchanged if none is left.
 */
async function drawAlibi(tools: ActionTools, game: Game, round: Round, afterTurn: number): Promise<RevealedAlibi[]> {
  if (round.starter === '') throw new Error('The round has no starter.')
  const cards = await loadCards(tools, round.id)
  const byId = (id: string) => cards.find((c) => c.id === id)!
  const hands: Record<Player, Card[]> = { host: [], guest: [] }
  for (const seat of ['host', 'guest'] as const) {
    hands[seat] = (await loadHandIds(tools, round.id, userInSeat(game, seat))).map(byId)
  }
  const dealt = { envelope: await loadSolution(tools, round.id), hands, faceUp: byId(round.faceUpCardId) }
  const alreadyPublic = [round.faceUpCardId, ...round.revealedAlibis.map((a) => a.cardId)]
  const card = pickAlibiCard(dealt, round.starter, alreadyPublic, Math.random)
  if (!card) return round.revealedAlibis

  const rows = must(
    await tools.query('alibiTexts', { where: { roundId: round.id, cardId: card.id }, limit: 1 }),
    'Loading the alibi',
  )
  const stored = rows.records[0]?.data.text
  const name = await tools.get<Record<string, unknown>>('cards', card.id)
  const text =
    typeof stored === 'string' && stored !== ''
      ? stored
      : templateAlibi({ kind: card.kind, name: name.success ? String(name.data.record.data.name) : 'This card' })
  return [...round.revealedAlibis, { cardId: card.id, text, afterTurn }]
}

/**
 * endTurn({ roundId }): after guessing, the player on turn passes it
 * (rules.nextTurn). R41: every completed turn is counted, and when an alibi
 * is due (rules.alibiDue) the server draws one into the round.
 */
const endTurn = action(async ({ userId, params, tools }) => {
  const roundId = textParam(params, 'roundId')
  const { round, game, seat } = await loadPlayingRound(tools, roundId, userId)
  requireTurn(round, userId)
  if (!round.guessedThisTurn) refuse('Guess before ending your turn.')

  const turnsPlayed = round.turnsPlayed + 1
  const alibis = alibiDue(turnsPlayed) ? await drawAlibi(tools, game, round, turnsPlayed) : round.revealedAlibis
  const nextUserId = userInSeat(game, nextTurn(seat))
  must(
    await tools.update('rounds', roundId, {
      turnUserId: nextUserId,
      guessedThisTurn: 0,
      turnsPlayed,
      ...(alibis !== round.revealedAlibis ? { revealedAlibis: JSON.stringify(alibis) } : {}),
    }),
    'Passing the turn',
  )
  return { turnUserId: nextUserId }
})

/**
 * The reveal (R30): copy the solution, both hands, the accusation, and both
 * players' questions and answers into the round, mark it revealed, score it,
 * and finish the series if it is decided. Otherwise prepare the next case
 * (setting and questions), so both players can answer on the reveal screen.
 * R36: a template confession is written at once, and the confession job is
 * queued (production only) to replace it with the AI's version and voice it.
 * Returns the winner and the next round's id ('' when the series is over).
 */
async function reveal(
  tools: ActionTools,
  env: Env,
  game: Game,
  round: Round,
  solution: Triple,
  accusation: Record<string, unknown>,
  winner: Player,
): Promise<{ winnerUserId: string; nextRoundId: string }> {
  const hands: Record<string, string[]> = {}
  for (const seat of ['host', 'guest'] as const) {
    const id = userInSeat(game, seat)
    hands[id] = await loadHandIds(tools, round.id, id)
  }
  const winnerUserId = userInSeat(game, winner)
  const answers = await loadAnswers(tools, round.id, game)
  const cards = must(await tools.query('cards', { where: { roundId: round.id }, limit: 20 }), 'Loading the cards')
  const nameOf = (id: string) => String(cards.records.find((c) => c.recordId === id)?.data.name ?? '')
  const confession = templateConfession({
    culprit: nameOf(solution.suspect),
    method: nameOf(solution.weapon),
    place: nameOf(solution.location),
  })
  must(
    await tools.update('rounds', round.id, {
      status: 'revealed',
      winnerUserId,
      pendingGuessId: '',
      revealedSolution: JSON.stringify(solution),
      revealedHands: JSON.stringify(hands),
      revealedAccusation: JSON.stringify(accusation),
      revealedAnswers: JSON.stringify(answers),
      confession,
    }),
    'Revealing the round',
  )
  if (portraitsEnabled()) await queueMediaJob(env, 'confession', game, round.id)

  const score = {
    host: game.scoreHost + (winner === 'host' ? 1 : 0),
    guest: game.scoreGuest + (winner === 'guest' ? 1 : 0),
  }
  const champion = seriesWinner(score, game.bestOf)
  must(
    await tools.update('games', game.id, {
      scoreHost: score.host,
      scoreGuest: score.guest,
      ...(champion ? { status: 'finished', seriesWinner: userInSeat(game, champion) } : {}),
    }),
    'Updating the score',
  )
  const nextRoundId = champion ? '' : await prepareRound(tools, game, round.number + 1)
  return { winnerUserId, nextRoundId }
}

/**
 * accuse({ roundId, suspect, weapon, location }): the player on turn names
 * the envelope. Right wins the round; wrong gives it to the opponent
 * (rules.checkAccusation). Either way the round is revealed.
 */
const accuse = action(async ({ userId, params, tools, env }) => {
  const roundId = textParam(params, 'roundId')
  const { round, game, seat } = await loadPlayingRound(tools, roundId, userId)
  requireTurn(round, userId)

  const triple = readTriple(params, await loadCards(tools, roundId))
  const solution = await loadSolution(tools, roundId)
  const correct = checkAccusation(triple, solution)
  must(
    await tools.create('accusations', { roundId, byUserId: userId, ...triple, correct: correct ? 1 : 0 }),
    'Recording the accusation',
  )

  const winner = correct ? seat : nextTurn(seat)
  const { winnerUserId, nextRoundId } = await reveal(
    tools,
    env,
    game,
    round,
    solution,
    { byUserId: userId, ...triple, correct },
    winner,
  )
  return { correct, winnerUserId, nextRoundId }
})

export const turnActions: Record<string, ActionHandler<Env>> = { guess, showCard, endTurn, accuse }
