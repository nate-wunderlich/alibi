import { describe, expect, it } from 'vitest'
import { ALIBI_MAX_WORDS, alibiPrompt, templateAlibi, validateAlibis } from './alibis'
import { GRAPHIC_TERMS } from './caseGen'
import { PRESET_CASE } from './presetCase'
import { SETTINGS } from './settings'

const setting = SETTINGS[1]
const cards = PRESET_CASE.cards

/** A valid AI reply: one alibi per card, each naming its card. */
function validReply() {
  return {
    alibis: cards.map((c) => ({ card: c.name, alibi: `${c.name} is cleared: three witnesses place it far from the scene all night.` })),
  }
}

describe('alibiPrompt (R41)', () => {
  it('includes all 12 card names and descriptions', () => {
    const text = Object.values(alibiPrompt(setting, cards)).join('\n')
    expect(cards).toHaveLength(12)
    for (const c of cards) {
      expect(text).toContain(c.name)
      expect(text).toContain(c.description)
    }
    expect(text).toContain(setting.name)
  })

  it('never carries an envelope marker: the AI is not told which cards are the answer', () => {
    const text = Object.values(alibiPrompt(setting, cards)).join('\n')
    expect(text).not.toMatch(/envelope|solution|culprit|guilty|the real answer is/i)
  })

  it(`asks for one short in-setting alibi per card: at most ${ALIBI_MAX_WORDS} words, naming its card, saying why it cannot be the answer`, () => {
    const text = Object.values(alibiPrompt(setting, cards)).join('\n')
    expect(text).toMatch(/one alibi for each of the 12 cards/i)
    expect(text).toContain(`at most ${ALIBI_MAX_WORDS} words`)
    expect(text).toMatch(/name the card/i)
    expect(text).toMatch(/why it cannot be the answer/i)
    expect(text).toMatch(/JSON/)
    for (const term of GRAPHIC_TERMS) expect(text, term).toContain(term)
  })
})

describe('validateAlibis (R41)', () => {
  const names = cards.map((c) => c.name)

  it('accepts one alibi per card and returns them by card name', () => {
    const result = validateAlibis(validReply(), names)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(Object.keys(result.value).sort()).toEqual([...names].sort())
      expect(result.value[names[0]]).toContain(names[0])
    }
  })

  it('rejects a missing card', () => {
    const reply = validReply()
    reply.alibis.pop()
    const result = validateAlibis(reply, names)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/no alibi/i)
  })

  it('rejects an alibi that does not name its card', () => {
    const reply = validReply()
    reply.alibis[0].alibi = 'Three witnesses place it far from the scene all night.'
    const result = validateAlibis(reply, names)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/name its card/i)
  })

  it(`rejects an alibi over ${ALIBI_MAX_WORDS} words`, () => {
    const reply = validReply()
    reply.alibis[2].alibi = `${names[2]} ${'was elsewhere '.repeat(20)}`
    const result = validateAlibis(reply, names)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join(' ')).toMatch(new RegExp(`${ALIBI_MAX_WORDS} words`))
  })

  it('rejects graphic terms', () => {
    const reply = validReply()
    reply.alibis[3].alibi = `${names[3]} was cleaning blood off the floor elsewhere.`
    const result = validateAlibis(reply, names)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/graphic/i)
  })

  it('rejects player-name tokens, and the error never echoes the name', () => {
    const players = ['Nathan Wunderlich', 'Sam Porter']
    for (const token of ['Nathan', 'Wunderlich', 'Porter']) {
      const reply = validReply()
      reply.alibis[4].alibi = `${names[4]} was with ${token} all evening.`
      const result = validateAlibis(reply, names, players)
      expect(result.ok, token).toBe(false)
      if (!result.ok) {
        expect(result.errors.join(' ')).toMatch(/player's name/i)
        expect(result.errors.join(' ').toLowerCase()).not.toContain(token.toLowerCase())
      }
    }
  })

  it('rejects a reply that is not a list of alibis', () => {
    expect(validateAlibis(null, names).ok).toBe(false)
    expect(validateAlibis({ alibis: 'none' }, names).ok).toBe(false)
  })
})

describe('templateAlibi (R41)', () => {
  it('names the card, for every kind, within the word cap and the tone guard', () => {
    for (const c of cards) {
      const text = templateAlibi(c)
      expect(text).toContain(c.name)
      expect(text.trim().split(/\s+/).length).toBeLessThanOrEqual(ALIBI_MAX_WORDS)
      expect(validateAlibis({ alibis: cards.map((x) => ({ card: x.name, alibi: templateAlibi(x) })) }, cards.map((x) => x.name)).ok).toBe(true)
    }
  })
})
