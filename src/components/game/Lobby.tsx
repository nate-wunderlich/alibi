/**
 * LOBBY: both players (live), the join code for the host only, my round-1
 * questions, and the host's Start button, enabled once a guest has joined
 * and both players have answered. While the AI writes the case, both
 * players see "Writing your case...".
 */

import { Button } from '@/components/ui'
import { useAction } from '@/lib/actions'
import { AiPausedBanner } from './AiPausedBanner'
import { InlineError } from './CardView'
import { answeredFlags, QuestionsPanel, WritingCase } from './QuestionsPanel'
import type { GameView } from './useGameData'

export function Lobby({ view }: { view: GameView }) {
  const { game, mySeat, players, joinCode, nameOf, prepRound } = view
  const start = useAction()
  if (!game) return null
  const isHost = mySeat === 'host'
  const guestJoined = game.guest !== ''
  const writing = prepRound?.status === 'generating'
  const bothAnswered = prepRound ? answeredFlags(view, prepRound).both : false

  return (
    <section data-testid="lobby" className="space-y-3">
      {/* R47: a compact header: series length, the host's join code, both players. */}
      <header className="space-y-1.5 border-b border-border pb-2">
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="font-display text-2xl font-bold">A new case file</h1>
          <p className="shrink-0 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Best of {game.bestOf}</p>
        </div>
        {isHost && joinCode && (
          <p className="text-sm text-muted-foreground">
            Share this code:{' '}
            <span data-testid="join-code" className="font-mono text-2xl font-medium tracking-[0.25em] text-primary">
              {joinCode}
            </span>
          </p>
        )}
        <AiPausedBanner paused={prepRound?.aiPaused === 1} />
        <ul className="flex flex-wrap gap-1.5">
          {players.map((p) => (
            <li
              key={p.userId}
              data-testid="lobby-player"
              className="rounded-sm border border-border bg-card px-2 py-0.5 text-sm"
            >
              <span className="font-semibold">{nameOf(p.userId)}</span>{' '}
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{p.seat}</span>
            </li>
          ))}
          {!guestJoined && (
            <li className="rounded-sm border border-dashed border-border px-2 py-0.5 text-sm text-muted-foreground">
              Waiting for your opponent
            </li>
          )}
        </ul>
      </header>

      {writing ? (
        <WritingCase />
      ) : (
        prepRound && <QuestionsPanel key={prepRound.id} view={view} round={prepRound} />
      )}

      {!writing &&
        (isHost ? (
          guestJoined ? (
            <div>
              <Button
                data-testid="start-series"
                className="w-full"
                disabled={!bothAnswered}
                loading={start.pending}
                onClick={() => start.run('startSeries', { gameId: view.gameId })}
              >
                Start the first case
              </Button>
              {!bothAnswered && <p className="mt-1 text-xs text-muted-foreground">You can start once you both have answered.</p>}
              <InlineError message={start.error} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">You can start once your opponent joins with the code.</p>
          )
        ) : (
          <p data-testid="lobby-waiting" className="text-sm text-muted-foreground">
            Waiting for {nameOf(game.host)} to start the first case.
          </p>
        ))}
    </section>
  )
}
