/**
 * No scrolling, anywhere (R47): every screen fits 390x660 (a phone minus its
 * browser bars) and 1280x720, with no page scroll and no scrolling panel.
 *
 * One walk through a best-of-3 series reaches every screen; each is measured
 * at both sizes. Every measurement is a soft assertion, so one run reports
 * the whole map. Results are printed as "[no-scroll] {json}" lines and saved
 * to no-scroll-results.json; each failing screen at 390x660 is saved as a
 * screenshot, both in this test's output folder.
 *
 * Needs the test accounts named "Alice" and "Bob".
 */
import type { Page, TestInfo } from '@playwright/test'
import { test, expect } from 'deepspace/testing'
import { answerMyQuestions, mustCall, parseJson, visibleRecords } from './helpers/game'

const VIEWPORTS = [
  { name: '390x660', width: 390, height: 660 },
  { name: '1280x720', width: 1280, height: 720 },
]

interface Measurement {
  screen: string
  viewport: string
  pass: boolean
  /** scrollingElement.scrollHeight - innerHeight (page scroll; <= 0 fits). */
  pageOverflow: number
  /** Visible elements with overflow auto/scroll whose content is taller than the box. */
  panels: { element: string; overflow: number }[]
}

/** What the browser shows right now: page overflow, and every scrolling panel that has somewhere to scroll. */
async function measureNow(page: Page) {
  return page.evaluate(() => {
    const se = document.scrollingElement ?? document.documentElement
    const panels: { element: string; overflow: number }[] = []
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      const style = getComputedStyle(el)
      if (!/(auto|scroll)/.test(`${style.overflowY} ${style.overflow}`)) continue
      if (el.clientHeight === 0 || style.visibility === 'hidden') continue
      const overflow = el.scrollHeight - el.clientHeight
      if (overflow <= 1) continue
      const id = el.getAttribute('data-testid') ?? el.getAttribute('data-slot') ?? ''
      panels.push({ element: `${el.tagName.toLowerCase()}${id ? `[${id}]` : ''}`, overflow })
    }
    return { pageOverflow: se.scrollHeight - window.innerHeight, panels }
  })
}

const results: Measurement[] = []

/** Measure the current screen at both sizes; save a 390x660 screenshot when it fails. */
async function measure(page: Page, screen: string, testInfo: TestInfo) {
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await page.waitForTimeout(400)
    const m = await measureNow(page)
    const r: Measurement = { screen, viewport: vp.name, pass: m.pageOverflow <= 0 && m.panels.length === 0, ...m }
    results.push(r)
    console.log(`[no-scroll] ${JSON.stringify(r)}`)
    if (!r.pass && vp.name === '390x660') {
      await page.screenshot({ path: testInfo.outputPath(`${screen.replace(/[^a-z0-9]+/gi, '-')}-390x660.png`) })
    }
    expect.soft(r.pass, `${screen} at ${vp.name}: page +${r.pageOverflow}px, ${r.panels.length} scrolling panel(s)`).toBe(true)
  }
}

type Kind = 'suspect' | 'weapon' | 'location'
type Triple = Record<Kind, string>
const KINDS: Kind[] = ['suspect', 'weapon', 'location']

/** A player's hand, the card kinds, and the face-up card, read through the probe. */
async function readRound(page: Page, roundId: string, gameId: string) {
  const v = await visibleRecords(page, roundId, gameId)
  const round = v.rounds.rows.find((r) => r.recordId === roundId)!
  return {
    hand: parseJson<string[]>(v.hands.rows[0].data.cardIds),
    kindOf: new Map(v.cards.rows.map((c) => [c.recordId, c.data.kind as Kind])),
    faceUp: String(round.data.faceUpCardId),
    turnUserId: String(round.data.turnUserId),
  }
}

/** The envelope as a spectator of both hands works it out: the 3 cards in no hand and not face up. */
function envelopeOf(a: Awaited<ReturnType<typeof readRound>>, b: Awaited<ReturnType<typeof readRound>>): Triple {
  const env = {} as Triple
  for (const id of a.kindOf.keys()) {
    if (!a.hand.includes(id) && !b.hand.includes(id) && id !== a.faceUp) env[a.kindOf.get(id)!] = id
  }
  return env
}

test('R47: every screen fits 390x660 and 1280x720 without scrolling', async ({ users }, testInfo) => {
  test.setTimeout(900_000)
  const [alice, bob] = await users(['Alice', 'Bob'])
  const gameUrl = (id: string) => `/game/${id}`

  // Static and home screens.
  await alice.page.goto('/')
  await expect(alice.page.getByTestId('static-landing')).toBeVisible({ timeout: 15_000 })
  await measure(alice.page, 'landing', testInfo)
  await alice.page.goto('/how-to-play')
  await expect(alice.page.getByTestId('how-to-play')).toBeVisible({ timeout: 15_000 })
  await measure(alice.page, 'how-to-play', testInfo)
  await alice.page.goto('/home')
  await expect(alice.page.getByTestId('join-code-input')).toBeVisible({ timeout: 15_000 })
  await measure(alice.page, 'home (signed in)', testInfo)

  // Lobby, as host and as guest, with the questions showing.
  await bob.page.goto('/home')
  const created = await mustCall<{ gameId: string; code: string; roundId: string; userId: string }>(alice.page, 'createGame', {
    bestOf: 3,
  })
  const { gameId } = created
  await mustCall(bob.page, 'joinGame', { code: created.code })
  for (const [u, who] of [
    [alice, 'host'],
    [bob, 'guest'],
  ] as const) {
    await u.page.goto(gameUrl(gameId))
    await expect(u.page.getByTestId('lobby')).toBeVisible({ timeout: 15_000 })
    await expect(u.page.getByTestId('question')).toHaveCount(2, { timeout: 30_000 })
    await measure(u.page, `lobby (${who})`, testInfo)
  }

  // Start the series; work out who is on turn and the envelope.
  await answerMyQuestions(alice.page, created.roundId, gameId)
  await answerMyQuestions(bob.page, created.roundId, gameId)
  await mustCall(alice.page, 'startSeries', { gameId })
  const roundId = created.roundId
  const a = await readRound(alice.page, roundId, gameId)
  const b = await readRound(bob.page, roundId, gameId)
  const envelope = envelopeOf(a, b)
  const aliceStarts = a.turnUserId === created.userId
  const [starter, other] = aliceStarts ? [alice, bob] : [bob, alice]
  const [sv, ov] = aliceStarts ? [a, b] : [b, a]

  // Table: the player on turn, and the waiting player (the grid is on the table).
  for (const [u, who] of [
    [starter, 'on turn'],
    [other, 'waiting'],
  ] as const) {
    await u.page.goto(gameUrl(gameId))
    await expect(u.page.getByTestId('table')).toBeVisible({ timeout: 60_000 })
    await expect(u.page.getByTestId('detective-grid')).toBeVisible({ timeout: 15_000 })
    await measure(u.page, `table (${who})`, testInfo)
  }

  // Choose a card to show: the starter names two of the other player's cards (different kinds).
  const [first] = ov.hand
  const second = ov.hand.find((id) => ov.kindOf.get(id) !== ov.kindOf.get(first))!
  const choose = { ...envelope, [ov.kindOf.get(first)!]: first, [ov.kindOf.get(second)!]: second } as Triple
  const pending = await mustCall<{ guessId: string; result: string }>(starter.page, 'guess', { roundId, ...choose })
  expect(pending.result).toBe('pending')
  await other.page.goto(gameUrl(gameId))
  await expect(other.page.getByTestId('show-card-prompt')).toBeVisible({ timeout: 15_000 })
  await measure(other.page, 'choose a card to show', testInfo)
  await mustCall(other.page, 'showCard', { guessId: pending.guessId, cardId: second })
  await mustCall(starter.page, 'endTurn', { roundId })

  // Three more no-match turns: 4 guesses in the log, and the alibi after turn 4.
  const noMatch = (v: typeof sv) => {
    const t = {} as Triple
    for (const k of KINDS) t[k] = v.hand.find((id) => v.kindOf.get(id) === k) ?? envelope[k]
    return t
  }
  for (const [u, v] of [
    [other, ov],
    [starter, sv],
    [other, ov],
  ] as const) {
    await mustCall(u.page, 'guess', { roundId, ...noMatch(v) })
    await mustCall(u.page, 'endTurn', { roundId })
  }
  await starter.page.goto(gameUrl(gameId))
  await expect(starter.page.getByTestId('round-log-entry')).toHaveCount(4, { timeout: 15_000 })
  await expect(starter.page.getByTestId('round-alibi')).toHaveCount(1, { timeout: 15_000 })
  await measure(starter.page, 'table: log (4 guesses and an alibi)', testInfo)
  await measure(starter.page, 'table: cast', testInfo)

  // Reveal: the starter accuses wrongly, so the other player wins round 1.
  const wrongSuspect = [...sv.kindOf.entries()].find(([id, k]) => k === 'suspect' && id !== envelope.suspect)![0]
  const accused = await mustCall<{ nextRoundId: string }>(starter.page, 'accuse', { roundId, ...envelope, suspect: wrongSuspect })
  await alice.page.goto(gameUrl(gameId))
  await expect(alice.page.getByTestId('reveal')).toBeVisible({ timeout: 15_000 })
  await measure(alice.page, 'reveal', testInfo)

  // Series end: round 2 (the other player starts), and they accuse correctly: 2-0.
  await answerMyQuestions(alice.page, accused.nextRoundId, gameId)
  await answerMyQuestions(bob.page, accused.nextRoundId, gameId)
  await mustCall(alice.page, 'nextRound', { gameId })
  const a2 = await readRound(alice.page, accused.nextRoundId, gameId)
  const b2 = await readRound(bob.page, accused.nextRoundId, gameId)
  await mustCall(other.page, 'accuse', { roundId: accused.nextRoundId, ...envelopeOf(a2, b2) })
  await alice.page.goto(gameUrl(gameId))
  await expect(alice.page.getByTestId('series-end')).toBeVisible({ timeout: 15_000 })
  await measure(alice.page, 'series end', testInfo)

  await testInfo.attach('no-scroll-results', { body: JSON.stringify(results, null, 2), contentType: 'application/json' })
  const { writeFileSync } = await import('node:fs')
  writeFileSync(testInfo.outputPath('no-scroll-results.json'), JSON.stringify(results, null, 2))
})
