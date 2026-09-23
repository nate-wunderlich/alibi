/**
 * The screens, driven only through real buttons and inputs (no action calls):
 * create a game, join it by code, see the lobby, start, see the table, and
 * make a guess that shows up in both browsers' round log.
 *
 * Needs the test accounts named "Alice" and "Bob" in the local registry.
 */
import type { Page } from '@playwright/test'
import { test, expect } from 'deepspace/testing'

const T = { timeout: 15_000 }

/**
 * Open a Select by its trigger's test id and pick its first option. Closed
 * select popups stay mounted but hidden, so only a visible option counts.
 */
async function pickFirst(page: Page, triggerTestId: string) {
  await page.getByTestId(triggerTestId).click()
  await page.locator('[role="option"]:visible').first().click()
  await expect(page.locator('[role="option"]:visible')).toHaveCount(0)
}

test('create, join, lobby, start, table, and a guess seen by both players', async ({ users }) => {
  test.setTimeout(120_000)
  const [alice, bob] = await users(['Alice', 'Bob'])

  // Alice creates a best-of-3 game and is shown the join code.
  await alice.page.goto('/home')
  await alice.page.getByTestId('best-of-3').click()
  await alice.page.getByTestId('create-game').click()
  const codeEl = alice.page.getByTestId('join-code')
  await expect(codeEl).toHaveText(/^[A-Z0-9]{6}$/, T)
  const code = (await codeEl.textContent())!.trim()

  // Bob joins with the code.
  await bob.page.goto('/home')
  await bob.page.getByTestId('join-code-input').fill(code)
  await bob.page.getByTestId('join-game').click()

  // Both see the lobby with both players.
  for (const u of [alice, bob]) {
    await expect(u.page.getByTestId('lobby'), `${u.name} sees the lobby`).toBeVisible(T)
    await expect(u.page.getByTestId('lobby-player'), `${u.name} sees both players`).toHaveCount(2, T)
  }
  await expect(bob.page.getByTestId('join-code'), 'only the host sees the code').toHaveCount(0)

  // Alice starts; both see the table.
  await alice.page.getByTestId('start-series').click()
  for (const u of [alice, bob]) {
    await expect(u.page.getByTestId('table'), `${u.name} sees the table`).toBeVisible(T)
    await expect(u.page.getByTestId('case-title')).not.toBeEmpty()
    await expect(u.page.getByTestId('score-host')).toHaveText('0')
    await expect(u.page.getByTestId('score-guest')).toHaveText('0')
    await expect(u.page.getByTestId('hand-card'), `${u.name} holds 4 cards`).toHaveCount(4, T)
    await expect(u.page.getByTestId('face-up-card')).toBeVisible()
  }

  // Alice starts round 1: she can guess; Bob waits.
  await expect(alice.page.getByTestId('guess-builder')).toBeVisible(T)
  await expect(alice.page.getByTestId('guess-submit')).toBeVisible()
  await expect(bob.page.getByTestId('turn-waiting')).toBeVisible(T)
  await expect(bob.page.getByTestId('guess-builder')).toHaveCount(0)

  // Alice builds and submits a guess; it appears in both round logs.
  await pickFirst(alice.page, 'guess-suspect')
  await pickFirst(alice.page, 'guess-weapon')
  await pickFirst(alice.page, 'guess-location')
  await alice.page.getByTestId('guess-submit').click()
  for (const u of [alice, bob]) {
    await expect(u.page.getByTestId('round-log-entry'), `${u.name} sees the guess in the log`).toHaveCount(1, T)
  }
})
