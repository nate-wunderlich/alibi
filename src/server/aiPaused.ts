/**
 * R49: when the AI is refused for lack of credits, the round is flagged
 * (rounds.aiPaused = 1, public) so the screens can say so plainly. Only an
 * "Insufficient credits" refusal sets it (isCreditsError in src/actions/ai.ts),
 * never a validation failure; each round starts unflagged.
 */

/** Collects whether any AI or speech call for a round was refused for credits. */
export function creditsWatch() {
  let paused = false
  return {
    onCreditsPaused: () => {
      paused = true
    },
    get paused() {
      return paused
    },
  }
}

export type CreditsWatch = ReturnType<typeof creditsWatch>

/** Flag the round when (and only when) the watch saw a credits refusal. */
export async function recordAiPaused(
  update: (roundId: string, data: { aiPaused: number }) => Promise<unknown>,
  roundId: string,
  watch: { paused: boolean },
): Promise<void> {
  if (watch.paused) await update(roundId, { aiPaused: 1 })
}
