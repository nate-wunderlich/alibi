/**
 * Case questions (docs/SPEC.md, Generation step 0b).
 *
 * Before each round, 4 questions with 4 tap answers each are prepared, 2 for
 * each player. The AI writes them for the round's setting; this module checks
 * what the AI returned, and holds a generic bank to fall back on when the AI
 * fails twice. Pure code: no network, no database.
 */

import { findGraphicTerm } from './caseGen'
import { shuffle, type Player, type Rng } from './rules'

export const QUESTION_COUNT = 4
export const ANSWER_COUNT = 4
export const QUESTION_MAX_LENGTH = 120
export const ANSWER_MAX_LENGTH = 40
/** R37: a scene beat is one or two sentences, at most this many words. */
export const BEAT_MAX_WORDS = 30

export interface Question {
  /** R37: the moment that sets up the choice, shown above the question (second person, present tense). */
  beat: string
  text: string
  answers: string[]
}

/** The 4 questions of a round, split 2 and 2. */
export type QuestionSet = Record<Player, Question[]>

export type ValidationResult = { ok: true; questions: Question[] } | { ok: false; errors: string[] }

/** Compare text the way a player would: ignore case and surrounding spaces. */
const normalize = (text: string) => text.trim().toLowerCase()

/** True if a list of strings has the same text twice (ignoring case and spaces). */
function hasDuplicates(texts: string[]): boolean {
  return new Set(texts.map(normalize)).size !== texts.length
}

/** Check one question's shape, scene beat, text, and answers. Returns a list of problems (empty if fine). */
function checkQuestion(item: unknown, n: number): string[] {
  if (typeof item !== 'object' || item === null) return [`Question ${n} is not an object.`]
  const { beat, text, answers } = item as { beat?: unknown; text?: unknown; answers?: unknown }
  const errors: string[] = []

  if (typeof beat !== 'string' || beat.trim() === '') errors.push(`Question ${n} has no scene beat.`)
  else {
    if (beat.trim().split(/\s+/).length > BEAT_MAX_WORDS) {
      errors.push(`Question ${n}'s scene beat is longer than ${BEAT_MAX_WORDS} words.`)
    }
    const term = findGraphicTerm(beat)
    if (term) errors.push(`Question ${n}'s scene beat is too graphic ("${term}").`)
    // R38: the beat speaks to the player, and does not give the options away.
    if (!/\b(you|your)\b/i.test(beat)) errors.push(`Question ${n}'s scene beat must address the player ("you" or "your").`)
    if (Array.isArray(answers)) {
      const leaked = answers.filter((a) => typeof a === 'string' && a.trim() && beat.toLowerCase().includes(a.trim().toLowerCase()))
      if (leaked.length >= 2) {
        errors.push(`Question ${n}'s scene beat gives away ${leaked.length} of its answer options (${leaked.join(', ')}); it may hint at one at most.`)
      }
    }
  }

  if (typeof text !== 'string' || text.trim() === '') errors.push(`Question ${n} has no text.`)
  else if (text.trim().length > QUESTION_MAX_LENGTH) {
    errors.push(`Question ${n} is longer than ${QUESTION_MAX_LENGTH} characters.`)
  }

  if (!Array.isArray(answers) || answers.some((a) => typeof a !== 'string')) {
    errors.push(`Question ${n} needs a list of text answers.`)
    return errors
  }
  if (answers.length !== ANSWER_COUNT) {
    errors.push(`Question ${n} needs exactly ${ANSWER_COUNT} answers; got ${answers.length}.`)
  }
  answers.forEach((a: string, i) => {
    if (a.trim() === '') errors.push(`Question ${n}, answer ${i + 1} is empty.`)
    else if (a.trim().length > ANSWER_MAX_LENGTH) {
      errors.push(`Question ${n}, answer ${i + 1} is longer than ${ANSWER_MAX_LENGTH} characters.`)
    }
  })
  if (hasDuplicates(answers)) errors.push(`Question ${n} repeats an answer.`)
  return errors
}

/**
 * Check a round's questions, typically straight from the AI's JSON.
 * Rules: exactly 4 questions, each with a scene beat (up to 30 words, passing
 * the tone guard, addressing the player, and naming at most one of its own
 * options) and exactly 4 answers; no empty text; questions up to 120
 * characters, answers up to 40; no repeated question, and no repeated answer
 * within a question.
 */
export function validateQuestions(input: unknown): ValidationResult {
  if (!Array.isArray(input)) return { ok: false, errors: ['Expected a list of questions.'] }
  const errors: string[] = []
  if (input.length !== QUESTION_COUNT) {
    errors.push(`Expected exactly ${QUESTION_COUNT} questions; got ${input.length}.`)
  }
  input.forEach((item, i) => errors.push(...checkQuestion(item, i + 1)))
  if (errors.length === 0) {
    const questions = input as Question[]
    if (hasDuplicates(questions.map((q) => q.text))) errors.push('Two questions are the same.')
  }
  return errors.length === 0 ? { ok: true, questions: input as Question[] } : { ok: false, errors }
}

/** Give the first 2 questions to the host and the last 2 to the guest. */
export function splitForPlayers(questions: Question[]): QuestionSet {
  return { host: questions.slice(0, 2), guest: questions.slice(2, 4) }
}

/**
 * Generic questions that fit any setting, grouped by the 4 aspects a case
 * needs (SPEC.md): who, what, where, and mood or motive.
 */
const BANK_BY_ASPECT: Record<'who' | 'what' | 'where' | 'motive', Question[]> = {
  who: [
    { beat: 'You scan the room one last time before it happened. One face will not meet your eyes.', text: 'Who was acting strangely before the crime?', answers: ['The newcomer', 'The oldest one here', 'The one in charge', 'The quiet helper'] },
    { beat: 'A whisper stops the moment you walk in. Somebody here is guarding something.', text: 'Who had a secret they were hiding?', answers: ['A trusted friend', 'A rival', 'A family member', 'A stranger'] },
    { beat: 'Raised voices echo down the hall that afternoon. You catch only the end of it.', text: 'Who argued with the victim that day?', answers: ['Their partner', 'Their boss', 'An old friend', 'Nobody, oddly'] },
  ],
  what: [
    { beat: 'Everything around you is quiet. Then, all at once, it is not.', text: 'What went wrong just before the crime?', answers: ['The lights went out', 'A loud crash', 'An alarm went off', 'Someone screamed'] },
    { beat: 'You kneel where it happened. Something small sits where it should not be.', text: 'What strange clue was left behind?', answers: ['A torn note', 'A muddy footprint', 'A broken watch', 'A strange smell'] },
    { beat: 'The night before, you notice an empty spot on a shelf.', text: 'What went missing the night before?', answers: ['A key', 'A map', 'A letter', 'A tool'] },
  ],
  where: [
    { beat: 'You retrace the victim\'s last steps. The trail goes cold in one place.', text: 'Where was the victim last seen?', answers: ['Near the entrance', 'In a hidden corner', 'By the windows', 'Somewhere off-limits'] },
    { beat: 'As night falls, you watch everyone drift to the same place, as if pulled there.', text: 'Where did everyone gather that evening?', answers: ['The main hall', 'The kitchen', 'Outside', 'The quietest room'] },
    { beat: 'You test every handle on your rounds. One turns when it should not.', text: 'Where was a door found unlocked?', answers: ['The storeroom', 'The back exit', 'The office', 'The basement'] },
  ],
  motive: [
    { beat: 'Old tensions simmer all evening. You can feel them in every glance.', text: 'What was everyone arguing about?', answers: ['Money', 'A secret', 'An old feud', 'A broken promise'] },
    { beat: 'You step inside and the air changes. Everyone feels it.', text: 'What mood hung over the place?', answers: ['Nervous', 'Festive', 'Gloomy', 'Suspicious'] },
    { beat: 'You remember the victim smiling like someone holding a winning card.', text: 'What did the victim know that others did not?', answers: ['Where the treasure is', 'Who lied', 'A way out', 'A dangerous plan'] },
  ],
}

/** The whole fallback bank as one flat list. */
export const FALLBACK_BANK: Question[] = Object.values(BANK_BY_ASPECT).flat()

/**
 * The fallback when the AI's questions fail twice: one random question from
 * each aspect (so the case still gets a who, what, where, and motive), in a
 * random order, split 2 and 2.
 */
export function fallbackQuestions(rng: Rng): QuestionSet {
  const onePerAspect = Object.values(BANK_BY_ASPECT).map((group) => shuffle(group, rng)[0])
  return splitForPlayers(shuffle(onePerAspect, rng))
}
