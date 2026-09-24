/**
 * A full series, best of 3 (docs/GAME_RULES.md; R29, R30, R33).
 *
 * Alice hosts, Bob joins. Round 1 walks through every kind of turn: an
 * automatic show, a turn that cannot guess twice, a choice the opponent must
 * make, a "no match", and a wrong accusation with its reveal. Round 2 ends
 * with a correct accusation that wins the series.
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

test('a best-of-3 series: show, choose, no match, wrong and right accusations, reveal, next round', async ({
  users,
}) => {
  test.setTimeout(420_000)
  const [alice, bob] = await users(['Alice', 'Bob'])
  await Promise.all([alice.page.goto('/home'), bob.page.goto('/home')])

  // Setup: Alice hosts a best of 3, Bob joins, both answer their questions, Alice starts.
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

  let a = await viewRound(alice.page, roundId, gameId)
  let b = await viewRound(bob.page, roundId, gameId)
  const envelope = deriveEnvelope(a, b)
  expect(a.round.data.turnUserId, 'the host starts round 1').toBe(aliceId)

  await test.step('a. auto-show: exactly one of Bob\'s cards is shown to Alice only', async () => {
    const bobCard = b.hand[0]
    const bobKind = b.kindOf.get(bobCard)!
    const triple = { ...envelope, [bobKind]: bobCard } as Triple
    const { guessId, result } = await mustCall<{ guessId: string; result: string }>(alice.page, 'guess', {
      roundId,
      ...triple,
    })
    expect(result).toBe('shown')

    a = await viewRound(alice.page, roundId, gameId)
    b = await viewRound(bob.page, roundId, gameId)
    const aliceShown = a.visible.shown_cards.rows.filter((r) => r.data.guessId === guessId)
    expect(aliceShown, 'Alice receives 1 shown card').toHaveLength(1)
    expect(aliceShown[0].data.cardId, "the shown card is Bob's matching card").toBe(bobCard)
    expect(b.visible.shown_cards.rows, 'Bob receives no shown_cards rows').toHaveLength(0)
    expect(guessRow(a.visible, guessId)?.data.result, 'Alice sees the guess as shown').toBe('shown')
    expect(guessRow(b.visible, guessId)?.data.result, 'Bob sees the guess as shown').toBe('shown')
  })

  await test.step('b. one guess per turn, then endTurn passes the turn to Bob', async () => {
    const again = await callAction(alice.page, 'guess', { roundId, ...envelope })
    expect(again.success, 'a second guess in the same turn is refused').toBe(false)
    await mustCall(alice.page, 'endTurn', { roundId })
    b = await viewRound(bob.page, roundId, gameId)
    expect(b.round.data.turnUserId).toBe(bobId)
  })

  let choiceGuessId = ''
  let nextRoundId = ''
  await test.step('c. choose: two of Alice\'s cards match, Alice picks one, only Bob sees it', async () => {
    // Two of Alice's cards of different kinds, plus the envelope card of the third kind.
    const [first] = a.hand
    const firstKind = a.kindOf.get(first)!
    const second = a.hand.find((id) => a.kindOf.get(id) !== firstKind)!
    const secondKind = a.kindOf.get(second)!
    const triple = { ...envelope, [firstKind]: first, [secondKind]: second } as Triple
    const { guessId, result } = await mustCall<{ guessId: string; result: string }>(bob.page, 'guess', {
      roundId,
      ...triple,
    })
    choiceGuessId = guessId
    expect(result).toBe('pending')
    b = await viewRound(bob.page, roundId, gameId)
    expect(b.round.data.pendingGuessId, 'the round waits for Alice to choose').toBe(guessId)

    const guessAgain = await callAction(bob.page, 'guess', { roundId, ...envelope })
    expect(guessAgain.success, 'Bob cannot guess again while a choice is pending').toBe(false)
    const endEarly = await callAction(bob.page, 'endTurn', { roundId })
    expect(endEarly.success, 'Bob cannot end his turn while a choice is pending').toBe(false)

    const notInGuess = a.hand.find((id) => id !== first && id !== second)!
    const badShow = await callAction(alice.page, 'showCard', { guessId, cardId: notInGuess })
    expect(badShow.success, 'Alice cannot show a card that is not in the guess').toBe(false)

    await mustCall(alice.page, 'showCard', { guessId, cardId: second })
    b = await viewRound(bob.page, roundId, gameId)
    a = await viewRound(alice.page, roundId, gameId)
    const bobShown = b.visible.shown_cards.rows.filter((r) => r.data.guessId === guessId)
    expect(bobShown, 'Bob receives the chosen card').toHaveLength(1)
    expect(bobShown[0].data.cardId).toBe(second)
    expect(
      a.visible.shown_cards.rows.filter((r) => r.data.guessId === guessId),
      'Alice does not receive the card she showed Bob',
    ).toHaveLength(0)
    expect(b.round.data.pendingGuessId, 'the choice is cleared').toBe('')
    expect(guessRow(a.visible, guessId)?.data.result).toBe('shown')
  })

  await test.step('d. no match: Alice guesses only her own and envelope cards', async () => {
    await mustCall(bob.page, 'endTurn', { roundId })
    const triple = {} as Triple
    for (const kind of KINDS) triple[kind] = ofKind(a, a.hand, kind)[0] ?? envelope[kind]
    const { guessId, result } = await mustCall<{ guessId: string; result: string }>(alice.page, 'guess', {
      roundId,
      ...triple,
    })
    expect(result).toBe('none')
    a = await viewRound(alice.page, roundId, gameId)
    b = await viewRound(bob.page, roundId, gameId)
    expect(guessRow(a.visible, guessId)?.data.result, 'Alice sees no match').toBe('none')
    expect(guessRow(b.visible, guessId)?.data.result, 'Bob sees no match').toBe('none')
    expect(a.visible.shown_cards.rows.filter((r) => r.data.guessId === guessId)).toHaveLength(0)
  })

  await test.step('e. wrong accusation: Bob wins round 1, the round is revealed', async () => {
    // Swap the envelope suspect for any other suspect.
    const otherSuspect = [...a.kindOf.entries()].find(([id, k]) => k === 'suspect' && id !== envelope.suspect)![0]
    const accusation = { ...envelope, suspect: otherSuspect }
    const res = await mustCall<{ correct: boolean; winnerUserId: string; nextRoundId: string }>(alice.page, 'accuse', {
      roundId,
      ...accusation,
    })
    expect(res.correct).toBe(false)
    expect(res.winnerUserId).toBe(bobId)
    expect(res.nextRoundId, 'the series goes on, so round 2 is prepared').not.toBe('')
    nextRoundId = res.nextRoundId

    a = await viewRound(alice.page, roundId, gameId)
    b = await viewRound(bob.page, roundId, gameId)
    for (const view of [a, b]) {
      expect(view.round.data.status).toBe('revealed')
      expect(view.round.data.winnerUserId).toBe(bobId)
      expect(parseJson(view.round.data.revealedSolution)).toEqual(envelope)
      const hands = parseJson<Record<string, string[]>>(view.round.data.revealedHands)
      expect([...hands[aliceId]].sort()).toEqual([...a.hand].sort())
      expect([...hands[bobId]].sort()).toEqual([...b.hand].sort())
      expect(parseJson<Record<string, unknown>>(view.round.data.revealedAccusation)).toMatchObject({
        byUserId: aliceId,
        ...accusation,
        correct: false,
      })
      expect(view.game.data.scoreGuest, 'Bob has 1').toBe(1)
      expect(view.game.data.scoreHost, 'Alice has 0').toBe(0)
      expect(view.visible.solution.rows, 'the solution collection stays closed after the reveal').toHaveLength(0)
      expect(view.visible.hands.rows, 'hands stay owner-only after the reveal').toHaveLength(1)
      const answers = parseJson<Record<string, unknown[]>>(view.round.data.revealedAnswers)
      expect(answers[aliceId], "Alice's answers are revealed").toHaveLength(2)
      expect(answers[bobId], "Bob's answers are revealed").toHaveLength(2)
      // R36: a confession is written at once, and it names the culprit.
      const culprit = cardName(view, envelope.suspect)
      expect(culprit, 'the culprit card has a name').not.toBe('')
      expect(String(view.round.data.confession ?? ''), 'both players see a confession naming the culprit').toContain(culprit)
    }
  })

  let round2Id = ''
  await test.step('f. nextRound: host only, after both answer; round 2 has a new setting and Bob starts', async () => {
    const byBob = await callAction(bob.page, 'nextRound', { gameId })
    expect(byBob.success, 'Bob cannot start the next round').toBe(false)
    expect(byBob.error).toMatch(/host/i)
    const unanswered = await callAction(alice.page, 'nextRound', { gameId })
    expect(unanswered.success, 'the next case waits for both answers').toBe(false)
    await answerMyQuestions(alice.page, nextRoundId, gameId)
    await answerMyQuestions(bob.page, nextRoundId, gameId)
    round2Id = (await mustCall<{ roundId: string }>(alice.page, 'nextRound', { gameId })).roundId
    expect(round2Id).toBe(nextRoundId)
    const view = await viewRound(bob.page, round2Id, gameId)
    expect(view.round.data.number).toBe(2)
    expect(view.round.data.status).toBe('playing')
    expect(view.round.data.settingId, 'round 2 uses a different setting').not.toBe(a.round.data.settingId)
    expect(view.round.data.turnUserId, 'Bob starts round 2').toBe(bobId)
    expect(view.game.data.currentRound).toBe(2)
  })

  await test.step('g. correct accusation: Bob wins round 2 and the series', async () => {
    const a2 = await viewRound(alice.page, round2Id, gameId)
    const b2 = await viewRound(bob.page, round2Id, gameId)
    const envelope2 = deriveEnvelope(a2, b2)
    const res = await mustCall<{ correct: boolean; winnerUserId: string; nextRoundId: string }>(bob.page, 'accuse', {
      roundId: round2Id,
      ...envelope2,
    })
    expect(res.correct).toBe(true)
    expect(res.winnerUserId).toBe(bobId)
    expect(res.nextRoundId, 'the series is decided, so no round 3 is prepared').toBe('')

    const after = await viewRound(alice.page, round2Id, gameId)
    expect(after.round.data.status).toBe('revealed')
    expect(parseJson(after.round.data.revealedSolution)).toEqual(envelope2)
    for (const view of [after, await viewRound(bob.page, round2Id, gameId)]) {
      expect(String(view.round.data.confession ?? ''), 'the confession names the culprit').toContain(
        cardName(view, envelope2.suspect),
      )
    }
    expect(after.game.data.scoreGuest, 'Bob has 2').toBe(2)
    expect(after.game.data.scoreHost, 'Alice has 0').toBe(0)
    expect(after.game.data.status, 'best of 3 is decided at 2').toBe('finished')
    expect(after.game.data.seriesWinner).toBe(bobId)

    const more = await callAction(alice.page, 'nextRound', { gameId })
    expect(more.success, 'no round after the series is decided').toBe(false)
  })

  expect(choiceGuessId).not.toBe('')
})
