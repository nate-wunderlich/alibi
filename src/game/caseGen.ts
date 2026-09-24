/**
 * Case generation, the pure half (docs/SPEC.md "Generation chain", steps 0b
 * and 1): the prompts sent to the AI, and the checks its answers must pass.
 * Pure code: no network, no database. src/actions/ai.ts makes the calls.
 *
 * The AI never sees the solution (R4): code picks the envelope only after
 * the case exists, so every prompt here describes the cast, not the answer.
 */

import type { PresetCase } from './presetCase'
import type { CardKind, Player } from './rules'
import type { Setting } from './settings'

export const CARD_NAME_MAX = 40
export const CARD_DESCRIPTION_MAX = 140
/** R37: room for a 70-90 word opening that credits both players by name. */
export const NARRATION_MAX = 750
export const TITLE_MAX = 80
export const VICTIM_MAX = 120

/**
 * The tone guard: text a party mystery should not contain. A case with any
 * of these, anywhere in its text, fails validation (then the AI retries, then
 * the fallback is used); the prompts list them as words to avoid (R40). Matched case-insensitively at the start of
 * a word (see findGraphicTerm), so a stem like "decapitat" also catches
 * "decapitated" but a name like "Gregory" is not "gory".
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

/**
 * The first graphic term in a text, or null. Terms match case-insensitively
 * at the start of a word, so "Gregory" is not "gory", while stems still
 * match ("decapitat" catches "decapitated", "blood" catches "bloodstained").
 * Shared with the confession check (R36).
 */
export function findGraphicTerm(text: string): string | null {
  const lower = text.toLowerCase()
  return GRAPHIC_TERMS.find((term) => new RegExp('\\b' + term).test(lower)) ?? null
}

export interface GeneratedCard {
  name: string
  description: string
}

/** The case as the AI returns it. */
/**
 * R38: the opening arrives as parts; code assembles them (assembleOpening),
 * adding the suspect list itself, so its structure is guaranteed.
 */
export interface OpeningParts {
  scene: string
  creditHost: string
  creditGuest: string
  hook: string
}

export const SCENE_MAX_WORDS = 35
export const CREDIT_MAX_WORDS = 22
export const HOOK_MAX_WORDS = 14

export interface GeneratedCase {
  title: string
  victim: string
  openingParts: OpeningParts
  suspects: GeneratedCard[]
  weapons: GeneratedCard[]
  locations: GeneratedCard[]
}

/**
 * One question a player answered, with the answer they tapped and their seat.
 * R39: prompts know players only by seat ("the host", "the guest"), never by
 * name; there is no field a name could travel in.
 */
export interface AnsweredQuestion {
  seat: Player
  question: string
  answer: string
}

/** How a seat is written in prompts and prose (R39). */
export function seatLabel(seat: Player): string {
  return seat === 'host' ? 'the host' : 'the guest'
}

/** The words of the players' display names that the guard looks for: 3+ letters each (R39). */
export function playerNameTokens(names: string[]): string[] {
  return [...new Set(names.flatMap((n) => n.split(/[^\p{L}]+/u)).filter((t) => t.length >= 3).map((t) => t.toLowerCase()))]
}

/** A whole-word, case-insensitive pattern for one name token; matches are then kept only if capitalized. */
function tokenPattern(token: string): RegExp {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'giu')
}

const capitalized = (word: string) => word[0] !== word[0].toLowerCase()

/** True if a text has a capitalized, whole-word match of one name token. */
const hasToken = (text: string, token: string) => [...text.matchAll(tokenPattern(token))].some((m) => capitalized(m[0]))

/**
 * The name guard (R39, narrowed by R40): true if a text contains a
 * capitalized token of a player's display name as a whole word ("Porter" is
 * found; "the porter" and "Natalie" are not).
 */
export function containsPlayerName(text: string, names: string[]): boolean {
  return playerNameTokens(names).some((token) => hasToken(text, token))
}

/** R40: stand-in names for a player-name collision. Single words, so none contains another's token. */
export const NEUTRAL_NAMES = [
  'Morgan',
  'Quinn',
  'Harlow',
  'Ellis',
  'Rowan',
  'Blake',
  'Hollis',
  'Avery',
  'Sloane',
  'Marlow',
  'Linden',
  'Carver',
  'Thorne',
  'Wren',
  'Ashby',
  'Colby',
  'Darrow',
  'Fenwick',
  'Greer',
  'Kestrel',
]

/** Every string inside a value (strings, arrays, and plain objects). */
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(strings)
  if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(strings)
  return []
}

/** The same value with `edit` applied to every string inside it. */
function mapStrings<T>(value: T, edit: (s: string) => string): T {
  if (typeof value === 'string') return edit(value) as T
  if (Array.isArray(value)) return value.map((v) => mapStrings(v, edit)) as T
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapStrings(v, edit)])) as T
  }
  return value
}

/**
 * R40: replace every capitalized token of a player's name, in every string of
 * a generated value (a case, a question set, a confession), with a neutral
 * name: the same stand-in for the same token everywhere, never one that
 * shares a token with a player, and never one the value already uses. Pure;
 * returns the value itself if nothing matched. The caller then validates as
 * usual, so no retry is spent and no name goes back to the AI.
 */
export function substituteNames<T>(value: T, names: string[]): T {
  const tokens = playerNameTokens(names)
  const all = strings(value)
  const hits = tokens.filter((t) => all.some((s) => hasToken(s, t)))
  if (hits.length === 0) return value
  const free = NEUTRAL_NAMES.filter(
    (n) => !tokens.includes(n.toLowerCase()) && !all.some((s) => tokenPattern(n.toLowerCase()).test(s)),
  )
  const standIn = new Map(hits.map((t, i) => [t, free[i] ?? 'Someone']))
  return mapStrings(value, (s) =>
    hits.reduce(
      (text, t) =>
        text.replace(tokenPattern(t), (m) => {
          if (!capitalized(m)) return m
          const name = standIn.get(t) ?? 'Someone'
          return m.length > 1 && m === m.toUpperCase() ? name.toUpperCase() : name
        }),
      s,
    ),
  )
}

/**
 * The guard's error for a text that names a player. It never repeats the
 * name: errors are sent back to the AI on a retry (R38), and names must never
 * reach the AI (R39).
 */
export function playerNameError(label: string): string {
  return `${label} contains a player's name; player names must never appear. Refer to players only as "the host" or "the guest".`
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
export function validateCase(
  input: unknown,
  options: { settingName?: string; playerNames?: string[] } = {},
): CaseValidation {
  if (typeof input !== 'object' || input === null) return { ok: false, errors: ['Expected a case object.'] }
  const c = input as Record<string, unknown>
  const errors: string[] = []

  for (const e of [checkText(c.title, 'The title', TITLE_MAX), checkText(c.victim, 'The victim', VICTIM_MAX)]) {
    if (e) errors.push(e)
  }

  // R38: the opening comes as parts, checked here (names, caps, hook, tone guard).
  const parts = c.openingParts as OpeningParts | undefined
  if (typeof parts !== 'object' || parts === null) errors.push('Expected openingParts: { scene, creditHost, creditGuest, hook }.')
  else errors.push(...validateOpeningParts(parts, options.playerNames))

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

  // Tone guard: every other piece of text the players will read (the opening parts were checked above).
  // Each text has a label for the tone guard (which may quote the card) and a
  // content-free one for the name guard, whose errors must never carry a name (R39).
  const texts: [string, unknown, string][] = [
    ['The title', c.title, 'The title'],
    ['The victim', c.victim, 'The victim'],
    ...cards.flatMap((card): [string, unknown, string][] => [
      [`The card "${card.name}"`, card.name, `A ${card.kind} card's name`],
      [`The description of "${card.name}"`, card.description, `A ${card.kind} card's description`],
    ]),
  ]
  for (const [label, text, safeLabel] of texts) {
    if (typeof text !== 'string') continue
    // R39: no player's name anywhere in the case; if one is present, no error may quote this text.
    const named = options.playerNames ? containsPlayerName(text, options.playerNames) : false
    const term = findGraphicTerm(text)
    if (term) errors.push(`${named ? safeLabel : label} is too graphic ("${term}").`)
    if (named) errors.push(playerNameError(safeLabel))
  }

  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
  if (options.settingName && typeof c.title === 'string' && same(c.title, options.settingName)) {
    errors.push("The title repeats the setting's name.")
  }

  // The stored opening is assembled by code: the parts plus the exact suspect names.
  let openingNarration = ''
  if (errors.length === 0 && parts) {
    openingNarration = assembleOpening(
      parts,
      cards.filter((card) => card.kind === 'suspect').map((card) => card.name),
    )
    if (openingNarration.length > NARRATION_MAX) {
      errors.push(`The assembled opening is longer than ${NARRATION_MAX} characters; shorten the scene and credits.`)
    }
  }

  if (errors.length > 0) return { ok: false, errors }
  return {
    ok: true,
    case: { title: String(c.title).trim(), victim: String(c.victim).trim(), openingNarration, cards },
  }
}

/** A sentence, with a full stop added if it has no closing punctuation. */
function sentence(text: string): string {
  const t = text.trim()
  return /[.!?…]["')\]]?$/.test(t) ? t : `${t}.`
}

/**
 * R38: the opening read aloud, assembled by code: the scene, each player's
 * credit, the four exact suspect names, and the hook question.
 */
export function assembleOpening(parts: OpeningParts, suspectNames: string[]): string {
  const list =
    suspectNames.length > 1
      ? `${suspectNames.slice(0, -1).join(', ')}, and ${suspectNames[suspectNames.length - 1]}`
      : suspectNames.join('')
  return [
    sentence(parts.scene),
    sentence(parts.creditHost),
    sentence(parts.creditGuest),
    `Four suspects remain: ${list}.`,
    parts.hook.trim(),
  ].join(' ')
}

const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length

/**
 * Check the opening's parts (R38, R39). Each part is present, within its word
 * cap, and passes the tone guard; the hook ends with "?". creditHost contains
 * "the host" and not "the guest"; creditGuest the reverse. With the players'
 * display names, no part may contain any of them. Returns the problems (empty
 * if fine), worded so a retry can fix them and never repeating a name.
 */
export function validateOpeningParts(parts: OpeningParts, playerNames?: string[]): string[] {
  const errors: string[] = []
  const caps: [keyof OpeningParts, number][] = [
    ['scene', SCENE_MAX_WORDS],
    ['creditHost', CREDIT_MAX_WORDS],
    ['creditGuest', CREDIT_MAX_WORDS],
    ['hook', HOOK_MAX_WORDS],
  ]
  for (const [key, cap] of caps) {
    const value = parts[key]
    if (typeof value !== 'string' || value.trim() === '') {
      errors.push(`openingParts.${key} is missing.`)
      continue
    }
    if (words(value) > cap) errors.push(`openingParts.${key} has ${words(value)} words; the most is ${cap}.`)
    const term = findGraphicTerm(value)
    if (term) errors.push(`openingParts.${key} is too graphic ("${term}").`)
    if (playerNames && containsPlayerName(value, playerNames)) errors.push(playerNameError(`openingParts.${key}`))
  }
  if (typeof parts.hook === 'string' && parts.hook.trim() !== '' && !parts.hook.trim().endsWith('?')) {
    errors.push('openingParts.hook must be a question that ends with "?".')
  }
  // R39: each credit names its own seat, never the other one.
  const credits: [keyof OpeningParts, string, string][] = [
    ['creditHost', 'the host', 'the guest'],
    ['creditGuest', 'the guest', 'the host'],
  ]
  for (const [key, own, other] of credits) {
    const value = parts[key]
    if (typeof value !== 'string' || value.trim() === '') continue
    if (!new RegExp(`\\b${own}\\b`, 'i').test(value)) errors.push(`openingParts.${key} must contain the words "${own}".`)
    if (new RegExp(`\\b${other}\\b`, 'i').test(value)) {
      errors.push(`openingParts.${key} must not mention "${other}"; that is the other player's credit.`)
    }
  }
  return errors
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
  // R40: the tone guard's terms, named outright, so fewer replies fail on them.
  `Words to avoid entirely (the game rejects any text that contains them or a word starting with them): ${GRAPHIC_TERMS.join(', ')}.`,
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
      'Before each question, write a scene beat: one or two cinematic sentences in the second person and present tense, at most 30 words, that put the player in the moment right before the choice (for example: "The storm hits. Someone pounds on the lighthouse door.").',
      'No question may repeat another, and no answer may repeat within a question.',
      'Return: [{"beat": "scene", "text": "question", "answers": ["a", "b", "c", "d"]}, ...] with exactly 4 items.',
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
      "The players' choices, by seat (each one must visibly shape the case: a name, a card, the victim, or the opening). Players are only ever called \"the host\" and \"the guest\":",
      ...answers.map((a, i) => `${i + 1}. ${seatLabel(a.seat)}: ${a.question} -> ${a.answer}`),
      '',
      earlierTitles.length > 0
        ? `Earlier cases in this series (your title must not repeat or echo any of them): ${earlierTitles.join('; ')}`
        : 'This is the first case in the series.',
      '',
      'Write:',
      '- a title (at most 6 words). The title must not repeat the setting\'s name.',
      '- the victim (a name plus at most 8 words);',
      '- openingParts: four short pieces the game assembles into the opening read aloud. The game adds the list of the 4 suspects itself, so do not list them. It credits each seat\'s choices:',
      '  "scene": one or two sentences that set the scene, at most 35 words, with no mention of the players;',
      '  "creditHost": one sentence crediting the host\'s choices (for example: "Because the host let the merchant captain in, ..."); it must contain the words "the host" and must not mention the guest; at most 22 words;',
      '  "creditGuest": one sentence crediting the guest\'s choices; it must contain the words "the guest" and must not mention the host; at most 22 words;',
      '  "hook": one question, at most 14 words, that ends with "?";',
      '- 4 suspects: every one belongs to this setting and gets a believable motive in their description, because any of them could turn out to be the culprit;',
      '- 4 weapons: each is a possible METHOD for the incident described above, and only one will turn out true, so all 4 must be plausible;',
      '- 4 locations: places within this setting where it could have happened.',
      'Keep it light, like a party mystery game: no graphic injuries or gore; methods can be sinister but never gruesome.',
      'Be brief. Card names at most 4 words. Each description is ONE short sentence of at most 16 words (a suspect\'s motive fits in that sentence). All 12 names must be different.',
      'Every suspect, weapon, and location is an object with exactly two keys, "name" and "description".',
      'Return: {"title": "", "victim": "", "openingParts": {"scene": "", "creditHost": "", "creditGuest": "", "hook": ""}, "suspects": [{"name": "", "description": ""} x4], "weapons": [{"name": "", "description": ""} x4], "locations": [{"name": "", "description": ""} x4]}',
    ].join('\n'),
  }
}
