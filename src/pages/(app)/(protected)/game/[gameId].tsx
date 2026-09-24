/**
 * /game/:gameId — one route for the whole series. It renders by status:
 * lobby -> LOBBY; a round being played -> TABLE; a revealed round -> REVEAL;
 * a finished series -> SERIES END. All data is live (useGameData).
 */

import { useParams } from 'react-router-dom'
import { Lobby } from '../../../../components/game/Lobby'
import { Reveal, SeriesEnd } from '../../../../components/game/Reveal'
import { Table } from '../../../../components/game/Table'
import { useGameData } from '../../../../components/game/useGameData'

export default function GamePage() {
  const { gameId = '' } = useParams()
  const view = useGameData(gameId)
  const { game, round, mySeat } = view

  let body
  // R47: the table, the reveal, and the series end fill the screen above their own bottom bars.
  let fill = false
  if (view.loading) body = <Skeleton />
  else if (!game || !mySeat) body = <NotYours />
  else if (game.status === 'lobby') body = <Lobby view={view} />
  else if (game.status === 'finished') {
    body = <SeriesEnd view={view} />
    fill = true
  } else if (!round || (round.status !== 'playing' && round.status !== 'revealed')) body = <Preparing />
  else if (round.status === 'revealed') {
    body = <Reveal view={view} round={round} />
    fill = true
  } else {
    body = <Table view={view} round={round} />
    fill = true
  }

  if (fill) {
    return <div className="mx-auto flex h-full w-full max-w-[480px] flex-col px-3 pt-2 text-foreground">{body}</div>
  }
  return <div className="mx-auto w-full max-w-[480px] px-4 py-3 text-foreground">{body}</div>
}

/** Loading placeholder shaped like the score and case header. */
function Skeleton() {
  return (
    <div aria-busy="true" className="space-y-4">
      <div className="h-16 animate-pulse rounded-sm bg-muted" />
      <div className="h-8 w-2/3 animate-pulse rounded-sm bg-muted" />
      <div className="h-24 animate-pulse rounded-sm bg-muted" />
    </div>
  )
}

function Preparing() {
  return (
    <div className="space-y-4">
      <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">Preparing the case</p>
      <div className="h-24 animate-pulse rounded-sm bg-muted" />
    </div>
  )
}

function NotYours() {
  return (
    <div className="space-y-2">
      <h1 className="font-display text-2xl font-bold">No such case file</h1>
      <p className="text-muted-foreground">This game does not exist, or you are not one of its two players.</p>
    </div>
  )
}
