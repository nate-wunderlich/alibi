/**
 * Dev-only probe for the secrecy test (tests/secrecy.spec.ts):
 *   /dev/records?round=<roundId>&game=<gameId>
 *
 * Two rules keep it harmless:
 * 1. It only renders what useQuery returns for the signed-in user (hands and
 *    solution for one round, join codes for one game, and the latest games).
 *    That is exactly what the server already sends this browser; the page
 *    reveals nothing extra, and it never calls an action.
 * 2. It renders "Not found" unless import.meta.env.DEV is true, so on the
 *    live site (a production build) it is inert.
 */

import { useSearchParams } from 'react-router-dom'
import { useQuery } from 'deepspace'

export default function DevRecordsPage() {
  if (!import.meta.env.DEV) return <p className="p-6">Not found</p>
  return <Probe />
}

function Probe() {
  const [params] = useSearchParams()
  const roundId = params.get('round') ?? ''
  const gameId = params.get('game') ?? ''
  const hands = useQuery('hands', { where: { roundId } })
  const solution = useQuery('solution', { where: { roundId } })
  const joinCodes = useQuery('join_codes', { where: { gameId } })
  const games = useQuery('games', { orderBy: 'createdAt', orderDir: 'desc', limit: 50 })

  const sections = [
    ['hands', hands],
    ['solution', solution],
    ['join_codes', joinCodes],
    ['games', games],
  ] as const

  return (
    <div className="p-6 font-mono text-xs">
      <h1 className="mb-4 text-base font-semibold">
        Records visible to this browser (round {roundId}, game {gameId})
      </h1>
      {sections.map(([name, result]) => (
        <section key={name}>
          <h2>{name}</h2>
          <pre data-testid={name} data-status={result.status}>
            {JSON.stringify(result.records, null, 2)}
          </pre>
        </section>
      ))}
    </div>
  )
}
