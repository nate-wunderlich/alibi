/**
 * The detective grid (SPEC.md "Detective grid"): the 12 cards down the side,
 * three columns (Me, Opponent, Envelope). Each cell is blank, has, doesn't,
 * or maybe.
 *
 * What the player provably knows is filled in and locked: their own hand,
 * the face-up card, and every card shown to them. Every other cell cycles on
 * tap (blank -> has -> doesn't -> maybe -> blank) and is saved to the
 * player's own `notes` row, which only they can read (R29).
 */

import { useRef, useState } from 'react'
import { useMutations, useQuery } from 'deepspace'
import { cn } from '@/lib/utils'
import { FileLabel, KIND_LABEL, KINDS } from './CardView'
import type { GameView, Round } from './useGameData'

type Column = 'me' | 'opponent' | 'envelope'
type Mark = '' | 'has' | 'no' | 'maybe'
type Marks = Record<string, Partial<Record<Column, Mark>>>

const COLUMNS: { id: Column; label: string }[] = [
  { id: 'me', label: 'Me' },
  { id: 'opponent', label: 'Opp.' },
  { id: 'envelope', label: 'Env.' },
]
const GLYPH: Record<Mark, string> = { '': '', has: '✓', no: '✗', maybe: '?' }
const SPOKEN: Record<Mark, string> = { '': 'blank', has: 'has it', no: "doesn't have it", maybe: 'maybe' }

/** The next mark on a tap: blank -> has -> doesn't -> maybe -> blank. */
function nextMark(mark: Mark): Mark {
  return mark === '' ? 'has' : mark === 'has' ? 'no' : mark === 'no' ? 'maybe' : ''
}

/**
 * What the player provably knows about a card, as locked cells:
 * - in my hand: I have it, so my opponent doesn't and it is not in the envelope;
 * - face up: nobody has it and it is not in the envelope;
 * - shown to me: my opponent has it, so I don't and it is not in the envelope.
 */
function provable(cardId: string, view: GameView, round: Round, shownIds: Set<string>): Partial<Record<Column, Mark>> {
  if (view.myHand.includes(cardId)) return { me: 'has', opponent: 'no', envelope: 'no' }
  if (cardId === round.faceUpCardId) return { me: 'no', opponent: 'no', envelope: 'no' }
  if (shownIds.has(cardId)) return { me: 'no', opponent: 'has', envelope: 'no' }
  return {}
}

export function DetectiveGrid({ view, round }: { view: GameView; round: Round }) {
  const notes = useQuery<{ roundId: string; marks: string }>('notes', { where: { roundId: round.id } })
  const { ready, createConfirmed, put } = useMutations<{ roundId: string; marks: string }>('notes')
  const row = notes.records[0]
  const saved: Marks = row ? (JSON.parse(row.data.marks) as Marks) : {}

  // My taps show at once; the saved row catches up through the subscription.
  const [local, setLocal] = useState<Marks | null>(null)
  const marks = local ?? saved
  const creating = useRef<Promise<string> | null>(null)
  const shownIds = new Set(view.shownToMe.values())

  /** Save the whole grid: update my row, or create it the first time (only once). */
  async function save(next: Marks) {
    const json = JSON.stringify(next)
    if (row) return put(row.recordId, { marks: json })
    if (creating.current) return put(await creating.current, { marks: json })
    creating.current = createConfirmed({ roundId: round.id, marks: json })
    await creating.current
  }

  function tap(cardId: string, column: Column) {
    const current = marks[cardId]?.[column] ?? ''
    const next: Marks = { ...marks, [cardId]: { ...marks[cardId], [column]: nextMark(current) } }
    setLocal(next)
    void save(next)
  }

  return (
    <div data-testid="detective-grid">
      <FileLabel>Detective grid · only you see this</FileLabel>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="text-muted-foreground">
            <th className="py-1 text-left font-normal">
              <span className="sr-only">Card</span>
            </th>
            {COLUMNS.map((c) => (
              <th key={c.id} className="w-12 py-1 text-center font-mono text-[11px] font-normal uppercase tracking-widest">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        {KINDS.map((kind) => (
          <tbody key={kind}>
            <tr>
              <th colSpan={4} className="pt-3 pb-1 text-left font-mono text-[10px] font-normal uppercase tracking-widest text-primary">
                {KIND_LABEL[kind]}s
              </th>
            </tr>
            {view.cards
              .filter((c) => c.kind === kind)
              .map((card) => {
                const known = provable(card.id, view, round, shownIds)
                const faceUp = card.id === round.faceUpCardId
                return (
                  <tr
                    key={card.id}
                    data-testid="grid-row"
                    data-card-id={card.id}
                    data-face-up={faceUp ? 'true' : 'false'}
                    className="border-t border-border"
                  >
                    <td className="py-1 pr-2 leading-tight">
                      {card.name}
                      {faceUp && <span className="ml-1 font-mono text-[10px] uppercase text-muted-foreground">face up</span>}
                    </td>
                    {COLUMNS.map((col) => {
                      const fixed = known[col.id] !== undefined
                      const mark: Mark = fixed ? known[col.id]! : (marks[card.id]?.[col.id] ?? '')
                      return (
                        <td key={col.id} className="p-0.5">
                          <button
                            type="button"
                            data-testid="grid-cell"
                            data-column={col.id}
                            data-mark={mark}
                            data-fixed={fixed ? 'true' : 'false'}
                            disabled={fixed || !ready}
                            onClick={() => tap(card.id, col.id)}
                            aria-label={`${card.name}, ${col.label}: ${SPOKEN[mark]}${fixed ? ' (known)' : ''}`}
                            className={cn(
                              'flex h-10 w-full items-center justify-center rounded-sm border font-mono text-base',
                              fixed
                                ? 'border-transparent bg-muted text-muted-foreground'
                                : 'border-border bg-card hover:bg-accent',
                              mark === 'has' && 'text-primary',
                            )}
                          >
                            {GLYPH[mark]}
                          </button>
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
          </tbody>
        ))}
      </table>
      <p className="mt-2 text-xs text-muted-foreground">
        Tap to cycle: ✓ has it, ✗ doesn&apos;t, ? maybe. Shaded cells are what you know for sure.
      </p>
    </div>
  )
}
