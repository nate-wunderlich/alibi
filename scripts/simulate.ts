#!/usr/bin/env node
/**
 * node scripts/simulate.ts [rounds] [config ...]
 *
 * Configs are schedule:source, e.g. A B:either B:starter C:starter; with
 * none given, every config runs. Each config keeps its own seed whatever
 * else runs, so a row always reproduces.
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
 * Both player models below are the standard (D47, architect).
 *
 * - CAREFUL keeps every possible envelope consistent with what it has seen
 *   (its hand, the face-up card, cards shown to it, "no match" results,
 *   alibis). The envelope fixes the opponent's hand (the 7 unseen cards are
 *   the envelope's 3 plus the opponent's 4), so this bookkeeping is exact.
 *   It guesses the triple (any of the 64, its own cards included) that
 *   leaves the fewest possible envelopes on average, and accuses only when
 *   exactly one envelope is left.
 * - CASUAL remembers only the cards it has seen (hand, face up, shown,
 *   alibis) and ignores "no match" results. It guesses a random unseen card
 *   of each kind, and accuses (at the start of its turn or right after its
 *   guess) when 2 or fewer possible envelopes are left: the product of its
 *   unseen suspects, weapons, and locations. It names a random unseen card
 *   of each kind, so at 2 it is a coin flip.
 *
 * Alibis clear one card that is not in the envelope and not already public
 * (face up or cleared); both players learn it. Schedules: A none; B one
 * after every full turn pair; C one after every second pair; D like B,
 * capped at 2 per round. Source: (i) random from either hand; (ii) from the
 * hand of the player who just moved (the second mover of the pair, so
 * always the non-starter); (iii) from the starter's hand (the player who
 * moved first in the round). Cards already cleared are skipped; if the
 * source has none left, there is no alibi. C(iii) is R41, the game's rule:
 * it runs through the rules module's own alibiDue and pickAlibiCard, so the
 * simulator and the game share one implementation (D48).
 *
 * Below the table: the chance the host wins a best-of-3 CAREFUL vs CAREFUL
 * series with the alternating starter (host starts rounds 1 and 3), from
 * the per-round starter win rate p: p(1-p) + (p^2 + (1-p)^2) p.
 *
 * "Guesses" counts the guesses made by the player who accused (their own,
 * not the round total): mean and max over rounds won by a right accusation.
 */

import { alibiDue, checkAccusation, deal, pickAlibiCard, resolveGuess, type Card, type CardKind, type Player, type Triple } from '../src/game/rules.ts'

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
type Source = 'either' | 'mover' | 'starter'
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
    const clear = (card: string) => {
      cleared.add(card)
      alibis++
      agents.host.learnAlibi(card)
      agents.guest.learnAlibi(card)
    }
    if (schedule === 'C' && source === 'starter') {
      // R41, the game's schedule: the SAME alibiDue and pickAlibiCard the game uses.
      if (alibiDue(turn)) {
        const card = pickAlibiCard(d, starter, [...cleared], rng)
        if (card) clear(card.id)
      }
    } else if (turn % 2 === 0) {
      const pair = turn / 2
      const due =
        schedule === 'B' || (schedule === 'C' && pair % 2 === 0) || (schedule === 'D' && alibis < 2)
      if (due) {
        const hands =
          source === 'either' ? [...d.hands.host, ...d.hands.guest] : source === 'mover' ? d.hands[current] : d.hands[starter]
        const eligible = hands.map((c) => c.id).filter((id) => !cleared.has(id))
        if (eligible.length > 0) clear(pickOne(eligible, rng))
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
const WANTED = process.argv.slice(3)
// New configs go at the end, so the older rows keep their seeds (and their numbers).
const ALL_CONFIGS: { schedule: Schedule; source: Source | null }[] = [
  { schedule: 'A', source: null },
  ...(['B', 'C', 'D'] as Schedule[]).flatMap((schedule) => (['either', 'mover'] as Source[]).map((source) => ({ schedule, source }))),
  ...(['B', 'C', 'D'] as Schedule[]).map((schedule) => ({ schedule, source: 'starter' as Source })),
]
const key = (c: { schedule: Schedule; source: Source | null }) => (c.source ? `${c.schedule}:${c.source}` : c.schedule)
const unknownConfigs = WANTED.filter((w) => !ALL_CONFIGS.some((c) => key(c) === w))
if (unknownConfigs.length) {
  console.error(`Unknown config(s): ${unknownConfigs.join(', ')}. Known: ${ALL_CONFIGS.map(key).join(' ')}`)
  process.exit(1)
}
const CONFIGS = ALL_CONFIGS.map((c, seedIndex) => ({ ...c, seedIndex })).filter((c) => WANTED.length === 0 || WANTED.includes(key(c)))
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
const SOURCE_LABEL: Record<Source, string> = { either: '(i) either hand', mover: '(ii) mover', starter: '(iii) starter' }
const series: string[] = []
let totalTimeouts = 0
CONFIGS.forEach(({ schedule, source, seedIndex }) => {
  const cc = run('cc', schedule, source ?? 'either', ROUNDS, 1000 + seedIndex)
  const cx = run('cx', schedule, source ?? 'either', ROUNDS, 2000 + seedIndex)
  const p = cc.starterWins / ROUNDS
  const hostBo3 = p * (1 - p) + (p * p + (1 - p) * (1 - p)) * p
  series.push(`${LABEL[schedule]} ${source ? SOURCE_LABEL[source] : '(n/a)'}: starter p = ${(100 * p).toFixed(1)}%, host wins best-of-3 = ${(100 * hostBo3).toFixed(1)}%`)
  totalTimeouts += cc.timeouts + cx.timeouts
  rows.push([
    LABEL[schedule],
    source === null ? '(n/a)' : SOURCE_LABEL[source],
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
console.log('\nBest-of-3, CAREFUL vs CAREFUL, host starts rounds 1 and 3:')
for (const s of series) console.log(`  ${s}`)
