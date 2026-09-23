/**
 * REVEAL (R30): the envelope, both hands, the accusation and whether it was
 * right, the round winner, and the score. Everything here comes from the
 * round's revealed* fields, copied by the server at the reveal; the secret
 * collections stay closed.
 */

import { Link } from 'react-router-dom'
import { Button, buttonVariants } from '@/components/ui'
import { useAction } from '@/lib/actions'
import type { Triple } from '../../game/rules'
import { SETTINGS } from '../../game/settings'
import { CardView, FileLabel, InlineError } from './CardView'
import { Scoreboard } from './Scoreboard'
import type { GameView, Round } from './useGameData'

interface Accusation extends Triple {
  byUserId: string
  correct: boolean
}

const parse = <T,>(text: string, fallback: T): T => {
  try {
    return text ? (JSON.parse(text) as T) : fallback
  } catch {
    return fallback
  }
}

/** The reveal of one round: envelope, accusation, winner, and both hands. */
export function RevealDetails({ view, round }: { view: GameView; round: Round }) {
  const envelope = parse<Triple | null>(round.revealedSolution, null)
  const hands = parse<Record<string, string[]>>(round.revealedHands, {})
  const accusation = parse<Accusation | null>(round.revealedAccusation, null)
  const card = (id: string) => view.cardsById.get(id)
  const name = (id: string) => card(id)?.name ?? '?'

  return (
    <div className="space-y-5">
      <div>
        <FileLabel>The envelope</FileLabel>
        <div data-testid="reveal-envelope" className="space-y-2">
          {envelope &&
            [envelope.suspect, envelope.weapon, envelope.location].map((id) => (
              <CardView key={id} card={card(id)} detailed className="border-primary" />
            ))}
        </div>
      </div>

      {accusation && (
        <div data-testid="reveal-accusation" className="rounded-sm border border-border bg-card p-3 text-sm">
          <span className="font-semibold">{view.nameOf(accusation.byUserId)}</span> accused {name(accusation.suspect)}, with{' '}
          {name(accusation.weapon)}, in {name(accusation.location)}.{' '}
          <span className={accusation.correct ? 'font-semibold text-primary' : 'font-semibold'}>
            {accusation.correct ? 'Right.' : 'Wrong.'}
          </span>
        </div>
      )}

      <p data-testid="round-winner" className="font-display text-2xl font-bold">
        {round.winnerUserId === view.myId ? 'You win this case.' : `${view.nameOf(round.winnerUserId)} wins this case.`}
      </p>

      <div className="grid gap-4">
        {Object.entries(hands).map(([userId, ids]) => (
          <div key={userId} data-testid="reveal-hand">
            <FileLabel>{userId === view.myId ? 'Your hand' : `${view.nameOf(userId)}'s hand`}</FileLabel>
            <div className="grid grid-cols-2 gap-2">
              {ids.map((id) => (
                <CardView key={id} card={card(id)} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** REVEAL screen between rounds: the details, the score, and "Next case" for the host. */
export function Reveal({ view, round }: { view: GameView; round: Round }) {
  const next = useAction()
  const setting = SETTINGS.find((s) => s.id === round.settingId)

  return (
    <section data-testid="reveal" className="space-y-6">
      <Scoreboard view={view} />
      <header>
        <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
          Case {round.number} · {setting?.name} · closed
        </p>
        <h1 className="font-display text-3xl font-bold leading-tight">{round.caseTitle}</h1>
      </header>
      <RevealDetails view={view} round={round} />
      {view.mySeat === 'host' ? (
        <div>
          <Button
            data-testid="next-case"
            size="lg"
            className="w-full"
            loading={next.pending}
            onClick={() => next.run('nextRound', { gameId: view.gameId })}
          >
            Next case
          </Button>
          <InlineError message={next.error} />
        </div>
      ) : (
        <p data-testid="next-case-waiting" className="text-muted-foreground">
          Waiting for {view.game ? view.nameOf(view.game.host) : 'the host'} to open the next case.
        </p>
      )}
    </section>
  )
}

/** SERIES END: the winner, the round-by-round results, the last reveal, and the way home. */
export function SeriesEnd({ view }: { view: GameView }) {
  const { game, round } = view
  if (!game) return null
  const iWon = game.seriesWinner === view.myId

  return (
    <section data-testid="series-end" className="space-y-6">
      <Scoreboard view={view} />
      <header>
        <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">Series closed</p>
        <h1 data-testid="series-winner" className="font-display text-4xl font-bold leading-tight">
          {iWon ? 'You solved the series.' : `${view.nameOf(game.seriesWinner)} solved the series.`}
        </h1>
      </header>

      <div>
        <FileLabel>Case by case</FileLabel>
        <ol className="space-y-2">
          {view.rounds.map((r) => (
            <li key={r.id} data-testid="series-round" className="flex justify-between gap-3 rounded-sm border border-border bg-card px-3 py-2 text-sm">
              <span className="min-w-0 truncate">
                <span className="font-mono text-muted-foreground">{r.number}.</span> {r.caseTitle} ·{' '}
                {SETTINGS.find((s) => s.id === r.settingId)?.name}
              </span>
              <span className="shrink-0 font-semibold">{view.nameOf(r.winnerUserId)}</span>
            </li>
          ))}
        </ol>
      </div>

      {round && (
        <div>
          <FileLabel>The last case</FileLabel>
          <RevealDetails view={view} round={round} />
        </div>
      )}

      <Link to="/home" data-testid="back-home" className={buttonVariants({ variant: 'outline', className: 'w-full' })}>
        Back home
      </Link>
    </section>
  )
}
