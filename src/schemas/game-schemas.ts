/**
 * Game collections (docs/SPEC.md, "Data and visibility").
 *
 * Clients never write any of these: every row is created and changed by a
 * server action (src/actions/games.ts), which checks the caller itself.
 * So every role has create/update/delete: false.
 *
 * Public game state (games, players, rounds, cards) is readable by any
 * signed-in user for now. Narrowing it to the two players in a game is
 * later work.
 */

import type { CollectionSchema, ColumnDefinition, RolePermissions } from 'deepspace/schema'

const text = (name: string): ColumnDefinition => ({ name, storage: 'text', interpretation: 'plain' })
const number = (name: string): ColumnDefinition => ({ name, storage: 'number', interpretation: 'plain' })

/** Signed-in users may read; nobody may write from the browser. */
const READ_ONLY: RolePermissions = { read: true, create: false, update: false, delete: false }
const NO_ACCESS: RolePermissions = { read: false, create: false, update: false, delete: false }

/** Readable by signed-in roles; anonymous visitors ('*') get nothing. */
const signedInReadOnly: Record<string, RolePermissions> = {
  viewer: READ_ONLY,
  member: READ_ONLY,
  admin: READ_ONLY,
  '*': NO_ACCESS,
}

/** A series between a host and a guest. Status: lobby -> playing -> finished. */
export const gamesSchema: CollectionSchema = {
  name: 'games',
  columns: [
    text('code'),
    text('host'),
    text('guest'),
    number('bestOf'),
    number('hostScore'),
    number('guestScore'),
    number('currentRound'),
    text('status'),
    text('seriesWinner'),
  ],
  permissions: signedInReadOnly,
}

/** One row per player in a game. Seat is 'host' or 'guest'. */
export const playersSchema: CollectionSchema = {
  name: 'players',
  columns: [text('gameId'), text('userId'), text('displayName'), text('seat')],
  permissions: signedInReadOnly,
}

/** One row per round. Status: generating -> ready -> playing -> revealed. */
export const roundsSchema: CollectionSchema = {
  name: 'rounds',
  columns: [
    text('gameId'),
    number('number'),
    text('status'),
    text('settingId'),
    text('caseTitle'),
    text('victim'),
    text('openingNarration'),
    text('starter'),
    text('turn'),
    text('faceUpCardId'),
    text('winner'),
  ],
  permissions: signedInReadOnly,
}

/** The 12 cards of a round. A card's record id is the id the rules use. */
export const cardsSchema: CollectionSchema = {
  name: 'cards',
  columns: [text('roundId'), text('kind'), text('name'), text('description'), text('imageUrl')],
  permissions: signedInReadOnly,
}

/**
 * Each player's 4 cards for a round. `cardIds` is a JSON list of card record ids.
 *
 * `userId` is the owner, set by the startSeries action for BOTH players.
 * It is deliberately NOT `userBound`: that would force it to the caller
 * (the host) for both rows.
 *
 * TEMPORARY: permissive for the red secrecy test (D10). D11 locks this per R29.
 */
export const handsSchema: CollectionSchema = {
  name: 'hands',
  columns: [text('roundId'), text('userId'), text('cardIds')],
  ownerField: 'userId',
  permissions: signedInReadOnly,
}

/**
 * The envelope for a round: one suspect, one weapon, one location (card ids).
 *
 * TEMPORARY: permissive for the red secrecy test (D10). D11 locks this per R29.
 */
export const solutionSchema: CollectionSchema = {
  name: 'solution',
  columns: [text('roundId'), text('suspect'), text('weapon'), text('location')],
  permissions: signedInReadOnly,
}

export const gameSchemas: CollectionSchema[] = [
  gamesSchema,
  playersSchema,
  roundsSchema,
  cardsSchema,
  handsSchema,
  solutionSchema,
]
