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

import { enqueueJob, type ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import { templateAlibi } from '../game/alibis'
import { buildQuestionPrompt, type AnsweredQuestion } from '../game/caseGen'
import { PRESET_CASE, type PresetCase } from '../game/presetCase'
import { fallbackQuestions, splitForPlayers, validateQuestions, type QuestionSet } from '../game/questions'
import { deal, starterForRound, type Card, type Player } from '../game/rules'
import { pickSetting, SETTINGS } from '../game/settings'
import { portraitsEnabled } from '../server/portraits'
import { askForCase, askForJson } from './ai'
import { loadRound, must, refuse, userInSeat, type Game } from './helpers'

/** A question as stored for a player: the id is what submitAnswers checks. */
export interface StoredQuestion {
  id: string
  /** R37: the scene beat shown above the question. Rounds prepared before R37 have none. */
  beat?: string
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
      openingAudioUrl: '',
      confession: '',
      confessionAudioUrl: '',
      turnsPlayed: 0,
      revealedAlibis: '[]',
    }),
    `Preparing round ${number}`,
  )

  // R39 guard: whoever has joined so far (the guest may not have joined round 1 yet).
  const questionGuard = await guardNames(tools, game)
  const fromAi = await askForJson<QuestionSet>(
    tools,
    `questions for round ${number} (${setting.id})`,
    buildQuestionPrompt(setting),
    (value) => {
      const checked = validateQuestions(value, { playerNames: questionGuard })
      return checked.ok ? { ok: true, value: splitForPlayers(checked.questions) } : checked
    },
    900,
    { playerNames: questionGuard },
  )
  const set = fromAi ?? fallbackQuestions(Math.random)

  let n = 0
  for (const seat of SEATS) {
    const questions: StoredQuestion[] = set[seat].map((q) => ({
      id: `q${++n}`,
      beat: q.beat,
      text: q.text,
      answers: q.answers,
    }))
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

/**
 * The players' display names, for the R39 guard only: generated text that
 * contains any of them is rejected. These names never go into a prompt.
 */
export async function guardNames(tools: ActionTools, game: Game): Promise<string[]> {
  const rows = must(await tools.query('players', { where: { gameId: game.id }, limit: 10 }), 'Loading the players')
  return rows.records.map((r) => String(r.data.displayName ?? '').trim()).filter((n) => n !== '')
}

/** Ask the AI for the case; fall back to the preset case after CASE_ATTEMPTS calls (R40). */
async function writeCase(
  tools: ActionTools,
  game: Game,
  settingId: string,
  number: number,
  answers: AnsweredQuestion[],
  playerNames: string[],
) {
  const setting = SETTINGS.find((s) => s.id === settingId)
  if (!setting) return PRESET_CASE
  const rounds = must(await tools.query('rounds', { where: { gameId: game.id }, limit: 50 }), 'Loading the rounds')
  const earlierTitles = rounds.records
    .filter((r) => Number(r.data.number) < number && String(r.data.caseTitle) !== '')
    .map((r) => String(r.data.caseTitle))
  const generated = await askForCase(tools, `case for round ${number} (${setting.id})`, setting, answers, earlierTitles, playerNames)
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
 * to 'answering' so the host can try again. Once the round is playing, the
 * portraits, opening-narration, and alibi jobs are queued (production builds
 * only; R35, R36, R41).
 */
export async function openRound(tools: ActionTools, env: Env, game: Game, roundId: string): Promise<void> {
  const round = await loadRound(tools, roundId)
  if (round.status === 'generating') refuse('The case is already being written.')
  if (round.status !== 'answering') refuse('This case has already started.')
  if (!round.hostAnswered || !round.guestAnswered) refuse('Both players must answer their questions first.')

  must(await tools.update('rounds', roundId, { status: 'generating' }), 'Starting to write the case')
  try {
    const answers = await loadAnswers(tools, roundId, game)
    // R39: choices are labelled by seat; the names are loaded only for the guard.
    const all: AnsweredQuestion[] = SEATS.flatMap((seat) =>
      answers[userInSeat(game, seat)].map((a) => ({ seat, question: a.question, answer: a.answer })),
    )
    const names = await guardNames(tools, game)
    const theCase = await writeCase(tools, game, round.settingId, round.number, all, names)
    await layOutAndDeal(tools, game, roundId, round.number, theCase)
  } catch (e) {
    await tools.update('rounds', roundId, { status: 'answering' })
    throw e
  }
  if (portraitsEnabled()) {
    await queueMediaJob(env, 'portraits', game, roundId)
    await queueMediaJob(env, 'opening', game, roundId)
    await queueMediaJob(env, 'alibis', game, roundId)
  }
}

/**
 * Queue a media job for a round (R35 portraits, R36 opening and confession,
 * R41 alibi texts),
 * acting as the host. Play never waits for media, so a failure here is logged
 * and otherwise ignored. Callers check portraitsEnabled() (production only).
 */
export async function queueMediaJob(
  env: Env,
  type: 'portraits' | 'opening' | 'confession' | 'alibis',
  game: Game,
  roundId: string,
): Promise<void> {
  try {
    await enqueueJob(env.JOB_ROOMS, `app:${env.DEEPSPACE_APP_ID}`, type, { roundId }, {
      enqueuedBy: game.host,
      maxAttempts: 2,
    })
  } catch (e) {
    console.warn(`[${type}] could not queue round ${roundId}: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/** Write the case's 12 cards, deal them with the rules module, and start play. */
async function layOutAndDeal(tools: ActionTools, game: Game, roundId: string, number: number, theCase: PresetCase) {
  // 1. The 12 cards. Each card's record id is the id the rules deal with.
  //    R41: each gets a template alibi at once (server-only; the 'alibis' job may improve it).
  const deck: Card[] = []
  for (const c of theCase.cards) {
    const { recordId } = must(
      await tools.create('cards', { roundId, kind: c.kind, name: c.name, description: c.description, imageUrl: '' }),
      'Creating a card',
    )
    deck.push({ id: recordId, kind: c.kind })
    must(await tools.create('alibiTexts', { roundId, cardId: recordId, text: templateAlibi(c) }), 'Writing an alibi')
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

  // 3. Open the round: round 1's starter is the game's coin flip; later rounds alternate (R41).
  const starter = starterForRound(number, game.firstStarter)
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
