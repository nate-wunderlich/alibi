import { describe, expect, it } from 'vitest'
import {
  assembleOpening,
  buildCasePrompt,
  buildQuestionPrompt,
  CARD_DESCRIPTION_MAX,
  CARD_NAME_MAX,
  findGraphicTerm,
  GRAPHIC_TERMS,
  NARRATION_MAX,
  validateCase,
  validateOpeningParts,
  type GeneratedCase,
  type OpeningParts,
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
    openingParts: {
      scene: 'The alarm stopped. Nobody on the ship could say who opened the airlock.',
      creditHost: 'The host heard the hull groan just before the lights went out.',
      creditGuest: 'The guest found the cargo bay door sealed from the inside.',
      hook: 'So who wanted the engineer silenced?',
    },
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

  it(`rejects an assembled opening over ${NARRATION_MAX} characters`, () => {
    expect(NARRATION_MAX).toBe(750) // R37: ~90 words plus two player names
    const tooLong = validCase()
    // Within the scene's word cap, but very long words.
    tooLong.openingParts.scene = Array.from({ length: 30 }, () => 'W'.repeat(24)).join(' ') + '.'
    expect(validateCase(tooLong).ok).toBe(false)
  })

  it('assembles the stored openingNarration from the parts and the exact suspect names (R38)', () => {
    const result = validateCase(validCase())
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.case.openingNarration).toBe(
        'The alarm stopped. Nobody on the ship could say who opened the airlock. ' +
          'The host heard the hull groan just before the lights went out. ' +
          'The guest found the cargo bay door sealed from the inside. ' +
          'Four suspects remain: Suspect 1, Suspect 2, Suspect 3, and Suspect 4. ' +
          'So who wanted the engineer silenced?',
      )
    }
  })

  it('rejects a missing title, victim, or opening, and input that is not a case', () => {
    for (const field of ['title', 'victim'] as const) {
      const blank = validCase()
      blank[field] = '  '
      expect(validateCase(blank).ok, `blank ${field}`).toBe(false)
    }
    const noParts = validCase() as Partial<GeneratedCase>
    delete noParts.openingParts
    expect(validateCase(noParts).ok, 'no openingParts').toBe(false)
    const blankScene = validCase()
    blankScene.openingParts.scene = '  '
    expect(validateCase(blankScene).ok, 'blank scene').toBe(false)
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
      (c, t) => (c.openingParts.scene = t),
      (c, t) => (c.openingParts.hook = `${t}?`),
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

describe('assembleOpening (R38)', () => {
  const parts: OpeningParts = {
    scene: 'Fog rolls in off the water.',
    creditHost: 'The host let the captain in.',
    creditGuest: 'The guest heard the lamp go dark.',
    hook: 'Who wanted the keeper gone?',
  }

  it('puts the 4 exact suspect names in the fixed sentence and ends with the hook', () => {
    const text = assembleOpening(parts, ['Captain Roswell', 'Eliza Crow', 'Thomas Wrenn', 'Dr. Iris Strand'])
    expect(text).toContain('Four suspects remain: Captain Roswell, Eliza Crow, Thomas Wrenn, and Dr. Iris Strand.')
    expect(text.startsWith('Fog rolls in off the water. The host let the captain in. The guest heard the lamp go dark.')).toBe(true)
    expect(text.endsWith('Who wanted the keeper gone?')).toBe(true)
  })
})

describe('validateOpeningParts (R39: seats, not names)', () => {
  const good = (): OpeningParts => ({
    scene: 'Fog rolls in off the water and the lamp gutters.',
    creditHost: 'Because the host let the captain in, the door stood open all night.',
    creditGuest: 'Because the guest followed the footprints, the cellar is no longer a secret.',
    hook: 'Who wanted the keeper gone?',
  })

  it('accepts well-formed parts', () => {
    expect(validateOpeningParts(good())).toEqual([])
  })

  it('requires "the host" in creditHost and "the guest" in creditGuest', () => {
    const noHost = good()
    noHost.creditHost = 'The captain came in from the storm.'
    expect(validateOpeningParts(noHost).join(' ')).toMatch(/creditHost.*the host/)
    const noGuest = good()
    noGuest.creditGuest = 'Someone followed the footprints.'
    expect(validateOpeningParts(noGuest).join(' ')).toMatch(/creditGuest.*the guest/)
  })

  it('rejects a credit that mentions the other seat', () => {
    const crossed = good()
    crossed.creditHost = 'Because the host and the guest argued, the door stood open.'
    expect(validateOpeningParts(crossed).join(' ')).toMatch(/creditHost.*the guest/)
  })

  it('rejects a hook that does not end with "?"', () => {
    const flat = good()
    flat.hook = 'Someone here is lying.'
    expect(validateOpeningParts(flat).join(' ')).toMatch(/\?/)
  })

  it('rejects parts over their word caps, and graphic terms', () => {
    const long = good()
    long.scene = Array.from({ length: 60 }, () => 'fog').join(' ')
    expect(validateOpeningParts(long).join(' ')).toMatch(/scene/i)
    const graphic = good()
    graphic.creditGuest = 'Because the guest found blood on the stairs, the cellar matters.'
    expect(validateOpeningParts(graphic).join(' ')).toMatch(/graphic/i)
  })
})

describe('the player-name guard (R39)', () => {
  const names = ['Nathan Wunderlich', 'Nate Wunderlich']

  it('rejects a case whose text contains any token of a player name, and says so without the name', () => {
    for (const token of ['Nathan', 'Nate', 'Wunderlich', 'WUNDERLICH']) {
      const c = validCase()
      c.suspects[0] = { ...c.suspects[0], name: `Captain ${token}` }
      const result = validateCase(c, { playerNames: names })
      expect(result.ok, token).toBe(false)
      // The errors go back to the AI on a retry, so they must never contain the name itself.
      if (!result.ok) {
        expect(result.errors.join(' ')).toMatch(/player's name/i)
        expect(result.errors.join(' ').toLowerCase()).not.toContain(token.toLowerCase())
      }
    }
  })

  it('checks the opening parts, title, and victim too', () => {
    const inParts = validCase()
    inParts.openingParts.scene = 'Nathan watches the storm.'
    expect(validateCase(inParts, { playerNames: names }).ok).toBe(false)
    const inTitle = validCase()
    inTitle.title = 'The Wunderlich Affair'
    expect(validateCase(inTitle, { playerNames: names }).ok).toBe(false)
  })

  it('matches whole words only: "Natalie" is not "Nate" or "Nathan"', () => {
    const c = validCase()
    c.suspects[0] = { ...c.suspects[0], name: 'Natalie Crane' }
    expect(validateCase(c, { playerNames: names }).ok).toBe(true)
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

  it('asks for a scene beat per question: second person, present tense, at most 30 words (R37)', () => {
    const text = Object.values(buildQuestionPrompt(setting)).join(' ')
    expect(text).toMatch(/beat/i)
    expect(text).toMatch(/second person/i)
    expect(text).toMatch(/present tense/i)
    expect(text).toMatch(/30 words/)
    expect(text).toContain('"beat"')
  })
})

describe('buildCasePrompt', () => {
  const answers = [
    { seat: 'host' as const, question: 'What went wrong on the ship?', answer: 'The lights failed' },
    { seat: 'host' as const, question: 'Who was acting strangely?', answer: 'The navigator' },
    { seat: 'guest' as const, question: 'Where was the victim last seen?', answer: 'The cargo bay' },
    { seat: 'guest' as const, question: 'What were they arguing about?', answer: 'Fuel rations' },
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

  it('labels each choice by seat ("the host:" / "the guest:") and never carries a player name (R39)', () => {
    const text = Object.values(buildCasePrompt(setting, answers, [])).join(' ')
    expect(text).toContain('the host: What went wrong on the ship? -> The lights failed')
    expect(text).toContain('the guest: What were they arguing about? -> Fuel rations')
    for (const token of ['Nathan', 'Nate', 'Wunderlich']) expect(text).not.toMatch(new RegExp(`\\b${token}\\b`, 'i'))
  })

  it('asks for openingParts (scene, creditHost, creditGuest, hook) and names who each credit belongs to (R38)', () => {
    const text = Object.values(buildCasePrompt(setting, answers, [])).join(' ')
    expect(text).toContain('"openingParts"')
    for (const key of ['scene', 'creditHost', 'creditGuest', 'hook']) expect(text).toContain(`"${key}"`)
    expect(text).toMatch(/creditHost[^\n]*"the host"/)
    expect(text).toMatch(/creditGuest[^\n]*"the guest"/)
    expect(text).toMatch(/ends? with "\?"/)
    expect(text).not.toContain('"openingNarration"')
  })

  it('states the rules the case must follow', () => {
    const text = Object.values(buildCasePrompt(setting, answers, [])).join(' ').toLowerCase()
    expect(text).toContain('family-friendly')
    expect(text).toContain('json')
    expect(text).toContain('motive')
    expect(text).toMatch(/only one/)
  })
})
