/**
 * Dev-only probe for the secrecy test (tests/secrecy.spec.ts): /dev/records?round=<id>
 *
 * Two rules keep it harmless:
 * 1. It only renders what useQuery('hands') and useQuery('solution') return
 *    for the signed-in user, filtered to one round. That is exactly what the
 *    server already sends this browser; the page reveals nothing extra, and it
 *    never calls an action.
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
  const hands = useQuery('hands', { where: { roundId } })
  const solution = useQuery('solution', { where: { roundId } })

  return (
    <div className="p-6 font-mono text-xs">
      <h1 className="mb-4 text-base font-semibold">Records visible to this browser, round {roundId}</h1>
      <h2>hands</h2>
      <pre data-testid="hands" data-status={hands.status}>
        {JSON.stringify(hands.records, null, 2)}
      </pre>
      <h2>solution</h2>
      <pre data-testid="solution" data-status={solution.status}>
        {JSON.stringify(solution.records, null, 2)}
      </pre>
    </div>
  )
}
