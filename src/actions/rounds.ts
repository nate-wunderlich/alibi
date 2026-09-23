/**
 * The life of a round, before play (docs/SPEC.md "Generation chain" 0-1; R25).
 *
 * prepareRound: pick a setting nobody has used in this series, ask the AI for
 *   4 questions about it (fallback: the generic bank), and give each player 2.
 *   The round waits in status 'answering'.
 * openRound: once both players have answered, ask the AI for the case built
 *   from the setting and all 4 answers (fallback: the preset case), lay out
 *   its 12 cards, deal them with the rules module, and start play.
 *
 * The AI sees the setting and the answers, never the solution (R4): code
 * deals the envelope only after the case exists.
 */

import type { ActionTools } from 'deepspace/worker'
import { buildCasePrompt, buildQuestionPrompt, validateCase, type AnsweredQuestion } from '../game/caseGen'
import { PRESET_CASE, type PresetCase } from '../game/presetCase'
import { fallbackQuestions, splitForPlayers, validateQuestions, type QuestionSet } from '../game/questions'
import { deal, starterForRound, type Card, type Player } from '../game/rules'
import { pickSetting, SETTINGS } from '../game/settings'
import { askForJson } from './ai'
import { loadRound, must, refuse, userInSeat, type Game } from './helpers'

/** A question as stored for a player: the id is what submitAnswers checks. */
export interface StoredQuestion {
  id: string
  text: string
  answers: string[]
}

/** An answer as stored: the question's text travels with it, for the case prompt and the reveal. */
export interface StoredAnswer {
  questionId: string
  question: string
  answer: string
}

const SEATS: Player[] = ['host', 'guest']

/** The settings this game has already used, so no setting repeats in a series. */
export async function usedSettingIds(tools: ActionTools, gameId: string): Promise<string[]> {
  const rounds = must(await tools.query('rounds', { where: { gameId }, limit: 50 }), 'Loading the rounds')
  return rounds.records.map((r) => String(r.data.settingId))
}

/**
 * Prepare round `number`: a new setting, and 2 questions for each player.
 * The guest may not have joined yet; their row is claimed when they do.
 * Returns the new round's id.
 */
export async function prepareRound(tools: ActionTools, game: Game, number: number): Promise<string> {
  const setting = pickSetting(await usedSettingIds(tools, game.id), Math.random)
  const { recordId: roundId } = must(
    await tools.create('rounds', {
      gameId: game.id,
      number,
      status: 'answering',
      settingId: setting.id,
      caseTitle: '',
      victim: '',
      openingNarration: '',
      starter: '',
      turnUserId: '',
      guessedThisTurn: 0,
      pendingGuessId: '',
      faceUpCardId: '',
      winnerUserId: '',
      revealedSolution: '',
      revealedHands: '',
      revealedAccusation: '',
      hostAnswered: 0,
      guestAnswered: 0,
      revealedAnswers: '',
    }),
    `Preparing round ${number}`,
  )

  const fromAi = await askForJson<QuestionSet>(
    tools,
    `questions for round ${number} (${setting.id})`,
    buildQuestionPrompt(setting),
    (value) => {
      const checked = validateQuestions(value)
      return checked.ok ? { ok: true, value: splitForPlayers(checked.questions) } : checked
    },
    900,
  )
  const set = fromAi ?? fallbackQuestions(Math.random)

  let n = 0
  for (const seat of SEATS) {
    const questions: StoredQuestion[] = set[seat].map((q) => ({ id: `q${++n}`, text: q.text, answers: q.answers }))
    must(
      await tools.create('questions', {
        roundId,
        seat,
        userId: userInSeat(game, seat),
        questions: JSON.stringify(questions),
      }),
      `Writing the ${seat}'s questions`,
    )
  }
  return roundId
}

/** Both players' answers for a round, the host's first. */
export async function loadAnswers(tools: ActionTools, roundId: string, game: Game): Promise<Record<string, StoredAnswer[]>> {
  const rows = must(await tools.query('answers', { where: { roundId }, limit: 10 }), 'Loading the answers')
  const byUser: Record<string, StoredAnswer[]> = {}
  for (const seat of SEATS) {
    const id = userInSeat(game, seat)
    const row = rows.records.find((r) => r.data.userId === id)
    byUser[id] = row ? (JSON.parse(String(row.data.answers)) as StoredAnswer[]) : []
  }
  return byUser
}

/** Ask the AI for the case; fall back to the preset case after one retry. */
async function writeCase(tools: ActionTools, game: Game, settingId: string, number: number, answers: AnsweredQuestion[]) {
  const setting = SETTINGS.find((s) => s.id === settingId)
  if (!setting) return PRESET_CASE
  const rounds = must(await tools.query('rounds', { where: { gameId: game.id }, limit: 50 }), 'Loading the rounds')
  const earlierTitles = rounds.records
    .filter((r) => Number(r.data.number) < number && String(r.data.caseTitle) !== '')
    .map((r) => String(r.data.caseTitle))
  const generated = await askForJson<PresetCase>(
    tools,
    `case for round ${number} (${setting.id})`,
    buildCasePrompt(setting, answers, earlierTitles),
    (value) => {
      const checked = validateCase(value, { settingName: setting.name })
      return checked.ok ? { ok: true, value: checked.case } : checked
    },
    2000,
  )
  if (generated) {
    // Public data only (the cast, not the solution), for tracing what the AI wrote.
    console.info(`[ai] case for round ${number}: "${generated.title}" | ${generated.cards.map((c) => c.name).join(' | ')}`)
  }
  return generated ?? PRESET_CASE
}

/**
 * Open a prepared round once both players have answered: write the case,
 * lay out the cards, deal, and start play. While the AI writes, the round is
 * 'generating' so both screens can say so; if anything fails, it goes back
 * to 'answering' so the host can try again.
 */
export async function openRound(tools: ActionTools, game: Game, roundId: string): Promise<void> {
  const round = await loadRound(tools, roundId)
  if (round.status === 'generating') refuse('The case is already being written.')
  if (round.status !== 'answering') refuse('This case has already started.')
  if (!round.hostAnswered || !round.guestAnswered) refuse('Both players must answer their questions first.')

  must(await tools.update('rounds', roundId, { status: 'generating' }), 'Starting to write the case')
  try {
    const answers = await loadAnswers(tools, roundId, game)
    const all = SEATS.flatMap((seat) => answers[userInSeat(game, seat)])
    const theCase = await writeCase(tools, game, round.settingId, round.number, all)
    await layOutAndDeal(tools, game, roundId, round.number, theCase)
  } catch (e) {
    await tools.update('rounds', roundId, { status: 'answering' })
    throw e
  }
}

/** Write the case's 12 cards, deal them with the rules module, and start play. */
async function layOutAndDeal(tools: ActionTools, game: Game, roundId: string, number: number, theCase: PresetCase) {
  // 1. The 12 cards. Each card's record id is the id the rules deal with.
  const deck: Card[] = []
  for (const c of theCase.cards) {
    const { recordId } = must(
      await tools.create('cards', { roundId, kind: c.kind, name: c.name, description: c.description, imageUrl: '' }),
      'Creating a card',
    )
    deck.push({ id: recordId, kind: c.kind })
  }

  // 2. Deal: envelope, two hands of 4, one face up.
  const dealt = deal(deck, Math.random)
  for (const seat of SEATS) {
    must(
      await tools.create('hands', {
        roundId,
        userId: userInSeat(game, seat),
        cardIds: JSON.stringify(dealt.hands[seat].map((c) => c.id)),
      }),
      `Dealing the ${seat}'s hand`,
    )
  }
  must(await tools.create('solution', { roundId, ...dealt.envelope }), 'Sealing the envelope')

  // 3. Open the round: the starter alternates by round number.
  const starter = starterForRound(number)
  must(
    await tools.update('rounds', roundId, {
      status: 'playing',
      caseTitle: theCase.title,
      victim: theCase.victim,
      openingNarration: theCase.openingNarration,
      faceUpCardId: dealt.faceUp.id,
      starter,
      turnUserId: userInSeat(game, starter),
    }),
    `Opening round ${number}`,
  )
  must(await tools.update('games', game.id, { status: 'playing', currentRound: number }), 'Updating the game')
}
