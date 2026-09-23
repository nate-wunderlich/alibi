/**
 * Game rules for alibi (docs/GAME_RULES.md), as pure functions.
 *
 * Nothing here talks to the network, the database, or the AI. Every random
 * choice goes through an `rng` passed in by the caller, so tests can replay
 * the exact same deal.
 */

/** A random number generator: returns a number from 0 (inclusive) to 1 (exclusive), like Math.random. */
export type Rng = () => number

export type Player = 'host' | 'guest'
export type CardKind = 'suspect' | 'weapon' | 'location'

/** A card is only an id and a kind. Names and art live elsewhere; the rules never need them. */
export interface Card {
  id: string
  kind: CardKind
}

/** One suspect, one weapon, and one location, by card id. Used for the envelope, guesses, and accusations. */
export interface Triple {
  suspect: string
  weapon: string
  location: string
}

/** Where every card went at the start of a round. */
export interface Deal {
  envelope: Triple
  hands: Record<Player, Card[]>
  faceUp: Card
}

/** The outcome of a guess, from the opponent's hand. */
export type GuessResult =
  | { type: 'none' } // opponent holds none: both players see "no match"
  | { type: 'auto'; card: Card } // exactly one: it is shown automatically
  | { type: 'choose'; options: Card[] } // two or three: the opponent picks one to show

const KINDS: CardKind[] = ['suspect', 'weapon', 'location']

/** Pick a random whole number from 0 up to (but not including) `count`. */
export function randomIndex(count: number, rng: Rng): number {
  return Math.floor(rng() * count)
}

/**
 * Shuffle a copy of a list (Fisher-Yates): walk from the last item to the
 * second, swapping each with a random item at or before it. The original
 * list is left untouched.
 */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const result = [...items]
  for (let i = result.length - 1; i >= 1; i--) {
    const j = randomIndex(i + 1, rng)
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

/** Throw unless the deck is 12 unique cards, 4 of each kind. */
function checkDeck(deck: readonly Card[]): void {
  if (deck.length !== 12) throw new Error(`A deck needs 12 cards; got ${deck.length}.`)
  if (new Set(deck.map((c) => c.id)).size !== 12) throw new Error('Card ids must be unique.')
  for (const kind of KINDS) {
    const count = deck.filter((c) => c.kind === kind).length
    if (count !== 4) throw new Error(`A deck needs 4 of each kind; got ${count} of kind "${kind}".`)
  }
}

/**
 * Set up a round (GAME_RULES.md, "Round setup"):
 * 1. Pick one random suspect, weapon, and location for the envelope.
 * 2. Shuffle the other 9 cards.
 * 3. The host gets the first 4, the guest the next 4, and the last one is face up.
 */
export function deal(deck: readonly Card[], rng: Rng): Deal {
  checkDeck(deck)

  // Step 1: the envelope, one card of each kind.
  const pick = (kind: CardKind): string => {
    const ofKind = deck.filter((c) => c.kind === kind)
    return ofKind[randomIndex(ofKind.length, rng)].id
  }
  const envelope: Triple = { suspect: pick('suspect'), weapon: pick('weapon'), location: pick('location') }

  // Step 2: shuffle everything that is not in the envelope.
  const inEnvelope = new Set([envelope.suspect, envelope.weapon, envelope.location])
  const rest = shuffle(
    deck.filter((c) => !inEnvelope.has(c.id)),
    rng,
  )

  // Step 3: deal 4, 4, and 1 face up.
  return {
    envelope,
    hands: { host: rest.slice(0, 4), guest: rest.slice(4, 8) },
    faceUp: rest[8],
  }
}

/**
 * Check a guess against the opponent's hand (GAME_RULES.md, "Guessing").
 * Matching cards come back in guess order: suspect, then weapon, then location.
 */
export function resolveGuess(guess: Triple, opponentHand: readonly Card[]): GuessResult {
  const named = [guess.suspect, guess.weapon, guess.location]
  const matches = named
    .map((id) => opponentHand.find((c) => c.id === id))
    .filter((c): c is Card => c !== undefined)
  if (matches.length === 0) return { type: 'none' }
  if (matches.length === 1) return { type: 'auto', card: matches[0] }
  return { type: 'choose', options: matches }
}

/** An accusation is right only if all three cards match the envelope. Right wins the round; wrong loses it. */
export function checkAccusation(accusation: Triple, envelope: Triple): boolean {
  return (
    accusation.suspect === envelope.suspect &&
    accusation.weapon === envelope.weapon &&
    accusation.location === envelope.location
  )
}

/** Who starts a round: the host starts round 1, then it alternates (odd rounds host, even rounds guest). */
export function starterForRound(round: number): Player {
  if (!Number.isInteger(round) || round < 1) throw new Error(`Round numbers start at 1; got ${round}.`)
  return round % 2 === 1 ? 'host' : 'guest'
}

/**
 * The series winner, or null if nobody has won yet.
 * A player needs a majority of the rounds: 2 of 3, 3 of 5, or 4 of 7.
 */
export function seriesWinner(score: Record<Player, number>, bestOf: 3 | 5 | 7): Player | null {
  if (bestOf !== 3 && bestOf !== 5 && bestOf !== 7) {
    throw new Error(`A series is best of 3, 5, or 7; got ${bestOf}.`)
  }
  const needed = Math.floor(bestOf / 2) + 1
  if (score.host >= needed) return 'host'
  if (score.guest >= needed) return 'guest'
  return null
}

/** After a guess without an accusation, the turn passes to the other player. */
export function nextTurn(current: Player): Player {
  return current === 'host' ? 'guest' : 'host'
}
