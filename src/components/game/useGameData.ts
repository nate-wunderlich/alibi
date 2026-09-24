/**
 * Everything one browser may see of a game, through live subscriptions.
 *
 * All data comes from useQuery: the server decides what each user receives
 * (R29, R32), so this hook never asks for secret data any other way. A
 * player's own hand, the join code (host only), and cards shown to them
 * arrive here; the opponent's hand and the solution never do.
 */

import { useMemo } from 'react'
import { useAuthStatus, useQuery } from 'deepspace'
import type { CardKind, Player } from '../../game/rules'

export interface GameData {
  host: string
  guest: string
  bestOf: 3 | 5 | 7
  scoreHost: number
  scoreGuest: number
  currentRound: number
  status: 'lobby' | 'playing' | 'finished'
  seriesWinner: string
  /** R41: who starts round 1 (a coin flip at the start of the series). */
  firstStarter: Player | ''
}

export interface PlayerData {
  gameId: string
  userId: string
  displayName: string
  seat: Player
}

export interface RoundData {
  gameId: string
  number: number
  status: 'answering' | 'generating' | 'playing' | 'revealed'
  settingId: string
  caseTitle: string
  victim: string
  openingNarration: string
  starter: Player
  turnUserId: string
  guessedThisTurn: number
  pendingGuessId: string
  faceUpCardId: string
  winnerUserId: string
  revealedSolution: string
  revealedHands: string
  revealedAccusation: string
  hostAnswered: number
  guestAnswered: number
  revealedAnswers: string
  /** R36: filled by background jobs in production; empty until then. */
  openingAudioUrl: string
  confession: string
  confessionAudioUrl: string
  /** R41: completed turns, and the alibis drawn so far (JSON list of RevealedAlibi). */
  turnsPlayed: number
  revealedAlibis: string
  /** R44: the round's complication (flavor, not a clue). */
  twist: string
}

/** R41: an alibi drawn during play: the card it clears and why. */
export interface RevealedAlibi {
  cardId: string
  text: string
  afterTurn: number
}

/** The round's drawn alibis, oldest first (rounds opened before R41 have none). */
export function alibisOf(round: Pick<RoundData, 'revealedAlibis'> | undefined): RevealedAlibi[] {
  if (!round?.revealedAlibis) return []
  try {
    return (JSON.parse(round.revealedAlibis) as RevealedAlibi[]).sort((a, b) => a.afterTurn - b.afterTurn)
  } catch {
    return []
  }
}

/** A player's case question, as prepared by the server. */
export interface StoredQuestion {
  id: string
  /** R37: the scene beat shown above the question (absent on rounds prepared before R37). */
  beat?: string
  text: string
  answers: string[]
}

/** A locked-in answer, with its question's text. */
export interface StoredAnswer {
  questionId: string
  question: string
  answer: string
}

export interface CardData {
  roundId: string
  kind: CardKind
  name: string
  description: string
  imageUrl: string
}

export interface GuessData {
  roundId: string
  byUserId: string
  suspect: string
  weapon: string
  location: string
  result: 'pending' | 'shown' | 'none'
  seq: number
}

export interface Card extends CardData {
  id: string
}

export interface Guess extends GuessData {
  id: string
}

export function useGameData(gameId: string) {
  const { userId: myId } = useAuthStatus()

  const games = useQuery<GameData>('games', { where: { recordId: gameId } })
  const players = useQuery<PlayerData>('players', { where: { gameId } })
  const joinCodes = useQuery<{ code: string }>('join_codes', { where: { gameId } })
  const rounds = useQuery<RoundData>('rounds', { where: { gameId } })

  const game = games.records[0]?.data
  const roundRecord = rounds.records.find((r) => r.data.number === game?.currentRound)
  const roundId = roundRecord?.recordId ?? ''

  const cards = useQuery<CardData>('cards', { where: { roundId } })
  const hands = useQuery<{ userId: string; cardIds: string }>('hands', { where: { roundId } })
  const guesses = useQuery<GuessData>('guesses', { where: { roundId } })
  const shown = useQuery<{ guessId: string; cardId: string }>('shown_cards', { where: { roundId } })

  // The next case being prepared: round 1 in the lobby, or the round after a reveal.
  // Its questions and answers are subscribed by QuestionsPanel, keyed by this round's id.
  const prepRecord = rounds.records.find((r) => r.data.number === (game?.currentRound ?? 0) + 1)

  return useMemo(() => {
    const cardsById = new Map<string, Card>(cards.records.map((c) => [c.recordId, { id: c.recordId, ...c.data }]))
    const myHandRow = hands.records.find((h) => h.data.userId === myId)
    const myHand = myHandRow ? (JSON.parse(myHandRow.data.cardIds) as string[]) : []
    const mySeat: Player | null = !game || !myId ? null : myId === game.host ? 'host' : myId === game.guest ? 'guest' : null
    const opponentId = mySeat === 'host' ? game?.guest ?? '' : mySeat === 'guest' ? game?.host ?? '' : ''

    /** A player's display name: "You" for me, their name, or their seat. */
    const nameOf = (userId: string): string => {
      if (userId === myId) return 'You'
      const p = players.records.find((r) => r.data.userId === userId)?.data
      if (p?.displayName) return p.displayName
      return userId === game?.host ? 'The host' : 'Your opponent'
    }

    return {
      myId: myId ?? '',
      mySeat,
      opponentId,
      loading: games.status === 'loading',
      game,
      gameId,
      players: players.records.map((r) => r.data),
      joinCode: joinCodes.records[0]?.data.code ?? '',
      rounds: rounds.records.map((r) => ({ id: r.recordId, ...r.data })).sort((a, b) => a.number - b.number),
      round: roundRecord ? { id: roundRecord.recordId, ...roundRecord.data } : undefined,
      /** The next case, waiting for answers or being written. */
      prepRound: prepRecord ? { id: prepRecord.recordId, ...prepRecord.data } : undefined,
      cards: [...cardsById.values()],
      cardsById,
      myHand,
      guesses: guesses.records.map((g) => ({ id: g.recordId, ...g.data })).sort((a, b) => a.seq - b.seq),
      shownToMe: new Map(shown.records.map((s) => [s.data.guessId, s.data.cardId])),
      nameOf,
    }
  }, [
    myId,
    game,
    gameId,
    games.status,
    players.records,
    joinCodes.records,
    rounds.records,
    roundRecord,
    prepRecord,
    cards.records,
    hands.records,
    guesses.records,
    shown.records,
  ])
}

export type GameView = ReturnType<typeof useGameData>
export type Round = NonNullable<GameView['round']>
