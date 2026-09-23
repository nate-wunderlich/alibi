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
import { checkAccusation, nextTurn, resolveGuess, seriesWinner, type Card, type Player, type Triple } from '../game/rules'
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
  type Round,
} from './helpers'

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

/** endTurn({ roundId }): after guessing, the player on turn passes it (rules.nextTurn). */
const endTurn = action(async ({ userId, params, tools }) => {
  const roundId = textParam(params, 'roundId')
  const { round, game, seat } = await loadPlayingRound(tools, roundId, userId)
  requireTurn(round, userId)
  if (!round.guessedThisTurn) refuse('Guess before ending your turn.')

  const nextUserId = userInSeat(game, nextTurn(seat))
  must(await tools.update('rounds', roundId, { turnUserId: nextUserId, guessedThisTurn: 0 }), 'Passing the turn')
  return { turnUserId: nextUserId }
})

/**
 * The reveal (R30): copy the solution, both hands, and the accusation into
 * the round, mark it revealed, score it, and finish the series if it is decided.
 */
async function reveal(
  tools: ActionTools,
  game: Game,
  round: Round,
  solution: Triple,
  accusation: Record<string, unknown>,
  winner: Player,
): Promise<string> {
  const hands: Record<string, string[]> = {}
  for (const seat of ['host', 'guest'] as const) {
    const id = userInSeat(game, seat)
    hands[id] = await loadHandIds(tools, round.id, id)
  }
  const winnerUserId = userInSeat(game, winner)
  must(
    await tools.update('rounds', round.id, {
      status: 'revealed',
      winnerUserId,
      pendingGuessId: '',
      revealedSolution: JSON.stringify(solution),
      revealedHands: JSON.stringify(hands),
      revealedAccusation: JSON.stringify(accusation),
    }),
    'Revealing the round',
  )

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
  return winnerUserId
}

/**
 * accuse({ roundId, suspect, weapon, location }): the player on turn names
 * the envelope. Right wins the round; wrong gives it to the opponent
 * (rules.checkAccusation). Either way the round is revealed.
 */
const accuse = action(async ({ userId, params, tools }) => {
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
  const winnerUserId = await reveal(tools, game, round, solution, { byUserId: userId, ...triple, correct }, winner)
  return { correct, winnerUserId }
})

export const turnActions: Record<string, ActionHandler<Env>> = { guess, showCard, endTurn, accuse }
