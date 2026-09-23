/**
 * Game setup actions: createGame, joinGame, submitAnswers, startSeries, nextRound.
 * Every action checks the caller itself (actions bypass RBAC; see helpers.ts).
 * Preparing and opening rounds (setting, questions, the AI case, the deal)
 * lives in rounds.ts.
 */

import type { ActionHandler, ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import {
  action,
  loadGame,
  loadRound,
  must,
  refuse,
  requireSeat,
  textParam,
} from './helpers'
import { openRound, prepareRound, type StoredAnswer, type StoredQuestion } from './rounds'

// ---------------------------------------------------------------------------
// Join codes
// ---------------------------------------------------------------------------

/** Letters and digits that cannot be mistaken for each other (no 0/O, 1/I/L). */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 6

/** A random 6-character join code. */
function randomCode(): string {
  let code = ''
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
  }
  return code
}

/** A join code no other game is using. Tries a few times, then gives up. */
async function uniqueCode(tools: ActionTools): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode()
    const existing = must(await tools.query('join_codes', { where: { code }, limit: 1 }), 'Checking the join code')
    if (existing.records.length === 0) return code
  }
  throw new Error('Could not find a free join code. Please try again.')
}

/** The caller's display name from the users collection, or '' if unknown. */
async function displayName(tools: ActionTools, userId: string): Promise<string> {
  const result = await tools.get<{ name?: string }>('users', userId)
  return result.success ? (result.data.record.data.name ?? '') : ''
}

/** A game's round by number, or undefined. */
async function findRound(tools: ActionTools, gameId: string, number: number) {
  const found = must(await tools.query('rounds', { where: { gameId, number }, limit: 1 }), 'Loading the round')
  return found.records[0]
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * createGame({ bestOf }): the caller becomes the host of a new game in the lobby.
 * The code is stored in join_codes, which only the host can read (R32).
 * Round 1 is prepared at once (setting and questions), so both players can
 * answer in the lobby. Returns the game id, the join code, and round 1's id.
 */
const createGame = action(async ({ userId, params, tools }) => {
  const bestOf = params.bestOf
  if (bestOf !== 3 && bestOf !== 5 && bestOf !== 7) refuse('bestOf must be 3, 5, or 7.')

  const code = await uniqueCode(tools)
  const { recordId: gameId } = must(
    await tools.create('games', {
      host: userId,
      guest: '',
      bestOf,
      scoreHost: 0,
      scoreGuest: 0,
      currentRound: 0,
      status: 'lobby',
      seriesWinner: '',
    }),
    'Creating the game',
  )
  must(await tools.create('join_codes', { gameId, code, hostId: userId }), 'Saving the join code')
  must(
    await tools.create('players', { gameId, userId, displayName: await displayName(tools, userId), seat: 'host' }),
    'Adding the host',
  )
  const roundId = await prepareRound(tools, await loadGame(tools, gameId), 1)
  return { gameId, code, userId, roundId }
})

/**
 * joinGame({ code }): the caller becomes the guest of the game with that code.
 * The game must be in the lobby, have no guest yet, and not be hosted by the
 * caller. The guest's round-1 questions, held in an unowned row nobody can
 * read, are copied into a NEW row owned by the guest from the start, and the
 * unowned row is deleted. Ownership is never transferred (D19: a row created
 * with its owner reaches that owner's screen live, the same way the host's does).
 */
const joinGame = action(async ({ userId, params, tools }) => {
  const code = typeof params.code === 'string' ? params.code.trim().toUpperCase() : ''
  if (code === '') refuse('A join code is required.')

  const found = must(await tools.query('join_codes', { where: { code }, limit: 1 }), 'Looking up the code')
  if (found.records.length === 0) refuse('No game has that code.')
  const game = await loadGame(tools, String(found.records[0].data.gameId))

  if (game.status !== 'lobby') refuse('That game has already started.')
  if (game.host === userId) refuse('You are the host of this game; share the code with your opponent.')
  if (game.guest !== '') refuse('That game already has two players.')

  must(await tools.update('games', game.id, { guest: userId }), 'Joining the game')
  must(
    await tools.create('players', {
      gameId: game.id,
      userId,
      displayName: await displayName(tools, userId),
      seat: 'guest',
    }),
    'Adding the guest',
  )

  // Give the guest their round-1 questions in a row they own from creation.
  const round1 = await findRound(tools, game.id, 1)
  if (round1) {
    const rows = must(
      await tools.query('questions', { where: { roundId: round1.recordId, seat: 'guest', userId: '' }, limit: 1 }),
      'Loading your questions',
    )
    const unowned = rows.records[0]
    if (unowned) {
      must(
        await tools.create('questions', {
          roundId: round1.recordId,
          seat: 'guest',
          userId,
          questions: String(unowned.data.questions),
        }),
        'Writing your questions',
      )
      must(await tools.remove('questions', unowned.recordId), 'Retiring the unassigned questions')
    }
  }
  return { gameId: game.id, userId, roundId: round1?.recordId ?? '' }
})

/**
 * submitAnswers({ roundId, answers: [{ questionId, answer }] }): a player
 * answers their 2 questions, once. Each question id must be one prepared for
 * the caller, and each answer one of that question's 4 options.
 */
const submitAnswers = action(async ({ userId, params, tools }) => {
  const roundId = textParam(params, 'roundId')
  const round = await loadRound(tools, roundId)
  const game = await loadGame(tools, round.gameId)
  const seat = requireSeat(game, userId)
  if (round.status !== 'answering') refuse('This case is no longer taking answers.')
  if (seat === 'host' ? round.hostAnswered : round.guestAnswered) refuse('You have already answered.')

  const rows = must(await tools.query('questions', { where: { roundId, userId }, limit: 1 }), 'Loading your questions')
  if (rows.records.length === 0) refuse('Your questions are not ready yet.')
  const questions = JSON.parse(String(rows.records[0].data.questions)) as StoredQuestion[]

  const given = params.answers
  if (!Array.isArray(given) || given.length !== questions.length) refuse(`Answer all ${questions.length} questions.`)
  const stored: StoredAnswer[] = questions.map((q) => {
    const match = (given as { questionId?: unknown; answer?: unknown }[]).find((a) => a.questionId === q.id)
    if (!match) refuse('Answer each of your own questions.')
    if (typeof match.answer !== 'string' || !q.answers.includes(match.answer)) {
      refuse('Each answer must be one of the offered options.')
    }
    return { questionId: q.id, question: q.text, answer: match.answer }
  })

  must(await tools.create('answers', { roundId, userId, answers: JSON.stringify(stored) }), 'Saving your answers')
  const flag: Record<string, number> = { [seat === 'host' ? 'hostAnswered' : 'guestAnswered']: 1 }
  must(await tools.update('rounds', roundId, flag), 'Marking you as answered')
  return { roundId }
})

/** startSeries({ gameId }): the host starts round 1 once a guest has joined and both have answered. */
const startSeries = action(async ({ userId, params, tools, env }) => {
  const game = await loadGame(tools, textParam(params, 'gameId'))
  if (game.host !== userId) refuse('Only the host can start the series.')
  if (game.guest === '') refuse('Wait for your opponent to join.')
  if (game.status !== 'lobby') refuse('This series has already started.')

  const round1 = await findRound(tools, game.id, 1)
  if (!round1) throw new Error('Round 1 was never prepared.')
  await openRound(tools, env, game, round1.recordId)
  return { gameId: game.id, roundId: round1.recordId }
})

/**
 * nextRound({ gameId }): the host opens the next case, after the current one
 * is revealed, while nobody has won the series, and once both players have
 * answered its questions (it was prepared at the reveal).
 */
const nextRound = action(async ({ userId, params, tools, env }) => {
  const game = await loadGame(tools, textParam(params, 'gameId'))
  if (game.host !== userId) refuse('Only the host can start the next round.')
  if (game.status === 'finished') refuse('The series is over.')
  if (game.status !== 'playing') refuse('The series has not started.')

  const current = await findRound(tools, game.id, game.currentRound)
  if (!current || current.data.status !== 'revealed') refuse('Finish the current round first.')
  const next = await findRound(tools, game.id, game.currentRound + 1)
  if (!next) refuse('The next case is not ready yet.')

  await openRound(tools, env, game, next.recordId)
  return { gameId: game.id, roundId: next.recordId }
})

export const gameActions: Record<string, ActionHandler<Env>> = {
  createGame,
  joinGame,
  submitAnswers,
  startSeries,
  nextRound,
}
