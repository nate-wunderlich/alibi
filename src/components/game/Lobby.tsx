/**
 * LOBBY: both players (live), the join code for the host only, and the
 * host's Start button once a guest has joined.
 */

import { Button } from '@/components/ui'
import { useAction } from '@/lib/actions'
import { FileLabel, InlineError } from './CardView'
import type { GameView } from './useGameData'

export function Lobby({ view }: { view: GameView }) {
  const { game, mySeat, players, joinCode, nameOf } = view
  const start = useAction()
  if (!game) return null
  const isHost = mySeat === 'host'
  const guestJoined = game.guest !== ''

  return (
    <section data-testid="lobby" className="space-y-6">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
          Best of {game.bestOf} · waiting room
        </p>
        <h1 className="font-display text-3xl font-bold">A new case file</h1>
      </div>

      {isHost && joinCode && (
        <div className="rounded-sm border border-border bg-card p-4">
          <FileLabel>Share this code with your opponent</FileLabel>
          <p data-testid="join-code" className="font-mono text-4xl font-medium tracking-[0.3em] text-primary">
            {joinCode}
          </p>
        </div>
      )}

      <div>
        <FileLabel>Detectives</FileLabel>
        <ul className="space-y-2">
          {players.map((p) => (
            <li
              key={p.userId}
              data-testid="lobby-player"
              className="flex items-center justify-between rounded-sm border border-border bg-card px-3 py-2"
            >
              <span className="font-semibold">{nameOf(p.userId)}</span>
              <span className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">{p.seat}</span>
            </li>
          ))}
          {!guestJoined && (
            <li className="rounded-sm border border-dashed border-border px-3 py-2 text-muted-foreground">
              Empty chair: waiting for your opponent to join.
            </li>
          )}
        </ul>
      </div>

      {isHost ? (
        guestJoined ? (
          <div>
            <Button
              data-testid="start-series"
              size="lg"
              className="w-full"
              loading={start.pending}
              onClick={() => start.run('startSeries', { gameId: view.gameId })}
            >
              Start the first case
            </Button>
            <InlineError message={start.error} />
          </div>
        ) : (
          <p className="text-muted-foreground">You can start once your opponent joins with the code.</p>
        )
      ) : (
        <p data-testid="lobby-waiting" className="text-muted-foreground">
          Waiting for {nameOf(game.host)} to start the first case.
        </p>
      )}
    </section>
  )
}
