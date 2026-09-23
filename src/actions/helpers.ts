/**
 * Shared pieces for the game actions.
 *
 * Actions run with RBAC OFF (see src/server/action-routes.ts): the record
 * tools can read and write any row. So every action checks the caller itself
 * before writing, and returns a clear error for each failed check. The game
 * rules themselves live in src/game/rules.ts; these helpers only load and
 * check records.
 */

import type { ActionContext, ActionHandler, ActionResult, ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import type { Card, CardKind, Player, Triple } from '../game/rules'

/** A check failed: the message goes back to the caller as the action's error. */
export class ActionError extends Error {}

/** Stop the action with a message for the caller. */
export function refuse(message: string): never {
  throw new ActionError(message)
}

/** Unwrap a record tool's result, or stop with a message saying what failed. */
export function must<T>(result: ActionResult<T>, what: string): T {
  if (!result.success) throw new Error(`${what} failed: ${result.error}`)
  return result.data
}

/** Run an action body and turn any thrown error into `{ success: false, error }`. */
export function action(body: (ctx: ActionContext<Env>) => Promise<unknown>): ActionHandler<Env> {
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

/** A required text parameter, or refuse. */
export function textParam(params: Record<string, unknown>, name: string): string {
  const value = params[name]
  if (typeof value !== 'string' || value === '') refuse(`${name} is required.`)
  return value
}

// ---------------------------------------------------------------------------
// Games and seats
// ---------------------------------------------------------------------------

export interface Game {
  id: string
  host: string
  guest: string
  bestOf: 3 | 5 | 7
  scoreHost: number
  scoreGuest: number
  currentRound: number
  status: string
  seriesWinner: string
}

/** Load a game by id, or refuse if there is none. */
export async function loadGame(tools: ActionTools, gameId: string): Promise<Game> {
  const result = await tools.get<Record<string, unknown>>('games', gameId)
  if (!result.success) refuse('That game does not exist.')
  const d = result.data.record.data
  return {
    id: gameId,
    host: String(d.host ?? ''),
    guest: String(d.guest ?? ''),
    bestOf: Number(d.bestOf) as 3 | 5 | 7,
    scoreHost: Number(d.scoreHost ?? 0),
    scoreGuest: Number(d.scoreGuest ?? 0),
    currentRound: Number(d.currentRound ?? 0),
    status: String(d.status ?? ''),
    seriesWinner: String(d.seriesWinner ?? ''),
  }
}

/** Which seat a user sits in, or null if they are not in this game. */
export function seatOf(game: Game, userId: string): Player | null {
  if (userId === game.host) return 'host'
  if (userId !== '' && userId === game.guest) return 'guest'
  return null
}

/** The user in a seat. */
export function userInSeat(game: Game, seat: Player): string {
  return seat === 'host' ? game.host : game.guest
}

/** The caller's seat, or refuse if they are not a player in this game. */
export function requireSeat(game: Game, userId: string): Player {
  const seat = seatOf(game, userId)
  if (!seat) refuse('You are not a player in this game.')
  return seat
}

// ---------------------------------------------------------------------------
// Rounds, cards, and hands
// ---------------------------------------------------------------------------

export interface Round {
  id: string
  gameId: string
  number: number
  status: string
  settingId: string
  turnUserId: string
  guessedThisTurn: boolean
  pendingGuessId: string
}

/** Load a round by id, or refuse if there is none. */
export async function loadRound(tools: ActionTools, roundId: string): Promise<Round> {
  const result = await tools.get<Record<string, unknown>>('rounds', roundId)
  if (!result.success) refuse('That round does not exist.')
  const d = result.data.record.data
  return {
    id: roundId,
    gameId: String(d.gameId ?? ''),
    number: Number(d.number ?? 0),
    status: String(d.status ?? ''),
    settingId: String(d.settingId ?? ''),
    turnUserId: String(d.turnUserId ?? ''),
    guessedThisTurn: Number(d.guessedThisTurn ?? 0) === 1,
    pendingGuessId: String(d.pendingGuessId ?? ''),
  }
}

/** The round's 12 cards as the rules see them: id and kind. */
export async function loadCards(tools: ActionTools, roundId: string): Promise<Card[]> {
  const found = must(await tools.query('cards', { where: { roundId }, limit: 50 }), 'Loading the cards')
  return found.records.map((r) => ({ id: r.recordId, kind: r.data.kind as CardKind }))
}

/** A player's hand in a round, as card ids. */
export async function loadHandIds(tools: ActionTools, roundId: string, userId: string): Promise<string[]> {
  const found = must(await tools.query('hands', { where: { roundId, userId }, limit: 1 }), 'Loading a hand')
  if (found.records.length === 0) throw new Error('A hand is missing for this round.')
  return JSON.parse(String(found.records[0].data.cardIds)) as string[]
}

/**
 * Read a suspect, weapon, and location from the params. Each must be a card
 * in this round, of the right kind; otherwise refuse.
 */
export function readTriple(params: Record<string, unknown>, cards: Card[]): Triple {
  const pick = (kind: CardKind): string => {
    const id = params[kind]
    const card = cards.find((c) => c.id === id)
    if (!card) refuse(`The ${kind} is not a card in this round.`)
    if (card.kind !== kind) refuse(`The card named as the ${kind} is a ${card.kind}.`)
    return card.id
  }
  return { suspect: pick('suspect'), weapon: pick('weapon'), location: pick('location') }
}
