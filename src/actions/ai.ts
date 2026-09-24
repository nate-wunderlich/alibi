/**
 * The one way the server asks the AI for something (R31): anthropic/chat-completion
 * through tools.integration, with claude-haiku-4-5 set explicitly (the
 * endpoint's default model is off standard pricing).
 *
 * askForJson sends a prompt, reads the reply as JSON (code fences stripped),
 * and checks it with a validator. If the reply is unusable it retries (2
 * calls in all by default; the case gets 3, R40), then returns null so the
 * caller uses its fallback. It never throws.
 *
 * Nothing here ever sends the solution: callers build prompts from
 * src/game/caseGen.ts, which only knows the setting and the answers (R4).
 */

import type { ActionResult, ActionTools, CronContext } from 'deepspace/worker'
import { alibiOrder, alibiPrompt, validateAlibis, type AlibiCardRef } from '../game/alibis'
import { buildCasePrompt, substituteNames, validateCase, type AnsweredQuestion, type Prompt } from '../game/caseGen'
import type { PresetCase } from '../game/presetCase'
import type { Setting } from '../game/settings'

export const AI_MODEL = 'claude-haiku-4-5'

type Check<T> = (value: unknown) => { ok: true; value: T } | { ok: false; errors: string[] }

/** The text of an Anthropic Messages response, or '' if there is none. */
function replyText(data: unknown): string {
  const content = (data as { content?: { type?: string; text?: string }[] } | null)?.content
  return (content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('')
}

/** Parse JSON from a reply, allowing a ```json fence around it. */
function parseJson(text: string): unknown {
  const unfenced = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  return JSON.parse(unfenced)
}

/** All askForJson needs: a way to call an integration, as actions have it. */
export type IntegrationCaller = Pick<ActionTools, 'integration'>

/**
 * Let a background job use askForJson (R36). The cron context's
 * integrations.call returns the data or throws; this wraps it into the
 * { success, data, error } shape actions get from tools.integration.
 */
export function integrationFromCron(integrations: CronContext['integrations']): IntegrationCaller {
  return {
    integration: async <T = unknown>(endpoint: string, data?: unknown): Promise<ActionResult<T>> => {
      try {
        const value = await integrations.call(endpoint, (data ?? {}) as Record<string, unknown>)
        return { success: true, data: value as T }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    },
  }
}

type Message = { role: 'user' | 'assistant'; content: string }

export interface AskOptions {
  /** Told how many calls were made and whether one passed (the sample command's pass rates; R38). */
  report?: (r: { attempts: number; ok: boolean }) => void
  /** The most calls to make before giving up (default 2; the case gets CASE_ATTEMPTS, R40). */
  attempts?: number
  /**
   * The players' display names (R40). A capitalized token of one in the reply
   * is replaced in code with a neutral name before the check, so a collision
   * costs no retry, and a retry never shows the AI a player's name.
   */
  playerNames?: string[]
}

export async function askForJson<T>(
  tools: IntegrationCaller,
  label: string,
  prompt: Prompt,
  check: Check<T>,
  maxTokens: number,
  options: AskOptions = {},
): Promise<T | null> {
  const { report, attempts = 2, playerNames = [] } = options
  // R38: a retry shows the AI its previous reply and exactly what was wrong with it.
  let messages: Message[] = [{ role: 'user', content: prompt.user }]
  for (let attempt = 1; attempt <= attempts; attempt++) {
    console.info(`[ai] ${label}: call ${attempt}`)
    const result = await tools.integration('anthropic/chat-completion', {
      model: AI_MODEL,
      max_tokens: maxTokens,
      system: prompt.system,
      messages,
    })
    if (!result.success) {
      console.warn(`[ai] ${label}: call ${attempt} failed: ${result.error}`)
      continue
    }
    const reply = replyText(result.data)
    // The reply shown back on a retry has any player-name token already replaced (R39, R40).
    const retryWith = (feedback: string, shown = substituteNames(reply, playerNames)): Message[] => [
      { role: 'user', content: prompt.user },
      { role: 'assistant', content: shown },
      { role: 'user', content: feedback },
    ]
    let parsed: unknown
    try {
      parsed = parseJson(reply)
    } catch {
      console.warn(`[ai] ${label}: call ${attempt} was not valid JSON`)
      messages = retryWith('Your reply was not valid JSON. Reply again with the JSON only: no code fences, no other text.')
      continue
    }
    const substituted = substituteNames(parsed, playerNames)
    if (substituted !== parsed) console.info(`[ai] ${label}: call ${attempt}: replaced a player-name collision in code (R40)`)
    const checked = check(substituted)
    if (checked.ok) {
      console.info(`[ai] ${label}: ok on call ${attempt}`)
      report?.({ attempts: attempt, ok: true })
      return checked.value
    }
    console.warn(`[ai] ${label}: call ${attempt} failed validation: ${checked.errors.slice(0, 3).join(' ')}`)
    messages = retryWith(
      ['Your reply did not pass these checks:', ...checked.errors.map((e) => `- ${e}`), 'Reply again with the corrected JSON only.'].join('\n'),
      substituted === parsed ? reply : JSON.stringify(substituted),
    )
  }
  console.warn(`[ai] ${label}: using the fallback`)
  report?.({ attempts, ok: false })
  return null
}

/** R40: the case gets 3 calls before the preset fallback. */
export const CASE_ATTEMPTS = 3

/**
 * The case path, shared by openRound and the sample command: the case
 * prompt, name substitution, validation, and up to CASE_ATTEMPTS calls.
 * Returns null if every call failed (the caller then uses the preset case).
 */
export function askForCase(
  tools: IntegrationCaller,
  label: string,
  setting: Setting,
  answers: AnsweredQuestion[],
  earlierTitles: string[],
  playerNames: string[],
  report?: AskOptions['report'],
): Promise<PresetCase | null> {
  return askForJson<PresetCase>(
    tools,
    label,
    buildCasePrompt(setting, answers, earlierTitles),
    (value) => {
      const checked = validateCase(value, { settingName: setting.name, playerNames })
      return checked.ok ? { ok: true, value: checked.case } : checked
    },
    2000,
    { attempts: CASE_ATTEMPTS, playerNames, report },
  )
}

/** R43: the alibis get their one retry only when more than this many are invalid. */
export const ALIBI_RETRY_OVER = 3

/**
 * The alibi path (R41-R43), shared by the 'alibis' job and the sample
 * command: the numbered prompt, then card-by-card acceptance. A card's first
 * valid alibi (from either call) is kept; the one retry happens only when
 * more than ALIBI_RETRY_OVER are invalid, and shows the AI the per-number
 * errors. Returns one entry per card, in alibiOrder(cards): the AI's text, or
 * null where the card keeps its template.
 */
export async function askForAlibis(
  tools: IntegrationCaller,
  label: string,
  setting: Setting,
  cards: (AlibiCardRef & { description: string })[],
  playerNames: string[],
  report?: AskOptions['report'],
): Promise<(string | null)[]> {
  const ordered = alibiOrder(cards)
  const kept: (string | null)[] = ordered.map(() => null)
  await askForJson<true>(
    tools,
    label,
    alibiPrompt(setting, ordered),
    (value) => {
      const checked = validateAlibis(value, ordered, playerNames)
      if (!checked.ok) return checked
      checked.results.forEach((r, i) => {
        if (r.ok && kept[i] === null) kept[i] = r.text
      })
      const invalid = checked.results.filter((r) => !r.ok)
      if (invalid.length > ALIBI_RETRY_OVER) return { ok: false, errors: invalid.flatMap((r) => (r.ok ? [] : r.errors)) }
      return { ok: true, value: true }
    },
    1500,
    { attempts: 2, playerNames, report },
  )
  const written = kept.filter((t) => t !== null).length
  console.info(`[ai] ${label}: ${written} of ${ordered.length} alibis written by the AI; the rest keep their templates`)
  return kept
}

