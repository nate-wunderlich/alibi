import { describe, expect, it } from 'vitest'
import {
  ANSWER_MAX_LENGTH,
  FALLBACK_BANK,
  fallbackQuestions,
  QUESTION_MAX_LENGTH,
  validateQuestions,
  type Question,
} from './questions'

/** Small seeded random number generator (mulberry32), so every run draws the same questions. */
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

/** Four valid questions, each with four answers. */
function validSet(): Question[] {
  return [
    { text: 'What went wrong just before the crime?', answers: ['A power cut', 'A loud crash', 'An alarm', 'A scream'] },
    { text: 'Who was acting strangely?', answers: ['The captain', 'The cook', 'The guest', 'The doctor'] },
    { text: 'Where was the last place anyone saw the victim?', answers: ['The deck', 'The galley', 'The cabin', 'The hold'] },
    { text: 'What was everyone arguing about?', answers: ['Money', 'A secret', 'An old feud', 'A love letter'] },
  ]
}

describe('validateQuestions', () => {
  it('accepts exactly 4 questions with 4 answers each', () => {
    const result = validateQuestions(validSet())
    expect(result.ok).toBe(true)
  })

  it('rejects the wrong number of questions', () => {
    expect(validateQuestions(validSet().slice(0, 3)).ok).toBe(false)
    expect(validateQuestions([...validSet(), validSet()[0]]).ok).toBe(false)
    expect(validateQuestions([]).ok).toBe(false)
  })

  it('rejects a question with the wrong number of answers', () => {
    const three = validSet()
    three[1] = { ...three[1], answers: three[1].answers.slice(0, 3) }
    expect(validateQuestions(three).ok).toBe(false)

    const five = validSet()
    five[2] = { ...five[2], answers: [...five[2].answers, 'The roof'] }
    expect(validateQuestions(five).ok).toBe(false)
  })

  it('rejects duplicate questions, ignoring case and extra spaces', () => {
    const set = validSet()
    set[3] = { ...set[3], text: '  who was ACTING strangely?  ' }
    expect(validateQuestions(set).ok).toBe(false)
  })

  it('rejects duplicate answers within a question', () => {
    const set = validSet()
    set[0] = { ...set[0], answers: ['A power cut', 'a power cut', 'An alarm', 'A scream'] }
    expect(validateQuestions(set).ok).toBe(false)
  })

  it(`rejects question text over ${120} characters but allows exactly ${120}`, () => {
    expect(QUESTION_MAX_LENGTH).toBe(120)
    const atLimit = validSet()
    atLimit[0] = { ...atLimit[0], text: 'Q'.repeat(119) + '?' }
    expect(validateQuestions(atLimit).ok).toBe(true)

    const tooLong = validSet()
    tooLong[0] = { ...tooLong[0], text: 'Q'.repeat(120) + '?' }
    expect(validateQuestions(tooLong).ok).toBe(false)
  })

  it(`rejects answer text over ${40} characters but allows exactly ${40}`, () => {
    expect(ANSWER_MAX_LENGTH).toBe(40)
    const atLimit = validSet()
    atLimit[1] = { ...atLimit[1], answers: ['A'.repeat(40), 'The cook', 'The guest', 'The doctor'] }
    expect(validateQuestions(atLimit).ok).toBe(true)

    const tooLong = validSet()
    tooLong[1] = { ...tooLong[1], answers: ['A'.repeat(41), 'The cook', 'The guest', 'The doctor'] }
    expect(validateQuestions(tooLong).ok).toBe(false)
  })

  it('rejects empty text and input that is not a list of questions (for example bad AI output)', () => {
    const blank = validSet()
    blank[0] = { ...blank[0], text: '   ' }
    expect(validateQuestions(blank).ok).toBe(false)

    const blankAnswer = validSet()
    blankAnswer[0] = { ...blankAnswer[0], answers: ['', 'A loud crash', 'An alarm', 'A scream'] }
    expect(validateQuestions(blankAnswer).ok).toBe(false)

    expect(validateQuestions(null).ok).toBe(false)
    expect(validateQuestions('four questions').ok).toBe(false)
    expect(validateQuestions([1, 2, 3, 4]).ok).toBe(false)
    expect(validateQuestions([{ text: 'Hi?', answers: 'no' }, 2, 3, 4]).ok).toBe(false)
  })

  it('explains what is wrong, so a retry or a log can say why', () => {
    const result = validateQuestions(validSet().slice(0, 2))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/exactly 4 questions/)
  })
})

describe('fallback bank', () => {
  it('has at least 8 questions, each valid on its own terms', () => {
    expect(FALLBACK_BANK.length).toBeGreaterThanOrEqual(8)
    for (const q of FALLBACK_BANK) {
      expect(q.answers).toHaveLength(4)
      expect(q.text.length).toBeLessThanOrEqual(120)
      for (const a of q.answers) expect(a.length).toBeLessThanOrEqual(40)
    }
  })
})

describe('fallbackQuestions', () => {
  it('always returns 4 valid questions, 2 per player', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const set = fallbackQuestions(seededRng(seed))
      expect(set.host).toHaveLength(2)
      expect(set.guest).toHaveLength(2)
      expect(validateQuestions([...set.host, ...set.guest]).ok).toBe(true)
    }
  })

  it('draws different questions for different seeds', () => {
    const firsts = new Set<string>()
    for (let seed = 1; seed <= 50; seed++) firsts.add(fallbackQuestions(seededRng(seed)).host[0].text)
    expect(firsts.size).toBeGreaterThan(1)
  })
})
