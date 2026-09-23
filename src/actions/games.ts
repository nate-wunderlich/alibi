/**
 * Game server actions: createGame, joinGame, startSeries.
 *
 * Actions run with RBAC OFF (see src/server/action-routes.ts): the record
 * tools can read and write any row. So every action here checks the caller
 * itself before writing, and returns a clear error for each failed check.
 */

import type { ActionContext, ActionHandler, ActionResult, ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import { PRESET_CASE } from '../game/presetCase'
import { deal, starterForRound, type Card } from '../game/rules'
import { pickSetting } from '../game/settings'

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** A check failed: the message goes back to the caller as the action's error. */
class ActionError extends Error {}

/** Stop the action with a message for the caller. */
function refuse(message: string): never {
  throw new ActionError(message)
}

/** Unwrap a record tool's result, or stop with a message saying what failed. */
function must<T>(result: ActionResult<T>, what: string): T {
  if (!result.success) throw new Error(`${what} failed: ${result.error}`)
  return result.data
}

/** Run an action body and turn any thrown error into `{ success: false, error }`. */
function action(body: (ctx: ActionContext<Env>) => Promise<unknown>): ActionHandler<Env> {
  return async (ctx) => {
    try {
      return { success: true, data: await body(ctx) }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      if (!(e instanceof ActionError)) console.error('[action] unexpected error:', message)
      return { success: false, error: message }
    }
  }
}

interface GameRow {
  code: string
  host: string
  guest: string
  bestOf: number
  status: string
}

/** Load a game by id, or refuse if there is none. */
async function loadGame(tools: ActionTools, gameId: unknown): Promise<GameRow> {
  if (typeof gameId !== 'string' || gameId === '') refuse('A game id is required.')
  const result = await tools.get<Record<string, unknown>>('games', gameId)
  if (!result.success) refuse('That game does not exist.')
  return result.data.record.data as unknown as GameRow
}

/** The caller's display name from the users collection, or '' if unknown. */
async function displayName(tools: ActionTools, userId: string): Promise<string> {
  const result = await tools.get<{ name?: string }>('users', userId)
  return result.success ? (result.data.record.data.name ?? '') : ''
}

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
    const existing = must(await tools.query('games', { where: { code }, limit: 1 }), 'Checking the join code')
    if (existing.records.length === 0) return code
  }
  throw new Error('Could not find a free join code. Please try again.')
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * createGame({ bestOf }): the caller becomes the host of a new game in the lobby.
 * Returns the game id and the join code for the guest.
 */
const createGame = action(async ({ userId, params, tools }) => {
  const bestOf = params.bestOf
  if (bestOf !== 3 && bestOf !== 5 && bestOf !== 7) refuse('bestOf must be 3, 5, or 7.')

  const code = await uniqueCode(tools)
  const { recordId: gameId } = must(
    await tools.create('games', {
      code,
      host: userId,
      guest: '',
      bestOf,
      hostScore: 0,
      guestScore: 0,
      currentRound: 0,
      status: 'lobby',
      seriesWinner: '',
    }),
    'Creating the game',
  )
  must(
    await tools.create('players', {
      gameId,
      userId,
      displayName: await displayName(tools, userId),
      seat: 'host',
    }),
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

  const found = must(await tools.query('games', { where: { code }, limit: 1 }), 'Looking up the code')
  if (found.records.length === 0) refuse('No game has that code.')
  const record = found.records[0]
  const game = record.data as unknown as GameRow

  if (game.status !== 'lobby') refuse('That game has already started.')
  if (game.host === userId) refuse('You are the host of this game; share the code with your opponent.')
  if (game.guest !== '') refuse('That game already has two players.')

  must(await tools.update('games', record.recordId, { guest: userId }), 'Joining the game')
  must(
    await tools.create('players', {
      gameId: record.recordId,
      userId,
      displayName: await displayName(tools, userId),
      seat: 'guest',
    }),
    'Adding the guest',
  )
  return { gameId: record.recordId, userId }
})

/**
 * startSeries({ gameId }): the host starts round 1.
 * Picks a setting, lays out the preset case's 12 cards, deals them with the
 * rules module, and writes the round, the hands, and the solution.
 */
const startSeries = action(async ({ userId, params, tools }) => {
  const gameId = params.gameId as string
  const game = await loadGame(tools, gameId)
  if (game.host !== userId) refuse('Only the host can start the series.')
  if (game.guest === '') refuse('Wait for your opponent to join.')
  if (game.status !== 'lobby') refuse('This series has already started.')

  // 1. The round, marked "generating" until everything is written.
  const setting = pickSetting([], Math.random)
  const { recordId: roundId } = must(
    await tools.create('rounds', {
      gameId,
      number: 1,
      status: 'generating',
      settingId: setting.id,
      caseTitle: PRESET_CASE.title,
      victim: PRESET_CASE.victim,
      openingNarration: PRESET_CASE.openingNarration,
      starter: '',
      turn: '',
      faceUpCardId: '',
      winner: '',
    }),
    'Creating round 1',
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
  for (const [seat, owner] of [
    ['host', game.host],
    ['guest', game.guest],
  ] as const) {
    must(
      await tools.create('hands', {
        roundId,
        userId: owner,
        cardIds: JSON.stringify(dealt.hands[seat].map((c) => c.id)),
      }),
      `Dealing the ${seat}'s hand`,
    )
  }
  must(await tools.create('solution', { roundId, ...dealt.envelope }), 'Sealing the envelope')

  // 4. Open the round and the series.
  const starter = starterForRound(1)
  must(
    await tools.update('rounds', roundId, { status: 'playing', faceUpCardId: dealt.faceUp.id, starter, turn: starter }),
    'Opening round 1',
  )
  must(await tools.update('games', gameId, { status: 'playing', currentRound: 1 }), 'Starting the series')
  return { gameId, roundId }
})

export const gameActions: Record<string, ActionHandler<Env>> = { createGame, joinGame, startSeries }
