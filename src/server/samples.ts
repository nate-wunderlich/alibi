/**
 * Prose samples (R38 (4)): run one setting through the real text pipeline
 * (the same prompts, validators, askForJson, and fallbacks the game uses) and
 * report how each step went, so quality is measured, not eyeballed.
 *
 * Text AI only (questions, case, alibis, confession): no images, no audio. Reached
 * only through the devSamples action, which refuses outside the dev server.
 */

import { askForAlibis, askForCase, askForJson, type IntegrationCaller } from '../actions/ai'
import { alibiOrder, templateAlibi } from '../game/alibis'
import { buildQuestionPrompt, type AnsweredQuestion } from '../game/caseGen'
import { PRESET_CASE, type PresetCase } from '../game/presetCase'
import { fallbackQuestions, splitForPlayers, validateQuestions, type QuestionSet } from '../game/questions'
import type { Setting } from '../game/settings'
import { confessionPrompt, templateConfession, validateConfession } from './narration'

export type StepOutcome = 'first-try' | 'retry' | 'fallback'

export interface SampleResult {
  setting: string
  steps: { questions: StepOutcome; case: StepOutcome; alibis: StepOutcome; confession: StepOutcome }
  questions: QuestionSet
  answers: AnsweredQuestion[]
  caseTitle: string
  victim: string
  suspects: string[]
  openingNarration: string
  solution: { culprit: string; method: string; place: string }
  confession: string
  /** R41, R43: the 12 alibis, one per card, as the 'alibis' job would write them (byAi: false = the template). */
  alibis: { kind: string; card: string; text: string; byAi: boolean }[]
}

/** Turn askForJson's report into a step outcome. */
function tracker() {
  let outcome: StepOutcome = 'fallback'
  return {
    report: (r: { attempts: number; ok: boolean }) => {
      outcome = !r.ok ? 'fallback' : r.attempts === 1 ? 'first-try' : 'retry'
    },
    get outcome() {
      return outcome
    },
  }
}

/**
 * `guardNames` are FAKE display names (the script passes "Alex Rivera" and
 * "Sam Porter"): they only exercise the R39 guard and R40 substitution, exactly as the game passes
 * real names to it. They never go into a prompt.
 */
export async function runSample(tools: IntegrationCaller, setting: Setting, guardNames: string[]): Promise<SampleResult> {
  // 1. Questions, exactly as prepareRound asks for them (fallback: the generic bank).
  const q = tracker()
  const questions =
    (await askForJson<QuestionSet>(
      tools,
      `sample questions (${setting.id})`,
      buildQuestionPrompt(setting),
      (value) => {
        const checked = validateQuestions(value, { playerNames: guardNames })
        return checked.ok ? { ok: true, value: splitForPlayers(checked.questions) } : checked
      },
      900,
      { report: q.report, playerNames: guardNames },
    )) ?? fallbackQuestions(Math.random)

  // 2. Fixed taps: the second option of every question, labelled by seat (R39).
  const answers: AnsweredQuestion[] = [
    ...questions.host.map((x) => ({ seat: 'host' as const, question: x.text, answer: x.answers[1] })),
    ...questions.guest.map((x) => ({ seat: 'guest' as const, question: x.text, answer: x.answers[1] })),
  ]

  // 3. The case, exactly as openRound asks for it (fallback: the preset case).
  const c = tracker()
  const theCase: PresetCase =
    (await askForCase(tools, `sample case (${setting.id})`, setting, answers, [], guardNames, c.report)) ?? PRESET_CASE

  // 3b. The alibis, as the 'alibis' job asks for them, card by card (R43): null keeps the template.
  const a = tracker()
  const orderedCards = alibiOrder(theCase.cards)
  const aiAlibis = await askForAlibis(tools, `sample alibis (${setting.id})`, setting, orderedCards, guardNames, a.report)

  // 4. A code-picked solution, then the confession as the reveal job asks for it (fallback: the template).
  const pick = (kind: string) => {
    const of = theCase.cards.filter((card) => card.kind === kind)
    return of[Math.floor(Math.random() * of.length)]
  }
  const [culprit, method, place] = [pick('suspect'), pick('weapon'), pick('location')]
  const k = tracker()
  const confession =
    (await askForJson<string>(
      tools,
      `sample confession (${setting.id})`,
      confessionPrompt({
        title: theCase.title,
        victim: theCase.victim,
        settingName: setting.name,
        culprit,
        method,
        place,
        answers,
      }),
      (value) => validateConfession(value, culprit.name, guardNames),
      500,
      { report: k.report, playerNames: guardNames },
    )) ?? templateConfession({ culprit: culprit.name, method: method.name, place: place.name })

  return {
    setting: setting.name,
    steps: { questions: q.outcome, case: c.outcome, alibis: a.outcome, confession: k.outcome },
    questions,
    answers,
    caseTitle: theCase.title,
    victim: theCase.victim,
    suspects: theCase.cards.filter((card) => card.kind === 'suspect').map((card) => card.name),
    openingNarration: theCase.openingNarration,
    solution: { culprit: culprit.name, method: method.name, place: place.name },
    confession,
    alibis: orderedCards.map((card, i) => ({
      kind: card.kind,
      card: card.name,
      text: aiAlibis[i] ?? templateAlibi(card),
      byAi: aiAlibis[i] !== null,
    })),
  }
}
