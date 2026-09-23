/**
 * Shared helpers for the multi-user game specs (secrecy.spec.ts, round.spec.ts).
 *
 * - callAction: call a server action from a signed-in page, the way the app
 *   does (bearer token from /api/auth/token, JSON body).
 * - visibleRecords: open the DEV-only probe (/dev/records) and return exactly
 *   what useQuery gave this browser for one round and game.
 */
import { expect, type Page } from '@playwright/test'

export interface ActionResponse<T = Record<string, unknown>> {
  success: boolean
  data?: T
  error?: string
}

/** Call a server action from inside a signed-in page: bearer token, JSON body. */
export async function callAction<T = Record<string, unknown>>(
  page: Page,
  name: string,
  params: Record<string, unknown>,
): Promise<ActionResponse<T>> {
  return page.evaluate(
    async ({ name, params }) => {
      const tokenRes = await fetch('/api/auth/token', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      })
      const { token } = (await tokenRes.json()) as { token?: string }
      const res = await fetch(`/api/actions/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(params),
      })
      return res.json()
    },
    { name, params },
  )
}

/** Call an action and fail the test with its error message unless it succeeds. */
export async function mustCall<T = Record<string, unknown>>(
  page: Page,
  name: string,
  params: Record<string, unknown>,
): Promise<T> {
  const res = await callAction<T>(page, name, params)
  expect(res.error, `${name} should succeed`).toBeUndefined()
  expect(res.success, `${name} should succeed`).toBe(true)
  return res.data as T
}

export interface RecordRow {
  recordId: string
  createdAt?: string
  data: Record<string, unknown>
}

/** Every section the probe renders, by its data-testid. */
export const PROBE_SECTIONS = [
  'hands',
  'solution',
  'join_codes',
  'games',
  'rounds',
  'cards',
  'guesses',
  'shown_cards',
] as const
export type ProbeSection = (typeof PROBE_SECTIONS)[number]

export interface SectionResult {
  status: string | null
  text: string
  rows: RecordRow[]
}

/** Read one probe section once its query has settled (ready, or error for an unknown collection). */
async function readSection(page: Page, name: ProbeSection): Promise<SectionResult> {
  const section = page.getByTestId(name)
  await expect(section).toHaveAttribute('data-status', /^(ready|error)$/, { timeout: 15_000 })
  const text = (await section.textContent()) ?? '[]'
  return { status: await section.getAttribute('data-status'), text, rows: JSON.parse(text) as RecordRow[] }
}

export type Visible = Record<ProbeSection, SectionResult> & { allText: string }

/** Open the probe and return everything this browser received for the round and game. */
export async function visibleRecords(page: Page, roundId: string, gameId: string): Promise<Visible> {
  await page.goto(`/dev/records?round=${encodeURIComponent(roundId)}&game=${encodeURIComponent(gameId)}`)
  const result = {} as Record<ProbeSection, SectionResult>
  for (const name of PROBE_SECTIONS) result[name] = await readSection(page, name)
  return { ...result, allText: PROBE_SECTIONS.map((n) => result[n].text).join('') }
}

/** Parse a JSON text column. */
export const parseJson = <T>(value: unknown): T => JSON.parse(String(value)) as T
