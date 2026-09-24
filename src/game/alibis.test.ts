import { describe, expect, it } from 'vitest'
import { ALIBI_MAX_WORDS, alibiPrompt, templateAlibi, validateAlibis } from './alibis'
import { GRAPHIC_TERMS } from './caseGen'
import { PRESET_CASE } from './presetCase'
import { SETTINGS } from './settings'

const setting = SETTINGS[1]
const cards = PRESET_CASE.cards

/** A valid AI reply (R43): one alibi per card, by number. */
function validReply() {
  return { alibis: cards.map((_, i) => ({ n: i + 1, alibi: 'Three witnesses place it far from the scene all night.' })) }
}
const cardList = cards.map((c) => ({ kind: c.kind, name: c.name }))

describe('alibiPrompt (R41, R43)', () => {
  it('includes all 12 card names and descriptions, numbered 1 to 12, with no kind in parentheses', () => {
    const text = Object.values(alibiPrompt(setting, cards)).join('\n')
    expect(cards).toHaveLength(12)
    cards.forEach((c, i) => {
      expect(text).toContain(`${i + 1}. ${c.name}: ${c.description}`)
    })
    expect(text).not.toMatch(/\((suspect|method|place|weapon|location)\)/i)
    expect(text).toContain(setting.name)
  })

  it('never carries an envelope marker: the AI is not told which cards are the answer', () => {
    const text = Object.values(alibiPrompt(setting, cards)).join('\n')
    expect(text).not.toMatch(/envelope|solution|culprit|guilty|the real answer is/i)
  })

  it(`asks for one short in-setting alibi per card by number, at most ${ALIBI_MAX_WORDS} words, saying why it cannot be the answer`, () => {
    const text = Object.values(alibiPrompt(setting, cards)).join('\n')
    expect(text).toMatch(/one alibi for each of the 12 cards/i)
    expect(text).toContain(`at most ${ALIBI_MAX_WORDS} words`)
    expect(text).toMatch(/why it cannot be the answer/i)
    expect(text).toContain('{"alibis": [{"n": 1, "alibi": "..."}')
    expect(text).toMatch(/short form or a pronoun/i)
    for (const term of GRAPHIC_TERMS) expect(text, term).toContain(term)
  })
})

/** The per-card results of a check that returned a list. */
function results(input: unknown, list = cardList, players?: string[]) {
  const checked = validateAlibis(input, list, players)
  if (!checked.ok) throw new Error(`expected per-card results, got: ${checked.errors.join(' ')}`)
  return checked.results
}

describe('validateAlibis (R41, R43: by number, card by card)', () => {
  it('parses the reply by n and returns one result per card, in card order', () => {
    const reply = { alibis: [...validReply().alibis].reverse().map((a) => ({ ...a, alibi: `Alibi number ${a.n} holds.` })) }
    const r = results(reply)
    expect(r).toHaveLength(12)
    r.forEach((x, i) => expect(x).toEqual({ ok: true, text: `Alibi number ${i + 1} holds.` }))
  })

  it('accepts "n" given as a numeric string', () => {
    const reply = { alibis: validReply().alibis.map((a) => ({ ...a, n: String(a.n) })) }
    expect(results(reply).every((x) => x.ok)).toBe(true)
  })

  it('a missing n fails only that card', () => {
    const reply = validReply()
    reply.alibis = reply.alibis.filter((a) => a.n !== 5)
    const r = results(reply)
    expect(r.filter((x) => !x.ok)).toHaveLength(1)
    expect(r[4]).toMatchObject({ ok: false })
    if (!r[4].ok) expect(r[4].errors.join(' ')).toMatch(/Alibi 5 is missing/)
  })

  it('does not require the card name in the text (R43: the UI shows it)', () => {
    expect(results(validReply()).every((x) => x.ok)).toBe(true)
  })

  it(`rejects an alibi over ${ALIBI_MAX_WORDS} words, by number`, () => {
    const reply = validReply()
    reply.alibis[2].alibi = 'was elsewhere '.repeat(20)
    const r = results(reply)
    expect(r[2].ok).toBe(false)
    if (!r[2].ok) expect(r[2].errors.join(' ')).toMatch(new RegExp(`Alibi 3 .*${ALIBI_MAX_WORDS} words`))
  })

  it('rejects graphic terms', () => {
    const reply = validReply()
    reply.alibis[3].alibi = 'It was cleaning blood off the floor elsewhere.'
    const r = results(reply)
    expect(r[3].ok).toBe(false)
    if (!r[3].ok) expect(r[3].errors.join(' ')).toMatch(/graphic/i)
  })

  it('rejects player-name tokens, and the error never echoes the name', () => {
    const players = ['Nathan Wunderlich', 'Sam Porter']
    for (const token of ['Nathan', 'Wunderlich', 'Porter']) {
      const reply = validReply()
      reply.alibis[4].alibi = `It was with ${token} all evening.`
      const r = results(reply, cardList, players)
      expect(r[4].ok, token).toBe(false)
      if (!r[4].ok) {
        expect(r[4].errors.join(' ')).toMatch(/player's name/i)
        expect(r[4].errors.join(' ').toLowerCase()).not.toContain(token.toLowerCase())
      }
    }
  })

  it('rejects a reply that is not a list of alibis', () => {
    expect(validateAlibis(null, cardList).ok).toBe(false)
    expect(validateAlibis({ alibis: 'none' }, cardList).ok).toBe(false)
  })
})

describe('templateAlibi (R41)', () => {
  it('names the card, for every kind, within the word cap and the tone guard', () => {
    for (const c of cards) {
      const text = templateAlibi(c)
      expect(text).toContain(c.name)
      expect(text.trim().split(/\s+/).length).toBeLessThanOrEqual(ALIBI_MAX_WORDS)
      const own = results({ alibis: cards.map((x, i) => ({ n: i + 1, alibi: templateAlibi(x) })) })
      expect(own.every((x) => x.ok)).toBe(true)
    }
  })
})

describe('an alibi names only its own card (R42, R43)', () => {
  // The D49 sample case (The Prehistoric Joyride), where alibis named other cards.
  const joyride = [
    { kind: 'suspect' as const, name: 'Captain Zenn' },
    { kind: 'suspect' as const, name: 'Dr. Flax Meridian' },
    { kind: 'suspect' as const, name: 'Gus Krell' },
    { kind: 'suspect' as const, name: 'Yuki Okafor' },
    { kind: 'weapon' as const, name: 'Plasma Wrench' },
    { kind: 'weapon' as const, name: 'Crystal Shard Spike' },
    { kind: 'weapon' as const, name: 'Temporal Disruptor' },
    { kind: 'weapon' as const, name: 'Magnetic Overload Coil' },
    { kind: 'location' as const, name: 'The Cockpit' },
    { kind: 'location' as const, name: 'The Dense Crystal Cave' },
    { kind: 'location' as const, name: 'The Engine Room' },
    { kind: 'location' as const, name: 'The Cargo Hold' },
  ]
  const at = (list: { name: string }[], name: string) => list.findIndex((c) => c.name === name)
  const reply = (list: { name: string }[], overrides: Record<string, string>) => ({
    alibis: list.map((c, i) => ({ n: i + 1, alibi: overrides[c.name] ?? 'A signed log puts it out of reach all night.' })),
  })

  it('accepts alibis that name only their own card', () => {
    expect(results(reply(joyride, {}), joyride).every((x) => x.ok)).toBe(true)
  })

  it('rejects an alibi for Gus Krell that mentions "the Engine Room", naming the kind, not the text', () => {
    const r = results(reply(joyride, { 'Gus Krell': 'Gus was fixing the landing gear in the Engine Room the whole time.' }), joyride)
    const x = r[at(joyride, 'Gus Krell')]
    expect(x.ok).toBe(false)
    if (!x.ok) {
      expect(x.errors.join(' ')).toMatch(/another location card/i)
      expect(x.errors.join(' ')).not.toMatch(/engine room/i)
    }
  })

  it('rejects an alibi that mentions "Yuki" (another suspect\'s first name)', () => {
    const r = results(reply(joyride, { 'Dr. Flax Meridian': "He was by the river; Yuki's sensor log shows it." }), joyride)
    const x = r[at(joyride, 'Dr. Flax Meridian')]
    expect(x.ok).toBe(false)
    if (!x.ok) {
      expect(x.errors.join(' ')).toMatch(/another suspect card/i)
      expect(x.errors.join(' ')).not.toMatch(/yuki/i)
    }
  })

  it('rejects an alibi for The Cargo Hold that mentions "cockpit" in lowercase', () => {
    const r = results(reply(joyride, { 'The Cargo Hold': 'It stayed dark; nobody walked from the cockpit to it all hour.' }), joyride)
    const x = r[at(joyride, 'The Cargo Hold')]
    expect(x.ok).toBe(false)
    if (!x.ok) expect(x.errors.join(' ')).toMatch(/another location card/i)
  })

  // The D51 case (A Very Wealthy Christmas): three suspects share the surname Ashford.
  const christmas = [
    { kind: 'suspect' as const, name: 'Marcus Webb' },
    { kind: 'suspect' as const, name: 'Gerald Ashford' },
    { kind: 'suspect' as const, name: 'Cynthia Ashford-Price' },
    { kind: 'suspect' as const, name: 'Dr. Harrison Ashford' },
    { kind: 'weapon' as const, name: 'Poisoned Champagne Flute' },
    { kind: 'weapon' as const, name: 'Weighted Silk Scarf' },
    { kind: 'weapon' as const, name: 'Spiked Hot Chocolate' },
    { kind: 'weapon' as const, name: 'Tampered Jewelry Box' },
    { kind: 'location' as const, name: 'Indoor Swimming Pool' },
    { kind: 'location' as const, name: 'Grand Library' },
    { kind: 'location' as const, name: 'Master Bedroom' },
    { kind: 'location' as const, name: 'Festive Dining Hall' },
  ]

  it('accepts "Dr. Ashford" in Dr. Harrison Ashford\'s alibi: a token shared with its own name is ignored', () => {
    const text = 'Dr. Ashford was on a video call with the resort manager from 9 AM to 11:15 AM in his locked office.'
    const r = results(reply(christmas, { 'Dr. Harrison Ashford': text }), christmas)
    expect(r[at(christmas, 'Dr. Harrison Ashford')]).toEqual({ ok: true, text })
  })

  it('rejects "Dr. Ashford" in the Tampered Jewelry Box\'s alibi', () => {
    const text = 'The music box was locked in the safe by Dr. Ashford himself until the gift exchange.'
    const r = results(reply(christmas, { 'Tampered Jewelry Box': text }), christmas)
    const x = r[at(christmas, 'Tampered Jewelry Box')]
    expect(x.ok).toBe(false)
    if (!x.ok) expect(x.errors.join(' ')).toMatch(/another suspect card/i)
  })

  it('does not count a capitalized "The"', () => {
    const r = results(reply(joyride, { 'Gus Krell': 'The harbor log shows him ashore all night.' }), joyride)
    expect(r.every((x) => x.ok)).toBe(true)
  })

  it('the prompt says plainly to name no other card', () => {
    const text = Object.values(alibiPrompt(setting, cards)).join('\n')
    expect(text).toMatch(/never mention any other card/i)
  })
})
