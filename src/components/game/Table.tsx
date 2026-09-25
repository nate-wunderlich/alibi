/**
 * TABLE: the round being played, on one screen that never scrolls (R47).
 *
 * Top strip (always visible): the series score, the case title, whose turn it
 * is, and the opening (read it in a dialog, or play it). Middle: the active
 * tab, filling the rest of the height. Bottom: the tab bar.
 *  - Play: the turn panel (guess, show a card, accuse, end turn), my hand, the face-up card.
 *  - Grid: my detective grid.
 *  - Log: newest first, as many entries as fit, then "and N earlier".
 *  - Cast: the 12 cards as compact tiles; tap one for its description and status.
 * What I can do comes from the round's live fields (turnUserId,
 * guessedThisTurn, pendingGuessId); the server re-checks every action, so
 * these conditions only decide which controls to show.
 */

import { useEffect, useState, type ReactNode } from 'react'
import {
  Button,
  ConfirmModal,
  Dialog,
  DialogContent,
  DialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui'
import { cn } from '@/lib/utils'
import { useAction } from '@/lib/actions'
import type { CardKind } from '../../game/rules'
import { AlibiEntry } from './AlibiEntry'
import { CardChip, CardView, InlineError, KIND_LABEL, KINDS, SuspectFace } from './CardView'
import { DetectiveGrid } from './DetectiveGrid'
import { FitList } from '../FitList'
import { NarrationAudio } from './NarrationAudio'
import { Scoreboard } from './Scoreboard'
import { alibisOf, type Card, type GameView, type Guess, type RevealedAlibi, type Round } from './useGameData'

type Pick = Record<CardKind, string>
const EMPTY_PICK: Pick = { suspect: '', weapon: '', location: '' }

type Tab = 'play' | 'grid' | 'log' | 'cast'
const TABS: { id: Tab; label: string }[] = [
  { id: 'play', label: 'Play' },
  { id: 'grid', label: 'Grid' },
  { id: 'log', label: 'Log' },
  { id: 'cast', label: 'Cast' },
]

export function Table({ view, round }: { view: GameView; round: Round }) {
  const [tab, setTab] = useState<Tab>('play')
  const pending = view.guesses.find((g) => g.id === round.pendingGuessId)
  const mustChoose = !!pending && pending.byUserId !== view.myId
  const myTurn = round.turnUserId === view.myId

  // When I must choose a card to show, go to Play (R47).
  useEffect(() => {
    if (mustChoose) setTab('play')
  }, [mustChoose])

  // A dot on Log when a new entry arrives while another tab is open.
  const logCount = view.guesses.length + alibisOf(round).length
  const [seenLog, setSeenLog] = useState(logCount)
  useEffect(() => {
    if (tab === 'log') setSeenLog(logCount)
  }, [tab, logCount])

  const marked: Record<Tab, boolean> = {
    play: mustChoose || (myTurn && tab !== 'play'),
    grid: false,
    log: tab !== 'log' && logCount > seenLog,
    cast: false,
  }

  return (
    <section data-testid="table" className="flex min-h-0 flex-1 flex-col gap-2">
      <TopStrip view={view} round={round} mustChoose={mustChoose} />

      <div role="tabpanel" data-testid={`tabpanel-${tab}`} className="flex min-h-0 flex-1 flex-col">
        {tab === 'play' && <PlayTab view={view} round={round} />}
        {tab === 'grid' && <DetectiveGrid key={round.id} view={view} round={round} />}
        {tab === 'log' && <LogTab view={view} round={round} />}
        {tab === 'cast' && <CastTab view={view} round={round} />}
      </div>

      <div role="tablist" aria-label="Table" className="-mx-3 grid shrink-0 grid-cols-4 border-t border-border bg-background">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            data-testid={`tab-${t.id}`}
            aria-selected={tab === t.id}
            data-marked={marked[t.id] ? 'true' : 'false'}
            onClick={() => setTab(t.id)}
            className={cn(
              'relative h-12 font-mono text-[11px] uppercase tracking-widest',
              tab === t.id ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
            {marked[t.id] && (
              <span aria-label="new" className="absolute right-[calc(50%-1.9rem)] top-3 h-1.5 w-1.5 rounded-full bg-primary" />
            )}
            {tab === t.id && <span aria-hidden className="absolute inset-x-6 top-0 h-0.5 bg-primary" />}
          </button>
        ))}
      </div>
    </section>
  )
}

/** Score, case title, whose turn it is, and the opening. */
function TopStrip({ view, round, mustChoose }: { view: GameView; round: Round; mustChoose: boolean }) {
  const [openingOpen, setOpeningOpen] = useState(false)
  const turn = mustChoose
    ? 'Choose a card to show'
    : round.turnUserId === view.myId
      ? 'Your turn'
      : `${view.nameOf(round.turnUserId)}'s turn`
  return (
    <header className="shrink-0 space-y-1 border-b border-border pb-2">
      <Scoreboard view={view} compact />
      <h1 data-testid="case-title" className="truncate font-display text-xl font-bold leading-tight" title={round.caseTitle}>
        {round.caseTitle}
      </h1>
      <div className="flex items-center gap-3 text-sm">
        <span data-testid="turn-status" className={cn('mr-auto truncate', round.turnUserId === view.myId || mustChoose ? 'text-primary' : 'text-muted-foreground')}>
          {turn}
        </span>
        <Button variant="link" className="h-auto shrink-0 px-0 text-sm" onClick={() => setOpeningOpen(true)}>
          Read the opening
        </Button>
        {round.openingAudioUrl && <NarrationAudio src={round.openingAudioUrl} label="Play the opening" testId="play-opening" />}
      </div>
      <Dialog open={openingOpen} onOpenChange={setOpeningOpen}>
        <DialogContent className="max-h-[85vh]">
          <DialogTitle className="font-display text-xl font-bold">{round.caseTitle}</DialogTitle>
          <p className="text-sm text-muted-foreground">Victim: {round.victim}</p>
          <p data-testid="opening-narration" className="border-l-2 border-primary pl-3 text-sm leading-relaxed">
            {round.openingNarration}
          </p>
        </DialogContent>
      </Dialog>
    </header>
  )
}

/** Play: the turn panel, my hand (2x2), and the face-up card. */
function PlayTab({ view, round }: { view: GameView; round: Round }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <TurnPanel view={view} round={round} />
      <div>
        <SmallLabel>Your hand</SmallLabel>
        <div data-testid="my-hand" className="grid grid-cols-2 gap-1.5">
          {view.myHand.map((id) => (
            <CardChip key={id} data-testid="hand-card" data-card-id={id} card={view.cardsById.get(id)} />
          ))}
        </div>
      </div>
      <div>
        <SmallLabel>Face up for both of you</SmallLabel>
        <CardChip data-testid="face-up-card" data-card-id={round.faceUpCardId} card={view.cardsById.get(round.faceUpCardId)} />
      </div>
    </div>
  )
}

function SmallLabel({ children }: { children: ReactNode }) {
  return <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{children}</p>
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
      <div data-testid="turn-waiting" className="rounded-sm border border-border bg-card p-3 text-sm text-muted-foreground">
        {nameOf(opponentId)} is on the case. Waiting for their move.
      </div>
    )
  }

  if (pending) {
    return (
      <div data-testid="waiting-for-show" className="rounded-sm border border-border bg-card p-3 text-sm text-muted-foreground">
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
    <div className="space-y-2 rounded-sm border border-primary bg-card p-2.5">
      {!guessed && !accusing && <GuessBuilder view={view} round={round} onAccuse={() => setAccusing(true)} />}
      {guessed && !accusing && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Your guess is in the log. Accuse now, or pass the turn.</p>
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
      {accusing && <AccusePanel view={view} round={round} onCancel={() => setAccusing(false)} />}
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
    <div className="grid gap-1.5">
      {KINDS.map((kind) => (
        <Select key={kind} value={pick[kind]} onValueChange={(v) => setPick({ ...pick, [kind]: v })}>
          <SelectTrigger data-testid={`${testIdPrefix}-${kind}`} aria-label={KIND_LABEL[kind]} className="h-9">
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

/** The guess: three selects, the guess button, and beside it the way to skip straight to accusing. */
function GuessBuilder({ view, round, onAccuse }: { view: GameView; round: Round; onAccuse: () => void }) {
  const [pick, setPick] = useState<Pick>(EMPTY_PICK)
  const guess = useAction()
  const complete = KINDS.every((k) => pick[k] !== '')

  return (
    <div data-testid="guess-builder" className="space-y-1.5">
      <CardPicker view={view} pick={pick} setPick={setPick} testIdPrefix="guess" />
      <div className="flex items-center gap-3">
        <Button
          data-testid="guess-submit"
          className="flex-1"
          disabled={!complete}
          loading={guess.pending}
          onClick={async () => {
            const res = await guess.run('guess', { roundId: round.id, ...pick })
            if (res.success) setPick(EMPTY_PICK)
          }}
        >
          Make the guess
        </Button>
        <Button variant="link" className="h-auto shrink-0 px-0 text-sm" onClick={onAccuse}>
          Skip and accuse
        </Button>
      </div>
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
    <div data-testid="accuse-panel" className="space-y-1.5">
      <p className="text-xs text-muted-foreground">
        Name the envelope. Wrong gives the round to {view.nameOf(view.opponentId)}.
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
    <div data-testid="show-card-prompt" className="space-y-1.5 rounded-sm border border-primary bg-card p-3">
      <p className="text-sm">
        {view.nameOf(guess.byUserId)} named {matching.length} of your cards. Show them exactly one.
      </p>
      {matching.map((id) => (
        <div key={id} className="flex items-center gap-2">
          <CardChip className="flex-1" card={view.cardsById.get(id)} />
          <Button data-testid="show-card" loading={show.pending} onClick={() => show.run('showCard', { guessId: guess.id, cardId: id })}>
            Show
          </Button>
        </div>
      ))}
      <InlineError message={show.error} />
    </div>
  )
}

type LogEntry = { type: 'guess'; at: number; guess: Guess } | { type: 'alibi'; at: number; alibi: RevealedAlibi }

/**
 * Log: every guess and each alibi (R41), newest first. A turn is one guess
 * (R33), so the alibi drawn after turn N sits just above the Nth guess. Only
 * the entries that fit are shown, then "and N earlier" (R47: no scrolling).
 */
function LogTab({ view, round }: { view: GameView; round: Round }) {
  const entries: LogEntry[] = [
    ...view.guesses.map((guess, i) => ({ type: 'guess' as const, at: i + 1, guess })),
    ...alibisOf(round).map((alibi) => ({ type: 'alibi' as const, at: alibi.afterTurn + 0.5, alibi })),
  ].sort((a, b) => b.at - a.at)
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

  if (entries.length === 0) return <p className="text-sm text-muted-foreground">No guesses yet.</p>
  return (
    <FitList
      count={entries.length}
      render={(i) => {
        const entry = entries[i]
        return entry.type === 'alibi' ? (
          <AlibiEntry
            key={`alibi-${entry.alibi.cardId}`}
            cardId={entry.alibi.cardId}
            cardName={name(entry.alibi.cardId)}
            text={entry.alibi.text}
          />
        ) : (
          <GuessEntry key={entry.guess.id} view={view} g={entry.guess} name={name} resultText={resultText} />
        )
      }}
      more={(hidden) => (
        <p data-testid="log-earlier" className="pt-1 text-xs text-muted-foreground">
          and {hidden} earlier
        </p>
      )}
    />
  )
}

/** One guess in the round log. */
function GuessEntry({
  view,
  g,
  name,
  resultText,
}: {
  view: GameView
  g: Guess
  name: (id: string) => string
  resultText: (g: Guess) => string
}) {
  return (
    <li
      data-testid="round-log-entry"
      data-result={g.result}
      data-shown-card-id={g.byUserId === view.myId ? (view.shownToMe.get(g.id) ?? '') : ''}
      className="rounded-sm border border-border bg-card px-3 py-1.5 text-sm"
    >
      <span className="font-semibold">{view.nameOf(g.byUserId)}</span> guessed {name(g.suspect)}, with{' '}
      {name(g.weapon)}, in {name(g.location)}.{' '}
      <span className={g.result === 'shown' && g.byUserId === view.myId ? 'text-primary' : 'text-muted-foreground'}>
        {resultText(g)}
      </span>
    </li>
  )
}

/** What I know about a card, for the Cast: in my hand, face up, cleared, or shown to me. */
function statusOf(c: Card, view: GameView, round: Round): string | undefined {
  if (view.myHand.includes(c.id)) return 'In your hand'
  if (c.id === round.faceUpCardId) return 'Face up'
  if (alibisOf(round).some((a) => a.cardId === c.id)) return 'Cleared by an alibi'
  if (new Set(view.shownToMe.values()).has(c.id)) return 'Shown to you'
  return undefined
}

/** Cast: the 12 cards as compact tiles by kind; tap one for its description and status. */
function CastTab({ view, round }: { view: GameView; round: Round }) {
  const [open, setOpen] = useState<Card | null>(null)
  return (
    <div data-testid="cast" className="flex min-h-0 flex-1 flex-col gap-2">
      {KINDS.map((kind) => (
        <div key={kind}>
          <SmallLabel>{KIND_LABEL[kind]}s</SmallLabel>
          <div className="grid grid-cols-4 gap-1.5">
            {view.cards
              .filter((c) => c.kind === kind)
              .map((c) => {
                const status = statusOf(c, view, round)
                return (
                  <button
                    key={c.id}
                    type="button"
                    data-testid="cast-card"
                    data-card-id={c.id}
                    onClick={() => setOpen(c)}
                    className={cn(
                      'flex flex-col items-center gap-1 rounded-sm border bg-card p-1 text-center',
                      status ? 'border-border opacity-60' : 'border-border hover:border-primary',
                    )}
                  >
                    {kind === 'suspect' && <SuspectFace card={c} size="h-11 w-11" />}
                    <span className="line-clamp-2 text-[11px] font-semibold leading-tight">{c.name}</span>
                  </button>
                )
              })}
          </div>
        </div>
      ))}
      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent data-testid="cast-detail">
          <DialogTitle className="sr-only">{open?.name}</DialogTitle>
          {open && <CardView card={open} detailed note={statusOf(open, view, round)} />}
        </DialogContent>
      </Dialog>
    </div>
  )
}
