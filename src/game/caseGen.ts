/**
 * Case generation, the pure half (docs/SPEC.md "Generation chain", steps 0b
 * and 1): the prompts sent to the AI, and the checks its answers must pass.
 * Pure code: no network, no database. src/actions/ai.ts makes the calls.
 *
 * The AI never sees the solution (R4): code picks the envelope only after
 * the case exists, so every prompt here describes the cast, not the answer.
 */

import type { PresetCase } from './presetCase'
import type { CardKind } from './rules'
import type { Setting } from './settings'

export const CARD_NAME_MAX = 40
export const CARD_DESCRIPTION_MAX = 140
export const NARRATION_MAX = 600
export const TITLE_MAX = 80
export const VICTIM_MAX = 120

/**
 * The tone guard: text a party mystery should not contain. A case with any
 * of these, anywhere in its text, fails validation (then the AI retries once,
 * then the preset case is used). Matched case-insensitively and inside longer
 * words ("decapitat" also catches "decapitated"), so the list may also catch
 * the odd harmless word; a retry is cheap.
 */
export const GRAPHIC_TERMS = [
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
]

/** The first graphic term in a text, or null. Shared with the confession check (R36). */
export function findGraphicTerm(text: string): string | null {
  const lower = text.toLowerCase()
  return GRAPHIC_TERMS.find((term) => lower.includes(term)) ?? null
}

export interface GeneratedCard {
  name: string
  description: string
}

/** The case as the AI returns it. */
export interface GeneratedCase {
  title: string
  victim: string
  openingNarration: string
  suspects: GeneratedCard[]
  weapons: GeneratedCard[]
  locations: GeneratedCard[]
}

/** One question a player answered, with the answer they tapped. */
export interface AnsweredQuestion {
  question: string
  answer: string
}

export type CaseValidation = { ok: true; case: PresetCase } | { ok: false; errors: string[] }

/** A non-empty string up to `max` characters, or an error message. */
function checkText(value: unknown, label: string, max: number): string | null {
  if (typeof value !== 'string' || value.trim() === '') return `${label} is missing.`
  if (value.trim().length > max) return `${label} is longer than ${max} characters.`
  return null
}

const GROUPS: { key: 'suspects' | 'weapons' | 'locations'; kind: CardKind }[] = [
  { key: 'suspects', kind: 'suspect' },
  { key: 'weapons', kind: 'weapon' },
  { key: 'locations', kind: 'location' },
]

/**
 * Check a case from the AI: a title, a victim, an opening narration (up to
 * 600 characters), and exactly 4 suspects, 4 weapons, and 4 locations, each
 * with a name (up to 40) and a description (up to 140). No two cards may
 * share a name, no text may contain a graphic term (the tone guard), and the
 * title may not simply repeat the setting's name. On success, returns the
 * case in the shape rounds are built from (the same shape as the preset case).
 */
export function validateCase(input: unknown, options: { settingName?: string } = {}): CaseValidation {
  if (typeof input !== 'object' || input === null) return { ok: false, errors: ['Expected a case object.'] }
  const c = input as Record<string, unknown>
  const errors: string[] = []

  for (const e of [
    checkText(c.title, 'The title', TITLE_MAX),
    checkText(c.victim, 'The victim', VICTIM_MAX),
    checkText(c.openingNarration, 'The opening narration', NARRATION_MAX),
  ]) {
    if (e) errors.push(e)
  }

  const cards: PresetCase['cards'] = []
  for (const { key, kind } of GROUPS) {
    const list = c[key]
    if (!Array.isArray(list)) {
      errors.push(`Expected a list of 4 ${key}.`)
      continue
    }
    if (list.length !== 4) errors.push(`Expected exactly 4 ${key}; got ${list.length}.`)
    list.forEach((item: unknown, i) => {
      const card = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>
      const nameError = checkText(card.name, `${key} ${i + 1}'s name`, CARD_NAME_MAX)
      const descriptionError = checkText(card.description, `${key} ${i + 1}'s description`, CARD_DESCRIPTION_MAX)
      if (nameError) errors.push(nameError)
      if (descriptionError) errors.push(descriptionError)
      if (!nameError && !descriptionError) {
        cards.push({ kind, name: String(card.name).trim(), description: String(card.description).trim() })
      }
    })
  }

  const names = cards.map((card) => card.name.toLowerCase())
  if (new Set(names).size !== names.length) errors.push('Two cards share a name.')

  // Tone guard: every piece of text the players will read.
  const texts: [string, unknown][] = [
    ['The title', c.title],
    ['The victim', c.victim],
    ['The opening narration', c.openingNarration],
    ...cards.flatMap((card): [string, unknown][] => [
      [`The card "${card.name}"`, card.name],
      [`The description of "${card.name}"`, card.description],
    ]),
  ]
  for (const [label, text] of texts) {
    const term = typeof text === 'string' ? findGraphicTerm(text) : null
    if (term) errors.push(`${label} is too graphic ("${term}").`)
  }

  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
  if (options.settingName && typeof c.title === 'string' && same(c.title, options.settingName)) {
    errors.push("The title repeats the setting's name.")
  }

  if (errors.length > 0) return { ok: false, errors }
  return {
    ok: true,
    case: {
      title: String(c.title).trim(),
      victim: String(c.victim).trim(),
      openingNarration: String(c.openingNarration).trim(),
      cards,
    },
  }
}

export interface Prompt {
  system: string
  user: string
}

/** The setting, written out the same way for every prompt. */
function describeSetting(setting: Setting): string {
  return [
    `Setting: ${setting.name}`,
    `What happened: ${setting.hook}`,
    `Why no one can leave: ${setting.whyNoOneCanLeave}`,
    `Mood: ${setting.mood}`,
  ].join('\n')
}

const SHARED_RULES = [
  'Keep everything family-friendly: no gore, no cruelty, nothing a 12-year-old should not read.',
  'Invent everything. No real people, no brands, and nothing from famous books, films, or games.',
  'Reply with JSON only: no code fences, no text before or after it.',
].join('\n')

/**
 * The prompt for a round's 4 case questions (step 0b). The AI writes 4
 * questions about THIS setting, each with 4 short tap answers, covering 4
 * aspects: who, what, where within the setting, and mood or motive. It sees
 * only the setting: never answers, never the solution.
 */
export function buildQuestionPrompt(setting: Setting): Prompt {
  return {
    system: [
      'You write the case questions for alibi, a two-player detective game.',
      'Before each case, the two players each answer 2 multiple-choice questions, and their answers shape the mystery.',
      SHARED_RULES,
    ].join('\n'),
    user: [
      describeSetting(setting),
      '',
      'Write exactly 4 questions specific to this setting, one for each aspect, in this order:',
      '1. who: a person or group in this setting;',
      '2. what: an event, object, or strange detail;',
      '3. where: a place within this setting;',
      '4. mood or motive: what people want, fear, or feel.',
      'Each question has exactly 4 answers to tap. Keep it short: each question at most 15 words, each answer at most 4 words.',
      'No question may repeat another, and no answer may repeat within a question.',
      'Return: [{"text": "question", "answers": ["a", "b", "c", "d"]}, ...] with exactly 4 items.',
    ].join('\n'),
  }
}

/**
 * The prompt for a round's case (step 1). Input: the setting, the 4 answers
 * with their questions, and the titles of earlier cases in the series. The
 * AI writes the cast; code picks the solution afterwards, so the AI never
 * knows who did it.
 */
export function buildCasePrompt(setting: Setting, answers: AnsweredQuestion[], earlierTitles: string[]): Prompt {
  return {
    system: [
      'You write the cases for alibi, a two-player detective game with 12 cards per case.',
      'The game picks the culprit, method, and place AT RANDOM after you write the case, so you do not know the solution and must not hint at one.',
      SHARED_RULES,
    ].join('\n'),
    user: [
      describeSetting(setting),
      '',
      "The players' answers (each one must visibly shape the case: a name, a card, the victim, or the opening):",
      ...answers.map((a, i) => `${i + 1}. ${a.question} -> ${a.answer}`),
      '',
      earlierTitles.length > 0
        ? `Earlier cases in this series (your title must not repeat or echo any of them): ${earlierTitles.join('; ')}`
        : 'This is the first case in the series.',
      '',
      'Write:',
      '- a title (at most 6 words). The title must not repeat the setting\'s name.',
      '- the victim (a name plus at most 8 words);',
      '- an opening narration of 50 to 70 words, read aloud at the start;',
      '- 4 suspects: every one belongs to this setting and gets a believable motive in their description, because any of them could turn out to be the culprit;',
      '- 4 weapons: each is a possible METHOD for the incident described above, and only one will turn out true, so all 4 must be plausible;',
      '- 4 locations: places within this setting where it could have happened.',
      'Keep it light, like a party mystery game: no graphic injuries or gore; methods can be sinister but never gruesome.',
      'Be brief. Card names at most 4 words. Each description is ONE short sentence of at most 16 words (a suspect\'s motive fits in that sentence). All 12 names must be different.',
      'Every suspect, weapon, and location is an object with exactly two keys, "name" and "description".',
      'Return: {"title": "", "victim": "", "openingNarration": "", "suspects": [{"name": "", "description": ""} x4], "weapons": [{"name": "", "description": ""} x4], "locations": [{"name": "", "description": ""} x4]}',
    ].join('\n'),
  }
}
