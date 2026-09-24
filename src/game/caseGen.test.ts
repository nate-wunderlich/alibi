import { describe, expect, it } from 'vitest'
import {
  buildCasePrompt,
  buildQuestionPrompt,
  CARD_DESCRIPTION_MAX,
  CARD_NAME_MAX,
  findGraphicTerm,
  GRAPHIC_TERMS,
  NARRATION_MAX,
  validateCase,
  type GeneratedCase,
} from './caseGen'
import { SETTINGS } from './settings'

const setting = SETTINGS[1] // The Orion Asteroid Run

/** A valid case: 4 suspects, 4 weapons, 4 locations, all names unique. */
function validCase(): GeneratedCase {
  const cards = (prefix: string) =>
    [1, 2, 3, 4].map((n) => ({ name: `${prefix} ${n}`, description: `The ${prefix.toLowerCase()} number ${n}.` }))
  return {
    title: 'The Airlock Affair',
    victim: 'Chief Engineer Vale',
    openingNarration: 'The alarm stopped. Nobody on the ship could say who opened the airlock.',
    suspects: cards('Suspect'),
    weapons: cards('Method'),
    locations: cards('Place'),
  }
}

describe('validateCase', () => {
  it('accepts 4 suspects, 4 weapons, 4 locations, a title, a victim, and an opening', () => {
    const result = validateCase(validCase())
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.case.title).toBe('The Airlock Affair')
      expect(result.case.cards).toHaveLength(12)
      expect(result.case.cards.filter((c) => c.kind === 'suspect')).toHaveLength(4)
      expect(result.case.cards.filter((c) => c.kind === 'weapon')).toHaveLength(4)
      expect(result.case.cards.filter((c) => c.kind === 'location')).toHaveLength(4)
    }
  })

  it('rejects the wrong number of cards of any kind', () => {
    for (const kind of ['suspects', 'weapons', 'locations'] as const) {
      const three = validCase()
      three[kind] = three[kind].slice(0, 3)
      expect(validateCase(three).ok, `3 ${kind}`).toBe(false)
      const five = validCase()
      five[kind] = [...five[kind], { name: 'Extra', description: 'One too many.' }]
      expect(validateCase(five).ok, `5 ${kind}`).toBe(false)
    }
  })

  it('rejects duplicate names, across kinds and ignoring case', () => {
    const sameKind = validCase()
    sameKind.suspects[1] = { ...sameKind.suspects[1], name: 'suspect 1' }
    expect(validateCase(sameKind).ok).toBe(false)

    const acrossKinds = validCase()
    acrossKinds.locations[0] = { ...acrossKinds.locations[0], name: 'Method 2' }
    expect(validateCase(acrossKinds).ok).toBe(false)
  })

  it(`rejects names over ${CARD_NAME_MAX} and descriptions over ${CARD_DESCRIPTION_MAX} characters`, () => {
    expect(CARD_NAME_MAX).toBe(40)
    expect(CARD_DESCRIPTION_MAX).toBe(140)

    const atLimit = validCase()
    atLimit.weapons[0] = { name: 'N'.repeat(40), description: 'D'.repeat(140) }
    expect(validateCase(atLimit).ok).toBe(true)

    const longName = validCase()
    longName.weapons[0] = { ...longName.weapons[0], name: 'N'.repeat(41) }
    expect(validateCase(longName).ok).toBe(false)

    const longDescription = validCase()
    longDescription.weapons[0] = { ...longDescription.weapons[0], description: 'D'.repeat(141) }
    expect(validateCase(longDescription).ok).toBe(false)
  })

  it(`rejects an opening narration over ${NARRATION_MAX} characters`, () => {
    expect(NARRATION_MAX).toBe(600)
    const atLimit = validCase()
    atLimit.openingNarration = 'N'.repeat(600)
    expect(validateCase(atLimit).ok).toBe(true)
    const tooLong = validCase()
    tooLong.openingNarration = 'N'.repeat(601)
    expect(validateCase(tooLong).ok).toBe(false)
  })

  it('rejects a missing title, victim, or opening, and input that is not a case', () => {
    for (const field of ['title', 'victim', 'openingNarration'] as const) {
      const blank = validCase()
      blank[field] = '  '
      expect(validateCase(blank).ok, `blank ${field}`).toBe(false)
    }
    expect(validateCase(null).ok).toBe(false)
    expect(validateCase('a case').ok).toBe(false)
    expect(validateCase({ ...validCase(), suspects: 'four' }).ok).toBe(false)
    expect(validateCase({ ...validCase(), weapons: [1, 2, 3, 4] }).ok).toBe(false)
  })

  it('explains what is wrong', () => {
    const result = validateCase({ ...validCase(), suspects: validCase().suspects.slice(0, 2) })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/4 suspects/)
  })
})

describe('validateCase tone guard', () => {
  it('lists at least the required graphic terms', () => {
    for (const term of [
      'blood',
      'bloody',
      'gore',
      'gory',
      'maul',
      'mauling',
      'dismember',
      'decapitat',
      'disembowel',
      'torture',
      'mutilat',
      'incision',
      'severed head',
      'corpse',
    ]) {
      expect(GRAPHIC_TERMS, term).toContain(term)
    }
  })

  it('rejects a graphic term in any card name or description, the title, the victim, or the narration', () => {
    const places: ((c: GeneratedCase, text: string) => void)[] = [
      (c, t) => (c.suspects[0].name = t),
      (c, t) => (c.weapons[2].description = t),
      (c, t) => (c.locations[3].name = t),
      (c, t) => (c.title = t),
      (c, t) => (c.victim = t),
      (c, t) => (c.openingNarration = t),
    ]
    for (const term of GRAPHIC_TERMS) {
      for (const place of places) {
        const c = validCase()
        place(c, `A ${term} here`)
        expect(validateCase(c).ok, `"${term}" should be refused`).toBe(false)
      }
    }
  })

  it('matches graphic terms regardless of case, and inside longer words', () => {
    const upper = validCase()
    upper.weapons[0] = { name: 'Staged MAULING', description: 'Made to look like an animal did it.' }
    expect(validateCase(upper).ok).toBe(false)

    const inside = validCase()
    inside.weapons[1] = { name: 'Decapitated Statue', description: 'A heavy stone head.' }
    expect(validateCase(inside).ok).toBe(false)

    const cut = validCase()
    cut.weapons[1] = { name: 'Surgical Incision Tool', description: 'A small blade from the medical bay.' }
    const result = validateCase(cut)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/incision/i)
  })

  it('still accepts a sinister but not gruesome case', () => {
    const c = validCase()
    c.weapons[0] = { name: 'Poisoned Tea', description: 'Something bitter was slipped into the last cup.' }
    c.weapons[1] = { name: 'Loosened Railing', description: 'One bolt was missing from the balcony rail.' }
    expect(validateCase(c).ok).toBe(true)
  })

  it("rejects a title identical to the setting's name, ignoring case and spaces", () => {
    const same = validCase()
    same.title = `  ${setting.name.toUpperCase()} `
    expect(validateCase(same, { settingName: setting.name }).ok).toBe(false)

    const different = validCase()
    expect(validateCase(different, { settingName: setting.name }).ok).toBe(true)
  })
})

describe('findGraphicTerm (D35: the "Father Gregory" false positive)', () => {
  it('does not flag a harmless name that merely contains a term ("Gre-gory")', () => {
    expect(findGraphicTerm('Father Gregory')).toBeNull()
  })

  it('still flags the term as a word', () => {
    expect(findGraphicTerm('a gory scene')).toBe('gory')
  })

  it('still flags a term at the start of a longer word', () => {
    expect(findGraphicTerm('bloodstained')).toBe('blood')
  })
})

describe('buildQuestionPrompt', () => {
  it("includes the setting's name, hook, and mood, and asks for JSON only", () => {
    const { system, user } = buildQuestionPrompt(setting)
    const text = system + user
    expect(text).toContain(setting.name)
    expect(text).toContain(setting.hook)
    expect(text).toContain(setting.mood)
    expect(text).toMatch(/JSON/)
  })
})

describe('buildCasePrompt', () => {
  const answers = [
    { question: 'What went wrong on the ship?', answer: 'The lights failed' },
    { question: 'Who was acting strangely?', answer: 'The navigator' },
    { question: 'Where was the victim last seen?', answer: 'The cargo bay' },
    { question: 'What were they arguing about?', answer: 'Fuel rations' },
  ]
  const earlierTitles = ['The Silent Hatch', 'Orbit of Lies']

  it("includes the setting's hook, every answer, and every earlier title", () => {
    const { system, user } = buildCasePrompt(setting, answers, earlierTitles)
    const text = system + user
    expect(text).toContain(setting.hook)
    expect(text).toContain(setting.whyNoOneCanLeave)
    for (const a of answers) {
      expect(text).toContain(a.question)
      expect(text).toContain(a.answer)
    }
    for (const title of earlierTitles) expect(text).toContain(title)
  })

  it('asks for a light tone and a title that is not the setting name', () => {
    const text = Object.values(buildCasePrompt(setting, answers, [])).join(' ')
    expect(text).toContain(
      'Keep it light, like a party mystery game: no graphic injuries or gore; methods can be sinister but never gruesome.',
    )
    expect(text).toContain("The title must not repeat the setting's name.")
  })

  it('states the rules the case must follow', () => {
    const text = Object.values(buildCasePrompt(setting, answers, [])).join(' ').toLowerCase()
    expect(text).toContain('family-friendly')
    expect(text).toContain('json')
    expect(text).toContain('motive')
    expect(text).toMatch(/only one/)
  })
})
