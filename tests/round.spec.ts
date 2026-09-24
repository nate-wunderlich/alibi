/**
 * A full series, best of 3 (docs/GAME_RULES.md; R29, R30, R33).
 *
 * Alice hosts, Bob joins. R41: round 1's starter is a coin flip stored on the
 * game, so the tests call the players FIRST (who starts round 1) and SECOND,
 * whichever seat that is. Round 1 walks through every kind of turn: an
 * automatic show, a turn that cannot guess twice, a choice the opponent must
 * make, a "no match", and a wrong accusation with its reveal. Round 2 (which
 * SECOND starts) ends with a correct accusation that wins the series.
 *
 * A second test plays 4 turns without accusing and checks the R41 alibi.
 *
 * The test never reads the solution collection. It works out the envelope
 * the way a spectator with both hands could: the 3 cards that are in no hand
 * and not face up.
 *
 * Needs the test accounts named "Alice" and "Bob" in the local registry.
 */
import type { Page } from '@playwright/test'
import { test, expect } from 'deepspace/testing'
import {
  answerMyQuestions,
  callAction,
  mustCall,
  parseJson,
  visibleRecords,
  type RecordRow,
  type Visible,
} from './helpers/game'

type Kind = 'suspect' | 'weapon' | 'location'
type Triple = Record<Kind, string>
const KINDS: Kind[] = ['suspect', 'weapon', 'location']

/** What a player can see of a round: their hand, plus the public cards and round row. */
interface RoundView {
  hand: string[]
  kindOf: Map<string, Kind>
  round: RecordRow
  game: RecordRow
  visible: Visible
}

async function viewRound(page: Page, roundId: string, gameId: string): Promise<RoundView> {
  const visible = await visibleRecords(page, roundId, gameId)
  const handRow = visible.hands.rows[0]
  const round = visible.rounds.rows.find((r) => r.recordId === roundId)
  const game = visible.games.rows.find((g) => g.recordId === gameId)
  expect(round, 'the round should be visible').toBeDefined()
  expect(game, 'the game should be visible').toBeDefined()
  return {
    hand: handRow ? parseJson<string[]>(handRow.data.cardIds) : [],
    kindOf: new Map(visible.cards.rows.map((c) => [c.recordId, c.data.kind as Kind])),
    round: round!,
    game: game!,
    visible,
  }
}

/** The envelope as a spectator of both hands would work it out: in no hand, not face up. */
function deriveEnvelope(alice: RoundView, bob: RoundView): Triple {
  const outside = [...alice.kindOf.keys()].filter(
    (id) => !alice.hand.includes(id) && !bob.hand.includes(id) && id !== alice.round.data.faceUpCardId,
  )
  expect(outside, 'exactly 3 cards should be outside both hands and the face-up slot').toHaveLength(3)
  const envelope = {} as Triple
  for (const id of outside) envelope[alice.kindOf.get(id)!] = id
  expect(Object.keys(envelope).sort(), 'the envelope should hold one card of each kind').toEqual([...KINDS].sort())
  return envelope
}

/** Cards of one kind from a hand. */
const ofKind = (view: RoundView, hand: string[], kind: Kind) => hand.filter((id) => view.kindOf.get(id) === kind)

/** A card's name as a player sees it (cards are public). */
const cardName = (view: RoundView, cardId: string) =>
  String(view.visible.cards.rows.find((c) => c.recordId === cardId)?.data.name ?? '')

/** Find this run's guess row by id. */
const guessRow = (v: Visible, guessId: string) => v.guesses.rows.find((g) => g.recordId === guessId)

/** A player as the tests address them, by seat-independent role. */
interface Side {
  page: Page
  id: string
  name: string
  seat: 'host' | 'guest'
}

/** Create a game (Alice hosts, Bob joins), answer, start, and return both sides by role. */
async function startGame(users: (names: string[]) => Promise<{ page: Page; name: string }[]>) {
  const [alice, bob] = await users(['Alice', 'Bob'])
  await Promise.all([alice.page.goto('/home'), bob.page.goto('/home')])
  const created = await mustCall<{ gameId: string; code: string; userId: string; roundId: string }>(
    alice.page,
    'createGame',
    { bestOf: 3 },
  )
  const { gameId, code, userId: aliceId } = created
  const { userId: bobId } = await mustCall<{ userId: string }>(bob.page, 'joinGame', { code })
  const tooEarly = await callAction(alice.page, 'startSeries', { gameId })
  expect(tooEarly.success, 'the series cannot start before both players answer').toBe(false)
  await answerMyQuestions(alice.page, created.roundId, gameId)
  await answerMyQuestions(bob.page, created.roundId, gameId)
  const { roundId } = await mustCall<{ roundId: string }>(alice.page, 'startSeries', { gameId })
  expect(roundId).toBe(created.roundId)

  // R41: the first starter is stored on the game, and round 1 starts with it.
  const view = await viewRound(alice.page, roundId, gameId)
  const firstSeat = view.game.data.firstStarter as 'host' | 'guest'
  expect(['host', 'guest'], 'the game stores a coin-flip first starter').toContain(firstSeat)
  expect(view.round.data.starter, "round 1's starter is the game's first starter").toBe(firstSeat)
  const host: Side = { page: alice.page, id: aliceId, name: 'Alice', seat: 'host' }
  const guest: Side = { page: bob.page, id: bobId, name: 'Bob', seat: 'guest' }
  const [first, second] = firstSeat === 'host' ? [host, guest] : [guest, host]
  expect(view.round.data.turnUserId, 'the first starter is on turn').toBe(first.id)
  return { gameId, roundId, host, guest, first, second }
}

test('a best-of-3 series: show, choose, no match, wrong and right accusations, reveal, next round', async ({
  users,
}) => {
  test.setTimeout(420_000)
  const { gameId, roundId, host, guest, first, second } = await startGame(users)

  let f = await viewRound(first.page, roundId, gameId)
  let s = await viewRound(second.page, roundId, gameId)
  const envelope = deriveEnvelope(f, s)

  await test.step("a. auto-show: exactly one of SECOND's cards is shown to FIRST only", async () => {
    const secondCard = s.hand[0]
    const secondKind = s.kindOf.get(secondCard)!
    const triple = { ...envelope, [secondKind]: secondCard } as Triple
    const { guessId, result } = await mustCall<{ guessId: string; result: string }>(first.page, 'guess', {
      roundId,
      ...triple,
    })
    expect(result).toBe('shown')

    f = await viewRound(first.page, roundId, gameId)
    s = await viewRound(second.page, roundId, gameId)
    const firstShown = f.visible.shown_cards.rows.filter((r) => r.data.guessId === guessId)
    expect(firstShown, 'FIRST receives 1 shown card').toHaveLength(1)
    expect(firstShown[0].data.cardId, "the shown card is SECOND's matching card").toBe(secondCard)
    expect(s.visible.shown_cards.rows, 'SECOND receives no shown_cards rows').toHaveLength(0)
    expect(guessRow(f.visible, guessId)?.data.result, 'FIRST sees the guess as shown').toBe('shown')
    expect(guessRow(s.visible, guessId)?.data.result, 'SECOND sees the guess as shown').toBe('shown')
  })

  await test.step('b. one guess per turn, then endTurn passes the turn to SECOND', async () => {
    const again = await callAction(first.page, 'guess', { roundId, ...envelope })
    expect(again.success, 'a second guess in the same turn is refused').toBe(false)
    await mustCall(first.page, 'endTurn', { roundId })
    s = await viewRound(second.page, roundId, gameId)
    expect(s.round.data.turnUserId).toBe(second.id)
    expect(s.round.data.turnsPlayed, 'a completed turn is counted').toBe(1)
  })

  let choiceGuessId = ''
  let nextRoundId = ''
  await test.step("c. choose: two of FIRST's cards match, FIRST picks one, only SECOND sees it", async () => {
    // Two of FIRST's cards of different kinds, plus the envelope card of the third kind.
    const [one] = f.hand
    const oneKind = f.kindOf.get(one)!
    const two = f.hand.find((id) => f.kindOf.get(id) !== oneKind)!
    const twoKind = f.kindOf.get(two)!
    const triple = { ...envelope, [oneKind]: one, [twoKind]: two } as Triple
    const { guessId, result } = await mustCall<{ guessId: string; result: string }>(second.page, 'guess', {
      roundId,
      ...triple,
    })
    choiceGuessId = guessId
    expect(result).toBe('pending')
    s = await viewRound(second.page, roundId, gameId)
    expect(s.round.data.pendingGuessId, 'the round waits for FIRST to choose').toBe(guessId)

    const guessAgain = await callAction(second.page, 'guess', { roundId, ...envelope })
    expect(guessAgain.success, 'SECOND cannot guess again while a choice is pending').toBe(false)
    const endEarly = await callAction(second.page, 'endTurn', { roundId })
    expect(endEarly.success, 'SECOND cannot end the turn while a choice is pending').toBe(false)

    const notInGuess = f.hand.find((id) => id !== one && id !== two)!
    const badShow = await callAction(first.page, 'showCard', { guessId, cardId: notInGuess })
    expect(badShow.success, 'FIRST cannot show a card that is not in the guess').toBe(false)

    await mustCall(first.page, 'showCard', { guessId, cardId: two })
    s = await viewRound(second.page, roundId, gameId)
    f = await viewRound(first.page, roundId, gameId)
    const secondShown = s.visible.shown_cards.rows.filter((r) => r.data.guessId === guessId)
    expect(secondShown, 'SECOND receives the chosen card').toHaveLength(1)
    expect(secondShown[0].data.cardId).toBe(two)
    expect(
      f.visible.shown_cards.rows.filter((r) => r.data.guessId === guessId),
      'FIRST does not receive the card they showed',
    ).toHaveLength(0)
    expect(s.round.data.pendingGuessId, 'the choice is cleared').toBe('')
    expect(guessRow(f.visible, guessId)?.data.result).toBe('shown')
  })

  await test.step('d. no match: FIRST guesses only their own and envelope cards', async () => {
    await mustCall(second.page, 'endTurn', { roundId })
    const triple = {} as Triple
    for (const kind of KINDS) triple[kind] = ofKind(f, f.hand, kind)[0] ?? envelope[kind]
    const { guessId, result } = await mustCall<{ guessId: string; result: string }>(first.page, 'guess', {
      roundId,
      ...triple,
    })
    expect(result).toBe('none')
    f = await viewRound(first.page, roundId, gameId)
    s = await viewRound(second.page, roundId, gameId)
    expect(guessRow(f.visible, guessId)?.data.result, 'FIRST sees no match').toBe('none')
    expect(guessRow(s.visible, guessId)?.data.result, 'SECOND sees no match').toBe('none')
    expect(f.visible.shown_cards.rows.filter((r) => r.data.guessId === guessId)).toHaveLength(0)
  })

  await test.step('e. wrong accusation: SECOND wins round 1, the round is revealed', async () => {
    // Swap the envelope suspect for any other suspect.
    const otherSuspect = [...f.kindOf.entries()].find(([id, k]) => k === 'suspect' && id !== envelope.suspect)![0]
    const accusation = { ...envelope, suspect: otherSuspect }
    const res = await mustCall<{ correct: boolean; winnerUserId: string; nextRoundId: string }>(first.page, 'accuse', {
      roundId,
      ...accusation,
    })
    expect(res.correct).toBe(false)
    expect(res.winnerUserId).toBe(second.id)
    expect(res.nextRoundId, 'the series goes on, so round 2 is prepared').not.toBe('')
    nextRoundId = res.nextRoundId

    f = await viewRound(first.page, roundId, gameId)
    s = await viewRound(second.page, roundId, gameId)
    for (const view of [f, s]) {
      expect(view.round.data.status).toBe('revealed')
      expect(view.round.data.winnerUserId).toBe(second.id)
      expect(parseJson(view.round.data.revealedSolution)).toEqual(envelope)
      const hands = parseJson<Record<string, string[]>>(view.round.data.revealedHands)
      expect([...hands[first.id]].sort()).toEqual([...f.hand].sort())
      expect([...hands[second.id]].sort()).toEqual([...s.hand].sort())
      expect(parseJson<Record<string, unknown>>(view.round.data.revealedAccusation)).toMatchObject({
        byUserId: first.id,
        ...accusation,
        correct: false,
      })
      const score = { host: view.game.data.scoreHost, guest: view.game.data.scoreGuest }
      expect(score[second.seat], 'SECOND has 1').toBe(1)
      expect(score[first.seat], 'FIRST has 0').toBe(0)
      expect(view.visible.solution.rows, 'the solution collection stays closed after the reveal').toHaveLength(0)
      expect(view.visible.hands.rows, 'hands stay owner-only after the reveal').toHaveLength(1)
      const answers = parseJson<Record<string, unknown[]>>(view.round.data.revealedAnswers)
      expect(answers[host.id], "the host's answers are revealed").toHaveLength(2)
      expect(answers[guest.id], "the guest's answers are revealed").toHaveLength(2)
      // R36: a confession is written at once, and it names the culprit.
      const culprit = cardName(view, envelope.suspect)
      expect(culprit, 'the culprit card has a name').not.toBe('')
      expect(String(view.round.data.confession ?? ''), 'both players see a confession naming the culprit').toContain(culprit)
    }
  })

  let round2Id = ''
  await test.step('f. nextRound: host only, after both answer; round 2 has a new setting and SECOND starts', async () => {
    const byGuest = await callAction(guest.page, 'nextRound', { gameId })
    expect(byGuest.success, 'the guest cannot start the next round').toBe(false)
    expect(byGuest.error).toMatch(/host/i)
    const unanswered = await callAction(host.page, 'nextRound', { gameId })
    expect(unanswered.success, 'the next case waits for both answers').toBe(false)
    await answerMyQuestions(host.page, nextRoundId, gameId)
    await answerMyQuestions(guest.page, nextRoundId, gameId)
    round2Id = (await mustCall<{ roundId: string }>(host.page, 'nextRound', { gameId })).roundId
    expect(round2Id).toBe(nextRoundId)
    const view = await viewRound(second.page, round2Id, gameId)
    expect(view.round.data.number).toBe(2)
    expect(view.round.data.status).toBe('playing')
    expect(view.round.data.settingId, 'round 2 uses a different setting').not.toBe(f.round.data.settingId)
    // R41: later rounds alternate from the coin-flip first starter.
    expect(view.round.data.starter, 'round 2 alternates from the first starter').toBe(second.seat)
    expect(view.round.data.turnUserId, 'SECOND starts round 2').toBe(second.id)
    expect(view.game.data.currentRound).toBe(2)
  })

  await test.step('g. correct accusation: SECOND wins round 2 and the series', async () => {
    const f2 = await viewRound(first.page, round2Id, gameId)
    const s2 = await viewRound(second.page, round2Id, gameId)
    const envelope2 = deriveEnvelope(f2, s2)
    const res = await mustCall<{ correct: boolean; winnerUserId: string; nextRoundId: string }>(second.page, 'accuse', {
      roundId: round2Id,
      ...envelope2,
    })
    expect(res.correct).toBe(true)
    expect(res.winnerUserId).toBe(second.id)
    expect(res.nextRoundId, 'the series is decided, so no round 3 is prepared').toBe('')

    const after = await viewRound(first.page, round2Id, gameId)
    expect(after.round.data.status).toBe('revealed')
    expect(parseJson(after.round.data.revealedSolution)).toEqual(envelope2)
    for (const view of [after, await viewRound(second.page, round2Id, gameId)]) {
      expect(String(view.round.data.confession ?? ''), 'the confession names the culprit').toContain(
        cardName(view, envelope2.suspect),
      )
    }
    const score = { host: after.game.data.scoreHost, guest: after.game.data.scoreGuest }
    expect(score[second.seat], 'SECOND has 2').toBe(2)
    expect(score[first.seat], 'FIRST has 0').toBe(0)
    expect(after.game.data.status, 'best of 3 is decided at 2').toBe('finished')
    expect(after.game.data.seriesWinner).toBe(second.id)

    const more = await callAction(host.page, 'nextRound', { gameId })
    expect(more.success, 'no round after the series is decided').toBe(false)
  })

  expect(choiceGuessId).not.toBe('')
})

test("R41: after turn 4, both players see one alibi clearing a card from the starter's hand", async ({ users }) => {
  test.setTimeout(420_000)
  const { gameId, roundId, first, second } = await startGame(users)
  const f = await viewRound(first.page, roundId, gameId)
  const s = await viewRound(second.page, roundId, gameId)
  const envelope = deriveEnvelope(f, s)
  const views = new Map([
    [first.id, f],
    [second.id, s],
  ])

  // Four turns, no accusation: each player names their own cards (or the envelope's), so nothing is shown.
  const order = [first, second, first, second]
  for (const [i, player] of order.entries()) {
    const view = views.get(player.id)!
    const triple = {} as Triple
    for (const kind of KINDS) triple[kind] = ofKind(view, view.hand, kind)[0] ?? envelope[kind]
    const { result } = await mustCall<{ result: string }>(player.page, 'guess', { roundId, ...triple })
    expect(result, `turn ${i + 1} is a no-match guess`).toBe('none')
    await mustCall(player.page, 'endTurn', { roundId })

    const after = await viewRound(first.page, roundId, gameId)
    expect(after.round.data.turnsPlayed, `turnsPlayed after turn ${i + 1}`).toBe(i + 1)
    const drawn = parseJson<unknown[]>(after.round.data.revealedAlibis || '[]')
    expect(drawn, `alibis after turn ${i + 1}`).toHaveLength(i + 1 === 4 ? 1 : 0)
    // The alibi texts stay server-only throughout (R41), for both players.
    for (const p of [first, second]) {
      const seen = await visibleRecords(p.page, roundId, gameId)
      expect.soft(seen.alibiTexts.rows, `${p.name} receives 0 alibiTexts rows after turn ${i + 1}`).toHaveLength(0)
    }
  }

  // Both screens: exactly one alibi in the round log, from the STARTER's (FIRST's) hand.
  let clearedId = ''
  for (const p of [first, second]) {
    await p.page.goto(`/game/${gameId}`)
    // R47: the log is its own tab.
    await p.page.getByTestId('tab-log').click()
    const alibi = p.page.getByTestId('round-alibi')
    await expect(alibi, `${p.name} sees exactly one alibi`).toHaveCount(1, { timeout: 15_000 })
    await expect(alibi).toContainText('Alibi')
    const cardId = (await alibi.getAttribute('data-card-id')) ?? ''
    if (!clearedId) clearedId = cardId
    expect(cardId, 'both players see the same alibi').toBe(clearedId)
    expect(f.hand, "the cleared card is from the starter's hand").toContain(cardId)
    await expect(alibi, 'the alibi names its card').toContainText(cardName(f, cardId))
    // It was drawn after the 4th guess; the log is newest first (R47), so it sits above the 4 guesses.
    // The alibi arrives with the round, the guesses by their own subscription, so wait for all 4
    // guesses before reading the order (D52: the snapshot raced them once).
    await expect(p.page.getByTestId('round-log-entry'), `${p.name} sees the 4 guesses`).toHaveCount(4, { timeout: 15_000 })
    const entries = await p.page
      .locator('[data-testid="round-log-entry"], [data-testid="round-alibi"]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')))
    expect(entries, 'newest first: the alibi, then the 4 guesses').toEqual([
      'round-alibi',
      'round-log-entry',
      'round-log-entry',
      'round-log-entry',
      'round-log-entry',
    ])
    // Both grids mark it as not in the envelope, and who holds it.
    await p.page.getByTestId('tab-grid').click()
    const cell = (column: string) =>
      p.page.locator(`[data-testid="grid-row"][data-card-id="${cardId}"] [data-testid="grid-cell"][data-column="${column}"]`)
    await expect(cell('envelope'), `${p.name}'s grid: not in the envelope`).toHaveAttribute('data-mark', 'no')
    await expect(cell('envelope')).toHaveAttribute('data-fixed', 'true')
    await expect(cell(p === first ? 'me' : 'opponent'), `${p.name}'s grid: its holder`).toHaveAttribute('data-mark', 'has')
  }

  // FIRST (on turn 5) accuses; at the reveal, the cleared card is not in the envelope.
  await mustCall(first.page, 'accuse', { roundId, ...envelope })
  const revealed = await viewRound(second.page, roundId, gameId)
  expect(revealed.round.data.status).toBe('revealed')
  const solution = parseJson<Triple>(revealed.round.data.revealedSolution)
  expect(Object.values(solution), 'the cleared card is not in the revealed envelope').not.toContain(clearedId)
})
