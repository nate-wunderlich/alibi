/**
 * Secrecy (docs/SPEC.md, Tests; R5, R29, R32): a browser only ever receives
 * the records its user may see. Written before the permissions existed, so it
 * failed first (D10) and passes once the schemas are locked (D11).
 *
 * Alice hosts, Bob joins, Alice starts the series. Each browser opens the dev
 * probe (/dev/records), which shows exactly what useQuery returns for that
 * user: hands and solution for this round, join codes for this game, and the
 * latest games. (The local database keeps rows from earlier runs, so every
 * check is scoped to this run's game and round.)
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
  data: Record<string, unknown>
}

/** Read one probe section once its query has settled (ready, or error for an unknown collection). */
async function readSection(page: Page, name: string) {
  const section = page.getByTestId(name)
  await expect(section).toHaveAttribute('data-status', /^(ready|error)$/, { timeout: 15_000 })
  const text = (await section.textContent()) ?? '[]'
  return { status: await section.getAttribute('data-status'), text, rows: JSON.parse(text) as RecordRow[] }
}

/** Open the probe and return everything this browser received for the round and game. */
async function visibleRecords(page: Page, roundId: string, gameId: string) {
  await page.goto(`/dev/records?round=${encodeURIComponent(roundId)}&game=${encodeURIComponent(gameId)}`)
  const [hands, solution, joinCodes, games] = [
    await readSection(page, 'hands'),
    await readSection(page, 'solution'),
    await readSection(page, 'join_codes'),
    await readSection(page, 'games'),
  ]
  return { hands, solution, joinCodes, games, allText: hands.text + solution.text + joinCodes.text + games.text }
}

/** Every received hands row must belong to the viewer: exactly 1, theirs, with 4 cards, and none of the other player's. */
function expectOnlyOwnHand(hands: RecordRow[], viewer: string, viewerId: string, otherId: string) {
  expect.soft(hands, `${viewer} should receive exactly 1 hands row`).toHaveLength(1)
  for (const row of hands) {
    expect.soft(row.data.userId, `every hands row ${viewer} receives should be ${viewer}'s`).toBe(viewerId)
    expect.soft(JSON.parse(String(row.data.cardIds)), `${viewer}'s hand should hold 4 cards`).toHaveLength(4)
  }
  const foreign = hands.filter((row) => row.data.userId === otherId)
  expect.soft(foreign, `${viewer} should receive no hands row belonging to the other player`).toHaveLength(0)
}

test('each player receives only their own hand, nobody receives the solution, only the host sees the join code', async ({
  users,
}) => {
  const [alice, bob] = await users(['Alice', 'Bob'])
  await Promise.all([alice.page.goto('/home'), bob.page.goto('/home')])
  for (const u of [alice, bob]) {
    await expect(u.page.getByTestId('app-navigation')).toBeVisible({ timeout: 15_000 })
  }

  // Alice creates a game. The code comes back to her in the action result.
  const created = await callAction<{ gameId: string; code: string; userId: string }>(alice.page, 'createGame', {
    bestOf: 3,
  })
  expect(created.error).toBeUndefined()
  expect(created.success).toBe(true)
  const { gameId, code, userId: aliceId } = created.data!

  // Before joining, Bob is not a member: the code must not reach his browser by any subscription.
  const bobBeforeJoin = await visibleRecords(bob.page, '', gameId)
  expect.soft(bobBeforeJoin.joinCodes.rows, 'Bob should receive no join_codes row for this game').toHaveLength(0)
  expect.soft(bobBeforeJoin.allText, 'the join code should appear nowhere in what Bob receives').not.toContain(code)

  // The host does see it (a positive control, so the check above is not passing by accident).
  const aliceLobby = await visibleRecords(alice.page, '', gameId)
  expect.soft(aliceLobby.joinCodes.rows, 'Alice should receive her join code').toHaveLength(1)
  expect.soft(aliceLobby.joinCodes.rows[0]?.data.code, "Alice's join_codes row should hold the code").toBe(code)

  // Bob joins with the code Alice shared out of band.
  const joined = await callAction<{ gameId: string; userId: string }>(bob.page, 'joinGame', { code })
  expect(joined.error).toBeUndefined()
  expect(joined.success).toBe(true)
  const bobId = joined.data!.userId

  // Bob tries to start Alice's game: refused, and the game is unchanged.
  const hijack = await callAction(bob.page, 'startSeries', { gameId })
  expect(hijack.success, 'Bob must not be able to start Alice\'s game').toBe(false)
  expect(hijack.error).toMatch(/host/i)
  const afterHijack = await visibleRecords(alice.page, '', gameId)
  const gameRow = afterHijack.games.rows.find((row) => row.recordId === gameId)
  expect(gameRow?.data.status, 'the game should still be in the lobby').toBe('lobby')
  expect(gameRow?.data.currentRound, 'no round should have started').toBe(0)

  // Alice starts the series.
  const started = await callAction<{ roundId: string }>(alice.page, 'startSeries', { gameId })
  expect(started.error).toBeUndefined()
  expect(started.success).toBe(true)
  const { roundId } = started.data!

  // Secrecy. Soft assertions, so every leak is reported, not just the first.
  const asBob = await visibleRecords(bob.page, roundId, gameId)
  expectOnlyOwnHand(asBob.hands.rows, 'Bob', bobId, aliceId)
  expect.soft(asBob.solution.rows, 'Bob should receive 0 solution rows').toHaveLength(0)
  expect.soft(asBob.joinCodes.rows, 'Bob should receive no join_codes row').toHaveLength(0)
  expect.soft(asBob.allText, 'the join code should appear nowhere in what Bob receives').not.toContain(code)

  const asAlice = await visibleRecords(alice.page, roundId, gameId)
  expectOnlyOwnHand(asAlice.hands.rows, 'Alice', aliceId, bobId)
  expect.soft(asAlice.solution.rows, 'Alice should receive 0 solution rows').toHaveLength(0)
})
