/**
 * How a card looks: a paper tag with its kind, name, and (optionally) its
 * one-sentence description. Suspects get a stamped initials block where a
 * portrait will go.
 */

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { CardKind } from '../../game/rules'
import type { Card } from './useGameData'

export const KIND_LABEL: Record<CardKind, string> = { suspect: 'Suspect', weapon: 'Method', location: 'Place' }
export const KINDS: CardKind[] = ['suspect', 'weapon', 'location']

/** Up to two initials from a name, skipping "The" and "A". */
function initials(name: string): string {
  const words = name.split(/\s+/).filter((w) => !/^(the|a|an)$/i.test(w))
  return words
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
}

export function CardView({
  card,
  detailed = false,
  note,
  className,
  ...props
}: {
  card: Card | undefined
  detailed?: boolean
  note?: ReactNode
  className?: string
  'data-testid'?: string
  'data-card-id'?: string
}) {
  if (!card) return <div className={cn('h-14 animate-pulse rounded-sm bg-muted', className)} {...props} />
  return (
    <div className={cn('flex gap-3 rounded-sm border border-border bg-card p-3', className)} {...props}>
      {card.kind === 'suspect' && <SuspectFace card={card} size={detailed ? 'h-16 w-16' : 'h-12 w-12'} />}
      <div className="min-w-0 flex-1">
        <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{KIND_LABEL[card.kind]}</div>
        <div className="font-semibold leading-snug text-foreground">{card.name}</div>
        {detailed && <p className="mt-0.5 text-sm text-muted-foreground">{card.description}</p>}
        {note && <div className="mt-1 text-xs text-primary">{note}</div>}
      </div>
    </div>
  )
}

/**
 * A suspect's portrait (R35) once the background job has painted it, or the
 * stamped initials until then. Both fill the same fixed box, so nothing on the
 * page moves when the picture arrives.
 */
function SuspectFace({ card, size }: { card: Card; size: string }) {
  const box = cn('shrink-0 overflow-hidden rounded-sm border border-border bg-muted', size)
  if (card.imageUrl) {
    return <img src={card.imageUrl} loading="lazy" alt={card.name} className={cn(box, 'object-cover')} />
  }
  return (
    <div aria-hidden className={cn(box, 'flex items-center justify-center font-display text-lg font-bold text-muted-foreground')}>
      {initials(card.name)}
    </div>
  )
}

/** A section heading in the case-file style: small caps label with a rule under it. */
export function FileLabel({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-2 border-b border-border pb-1 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
      {children}
    </h2>
  )
}

/** An inline error in plain words. */
export function InlineError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p role="alert" className="mt-2 text-sm text-destructive">
      {message}
    </p>
  )
}
