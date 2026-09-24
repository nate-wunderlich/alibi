/**
 * Design Direction
 *
 * Product: a two-player detective duel for friends on their phones; every
 *   round is a freshly written case, and each player's cards stay secret.
 * Emotion: the hush when a sealed envelope slides across the table and both
 *   players lean in.
 * Metaphor: a manila case file on a dark desk under one lamp, a red
 *   evidence stamp across the envelope.
 * References: 1940s police evidence tags, Penguin crime paperback covers,
 *   the typewritten dossier props in noir films.
 * Signature: the sealed envelope, stamped in red, that holds the solution.
 * Hero: the envelope sits under the wordmark; its stamp settles in once on
 *   load (off for reduced motion).
 *
 * Style Tile
 * - Color: warm near-black desk + aged-paper text + one stamp-red accent; low saturation.
 * - Type: Fraunces (heading) + Source Sans 3 (body): the case title needs warmth, the clues need to disappear.
 * - Theme: dark, because the game is played in the lamplight of a case file, not in daylight.
 * - Art direction: code-built props (paper, stamps, tags) instead of images.
 * - Motion: a single, slow settle; nothing loops.
 * - Voice: second person; short declarative lines; never says "we".
 *
 * This page is STATIC: it lives at the top level of src/pages/, so it mounts
 * no DeepSpace providers (no auth call, no realtime connection). The app
 * itself is behind "Enter the app".
 */

import { Link } from 'react-router-dom'
import { APP_NAME } from '../constants'

export default function Landing() {
  return (
    <div
      data-testid="static-landing"
      className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-16 text-center text-foreground"
    >
      <h1 className="font-display text-7xl font-bold tracking-tight sm:text-8xl">{APP_NAME}</h1>
      <p className="mt-4 max-w-sm text-base text-muted-foreground">
        A two-player detective duel. Every round is a new case, and your cards stay secret.
      </p>

      <SealedEnvelope />

      <Link
        to="/home"
        className="mt-10 inline-flex items-center rounded-sm bg-primary px-6 py-3 text-base font-semibold text-primary-foreground transition-opacity hover:opacity-90"
      >
        Enter the app
      </Link>
    </div>
  )
}

/** The signature prop: a manila-style envelope with a red "sealed" stamp, built in markup, not an image. */
function SealedEnvelope() {
  return (
    <div aria-hidden className="relative mt-12 h-40 w-64 rounded-sm border border-border bg-card shadow-xl">
      {/* Flap: a triangle from both top corners to a point at the center (POLISH: it was a rotated box, off-center and clipped). */}
      <svg className="absolute inset-x-0 top-0 h-20 w-full" viewBox="0 0 256 80" preserveAspectRatio="none">
        <polygon
          points="0,0 256,0 128,80"
          className="fill-muted stroke-border"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="absolute bottom-4 left-4 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
        Case file · envelope
      </div>
      <div className="stamp-settle absolute right-5 top-14 -rotate-12 rounded-sm border-2 border-primary px-3 py-1 font-mono text-sm font-medium uppercase tracking-widest text-primary">
        Sealed
      </div>
    </div>
  )
}
