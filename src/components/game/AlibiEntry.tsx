/**
 * One alibi in the round log (R41, R43): an "Alibi" label, the card's name,
 * and beside it the in-setting text. The text may call its card by a short
 * form or a pronoun, so the name is always shown here.
 */
export function AlibiEntry({ cardId, cardName, text }: { cardId: string; cardName: string; text: string }) {
  return (
    <li
      data-testid="round-alibi"
      data-card-id={cardId}
      className="rounded-sm border border-primary/60 bg-primary/5 px-3 py-2 text-sm"
    >
      <span className="font-mono text-[11px] uppercase tracking-widest text-primary">Alibi</span>{' '}
      <span data-testid="round-alibi-card" className="font-semibold">
        {cardName}
      </span>{' '}
      is cleared.
      <p className="mt-1 border-l-2 border-primary pl-3 font-display italic leading-relaxed">{text}</p>
    </li>
  )
}
