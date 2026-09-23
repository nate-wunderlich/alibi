/**
 * Game collections (docs/SPEC.md, "Data and visibility").
 *
 * Clients never write any of these except their own `notes` row: every
 * other row is created and changed by a server action (src/actions/), which
 * checks the caller itself. So every role has create/update/delete: false.
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

/** Signed-in users may read only rows they own (the schema's ownerField); nobody may write. */
const OWN_READ_ONLY: RolePermissions = { read: 'own', create: false, update: false, delete: false }
const signedInOwnReadOnly: Record<string, RolePermissions> = {
  viewer: OWN_READ_ONLY,
  member: OWN_READ_ONLY,
  admin: OWN_READ_ONLY,
  '*': NO_ACCESS,
}

/** A series between a host and a guest. Status: lobby -> playing -> finished. */
export const gamesSchema: CollectionSchema = {
  name: 'games',
  columns: [
    text('host'),
    text('guest'),
    number('bestOf'),
    number('scoreHost'),
    number('scoreGuest'),
    number('currentRound'),
    text('status'),
    /** The winner's user id once the series is decided. */
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

/**
 * One row per round. Status: generating -> ready -> playing -> revealed.
 *
 * `guessedThisTurn` is 1 once the player on turn has guessed (R33: one guess
 * per turn, and no ending a turn without one). `pendingGuessId` is set while
 * the opponent must choose which card to show.
 *
 * The revealed* fields stay empty until the reveal, then hold JSON copies of
 * the solution, both hands, and the accusation (R30). The secret collections
 * themselves are never opened up.
 */
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
    text('turnUserId'),
    number('guessedThisTurn'),
    text('pendingGuessId'),
    text('faceUpCardId'),
    text('winnerUserId'),
    text('revealedSolution'),
    text('revealedHands'),
    text('revealedAccusation'),
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
 * R29: each player reads only their own hand.
 */
export const handsSchema: CollectionSchema = {
  name: 'hands',
  columns: [text('roundId'), text('userId'), text('cardIds')],
  ownerField: 'userId',
  permissions: signedInOwnReadOnly,
}

/**
 * The envelope for a round: one suspect, one weapon, one location (card ids).
 *
 * R29: no client may read it, the app owner included. Only a '*' entry, all
 * false: every role falls back to it. Server actions still read it.
 */
export const solutionSchema: CollectionSchema = {
  name: 'solution',
  columns: [text('roundId'), text('suspect'), text('weapon'), text('location')],
  permissions: { '*': NO_ACCESS },
}

/**
 * A game's join code, kept out of `games` so only the host can read it.
 *
 * R32: readable only by the host (hostId); a lobby could otherwise be joined
 * by any signed-in user.
 */
export const joinCodesSchema: CollectionSchema = {
  name: 'join_codes',
  columns: [text('gameId'), text('code'), text('hostId')],
  ownerField: 'hostId',
  permissions: signedInOwnReadOnly,
}

/**
 * Every guess. Both players see every guess and whether a card was shown
 * (GAME_RULES.md, "Guessing"), so it holds no secrets.
 * result: 'pending' (the opponent must choose), 'shown', or 'none'.
 */
export const guessesSchema: CollectionSchema = {
  name: 'guesses',
  columns: [
    text('roundId'),
    text('byUserId'),
    text('suspect'),
    text('weapon'),
    text('location'),
    text('result'),
    number('seq'),
  ],
  permissions: signedInReadOnly,
}

/**
 * Which card was shown for a guess. R29: only the guesser (toUserId) reads it;
 * the player who showed it already knows.
 */
export const shownCardsSchema: CollectionSchema = {
  name: 'shown_cards',
  columns: [text('guessId'), text('roundId'), text('toUserId'), text('cardId')],
  ownerField: 'toUserId',
  permissions: signedInOwnReadOnly,
}

/**
 * Accusations. R30: no client reads this collection; the reveal copies the
 * accusation into the round.
 */
export const accusationsSchema: CollectionSchema = {
  name: 'accusations',
  columns: [
    text('roundId'),
    text('byUserId'),
    text('suspect'),
    text('weapon'),
    text('location'),
    number('correct'),
  ],
  permissions: { '*': NO_ACCESS },
}

/**
 * Each player's detective grid for a round. `marks` is JSON:
 * { [cardId]: { me?, opponent?, envelope? } }, each 'has' | 'no' | 'maybe'.
 * Only the player's own taps are stored; what they provably know is
 * worked out on screen.
 *
 * R29: owner only. This is the one collection clients write: a player may
 * create their own row (userId is userBound, so it is always the creator)
 * and update only its marks. No deletes, and no reading anyone else's.
 */
export const notesSchema: CollectionSchema = {
  name: 'notes',
  columns: [text('roundId'), { ...text('userId'), userBound: true }, text('marks')],
  ownerField: 'userId',
  uniqueOn: ['roundId', 'userId'],
  permissions: {
    viewer: { read: 'own', create: true, update: 'own', delete: false, writableFields: ['roundId', 'marks'] },
    member: { read: 'own', create: true, update: 'own', delete: false, writableFields: ['roundId', 'marks'] },
    admin: { read: 'own', create: true, update: 'own', delete: false, writableFields: ['roundId', 'marks'] },
    '*': NO_ACCESS,
  },
}

export const gameSchemas: CollectionSchema[] = [
  gamesSchema,
  playersSchema,
  roundsSchema,
  cardsSchema,
  handsSchema,
  solutionSchema,
  joinCodesSchema,
  guessesSchema,
  shownCardsSchema,
  accusationsSchema,
  notesSchema,
]
