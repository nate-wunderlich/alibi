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
  test.setTimeout(300_000)
  const [alice, bob] = await users(['Alice', 'Bob'])

  // Alice creates a best-of-3 game and is shown the join code.
  await alice.page.goto('/home')
  await alice.page.getByTestId('best-of-3').click()
  await alice.page.getByTestId('create-game').click()
  const codeEl = alice.page.getByTestId('join-code')
  await expect(codeEl).toHaveText(/^[A-Z0-9]{6}$/, T)
  const code = (await codeEl.textContent())!.trim()

  // A second Bob tab already has the game page open before he joins (mirrors
  // the live gate, where the guest's page was subscribed before the claim).
  // It must switch to the lobby and show his questions WITHOUT a reload.
  const gameId = new URL(alice.page.url()).pathname.split('/').pop()!
  const bobEarly = await bob.context.newPage()
  await bobEarly.goto(`/game/${gameId}`)
  await expect(bobEarly.getByRole('heading', { name: 'No such case file' })).toBeVisible(T)

  // Bob joins with the code.
  await bob.page.goto('/home')
  await bob.page.getByTestId('join-code-input').fill(code)
  await bob.page.getByTestId('join-game').click()

  // D19: the guest's 2 questions appear within 15s of joining, with no reload, in both tabs.
  await expect(bob.page.getByTestId('question'), "the guest's questions appear live").toHaveCount(2, T)
  await expect(bobEarly.getByTestId('question'), 'the already-open tab gets them live too').toHaveCount(2, T)
  await bobEarly.close()

  // Both see the lobby with both players.
  for (const u of [alice, bob]) {
    await expect(u.page.getByTestId('lobby'), `${u.name} sees the lobby`).toBeVisible(T)
    await expect(u.page.getByTestId('lobby-player'), `${u.name} sees both players`).toHaveCount(2, T)
  }
  await expect(bob.page.getByTestId('join-code'), 'only the host sees the code').toHaveCount(0)

  // Each player answers their 2 questions by tapping, then locks them in.
  await expect(alice.page.getByTestId('start-series'), 'no start before both answer').toBeDisabled()
  for (const u of [alice, bob]) {
    const questions = u.page.getByTestId('question')
    await expect(questions, `${u.name} gets 2 questions`).toHaveCount(2, { timeout: 30_000 })
    for (let i = 0; i < 2; i++) await questions.nth(i).getByTestId('answer-option').first().click()
    await u.page.getByTestId('submit-answers').click()
    await expect(u.page.getByTestId('my-answers'), `${u.name}'s answers are locked in`).toBeVisible(T)
  }
  for (const u of [alice, bob]) {
    await expect(u.page.getByTestId('opponent-answered')).toHaveAttribute('data-answered', 'true', T)
  }

  // Alice starts; the AI writes the case; both see the table.
  await expect(alice.page.getByTestId('start-series')).toBeEnabled(T)
  await alice.page.getByTestId('start-series').click()
  for (const u of [alice, bob]) {
    await expect(u.page.getByTestId('table'), `${u.name} sees the table`).toBeVisible({ timeout: 90_000 })
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

  // If Bob holds two or three of the named cards, he chooses one to show.
  const aliceEntry = alice.page.getByTestId('round-log-entry').first()
  if ((await aliceEntry.getAttribute('data-result')) === 'pending') {
    await bob.page.getByTestId('show-card').first().click()
  }
  await expect(aliceEntry, "Alice's guess resolves").toHaveAttribute('data-result', /^(shown|none)$/, T)

  // Detective grid (SPEC.md "Detective grid"): what Alice provably knows is pre-filled and locked.
  const cardIds = async (page: Page, testId: string) =>
    page.getByTestId(testId).evaluateAll((els) => els.map((el) => el.getAttribute('data-card-id') ?? ''))
  const aliceHand = await cardIds(alice.page, 'hand-card')
  const bobHand = await cardIds(bob.page, 'hand-card')
  const [faceUp] = await cardIds(alice.page, 'face-up-card')
  const shown = (await aliceEntry.getAttribute('data-shown-card-id')) ?? ''
  expect(aliceHand).toHaveLength(4)

  const cell = (page: Page, cardId: string, column: 'me' | 'opponent' | 'envelope') =>
    page.locator(`[data-testid="grid-row"][data-card-id="${cardId}"] [data-testid="grid-cell"][data-column="${column}"]`)

  await expect(alice.page.getByTestId('detective-grid')).toBeVisible(T)
  await expect(alice.page.getByTestId('grid-row'), 'the grid lists all 12 cards').toHaveCount(12)

  // Phone-first: at 390px wide the grid fits and the page does not scroll sideways.
  await alice.page.setViewportSize({ width: 390, height: 844 })
  const gridBox = await alice.page.getByTestId('detective-grid').boundingBox()
  expect(gridBox!.x + gridBox!.width, 'the grid fits in 390px').toBeLessThanOrEqual(390)
  expect(await alice.page.evaluate(() => document.documentElement.scrollWidth), 'no sideways scroll').toBeLessThanOrEqual(390)
  for (const id of aliceHand) {
    await expect(cell(alice.page, id, 'me'), 'her hand is marked "has" under Me').toHaveAttribute('data-mark', 'has')
    await expect(cell(alice.page, id, 'me')).toHaveAttribute('data-fixed', 'true')
  }
  await expect(alice.page.locator(`[data-testid="grid-row"][data-card-id="${faceUp}"]`)).toHaveAttribute(
    'data-face-up',
    'true',
  )
  await expect(cell(alice.page, faceUp, 'envelope'), 'the face-up card is not in the envelope').toHaveAttribute(
    'data-mark',
    'no',
  )
  if (shown) {
    await expect(cell(alice.page, shown, 'opponent'), 'the shown card is "has" under Opponent').toHaveAttribute(
      'data-mark',
      'has',
    )
    await expect(cell(alice.page, shown, 'opponent')).toHaveAttribute('data-fixed', 'true')
  }

  // Alice cycles an open cell: blank -> has -> doesn't -> maybe. It survives a reload.
  const allIds = await alice.page
    .getByTestId('grid-row')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-card-id') ?? ''))
  const open = allIds.find((id) => !aliceHand.includes(id) && !bobHand.includes(id) && id !== faceUp && id !== shown)!
  const target = cell(alice.page, open, 'envelope')
  await expect(target).toHaveAttribute('data-mark', '')
  for (const mark of ['has', 'no', 'maybe']) {
    await target.click()
    await expect(target).toHaveAttribute('data-mark', mark, T)
  }
  await alice.page.reload()
  await expect(cell(alice.page, open, 'envelope'), 'the mark survives a reload').toHaveAttribute('data-mark', 'maybe', T)

  // Bob's grid is his own: none of Alice's marks.
  await expect(cell(bob.page, open, 'envelope'), "Bob does not see Alice's mark").toHaveAttribute('data-mark', '', T)
})
