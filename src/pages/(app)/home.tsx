/* home pattern: search-first — the join-code box and "open a new case" come first, your open cases listed under them */

/**
 * /home: start a series (best of 3, 5, or 7) or join one by code, then pick
 * up any case you are already in. Signed-out visitors see the same controls
 * with a sign-in prompt in place of the actions.
 */

import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AuthOverlay, useAuthStatus, useQuery } from 'deepspace'
import { Button, Input, Label } from '@/components/ui'
import { cn } from '@/lib/utils'
import { useAction } from '@/lib/actions'
import { FileLabel, InlineError } from '../../components/game/CardView'
import type { GameData } from '../../components/game/useGameData'

const SERIES_LENGTHS = [3, 5, 7] as const

export default function HomePage() {
  const { isLoaded, isSignedIn } = useAuthStatus()
  const [signingIn, setSigningIn] = useState(false)

  return (
    <div className="mx-auto w-full max-w-[480px] space-y-8 px-4 py-8 text-foreground">
      <header>
        <h1 className="font-display text-4xl font-bold tracking-tight">Open a case</h1>
        <p className="mt-2 text-muted-foreground">
          Two detectives, one envelope. Start a series and share the code, or join your opponent&apos;s.
        </p>
        <Link
          data-testid="home-how-to-play"
          to="/how-to-play"
          className="mt-2 inline-block text-sm text-primary underline-offset-4 hover:underline"
        >
          How to play
        </Link>
      </header>

      {isLoaded && !isSignedIn ? (
        <div className="rounded-sm border border-border bg-card p-4">
          <p className="mb-3">Sign in to start or join a case.</p>
          <Button data-testid="home-sign-in" onClick={() => setSigningIn(true)}>
            Sign in
          </Button>
          {signingIn && <AuthOverlay onClose={() => setSigningIn(false)} />}
        </div>
      ) : (
        <>
          <JoinByCode />
          <CreateGame />
          <MyCases />
        </>
      )}
    </div>
  )
}

function CreateGame() {
  const [bestOf, setBestOf] = useState<3 | 5 | 7>(3)
  const create = useAction()
  const navigate = useNavigate()

  return (
    <section>
      <FileLabel>New series</FileLabel>
      <div role="radiogroup" aria-label="Series length" className="mb-3 grid grid-cols-3 gap-2">
        {SERIES_LENGTHS.map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={bestOf === n}
            data-testid={`best-of-${n}`}
            onClick={() => setBestOf(n)}
            className={cn(
              'rounded-sm border px-3 py-2 text-sm transition-colors',
              bestOf === n
                ? 'border-primary bg-card font-semibold text-foreground'
                : 'border-border text-muted-foreground hover:text-foreground',
            )}
          >
            Best of {n}
          </button>
        ))}
      </div>
      <Button
        data-testid="create-game"
        size="lg"
        className="w-full"
        loading={create.pending}
        onClick={async () => {
          const res = await create.run<{ gameId: string }>('createGame', { bestOf })
          if (res.success && res.data) navigate(`/game/${res.data.gameId}`)
        }}
      >
        Create the case file
      </Button>
      <InlineError message={create.error} />
    </section>
  )
}

function JoinByCode() {
  const [code, setCode] = useState('')
  const join = useAction()
  const navigate = useNavigate()
  const ready = code.trim().length === 6

  return (
    <section>
      <FileLabel>Join with a code</FileLabel>
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault()
          const res = await join.run<{ gameId: string }>('joinGame', { code })
          if (res.success && res.data) navigate(`/game/${res.data.gameId}`)
        }}
      >
        <Label htmlFor="join-code" className="sr-only">
          Join code
        </Label>
        <Input
          id="join-code"
          data-testid="join-code-input"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="6-character code"
          maxLength={6}
          autoComplete="off"
          className="font-mono tracking-[0.2em]"
        />
        <Button data-testid="join-game" type="submit" disabled={!ready} loading={join.pending}>
          Join
        </Button>
      </form>
      <InlineError message={join.error} />
    </section>
  )
}

/** Series I host or joined, newest first, so I can pick one back up. */
function MyCases() {
  const { userId } = useAuthStatus()
  const hosting = useQuery<GameData>('games', { where: { host: userId ?? '' }, orderBy: 'createdAt', orderDir: 'desc', limit: 5 })
  const joined = useQuery<GameData>('games', { where: { guest: userId ?? '' }, orderBy: 'createdAt', orderDir: 'desc', limit: 5 })
  const mine = [...hosting.records, ...joined.records]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 5)

  if (mine.length === 0) return null
  const statusText = (g: GameData) =>
    g.status === 'lobby' ? 'In the lobby' : g.status === 'finished' ? 'Closed' : `Case ${g.currentRound} in play`

  return (
    <section>
      <FileLabel>Your cases</FileLabel>
      <ul className="space-y-2">
        {mine.map((g) => (
          <li key={g.recordId}>
            <Link
              to={`/game/${g.recordId}`}
              className="flex items-center justify-between rounded-sm border border-border bg-card px-3 py-2 hover:bg-accent"
            >
              <span>
                Best of {g.data.bestOf} · {g.data.scoreHost}–{g.data.scoreGuest}
              </span>
              <span className="text-sm text-muted-foreground">{statusText(g.data)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
