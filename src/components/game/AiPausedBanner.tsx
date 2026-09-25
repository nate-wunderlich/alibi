/**
 * R49: one plain line in a top strip when the AI was refused for lack of
 * credits for this round (rounds.aiPaused). Renders nothing otherwise.
 */
export function AiPausedBanner({ paused }: { paused: boolean }) {
  if (!paused) return null
  return (
    <p data-testid="ai-paused" role="status" className="text-[11px] leading-tight text-primary">
      AI features are paused: this demo&apos;s credits ran out. You&apos;re playing a built-in case.
    </p>
  )
}
