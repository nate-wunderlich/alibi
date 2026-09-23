/**
 * Secrecy (docs/SPEC.md, Tests; R5, R29): a browser only ever receives the
 * records its user may see. Written before the permissions exist, so it must
 * fail first (D10) and pass once the schemas are locked (D11).
 *
 * Alice hosts, Bob joins, Alice starts the series. Then each browser opens
 * the dev probe (/dev/records), which shows exactly what useQuery returns
 * for that user, for this round only (the local database keeps rows from
 * earlier runs).
 *
 * Needs the test accounts named "Alice" and "Bob" in the local registry.
 */
import type { Page } from '@playwright/test'
import { test, expect } from 'deepspace/testing'

interface ActionResponse<T> {
  success: boolean
  data?: T
  error?: string
}

/** Call a server action from inside a signed-in page, the way the app does: bearer token, JSON body. */
async function callAction<T>(page: Page, name: string, params: Record<string, unknown>): Promise<ActionResponse<T>> {
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

interface RecordRow {
  recordId: string
  data: Record<string, string>
}

/** Open the probe for one round and return the hands and solution rows this browser received. */
async function visibleRecords(page: Page, roundId: string) {
  await page.goto(`/dev/records?round=${encodeURIComponent(roundId)}`)
  const hands = page.getByTestId('hands')
  const solution = page.getByTestId('solution')
  await expect(hands).toHaveAttribute('data-status', 'ready', { timeout: 15_000 })
  await expect(solution).toHaveAttribute('data-status', 'ready', { timeout: 15_000 })
  return {
    hands: JSON.parse((await hands.textContent()) ?? '[]') as RecordRow[],
    solution: JSON.parse((await solution.textContent()) ?? '[]') as RecordRow[],
  }
}

test('each player receives only their own hand, and nobody receives the solution', async ({ users }) => {
  const [alice, bob] = await users(['Alice', 'Bob'])
  await Promise.all([alice.page.goto('/home'), bob.page.goto('/home')])
  for (const u of [alice, bob]) {
    await expect(u.page.getByTestId('app-navigation')).toBeVisible({ timeout: 15_000 })
  }

  // Setup: create, join, start. These must all succeed.
  const created = await callAction<{ gameId: string; code: string; userId: string }>(alice.page, 'createGame', {
    bestOf: 3,
  })
  expect(created.error).toBeUndefined()
  expect(created.success).toBe(true)
  const { gameId, code, userId: aliceId } = created.data!

  const joined = await callAction<{ gameId: string; userId: string }>(bob.page, 'joinGame', { code })
  expect(joined.error).toBeUndefined()
  expect(joined.success).toBe(true)
  const bobId = joined.data!.userId

  const started = await callAction<{ roundId: string }>(alice.page, 'startSeries', { gameId })
  expect(started.error).toBeUndefined()
  expect(started.success).toBe(true)
  const { roundId } = started.data!

  // Secrecy. Soft assertions, so every leak is reported, not just the first.
  const asBob = await visibleRecords(bob.page, roundId)
  expect.soft(asBob.hands, 'Bob should receive exactly 1 hands row').toHaveLength(1)
  expect.soft(asBob.hands[0]?.data.userId, "Bob's only hands row should be his").toBe(bobId)
  expect.soft(JSON.parse(asBob.hands[0]?.data.cardIds ?? '[]'), 'Bob should hold 4 cards').toHaveLength(4)
  expect.soft(asBob.solution, 'Bob should receive 0 solution rows').toHaveLength(0)

  const asAlice = await visibleRecords(alice.page, roundId)
  expect.soft(asAlice.hands, 'Alice should receive exactly 1 hands row').toHaveLength(1)
  expect.soft(asAlice.hands[0]?.data.userId, "Alice's only hands row should be hers").toBe(aliceId)
  expect.soft(JSON.parse(asAlice.hands[0]?.data.cardIds ?? '[]'), 'Alice should hold 4 cards').toHaveLength(4)
})
