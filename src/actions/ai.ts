/**
 * The one way the server asks the AI for something (R31): anthropic/chat-completion
 * through tools.integration, with claude-haiku-4-5 set explicitly (the
 * endpoint's default model is off standard pricing).
 *
 * askForJson sends a prompt, reads the reply as JSON (code fences stripped),
 * and checks it with a validator. If the reply is unusable it retries once,
 * then returns null so the caller uses its fallback. It never throws.
 *
 * Nothing here ever sends the solution: callers build prompts from
 * src/game/caseGen.ts, which only knows the setting and the answers (R4).
 */

import type { ActionResult, ActionTools, CronContext } from 'deepspace/worker'
import type { Prompt } from '../game/caseGen'

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

export async function askForJson<T>(
  tools: IntegrationCaller,
  label: string,
  prompt: Prompt,
  check: Check<T>,
  maxTokens: number,
): Promise<T | null> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    console.info(`[ai] ${label}: call ${attempt}`)
    const result = await tools.integration('anthropic/chat-completion', {
      model: AI_MODEL,
      max_tokens: maxTokens,
      system: prompt.system,
      messages: [{ role: 'user', content: prompt.user }],
    })
    if (!result.success) {
      console.warn(`[ai] ${label}: call ${attempt} failed: ${result.error}`)
      continue
    }
    let parsed: unknown
    try {
      parsed = parseJson(replyText(result.data))
    } catch {
      console.warn(`[ai] ${label}: call ${attempt} was not valid JSON`)
      continue
    }
    const checked = check(parsed)
    if (checked.ok) {
      console.info(`[ai] ${label}: ok on call ${attempt}`)
      return checked.value
    }
    console.warn(`[ai] ${label}: call ${attempt} failed validation: ${checked.errors.slice(0, 3).join(' ')}`)
  }
  console.warn(`[ai] ${label}: using the fallback`)
  return null
}
