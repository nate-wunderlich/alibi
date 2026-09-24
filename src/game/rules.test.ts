import { describe, expect, it } from 'vitest'
import {
  alibiDue,
  checkAccusation,
  deal,
  firstStarter,
  nextTurn,
  pickAlibiCard,
  resolveGuess,
  seriesWinner,
  starterForRound,
  type Card,
  type Deal,
} from './rules'

/** Small seeded random number generator (mulberry32), so every run deals the same cards. */
function seededRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** An rng that always returns the same number, for deals worked out by hand. */
const constantRng = (value: number) => () => value

// 12 placeholder cards: s1-s4 suspects, w1-w4 weapons, l1-l4 locations.
const DECK: Card[] = [
  ...[1, 2, 3, 4].map((n) => ({ id: `s${n}`, kind: 'suspect' as const })),
  ...[1, 2, 3, 4].map((n) => ({ id: `w${n}`, kind: 'weapon' as const })),
  ...[1, 2, 3, 4].map((n) => ({ id: `l${n}`, kind: 'location' as const })),
]

const ids = (cards: Card[]) => cards.map((c) => c.id)
const card = (id: string) => DECK.find((c) => c.id === id)!

/** Every card id in a deal, in one flat list. */
function allPlaced(d: Deal): string[] {
  return [
    d.envelope.suspect,
    d.envelope.weapon,
    d.envelope.location,
    ...ids(d.hands.host),
    ...ids(d.hands.guest),
    d.faceUp.id,
  ]
}

describe('deal', () => {
  it('puts all 12 cards in exactly one place, for many seeds', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const d = deal(DECK, seededRng(seed))
      const placed = allPlaced(d)
      expect(placed).toHaveLength(12)
      expect(new Set(placed).size).toBe(12)
      expect([...placed].sort()).toEqual(ids(DECK).sort())
    }
  })

  it('puts one card of each kind in the envelope', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const { envelope } = deal(DECK, seededRng(seed))
      expect(card(envelope.suspect).kind).toBe('suspect')
      expect(card(envelope.weapon).kind).toBe('weapon')
      expect(card(envelope.location).kind).toBe('location')
    }
  })

  it('deals two hands of 4 and never puts an envelope card in a hand', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const d = deal(DECK, seededRng(seed))
      expect(d.hands.host).toHaveLength(4)
      expect(d.hands.guest).toHaveLength(4)
      const envelopeIds = [d.envelope.suspect, d.envelope.weapon, d.envelope.location]
      for (const c of [...d.hands.host, ...d.hands.guest, d.faceUp]) {
        expect(envelopeIds).not.toContain(c.id)
      }
    }
  })

  it('gives different envelopes for different seeds (it is actually random)', () => {
    const envelopes = new Set<string>()
    for (let seed = 1; seed <= 200; seed++) {
      const { envelope } = deal(DECK, seededRng(seed))
      envelopes.add(`${envelope.suspect}-${envelope.weapon}-${envelope.location}`)
    }
    // 64 possible envelopes; 200 deals should hit well over half of them.
    expect(envelopes.size).toBeGreaterThan(40)
  })

  it('produces the deal worked out by hand when the rng always returns 0', () => {
    // Worked by hand, NOT by calling deal():
    // Envelope: each pick is floor(0 * 4) = 0, the first of its kind -> s1, w1, l1.
    // Remaining 9 in deck order: [s2,s3,s4,w2,w3,w4,l2,l3,l4].
    // Shuffle (Fisher-Yates, i = 8 down to 1, j = floor(0 * (i+1)) = 0, swap a[i] with a[0]):
    //   i=8: [l4,s3,s4,w2,w3,w4,l2,l3,s2]
    //   i=7: [l3,s3,s4,w2,w3,w4,l2,l4,s2]
    //   i=6: [l2,s3,s4,w2,w3,w4,l3,l4,s2]
    //   i=5: [w4,s3,s4,w2,w3,l2,l3,l4,s2]
    //   i=4: [w3,s3,s4,w2,w4,l2,l3,l4,s2]
    //   i=3: [w2,s3,s4,w3,w4,l2,l3,l4,s2]
    //   i=2: [s4,s3,w2,w3,w4,l2,l3,l4,s2]
    //   i=1: [s3,s4,w2,w3,w4,l2,l3,l4,s2]
    // Host gets the first 4, guest the next 4, the last is face up.
    const d = deal(DECK, constantRng(0))
    expect(d.envelope).toEqual({ suspect: 's1', weapon: 'w1', location: 'l1' })
    expect(ids(d.hands.host)).toEqual(['s3', 's4', 'w2', 'w3'])
    expect(ids(d.hands.guest)).toEqual(['w4', 'l2', 'l3', 'l4'])
    expect(d.faceUp.id).toBe('s2')
  })

  it('produces the deal worked out by hand when the rng always returns 0.999', () => {
    // Worked by hand: envelope picks floor(0.999 * 4) = 3, the last of each kind -> s4, w4, l4.
    // Shuffle: j = floor(0.999 * (i+1)) = i, so every swap is a[i] with itself: no change.
    // Remaining order stays [s1,s2,s3,w1,w2,w3,l1,l2,l3].
    const d = deal(DECK, constantRng(0.999))
    expect(d.envelope).toEqual({ suspect: 's4', weapon: 'w4', location: 'l4' })
    expect(ids(d.hands.host)).toEqual(['s1', 's2', 's3', 'w1'])
    expect(ids(d.hands.guest)).toEqual(['w2', 'w3', 'l1', 'l2'])
    expect(d.faceUp.id).toBe('l3')
  })

  it('refuses a deck that is not 4 suspects, 4 weapons, and 4 locations', () => {
    expect(() => deal(DECK.slice(0, 11), seededRng(1))).toThrow(/12 cards/)
    const fiveSuspects = [...DECK.slice(0, 11), { id: 's5', kind: 'suspect' as const }]
    expect(() => deal(fiveSuspects, seededRng(1))).toThrow(/4 of each kind/)
    const duplicate = [...DECK.slice(0, 11), { id: 'l1', kind: 'location' as const }]
    expect(() => deal(duplicate, seededRng(1))).toThrow(/unique/)
  })
})

describe('resolveGuess', () => {
  const opponentHand = [card('s2'), card('w3'), card('l4'), card('s3')]

  it('returns none when the opponent holds none of the three', () => {
    expect(resolveGuess({ suspect: 's1', weapon: 'w1', location: 'l1' }, opponentHand)).toEqual({
      type: 'none',
    })
  })

  it('shows the single matching card automatically', () => {
    expect(resolveGuess({ suspect: 's1', weapon: 'w3', location: 'l1' }, opponentHand)).toEqual({
      type: 'auto',
      card: card('w3'),
    })
  })

  it('asks the opponent to choose when two cards match', () => {
    expect(resolveGuess({ suspect: 's2', weapon: 'w1', location: 'l4' }, opponentHand)).toEqual({
      type: 'choose',
      options: [card('s2'), card('l4')],
    })
  })

  it('asks the opponent to choose when all three match', () => {
    expect(resolveGuess({ suspect: 's3', weapon: 'w3', location: 'l4' }, opponentHand)).toEqual({
      type: 'choose',
      options: [card('s3'), card('w3'), card('l4')],
    })
  })
})

describe('checkAccusation', () => {
  const envelope = { suspect: 's2', weapon: 'w4', location: 'l1' }

  it('is right only when all three cards match the envelope', () => {
    expect(checkAccusation({ suspect: 's2', weapon: 'w4', location: 'l1' }, envelope)).toBe(true)
  })

  it('is wrong when any one card differs', () => {
    expect(checkAccusation({ suspect: 's1', weapon: 'w4', location: 'l1' }, envelope)).toBe(false)
    expect(checkAccusation({ suspect: 's2', weapon: 'w3', location: 'l1' }, envelope)).toBe(false)
    expect(checkAccusation({ suspect: 's2', weapon: 'w4', location: 'l2' }, envelope)).toBe(false)
  })
})

describe('firstStarter and starterForRound (R41)', () => {
  it("round 1's starter is chosen by the rng: a coin flip", () => {
    expect(firstStarter(constantRng(0.1))).toBe('host')
    expect(firstStarter(constantRng(0.9))).toBe('guest')
    const rng = seededRng(7)
    const firsts = Array.from({ length: 1000 }, () => firstStarter(rng))
    const hosts = firsts.filter((p) => p === 'host').length
    expect(hosts).toBeGreaterThan(400)
    expect(hosts).toBeLessThan(600)
  })

  it('later rounds alternate from whoever started round 1', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((n) => starterForRound(n, 'host'))).toEqual([
      'host',
      'guest',
      'host',
      'guest',
      'host',
      'guest',
      'host',
    ])
    expect([1, 2, 3, 4, 5, 6, 7].map((n) => starterForRound(n, 'guest'))).toEqual([
      'guest',
      'host',
      'guest',
      'host',
      'guest',
      'host',
      'guest',
    ])
  })

  it('refuses round numbers below 1 or with fractions', () => {
    expect(() => starterForRound(0, 'host')).toThrow()
    expect(() => starterForRound(1.5, 'guest')).toThrow()
  })
})

describe('alibiDue (R41)', () => {
  it('is true after turns 4, 8, and 12 (every second full turn pair)', () => {
    for (const turn of [4, 8, 12]) expect(alibiDue(turn), `turn ${turn}`).toBe(true)
  })

  it('is false after every other turn', () => {
    for (const turn of [0, 1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 14]) expect(alibiDue(turn), `turn ${turn}`).toBe(false)
  })
})

describe('pickAlibiCard (R41)', () => {
  const dealt = deal(DECK, seededRng(3))

  it("returns a card from the starter's hand that is not already public", () => {
    for (const starter of ['host', 'guest'] as const) {
      const hand = ids(dealt.hands[starter])
      const publicIds = hand.slice(0, 2)
      for (let seed = 0; seed < 50; seed++) {
        const picked = pickAlibiCard(dealt, starter, publicIds, seededRng(seed))
        expect(picked).not.toBeNull()
        expect(hand).toContain(picked!.id)
        expect(publicIds).not.toContain(picked!.id)
      }
    }
  })

  it("returns null when every card in the starter's hand is already public", () => {
    expect(pickAlibiCard(dealt, 'host', ids(dealt.hands.host), seededRng(1))).toBeNull()
  })

  it("ignores public cards outside the starter's hand", () => {
    const publicIds = [...ids(dealt.hands.guest), dealt.faceUp.id]
    expect(pickAlibiCard(dealt, 'host', publicIds, seededRng(1))).not.toBeNull()
  })

  it('never picks a card in the envelope (1,000 random deals)', () => {
    const rng = seededRng(11)
    for (let i = 0; i < 1000; i++) {
      const d = deal(DECK, rng)
      const starter = rng() < 0.5 ? 'host' : 'guest'
      const alreadyPublic = ids(d.hands[starter]).filter(() => rng() < 0.3)
      const picked = pickAlibiCard(d, starter, alreadyPublic, rng)
      const envelope = [d.envelope.suspect, d.envelope.weapon, d.envelope.location]
      if (picked) {
        expect(envelope).not.toContain(picked.id)
        expect(ids(d.hands[starter])).toContain(picked.id)
      } else {
        expect(alreadyPublic).toHaveLength(4)
      }
    }
  })
})

describe('seriesWinner', () => {
  it.each([
    [3, 2],
    [5, 3],
    [7, 4],
  ] as const)('best of %i is won at %i wins', (bestOf, needed) => {
    // One short of the majority: nobody has won yet, whatever the other score.
    for (let other = 0; other < needed; other++) {
      expect(seriesWinner({ host: needed - 1, guest: other }, bestOf)).toBeNull()
      expect(seriesWinner({ host: other, guest: needed - 1 }, bestOf)).toBeNull()
    }
    expect(seriesWinner({ host: needed, guest: needed - 1 }, bestOf)).toBe('host')
    expect(seriesWinner({ host: 0, guest: needed }, bestOf)).toBe('guest')
  })

  it('returns null at the start of a series', () => {
    expect(seriesWinner({ host: 0, guest: 0 }, 5)).toBeNull()
  })

  it('refuses a series length other than 3, 5, or 7', () => {
    expect(() => seriesWinner({ host: 0, guest: 0 }, 4 as 3)).toThrow(/3, 5, or 7/)
  })
})

describe('nextTurn', () => {
  it('switches players', () => {
    expect(nextTurn('host')).toBe('guest')
    expect(nextTurn('guest')).toBe('host')
  })
})
