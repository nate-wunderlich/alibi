/**
 * Dev-only probe for the multi-user tests (tests/secrecy.spec.ts, tests/round.spec.ts):
 *   /dev/records?round=<roundId>&game=<gameId>
 *
 * Two rules keep it harmless:
 * 1. It only renders what useQuery returns for the signed-in user (one
 *    round's hands, solution, cards, guesses, shown cards, notes, questions,
 *    answers, and alibi texts; one game's
 *    join codes and rounds; and the latest games). That is exactly what the
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
  const gameId = params.get('game') ?? ''

  const sections = [
    ['hands', useQuery('hands', { where: { roundId } })],
    ['solution', useQuery('solution', { where: { roundId } })],
    ['join_codes', useQuery('join_codes', { where: { gameId } })],
    ['games', useQuery('games', { orderBy: 'createdAt', orderDir: 'desc', limit: 50 })],
    ['rounds', useQuery('rounds', { where: { gameId } })],
    ['cards', useQuery('cards', { where: { roundId } })],
    ['guesses', useQuery('guesses', { where: { roundId } })],
    ['shown_cards', useQuery('shown_cards', { where: { roundId } })],
    ['notes', useQuery('notes', { where: { roundId } })],
    ['questions', useQuery('questions', { where: { roundId } })],
    ['answers', useQuery('answers', { where: { roundId } })],
    ['alibiTexts', useQuery('alibiTexts', { where: { roundId } })],
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
