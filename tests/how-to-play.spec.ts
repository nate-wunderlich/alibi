/**
 * How to play (R46): a public guide at /how-to-play, linked from the landing
 * and home pages, and a panel over the table during a game (play is never
 * left: the table stays mounted underneath, and closing returns to it).
 *
 * The in-game test needs the test accounts named "Alice" and "Bob".
 */
import { test as base, expect as baseExpect } from '@playwright/test'
import { test, expect } from 'deepspace/testing'
import { answerMyQuestions, mustCall } from './helpers/game'

const T = { timeout: 15_000 }

/** The guide's sections, in order (R46). */
export const SECTIONS = [
  'The goal',
  'The cards and the envelope',
  'Your turn',
  'Alibis',
  'Choice scenes',
  'The detective grid',
  'Winning a round and a series',
]

base('a signed-out visitor reads /how-to-play: every section heading', async ({ page }) => {
  await page.goto('/how-to-play')
  await baseExpect(page.getByTestId('how-to-play')).toBeVisible(T)
  for (const heading of SECTIONS) {
    await baseExpect(page.getByRole('heading', { name: heading, exact: true }), heading).toBeVisible()
  }
})

base('the landing page and the home page link to the guide', async ({ page }) => {
  await page.goto('/')
  await baseExpect(page.getByRole('link', { name: 'How to play' }).first()).toHaveAttribute('href', '/how-to-play', T)
  await page.goto('/home')
  await baseExpect(page.getByTestId('home-how-to-play')).toHaveAttribute('href', '/how-to-play', T)
  await page.getByTestId('home-how-to-play').click()
  await baseExpect(page).toHaveURL(/\/how-to-play$/, T)
  await baseExpect(page.getByRole('heading', { name: 'The goal', exact: true })).toBeVisible(T)
})

test('during a game, the header opens the guide over the table, and closing returns to the same round', async ({
  users,
}) => {
  test.setTimeout(300_000)
  const [alice, bob] = await users(['Alice', 'Bob'])
  await Promise.all([alice.page.goto('/home'), bob.page.goto('/home')])
  const created = await mustCall<{ gameId: string; code: string; roundId: string }>(alice.page, 'createGame', {
    bestOf: 3,
  })
  await mustCall(bob.page, 'joinGame', { code: created.code })
  await answerMyQuestions(alice.page, created.roundId, created.gameId)
  await answerMyQuestions(bob.page, created.roundId, created.gameId)
  await mustCall(alice.page, 'startSeries', { gameId: created.gameId })

  const page = alice.page
  const url = `/game/${created.gameId}`
  await page.goto(url)
  await expect(page.getByTestId('table')).toBeVisible({ timeout: 60_000 })
  const turnArea = page.getByTestId('guess-builder').or(page.getByTestId('turn-waiting'))
  await expect(turnArea).toBeVisible(T)

  await page.getByTestId('nav-how-to-play').click()
  const panel = page.getByTestId('how-to-play-panel')
  await expect(panel).toBeVisible(T)
  for (const heading of SECTIONS) {
    await expect(panel.getByRole('heading', { name: heading, exact: true }), heading).toBeVisible()
  }
  // Play is never left: the table and the turn controls stay mounted underneath.
  await expect(page).toHaveURL(new RegExp(`${url}$`))
  await expect(page.getByTestId('table')).toBeAttached()
  await expect(turnArea).toBeAttached()

  await panel.getByRole('button', { name: 'Close' }).click()
  await expect(panel).toHaveCount(0, T)
  await expect(page).toHaveURL(new RegExp(`${url}$`))
  await expect(page.getByTestId('table')).toBeVisible()
  await expect(turnArea).toBeVisible()
})
