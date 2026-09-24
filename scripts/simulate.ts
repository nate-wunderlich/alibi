#!/usr/bin/env node
/**
 * node scripts/simulate.ts [rounds]
 *
 * D45: simulate alibi schedules over the REAL rules (src/game/rules.ts:
 * deal, resolveGuess, checkAccusation) before building anything. No app
 * code, no network, no AI. Node 24 runs this TypeScript file directly.
 *
 * A round: 4/4/4 deck, 4 cards each, 1 face up; the starter alternates. On
 * a turn a player guesses and may then accuse, or accuses directly. The
 * opponent shows a card per the rules (their choice, random, when holding
 * 2+). A right accusation wins the round; a wrong one loses it.
 *
 * Players:
 * - CAREFUL keeps every possible envelope consistent with what it has seen
 *   (its hand, the face-up card, cards shown to it, "no match" results,
 *   alibis). The envelope fixes the opponent's hand (the 7 unseen cards are
 *   the envelope's 3 plus the opponent's 4), so this bookkeeping is exact.
 *   It guesses the triple (any of the 64, its own cards included) that
 *   leaves the fewest possible envelopes on average, and accuses only when
 *   exactly one envelope is left.
 * - CASUAL remembers only the cards it has seen (hand, face up, shown,
 *   alibis), guesses a random unseen card of each kind, and accuses when 2
 *   or fewer candidate envelopes are left (a coin flip at 2).
 *
 * Alibis clear one card that is not in the envelope and not already public
 * (face up or cleared); both players learn it. Schedules: A none; B one
 * after every full turn pair; C one after every second pair; D like B,
 * capped at 2 per round. Source: (i) random from either hand; (ii) from the
 * hand of the player who just moved (the second mover of the pair).
 *
 * "Guesses" counts the guesses made by the player who accused (their own,
 * not the round total): mean and max over rounds won by a right accusation.
 */

import { checkAccusation, deal, resolveGuess, type Card, type CardKind, type Player, type Triple } from '../src/game/rules.ts'

const KINDS: CardKind[] = ['suspect', 'weapon', 'location']
const DECK: Card[] = KINDS.flatMap((kind) => [0, 1, 2, 3].map((n) => ({ id: `${kind[0]}${n}`, kind })))
const BIT = new Map(DECK.map((c, i) => [c.id, 1 << i]))
const OF_KIND: Record<CardKind, string[]> = {
  suspect: DECK.filter((c) => c.kind === 'suspect').map((c) => c.id),
  weapon: DECK.filter((c) => c.kind === 'weapon').map((c) => c.id),
  location: DECK.filter((c) => c.kind === 'location').map((c) => c.id),
}
const ALL_TRIPLES: Triple[] = OF_KIND.suspect.flatMap((suspect) =>
  OF_KIND.weapon.flatMap((weapon) => OF_KIND.location.map((location) => ({ suspect, weapon, location }))),
)
const mask = (ids: string[]) => ids.reduce((m, id) => m | BIT.get(id)!, 0)
const tripleMask = (t: Triple) => mask([t.suspect, t.weapon, t.location])

/** mulberry32: a small seeded generator, so every run is reproducible. */
function seeded(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
type Rng = () => number
const pickOne = <T>(items: T[], rng: Rng): T => items[Math.floor(rng() * items.length)]

interface Agent {
  /** An accusation to make now, before guessing, or null. */
  accuseNow(rng: Rng): Triple | null
  guess(rng: Rng): Triple
  /** The result of this agent's own guess: the card shown, or null for "no match". */
  learnFromOwnGuess(guess: Triple, shown: string | null): void
  /** A card cleared by an alibi (public). */
  learnAlibi(card: string): void
}

class Careful implements Agent {
  private unknown: number // cards not in my hand and not face up: the envelope's 3 plus the opponent's 4
  private worlds: number[] // envelope masks still possible
  constructor(hand: Card[], faceUp: Card) {
    this.unknown = ((1 << 12) - 1) & ~mask([...hand.map((c) => c.id), faceUp.id])
    this.worlds = ALL_TRIPLES.map(tripleMask).filter((env) => (env & this.unknown) === env)
  }
  private keep(test: (env: number) => boolean) {
    this.worlds = this.worlds.filter(test)
  }
  accuseNow(): Triple | null {
    return this.worlds.length === 1 ? envelopeOf(this.worlds[0]) : null
  }
  guess(rng: Rng): Triple {
    // Fewest possible envelopes left on average, over the envelopes still possible (equally likely).
    let best: Triple[] = []
    let bestScore = Infinity
    for (const g of ALL_TRIPLES) {
      const named = [g.suspect, g.weapon, g.location].map((id) => BIT.get(id)!)
      let score = 0
      for (const env of this.worlds) {
        const opp = this.unknown & ~env
        const matches = named.filter((b) => opp & b)
        if (matches.length === 0) {
          score += this.worlds.filter((e) => named.every((b) => !(this.unknown & ~e & b))).length
        } else {
          for (const b of matches) score += this.worlds.filter((e) => !(e & b)).length / matches.length
        }
      }
      if (score < bestScore - 1e-9) {
        bestScore = score
        best = [g]
      } else if (Math.abs(score - bestScore) <= 1e-9) best.push(g)
    }
    return pickOne(best, rng)
  }
  learnFromOwnGuess(guess: Triple, shown: string | null) {
    if (shown) {
      const b = BIT.get(shown)!
      this.keep((env) => !(env & b))
    } else {
      const named = tripleMask(guess)
      this.keep((env) => (this.unknown & ~env & named) === 0)
    }
  }
  learnAlibi(card: string) {
    const b = BIT.get(card)!
    this.keep((env) => !(env & b))
  }
}

class Casual implements Agent {
  private seen: Set<string>
  constructor(hand: Card[], faceUp: Card) {
    this.seen = new Set([...hand.map((c) => c.id), faceUp.id])
  }
  private unseen(kind: CardKind) {
    return OF_KIND[kind].filter((id) => !this.seen.has(id))
  }
  accuseNow(rng: Rng): Triple | null {
    const [s, w, l] = KINDS.map((k) => this.unseen(k))
    if (s.length * w.length * l.length > 2) return null
    return { suspect: pickOne(s, rng), weapon: pickOne(w, rng), location: pickOne(l, rng) }
  }
  guess(rng: Rng): Triple {
    const [s, w, l] = KINDS.map((k) => this.unseen(k))
    return { suspect: pickOne(s, rng), weapon: pickOne(w, rng), location: pickOne(l, rng) }
  }
  learnFromOwnGuess(_guess: Triple, shown: string | null) {
    if (shown) this.seen.add(shown)
  }
  learnAlibi(card: string) {
    this.seen.add(card)
  }
}

function envelopeOf(env: number): Triple {
  const [suspect, weapon, location] = KINDS.map((k) => OF_KIND[k].find((id) => env & BIT.get(id)!)!)
  return { suspect, weapon, location }
}

type Schedule = 'A' | 'B' | 'C' | 'D'
type Source = 'either' | 'mover'
type Kind = 'careful' | 'casual'

interface Outcome {
  winner: Player
  starter: Player
  accuserGuesses: number
  right: boolean
  timedOut: boolean
}

const other = (p: Player): Player => (p === 'host' ? 'guest' : 'host')
const MAX_TURNS = 200

function playRound(kinds: Record<Player, Kind>, starter: Player, schedule: Schedule, source: Source, rng: Rng): Outcome {
  const d = deal(DECK, rng)
  const make = (p: Player): Agent => (kinds[p] === 'careful' ? new Careful(d.hands[p], d.faceUp) : new Casual(d.hands[p], d.faceUp))
  const agents: Record<Player, Agent> = { host: make('host'), guest: make('guest') }
  const guesses: Record<Player, number> = { host: 0, guest: 0 }
  const cleared = new Set<string>()
  let alibis = 0
  let current = starter

  const finish = (accuser: Player, accusation: Triple): Outcome => {
    const right = checkAccusation(accusation, d.envelope)
    return { winner: right ? accuser : other(accuser), starter, accuserGuesses: guesses[accuser], right, timedOut: false }
  }

  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    const me = agents[current]
    const direct = me.accuseNow(rng)
    if (direct) return finish(current, direct)
    const g = me.guess(rng)
    guesses[current]++
    const r = resolveGuess(g, d.hands[other(current)])
    const shown = r.type === 'none' ? null : r.type === 'auto' ? r.card.id : pickOne(r.options, rng).id
    me.learnFromOwnGuess(g, shown)
    const after = me.accuseNow(rng)
    if (after) return finish(current, after)

    // Alibis come after a full turn pair (both players have moved).
    if (turn % 2 === 0) {
      const pair = turn / 2
      const due =
        schedule === 'B' || (schedule === 'C' && pair % 2 === 0) || (schedule === 'D' && alibis < 2)
      if (due) {
        const hands = source === 'either' ? [...d.hands.host, ...d.hands.guest] : d.hands[current]
        const eligible = hands.map((c) => c.id).filter((id) => !cleared.has(id))
        if (eligible.length > 0) {
          const card = pickOne(eligible, rng)
          cleared.add(card)
          alibis++
          agents.host.learnAlibi(card)
          agents.guest.learnAlibi(card)
        }
      }
    }
    current = other(current)
  }
  return { winner: starter, starter, accuserGuesses: 0, right: false, timedOut: true }
}

interface Stats {
  meanGuesses: number
  maxGuesses: number
  starterWins: number
  carefulWins: number
  quick: number
  timeouts: number
}

function run(matchup: 'cc' | 'cx', schedule: Schedule, source: Source, rounds: number, seed: number): Stats {
  const rng = seeded(seed)
  let sum = 0
  let n = 0
  let max = 0
  let starterWins = 0
  let carefulWins = 0
  let quick = 0
  let timeouts = 0
  for (let i = 0; i < rounds; i++) {
    const starter: Player = i % 2 === 0 ? 'host' : 'guest'
    // CAREFUL vs CASUAL: the seats alternate every two rounds, so each seat meets each starter equally.
    const carefulSeat: Player = Math.floor(i / 2) % 2 === 0 ? 'host' : 'guest'
    const kinds: Record<Player, Kind> =
      matchup === 'cc' ? { host: 'careful', guest: 'careful' } : { [carefulSeat]: 'careful', [other(carefulSeat)]: 'casual' } as Record<Player, Kind>
    const o = playRound(kinds, starter, schedule, source, rng)
    if (o.timedOut) {
      timeouts++
      continue
    }
    if (o.right) {
      sum += o.accuserGuesses
      n++
      max = Math.max(max, o.accuserGuesses)
    }
    if (o.winner === o.starter) starterWins++
    if (matchup === 'cx' && o.winner === carefulSeat) carefulWins++
    if (o.accuserGuesses <= 1) quick++
  }
  return { meanGuesses: sum / n, maxGuesses: max, starterWins, carefulWins, quick, timeouts }
}

const ROUNDS = Number(process.argv[2] ?? 20000)
const CONFIGS: { schedule: Schedule; source: Source | null }[] = [
  { schedule: 'A', source: null },
  ...(['B', 'C', 'D'] as Schedule[]).flatMap((schedule) => (['either', 'mover'] as Source[]).map((source) => ({ schedule, source }))),
]
const pct = (k: number) => `${((100 * k) / ROUNDS).toFixed(1)}%`
const LABEL: Record<Schedule, string> = {
  A: 'A none',
  B: 'B every pair',
  C: 'C every 2nd pair',
  D: 'D every pair, max 2',
}

const header = [
  'schedule',
  'source',
  'CvC mean',
  'CvC max',
  'CvC starter wins',
  'CvC <=1 guess',
  'CvX mean',
  'CvX max',
  'CAREFUL wins vs CASUAL',
  'CvX <=1 guess',
]
const rows: string[][] = []
let totalTimeouts = 0
CONFIGS.forEach(({ schedule, source }, i) => {
  const cc = run('cc', schedule, source ?? 'either', ROUNDS, 1000 + i)
  const cx = run('cx', schedule, source ?? 'either', ROUNDS, 2000 + i)
  totalTimeouts += cc.timeouts + cx.timeouts
  rows.push([
    LABEL[schedule],
    source === null ? '(n/a)' : source === 'either' ? '(i) either hand' : '(ii) mover',
    cc.meanGuesses.toFixed(2),
    String(cc.maxGuesses),
    pct(cc.starterWins),
    pct(cc.quick),
    cx.meanGuesses.toFixed(2),
    String(cx.maxGuesses),
    pct(cx.carefulWins),
    pct(cx.quick),
  ])
})

const widths = header.map((h, c) => Math.max(h.length, ...rows.map((r) => r[c].length)))
const line = (cells: string[]) => '| ' + cells.map((cell, c) => cell.padEnd(widths[c])).join(' | ') + ' |'
console.log(`${ROUNDS} rounds per cell. CvC = CAREFUL vs CAREFUL; CvX = CAREFUL vs CASUAL. Guesses = the accuser's own guesses, over rounds won by a right accusation.`)
console.log(line(header))
console.log('|' + widths.map((w) => '-'.repeat(w + 2)).join('|') + '|')
for (const r of rows) console.log(line(r))
console.log(`timeouts (rounds over ${MAX_TURNS} turns, excluded): ${totalTimeouts}`)
