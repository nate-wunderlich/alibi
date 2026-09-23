/**
 * Game setup actions: createGame, joinGame, startSeries, nextRound.
 * Every action checks the caller itself (actions bypass RBAC; see helpers.ts).
 */

import type { ActionHandler, ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import { PRESET_CASE } from '../game/presetCase'
import { deal, starterForRound, type Card } from '../game/rules'
import { pickSetting } from '../game/settings'
import { action, loadGame, must, refuse, textParam, userInSeat, type Game } from './helpers'

// ---------------------------------------------------------------------------
// Join codes
// ---------------------------------------------------------------------------

/** Letters and digits that cannot be mistaken for each other (no 0/O, 1/I/L). */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 6

/** A random 6-character join code. */
function randomCode(): string {
  let code = ''
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
  }
  return code
}

/** A join code no other game is using. Tries a few times, then gives up. */
async function uniqueCode(tools: ActionTools): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode()
    const existing = must(await tools.query('join_codes', { where: { code }, limit: 1 }), 'Checking the join code')
    if (existing.records.length === 0) return code
  }
  throw new Error('Could not find a free join code. Please try again.')
}

/** The caller's display name from the users collection, or '' if unknown. */
async function displayName(tools: ActionTools, userId: string): Promise<string> {
  const result = await tools.get<{ name?: string }>('users', userId)
  return result.success ? (result.data.record.data.name ?? '') : ''
}

// ---------------------------------------------------------------------------
// Starting a round (shared by startSeries and nextRound)
// ---------------------------------------------------------------------------

/**
 * Set up round `number` of a game: pick an unused setting, lay out the preset
 * case's 12 cards, deal them with the rules module, and write the round, the
 * hands, and the solution. Returns the new round's id.
 */
async function startRound(tools: ActionTools, game: Game, number: number, usedSettingIds: string[]): Promise<string> {
  // 1. The round, marked "generating" until everything is written.
  const setting = pickSetting(usedSettingIds, Math.random)
  const { recordId: roundId } = must(
    await tools.create('rounds', {
      gameId: game.id,
      number,
      status: 'generating',
      settingId: setting.id,
      caseTitle: PRESET_CASE.title,
      victim: PRESET_CASE.victim,
      openingNarration: PRESET_CASE.openingNarration,
      starter: '',
      turnUserId: '',
      guessedThisTurn: 0,
      pendingGuessId: '',
      faceUpCardId: '',
      winnerUserId: '',
      revealedSolution: '',
      revealedHands: '',
      revealedAccusation: '',
    }),
    `Creating round ${number}`,
  )

  // 2. The 12 cards. Each card's record id is the id the rules deal with.
  const deck: Card[] = []
  for (const c of PRESET_CASE.cards) {
    const { recordId } = must(
      await tools.create('cards', { roundId, kind: c.kind, name: c.name, description: c.description, imageUrl: '' }),
      'Creating a card',
    )
    deck.push({ id: recordId, kind: c.kind })
  }

  // 3. Deal: envelope, two hands of 4, one face up.
  const dealt = deal(deck, Math.random)
  for (const seat of ['host', 'guest'] as const) {
    must(
      await tools.create('hands', {
        roundId,
        userId: userInSeat(game, seat),
        cardIds: JSON.stringify(dealt.hands[seat].map((c) => c.id)),
      }),
      `Dealing the ${seat}'s hand`,
    )
  }
  must(await tools.create('solution', { roundId, ...dealt.envelope }), 'Sealing the envelope')

  // 4. Open the round: the starter alternates by round number.
  const starter = starterForRound(number)
  must(
    await tools.update('rounds', roundId, {
      status: 'playing',
      faceUpCardId: dealt.faceUp.id,
      starter,
      turnUserId: userInSeat(game, starter),
    }),
    `Opening round ${number}`,
  )
  must(await tools.update('games', game.id, { status: 'playing', currentRound: number }), 'Updating the game')
  return roundId
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * createGame({ bestOf }): the caller becomes the host of a new game in the lobby.
 * Returns the game id and the join code for the guest. The code is stored in
 * join_codes, which only the host can read (R32).
 */
const createGame = action(async ({ userId, params, tools }) => {
  const bestOf = params.bestOf
  if (bestOf !== 3 && bestOf !== 5 && bestOf !== 7) refuse('bestOf must be 3, 5, or 7.')

  const code = await uniqueCode(tools)
  const { recordId: gameId } = must(
    await tools.create('games', {
      host: userId,
      guest: '',
      bestOf,
      scoreHost: 0,
      scoreGuest: 0,
      currentRound: 0,
      status: 'lobby',
      seriesWinner: '',
    }),
    'Creating the game',
  )
  must(await tools.create('join_codes', { gameId, code, hostId: userId }), 'Saving the join code')
  must(
    await tools.create('players', { gameId, userId, displayName: await displayName(tools, userId), seat: 'host' }),
    'Adding the host',
  )
  return { gameId, code, userId }
})

/**
 * joinGame({ code }): the caller becomes the guest of the game with that code.
 * The game must be in the lobby, have no guest yet, and not be hosted by the caller.
 */
const joinGame = action(async ({ userId, params, tools }) => {
  const code = typeof params.code === 'string' ? params.code.trim().toUpperCase() : ''
  if (code === '') refuse('A join code is required.')

  const found = must(await tools.query('join_codes', { where: { code }, limit: 1 }), 'Looking up the code')
  if (found.records.length === 0) refuse('No game has that code.')
  const game = await loadGame(tools, String(found.records[0].data.gameId))

  if (game.status !== 'lobby') refuse('That game has already started.')
  if (game.host === userId) refuse('You are the host of this game; share the code with your opponent.')
  if (game.guest !== '') refuse('That game already has two players.')

  must(await tools.update('games', game.id, { guest: userId }), 'Joining the game')
  must(
    await tools.create('players', {
      gameId: game.id,
      userId,
      displayName: await displayName(tools, userId),
      seat: 'guest',
    }),
    'Adding the guest',
  )
  return { gameId: game.id, userId }
})

/** startSeries({ gameId }): the host starts round 1 once a guest has joined. */
const startSeries = action(async ({ userId, params, tools }) => {
  const game = await loadGame(tools, textParam(params, 'gameId'))
  if (game.host !== userId) refuse('Only the host can start the series.')
  if (game.guest === '') refuse('Wait for your opponent to join.')
  if (game.status !== 'lobby') refuse('This series has already started.')

  const roundId = await startRound(tools, game, 1, [])
  return { gameId: game.id, roundId }
})

/**
 * nextRound({ gameId }): the host starts the next round, after the current
 * one is revealed and while nobody has won the series. The setting is new to
 * this series.
 */
const nextRound = action(async ({ userId, params, tools }) => {
  const game = await loadGame(tools, textParam(params, 'gameId'))
  if (game.host !== userId) refuse('Only the host can start the next round.')
  if (game.status === 'finished') refuse('The series is over.')
  if (game.status !== 'playing') refuse('The series has not started.')

  const rounds = must(await tools.query('rounds', { where: { gameId: game.id }, limit: 50 }), 'Loading the rounds')
  const current = rounds.records.find((r) => Number(r.data.number) === game.currentRound)
  if (!current || current.data.status !== 'revealed') refuse('Finish the current round first.')

  const usedSettingIds = rounds.records.map((r) => String(r.data.settingId))
  const roundId = await startRound(tools, game, game.currentRound + 1, usedSettingIds)
  return { gameId: game.id, roundId }
})

export const gameActions: Record<string, ActionHandler<Env>> = { createGame, joinGame, startSeries, nextRound }
