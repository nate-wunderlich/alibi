/**
 * TABLE: the round being played.
 *
 * Top to bottom: score, the case, whose turn and what I can do now (guess,
 * show a card, accuse, end turn), my hand and the face-up card, my detective
 * grid, the round log, and the cast. What I can do comes from the round's live fields
 * (turnUserId, guessedThisTurn, pendingGuessId); the server re-checks every
 * action, so these conditions only decide which controls to show.
 */

import { useState } from 'react'
import { Button, ConfirmModal, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui'
import { useAction } from '@/lib/actions'
import type { CardKind } from '../../game/rules'
import { SETTINGS } from '../../game/settings'
import { CardView, FileLabel, InlineError, KIND_LABEL, KINDS } from './CardView'
import { DetectiveGrid } from './DetectiveGrid'
import { Scoreboard } from './Scoreboard'
import type { Card, GameView, Guess, Round } from './useGameData'

type Pick = Record<CardKind, string>
const EMPTY_PICK: Pick = { suspect: '', weapon: '', location: '' }

export function Table({ view, round }: { view: GameView; round: Round }) {
  const setting = SETTINGS.find((s) => s.id === round.settingId)
  const [narrationOpen, setNarrationOpen] = useState(false)

  return (
    <section data-testid="table" className="space-y-6">
      <Scoreboard view={view} />

      <header>
        <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
          {setting?.name ?? 'Unknown setting'}
        </p>
        <h1 data-testid="case-title" className="font-display text-3xl font-bold leading-tight">
          {round.caseTitle}
        </h1>
        <p className="mt-1 text-muted-foreground">Victim: {round.victim}</p>
        <Button variant="link" className="h-auto px-0" onClick={() => setNarrationOpen((o) => !o)}>
          {narrationOpen ? 'Hide the opening' : 'Read the opening'}
        </Button>
        {narrationOpen && (
          <p data-testid="opening-narration" className="mt-1 border-l-2 border-primary pl-3 text-sm leading-relaxed">
            {round.openingNarration}
          </p>
        )}
      </header>

      <TurnPanel view={view} round={round} />

      <div>
        <FileLabel>Your hand</FileLabel>
        <div data-testid="my-hand" className="grid grid-cols-2 gap-2">
          {view.myHand.map((id) => (
            <CardView key={id} data-testid="hand-card" data-card-id={id} card={view.cardsById.get(id)} />
          ))}
        </div>
      </div>

      <div>
        <FileLabel>Face up for both of you</FileLabel>
        <CardView
          data-testid="face-up-card"
          data-card-id={round.faceUpCardId}
          card={view.cardsById.get(round.faceUpCardId)}
        />
      </div>

      <DetectiveGrid key={round.id} view={view} round={round} />

      <RoundLog view={view} />

      <Cast view={view} round={round} />
    </section>
  )
}

/** Whose turn it is, and the controls for what I can do right now. */
function TurnPanel({ view, round }: { view: GameView; round: Round }) {
  const { myId, opponentId, nameOf } = view
  const myTurn = round.turnUserId === myId
  const pending = view.guesses.find((g) => g.id === round.pendingGuessId)

  // My opponent's guess is waiting for me to choose a card to show.
  if (pending && pending.byUserId !== myId) return <ShowCardPrompt view={view} guess={pending} />

  if (!myTurn) {
    return (
      <div data-testid="turn-waiting" className="rounded-sm border border-border bg-card p-4 text-muted-foreground">
        {nameOf(opponentId)} is on the case. Waiting for their move.
      </div>
    )
  }

  if (pending) {
    return (
      <div data-testid="waiting-for-show" className="rounded-sm border border-border bg-card p-4 text-muted-foreground">
        {nameOf(opponentId)} holds more than one of those cards and is choosing which to show you.
      </div>
    )
  }

  return <MyTurn view={view} round={round} />
}

/** My turn: guess first, then accuse or end the turn (R33). I may also accuse without guessing. */
function MyTurn({ view, round }: { view: GameView; round: Round }) {
  const [accusing, setAccusing] = useState(false)
  const guessed = round.guessedThisTurn === 1
  const endTurn = useAction()

  return (
    <div className="space-y-3 rounded-sm border border-primary bg-card p-4">
      <p className="font-mono text-[11px] uppercase tracking-widest text-primary">Your turn</p>
      {!guessed && !accusing && <GuessBuilder view={view} round={round} />}
      {guessed && !accusing && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Your guess is in the log below. Accuse now, or pass the turn.</p>
          <div className="grid grid-cols-2 gap-2">
            <Button data-testid="accuse-now" variant="outline" onClick={() => setAccusing(true)}>
              Accuse now
            </Button>
            <Button
              data-testid="end-turn"
              loading={endTurn.pending}
              onClick={() => endTurn.run('endTurn', { roundId: round.id })}
            >
              End turn
            </Button>
          </div>
          <InlineError message={endTurn.error} />
        </div>
      )}
      {accusing ? (
        <AccusePanel view={view} round={round} onCancel={() => setAccusing(false)} />
      ) : (
        !guessed && (
          <Button variant="link" className="h-auto px-0 text-sm" onClick={() => setAccusing(true)}>
            Skip the guess and accuse
          </Button>
        )
      )}
    </div>
  )
}

/** Three selects, one per kind. You may name cards you hold (a legal bluff). */
function CardPicker({
  view,
  pick,
  setPick,
  testIdPrefix,
}: {
  view: GameView
  pick: Pick
  setPick: (p: Pick) => void
  testIdPrefix: string
}) {
  return (
    <div className="grid gap-2">
      {KINDS.map((kind) => (
        <Select key={kind} value={pick[kind]} onValueChange={(v) => setPick({ ...pick, [kind]: v })}>
          <SelectTrigger data-testid={`${testIdPrefix}-${kind}`} aria-label={KIND_LABEL[kind]}>
            <SelectValue placeholder={`Choose a ${KIND_LABEL[kind].toLowerCase()}`} />
          </SelectTrigger>
          <SelectContent>
            {view.cards
              .filter((c) => c.kind === kind)
              .map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      ))}
    </div>
  )
}

function GuessBuilder({ view, round }: { view: GameView; round: Round }) {
  const [pick, setPick] = useState<Pick>(EMPTY_PICK)
  const guess = useAction()
  const complete = KINDS.every((k) => pick[k] !== '')

  return (
    <div data-testid="guess-builder" className="space-y-2">
      <p className="text-sm">Name a suspect, a method, and a place. If your opponent holds any of them, they must show you one.</p>
      <CardPicker view={view} pick={pick} setPick={setPick} testIdPrefix="guess" />
      <Button
        data-testid="guess-submit"
        className="w-full"
        disabled={!complete}
        loading={guess.pending}
        onClick={async () => {
          const res = await guess.run('guess', { roundId: round.id, ...pick })
          if (res.success) setPick(EMPTY_PICK)
        }}
      >
        Make the guess
      </Button>
      <InlineError message={guess.error} />
    </div>
  )
}

/** Accuse with a confirm step: a wrong accusation hands the round to the opponent. */
function AccusePanel({ view, round, onCancel }: { view: GameView; round: Round; onCancel: () => void }) {
  const [pick, setPick] = useState<Pick>(EMPTY_PICK)
  const [confirming, setConfirming] = useState(false)
  const accuse = useAction()
  const complete = KINDS.every((k) => pick[k] !== '')
  const name = (id: string) => view.cardsById.get(id)?.name ?? '?'

  return (
    <div data-testid="accuse-panel" className="space-y-2">
      <p className="text-sm">
        Name the envelope. Right, and you win the round. Wrong, and {view.nameOf(view.opponentId)} wins it.
      </p>
      <CardPicker view={view} pick={pick} setPick={setPick} testIdPrefix="accuse" />
      <div className="grid grid-cols-2 gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Not yet
        </Button>
        <Button data-testid="accuse-submit" variant="destructive" disabled={!complete} onClick={() => setConfirming(true)}>
          Accuse
        </Button>
      </div>
      <InlineError message={accuse.error} />
      <ConfirmModal
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={async () => {
          const res = await accuse.run('accuse', { roundId: round.id, ...pick })
          setConfirming(false)
          if (res.success) onCancel()
        }}
        title={`Accuse ${name(pick.suspect)}, with ${name(pick.weapon)}, in ${name(pick.location)}?`}
        description="This ends the round either way."
        confirmText="Accuse"
        cancelText="Go back"
        loading={accuse.pending}
      />
    </div>
  )
}

/** My opponent's guess matched two or three of my cards: I choose which one to show. */
function ShowCardPrompt({ view, guess }: { view: GameView; guess: Guess }) {
  const show = useAction()
  const named = [guess.suspect, guess.weapon, guess.location]
  const matching = view.myHand.filter((id) => named.includes(id))

  return (
    <div data-testid="show-card-prompt" className="space-y-2 rounded-sm border border-primary bg-card p-4">
      <p className="font-mono text-[11px] uppercase tracking-widest text-primary">Your choice</p>
      <p className="text-sm">
        {view.nameOf(guess.byUserId)} named {matching.length} of your cards. Show them exactly one.
      </p>
      {matching.map((id) => (
        <div key={id} className="flex items-center gap-2">
          <CardView className="flex-1" card={view.cardsById.get(id)} />
          <Button
            data-testid="show-card"
            loading={show.pending}
            onClick={() => show.run('showCard', { guessId: guess.id, cardId: id })}
          >
            Show
          </Button>
        </div>
      ))}
      <InlineError message={show.error} />
    </div>
  )
}

/** Every guess this round, oldest first, with its result. */
function RoundLog({ view }: { view: GameView }) {
  const name = (id: string) => view.cardsById.get(id)?.name ?? '?'
  const resultText = (g: Guess) => {
    if (g.result === 'none') return 'No match.'
    if (g.result === 'pending') return 'A card is being chosen.'
    if (g.byUserId === view.myId) {
      const shown = view.shownToMe.get(g.id)
      return shown ? `Shown to you: ${name(shown)}.` : 'A card was shown to you.'
    }
    return `You showed ${view.nameOf(g.byUserId)} a card.`
  }

  return (
    <div>
      <FileLabel>Round log</FileLabel>
      {view.guesses.length === 0 ? (
        <p className="text-sm text-muted-foreground">No guesses yet.</p>
      ) : (
        <ol className="space-y-2">
          {view.guesses.map((g) => (
            <li
              key={g.id}
              data-testid="round-log-entry"
              data-result={g.result}
              data-shown-card-id={g.byUserId === view.myId ? (view.shownToMe.get(g.id) ?? '') : ''}
              className="rounded-sm border border-border bg-card px-3 py-2 text-sm"
            >
              <span className="font-semibold">{view.nameOf(g.byUserId)}</span> guessed {name(g.suspect)}, with{' '}
              {name(g.weapon)}, in {name(g.location)}.{' '}
              <span className={g.result === 'shown' && g.byUserId === view.myId ? 'text-primary' : 'text-muted-foreground'}>
                {resultText(g)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

/** The 12 cards grouped by kind, with a note on what I know about each. */
function Cast({ view, round }: { view: GameView; round: Round }) {
  const shownIds = new Set(view.shownToMe.values())
  const noteFor = (c: Card) => {
    if (view.myHand.includes(c.id)) return 'In your hand'
    if (c.id === round.faceUpCardId) return 'Face up'
    if (shownIds.has(c.id)) return 'Shown to you'
    return undefined
  }
  return (
    <div className="space-y-4">
      {KINDS.map((kind) => (
        <div key={kind}>
          <FileLabel>{KIND_LABEL[kind]}s</FileLabel>
          <div className="space-y-2">
            {view.cards
              .filter((c) => c.kind === kind)
              .map((c) => (
                <CardView key={c.id} card={c} detailed note={noteFor(c)} />
              ))}
          </div>
        </div>
      ))}
    </div>
  )
}
