import { describe, expect, it } from 'vitest'
import { pickSetting, SETTINGS } from './settings'

/** Small seeded random number generator (mulberry32), so every run picks the same settings. */
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

const ALL_IDS = SETTINGS.map((s) => s.id)

describe('SETTINGS', () => {
  it('holds the 12 settings from docs/SETTINGS.md, each with unique id and every field filled', () => {
    expect(SETTINGS).toHaveLength(12)
    expect(new Set(ALL_IDS).size).toBe(12)
    for (const s of SETTINGS) {
      for (const field of [s.id, s.name, s.hook, s.whyNoOneCanLeave, s.mood]) {
        expect(field.trim().length).toBeGreaterThan(0)
      }
    }
  })

  it('keeps the document order: first is Zoroastro, last is the Prehistoric Joyride', () => {
    expect(SETTINGS[0].name).toBe('The Lost City of Zoroastro')
    expect(SETTINGS[11].name).toBe('The Prehistoric Joyride')
  })
})

describe('pickSetting', () => {
  it('never returns a setting already used in the series', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const rng = seededRng(seed)
      const used: string[] = []
      // Play a whole best-of-7 series plus spare: 12 picks in a row, none repeating.
      for (let round = 0; round < 12; round++) {
        const picked = pickSetting(used, rng)
        expect(used).not.toContain(picked.id)
        used.push(picked.id)
      }
      expect([...used].sort()).toEqual([...ALL_IDS].sort())
    }
  })

  it('can reach all 12 settings from an empty series', () => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 500; seed++) seen.add(pickSetting([], seededRng(seed)).id)
    expect(seen.size).toBe(12)
  })

  it('picks by position among the unused settings (worked out by hand)', () => {
    // Worked by hand: with only settings 1 and 2 used, 10 remain (3..12 in order).
    // rng 0 -> floor(0 * 10) = 0 -> the first remaining, setting 3 (The Ransom Tide).
    // rng 0.999 -> floor(0.999 * 10) = 9 -> the last remaining, setting 12.
    const used = [ALL_IDS[0], ALL_IDS[1]]
    expect(pickSetting(used, () => 0).name).toBe('The Ransom Tide')
    expect(pickSetting(used, () => 0.999).name).toBe('The Prehistoric Joyride')
  })

  it('throws a clear error when all 12 are used', () => {
    expect(() => pickSetting(ALL_IDS, seededRng(1))).toThrow(/all 12 settings/i)
  })
})
