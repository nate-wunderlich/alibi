/**
 * Prose samples (R38 (4)): run one setting through the real text pipeline
 * (the same prompts, validators, askForJson, and fallbacks the game uses) and
 * report how each step went, so quality is measured, not eyeballed.
 *
 * Text AI only (questions, case, confession): no images, no audio. Reached
 * only through the devSamples action, which refuses outside the dev server.
 */

import { askForJson, type IntegrationCaller } from '../actions/ai'
import { buildCasePrompt, buildQuestionPrompt, validateCase, type AnsweredQuestion } from '../game/caseGen'
import { PRESET_CASE, type PresetCase } from '../game/presetCase'
import { fallbackQuestions, splitForPlayers, validateQuestions, type QuestionSet } from '../game/questions'
import type { Setting } from '../game/settings'
import { confessionPrompt, templateConfession, validateConfession } from './narration'

export type StepOutcome = 'first-try' | 'retry' | 'fallback'

export interface SampleResult {
  setting: string
  players: { host: string; guest: string }
  steps: { questions: StepOutcome; case: StepOutcome; confession: StepOutcome }
  questions: QuestionSet
  answers: AnsweredQuestion[]
  caseTitle: string
  victim: string
  suspects: string[]
  openingNarration: string
  solution: { culprit: string; method: string; place: string }
  confession: string
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

export async function runSample(
  tools: IntegrationCaller,
  setting: Setting,
  players: { host: string; guest: string },
): Promise<SampleResult> {
  // 1. Questions, exactly as prepareRound asks for them (fallback: the generic bank).
  const q = tracker()
  const questions =
    (await askForJson<QuestionSet>(
      tools,
      `sample questions (${setting.id})`,
      buildQuestionPrompt(setting),
      (value) => {
        const checked = validateQuestions(value)
        return checked.ok ? { ok: true, value: splitForPlayers(checked.questions) } : checked
      },
      900,
      q.report,
    )) ?? fallbackQuestions(Math.random)

  // 2. Fixed taps: the second option of every question; the host answers the first two.
  const answers: AnsweredQuestion[] = [
    ...questions.host.map((x) => ({ player: players.host, question: x.text, answer: x.answers[1] })),
    ...questions.guest.map((x) => ({ player: players.guest, question: x.text, answer: x.answers[1] })),
  ]

  // 3. The case, exactly as openRound asks for it (fallback: the preset case).
  const c = tracker()
  const theCase: PresetCase =
    (await askForJson<PresetCase>(
      tools,
      `sample case (${setting.id})`,
      buildCasePrompt(setting, answers, [], players),
      (value) => {
        const checked = validateCase(value, { settingName: setting.name, players })
        return checked.ok ? { ok: true, value: checked.case } : checked
      },
      2000,
      c.report,
    )) ?? PRESET_CASE

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
      (value) => validateConfession(value, culprit.name),
      500,
      k.report,
    )) ?? templateConfession({ culprit: culprit.name, method: method.name, place: place.name })

  return {
    setting: setting.name,
    players,
    steps: { questions: q.outcome, case: c.outcome, confession: k.outcome },
    questions,
    answers,
    caseTitle: theCase.title,
    victim: theCase.victim,
    suspects: theCase.cards.filter((card) => card.kind === 'suspect').map((card) => card.name),
    openingNarration: theCase.openingNarration,
    solution: { culprit: culprit.name, method: method.name, place: place.name },
    confession,
  }
}
