/** The series score: host on the left, guest on the right, and the case number. */

import type { GameView } from './useGameData'

export function Scoreboard({ view, compact = false }: { view: GameView; compact?: boolean }) {
  const { game, nameOf, round } = view
  if (!game) return null
  // R47: one line for the table's top strip.
  if (compact) {
    return (
      <div data-testid="series-score" className="flex items-center justify-between gap-2 text-sm">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate text-muted-foreground">{nameOf(game.host)}</span>
          <span data-testid="score-host" className="font-display text-lg font-bold">
            {game.scoreHost}
          </span>
        </div>
        <div className="shrink-0 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {round ? `Case ${round.number}` : 'Series'} · best of {game.bestOf}
        </div>
        <div className="flex min-w-0 items-baseline justify-end gap-1.5">
          <span data-testid="score-guest" className="font-display text-lg font-bold">
            {game.scoreGuest}
          </span>
          <span className="truncate text-muted-foreground">{nameOf(game.guest)}</span>
        </div>
      </div>
    )
  }
  return (
    <div
      data-testid="series-score"
      className="flex items-center justify-between rounded-sm border border-border bg-card px-4 py-2"
    >
      <div className="min-w-0">
        <div className="truncate text-sm text-muted-foreground">{nameOf(game.host)}</div>
        <div data-testid="score-host" className="font-display text-2xl font-bold">
          {game.scoreHost}
        </div>
      </div>
      <div className="text-center font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
        {round ? `Case ${round.number}` : 'Series'}
        <br />
        best of {game.bestOf}
      </div>
      <div className="min-w-0 text-right">
        <div className="truncate text-sm text-muted-foreground">{nameOf(game.guest)}</div>
        <div data-testid="score-guest" className="font-display text-2xl font-bold">
          {game.scoreGuest}
        </div>
      </div>
    </div>
  )
}
