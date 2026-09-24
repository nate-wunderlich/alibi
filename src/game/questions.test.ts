import { describe, expect, it } from 'vitest'
import {
  ANSWER_MAX_LENGTH,
  BEAT_MAX_WORDS,
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
    { beat: 'The lights flicker around you. Somewhere below deck, glass breaks.', text: 'What went wrong just before the crime?', answers: ['A power cut', 'A loud crash', 'An alarm', 'A scream'] },
    { beat: 'You watch the crew at dinner. One chair scrapes back too fast.', text: 'Who was acting strangely?', answers: ['The captain', 'The cook', 'The guest', 'The doctor'] },
    { beat: 'The corridor is empty now. You try to picture the last footsteps.', text: 'Where was the last place anyone saw the victim?', answers: ['The deck', 'The galley', 'The cabin', 'The hold'] },
    { beat: 'Raised voices reach you through the walls all evening.', text: 'What was everyone arguing about?', answers: ['Money', 'A secret', 'An old feud', 'A love letter'] },
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

describe('scene beats (R37)', () => {
  it(`caps a beat at ${BEAT_MAX_WORDS} words`, () => {
    expect(BEAT_MAX_WORDS).toBe(30)
    const atLimit = validSet()
    // Beats must address the player (R38), so the filler starts with "you".
    atLimit[0] = { ...atLimit[0], beat: ['you', ...Array.from({ length: 29 }, () => 'word')].join(' ') }
    expect(validateQuestions(atLimit).ok).toBe(true)
    const tooLong = validSet()
    tooLong[0] = { ...tooLong[0], beat: ['you', ...Array.from({ length: 30 }, () => 'word')].join(' ') }
    expect(validateQuestions(tooLong).ok).toBe(false)
  })

  it('requires a non-empty beat on every question', () => {
    const missing = validSet() as Partial<Question>[]
    delete missing[2].beat
    expect(validateQuestions(missing).ok).toBe(false)
    const blank = validSet()
    blank[1] = { ...blank[1], beat: '   ' }
    expect(validateQuestions(blank).ok).toBe(false)
  })

  it('requires the beat to address the player ("you" or "your") (R38)', () => {
    const detached = validSet()
    detached[0] = { ...detached[0], beat: 'Investigators examine the racket fragments.' }
    const result = validateQuestions(detached)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/you/i)
  })

  it("rejects a beat that contains two or more of its question's answer options (R38)", () => {
    const leaky = validSet()
    leaky[1] = { ...leaky[1], beat: 'You wonder: was it the captain, or the cook?' }
    const result = validateQuestions(leaky)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/options/i)
    const one = validSet()
    one[1] = { ...one[1], beat: 'You watch the captain pace the deck.' }
    expect(validateQuestions(one).ok).toBe(true)
  })

  it('applies the tone guard to beats', () => {
    const graphic = validSet()
    graphic[0] = { ...graphic[0], beat: 'You find blood on the stairs.' }
    const result = validateQuestions(graphic)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/graphic/i)
  })
})

describe('fallback bank', () => {
  it('has at least 8 questions, each valid on its own terms', () => {
    expect(FALLBACK_BANK.length).toBeGreaterThanOrEqual(8)
    for (const q of FALLBACK_BANK) {
      expect(q.answers).toHaveLength(4)
      expect(q.text.length).toBeLessThanOrEqual(120)
      expect(q.beat.trim().length, `"${q.text}" has a beat`).toBeGreaterThan(0)
      expect(q.beat.trim().split(/\s+/).length, `"${q.text}" beat is at most 30 words`).toBeLessThanOrEqual(30)
      expect(q.beat, `"${q.text}" beat addresses the player`).toMatch(/\b(you|your)\b/i)
      const leaked = q.answers.filter((a) => q.beat.toLowerCase().includes(a.toLowerCase()))
      expect(leaked.length, `"${q.text}" beat does not give away 2+ options`).toBeLessThan(2)
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
