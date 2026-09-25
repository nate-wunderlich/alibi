/**
 * Narration (R36): the voiced opening, and the confession at the reveal.
 *
 * - runOpening voices the round's opening narration (speech/text-to-speech,
 *   tts-1, voice fable, mp3) and sets openingAudioUrl.
 * - runConfession asks the AI for a short first-person confession FROM the
 *   solution (the first time the AI sees it, R4), keeps the code-built
 *   template if the AI fails twice, voices whichever text stands, and sets
 *   confession and confessionAudioUrl.
 *
 * Both run as background jobs in production builds only (R35's switch), skip
 * work already done so a retry never pays twice, and log one line per paid
 * call so the app keeps its own count (FRICTION 9).
 */

import { askForJson, integrationFromCron, isCreditsError } from '../actions/ai'
import { creditsWatch, recordAiPaused } from './aiPaused'
import {
  containsPlayerName,
  findGraphicTerm,
  playerNameError,
  seatLabel,
  type AnsweredQuestion,
  type Prompt,
} from '../game/caseGen'
import { SETTINGS } from '../game/settings'
import { toBase64 } from './media'
import type { PortraitDeps } from './portraits'

/** Same needs as the portraits job: records, integrations, and a way to store a file. */
export type NarrationDeps = PortraitDeps

/** R37: room for a 60-90 word confession. */
export const CONFESSION_MAX = 700
const TTS = { model: 'tts-1', voice: 'fable', response_format: 'mp3' } as const

interface Named {
  name: string
  description: string
}

/** The confession written at once at the reveal: free, and always present. */
export function templateConfession(s: { culprit: string; method: string; place: string }): string {
  return (
    `I am ${s.culprit}, and it was me. I used ${s.method} in ${s.place}. ` +
    'I was sure nobody would ever piece it together.'
  )
}

/** The prompt for the AI's confession: the case, and now the solution too. */
export function confessionPrompt(c: {
  title: string
  victim: string
  settingName: string
  culprit: Named
  method: Named
  place: Named
  /** Both players' choices, by seat only (R39: never by name). */
  answers: AnsweredQuestion[]
}): Prompt {
  return {
    system: [
      'You write the confession at the end of a case in alibi, a two-player detective game.',
      'The case is solved; you are told the truth for the first time.',
      'Keep it family-friendly, like a party mystery game: no graphic injuries or gore.',
      'Reply with JSON only: {"confession": "..."}, no code fences, no text before or after it.',
    ].join('\n'),
    user: [
      `Case: ${c.title}`,
      `Setting: ${c.settingName}`,
      `Victim: ${c.victim}`,
      `The culprit: ${c.culprit.name}. ${c.culprit.description}`,
      `How: ${c.method.name}. ${c.method.description}`,
      `Where: ${c.place.name}. ${c.place.description}`,
      '',
      'The players\' choices that shaped this case, by seat (players are only ever "the host" and "the guest"):',
      ...c.answers.map((a) => `${seatLabel(a.seat)}: ${a.question} -> ${a.answer}`),
      '',
      `Write the confession in the culprit's own voice, in the first person, 60 to 90 words, spoken aloud.`,
      `Start by saying their full name, "${c.culprit.name}". Say how and where, and give the motive.`,
      'Pay off at least one choice from each player, so both players hear their choices mattered. Never use a player\'s name; say "the host" or "the guest" if you refer to them.',
      'End with a small twist. Dramatic but never gruesome.',
    ].join('\n'),
  }
}

/**
 * Check the AI's confession: a string, under the length cap, not graphic,
 * naming the culprit, and (R39) containing no token of a player's name.
 */
export function validateConfession(
  input: unknown,
  culpritName: string,
  playerNames?: string[],
): { ok: true; value: string } | { ok: false; errors: string[] } {
  const text = (input as { confession?: unknown } | null)?.confession
  if (typeof text !== 'string' || text.trim() === '') return { ok: false, errors: ['No confession text.'] }
  const errors: string[] = []
  const trimmed = text.trim()
  if (trimmed.length > CONFESSION_MAX) errors.push(`The confession is longer than ${CONFESSION_MAX} characters.`)
  const term = findGraphicTerm(trimmed)
  if (term) errors.push(`The confession is too graphic ("${term}").`)
  if (!trimmed.toLowerCase().includes(culpritName.toLowerCase())) errors.push('The confession does not name the culprit.')
  if (playerNames && containsPlayerName(trimmed, playerNames)) errors.push(playerNameError('The confession'))
  return errors.length ? { ok: false, errors } : { ok: true, value: trimmed }
}

interface Row<T> {
  recordId: string
  data: T
}

interface RoundFields {
  gameId?: string
  revealedAnswers?: string
  caseTitle?: string
  victim?: string
  settingId?: string
  openingNarration?: string
  openingAudioUrl?: string
  revealedSolution?: string
  confession?: string
  confessionAudioUrl?: string
}

async function loadRound(deps: NarrationDeps, roundId: string): Promise<RoundFields> {
  const rows = (await deps.records.query('rounds', { where: { recordId: roundId }, limit: 1 })) as Row<RoundFields>[]
  if (!rows[0]) throw new Error(`Round ${roundId} not found`)
  return rows[0].data
}

/** R49: thrown by voice() when text-to-speech is refused for lack of credits. */
class CreditsPaused extends Error {}

/** R49: flag the round as AI-paused (public), so the screens can say so. */
async function flagPaused(deps: NarrationDeps, roundId: string): Promise<void> {
  console.warn(`[narration] round ${roundId}: AI paused for credits`)
  await deps.records.update('rounds', roundId, { aiPaused: 1 })
}

/** Voice a text with TTS (one paid call, logged) and store it; returns the stored path. */
async function voice(deps: NarrationDeps, hostId: string, what: string, roundId: string, text: string): Promise<string> {
  console.info(`[narration] ${what} round ${roundId}: tts call`)
  let spoken: { audioUrl?: string }
  try {
    spoken = (await deps.integrations.call('speech/text-to-speech', { input: text, ...TTS })) as { audioUrl?: string }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (isCreditsError(message)) throw new CreditsPaused(message)
    throw e
  }
  if (!spoken?.audioUrl) throw new Error('text-to-speech returned no audio')
  const media = await toBase64(spoken.audioUrl)
  return deps.upload(hostId, { base64: media.base64, name: `${what}-${roundId}.mp3`, mimeType: media.mimeType })
}

/** R36 (1): voice the opening narration once. */
export async function runOpening(deps: NarrationDeps, job: { roundId: string; hostId: string }): Promise<void> {
  const round = await loadRound(deps, job.roundId)
  if (round.openingAudioUrl || !round.openingNarration) return
  let openingAudioUrl: string
  try {
    openingAudioUrl = await voice(deps, job.hostId, 'opening', job.roundId, round.openingNarration)
  } catch (e) {
    // R49: refused for credits: flag the round and stop (a retry would be refused too).
    if (e instanceof CreditsPaused) return flagPaused(deps, job.roundId)
    throw e
  }
  await deps.records.update('rounds', job.roundId, { openingAudioUrl })
}

/**
 * R36 (2): write the AI confession (unless it is already written), then
 * voice whichever confession stands. A TTS failure throws after the text is
 * saved, so the job's retry only voices.
 */
export async function runConfession(deps: NarrationDeps, job: { roundId: string; hostId: string }): Promise<void> {
  const round = await loadRound(deps, job.roundId)
  if (round.confessionAudioUrl) return

  let confession = round.confession ?? ''
  const solution = JSON.parse(round.revealedSolution || '{}') as { suspect?: string; weapon?: string; location?: string }
  const cards = (await deps.records.query('cards', { where: { roundId: job.roundId }, limit: 20 })) as Row<Named>[]
  const card = (id?: string) => cards.find((c) => c.recordId === id)?.data ?? { name: '?', description: '' }
  const [culprit, method, place] = [card(solution.suspect), card(solution.weapon), card(solution.location)]
  const template = templateConfession({ culprit: culprit.name, method: method.name, place: place.name })

  if (!confession || confession === template) {
    const setting = SETTINGS.find((s) => s.id === round.settingId)
    // Both players' choices (copied into the round at the reveal), labelled by seat (R39).
    const games = (await deps.records.query('games', { where: { recordId: round.gameId ?? '' }, limit: 1 })) as Row<{
      host?: string
    }>[]
    const hostId = games[0]?.data.host ?? ''
    const revealed = JSON.parse(round.revealedAnswers || '{}') as Record<string, { question: string; answer: string }[]>
    const answers: AnsweredQuestion[] = Object.entries(revealed).flatMap(([userId, list]) =>
      list.map((a) => ({ seat: userId === hostId ? ('host' as const) : ('guest' as const), question: a.question, answer: a.answer })),
    )
    // The players' display names are loaded only for the guard and substitution; they never go into the prompt (R39, R40).
    const players = (await deps.records.query('players', { where: { gameId: round.gameId ?? '' }, limit: 10 })) as Row<{
      displayName?: string
    }>[]
    const playerNames = players.map((p) => p.data.displayName ?? '').filter((n) => n.trim() !== '')
    const watch = creditsWatch()
    const written = await askForJson<string>(
      integrationFromCron(deps.integrations),
      `confession for round ${job.roundId}`,
      confessionPrompt({
        title: round.caseTitle ?? '',
        victim: round.victim ?? '',
        settingName: setting?.name ?? '',
        culprit,
        method,
        place,
        answers,
      }),
      (value) => validateConfession(value, culprit.name, playerNames),
      500,
      { playerNames, onCreditsPaused: watch.onCreditsPaused },
    )
    // R49: a credits refusal flags the round; a validation failure does not.
    await recordAiPaused((id, data) => deps.records.update('rounds', id, data), job.roundId, watch)
    if (written) {
      confession = written
      await deps.records.update('rounds', job.roundId, { confession })
    } else {
      confession = confession || template
    }
  }

  let confessionAudioUrl: string
  try {
    confessionAudioUrl = await voice(deps, job.hostId, 'confession', job.roundId, confession)
  } catch (e) {
    // R49: refused for credits: flag the round and stop (a retry would be refused too).
    if (e instanceof CreditsPaused) return flagPaused(deps, job.roundId)
    throw e
  }
  await deps.records.update('rounds', job.roundId, { confessionAudioUrl })
}
