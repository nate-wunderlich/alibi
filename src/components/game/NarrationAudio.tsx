/**
 * A narration clip (R36): one <audio> element and a Play/Pause button.
 * With autoplay, it tries to start as soon as the clip arrives; browsers may
 * refuse to play before the user has interacted, and then the Play button is
 * all there is. No autoplay for the opening (the player chooses).
 *
 * R47: useNarration splits the two, so a screen with steps can keep the
 * <audio> mounted (autoplay on arrival still works whichever step is open)
 * and show the button only on its own step.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui'

export interface Narration {
  /** The <audio> element; keep it mounted. */
  element: ReactNode
  /** The Play/Pause button; show it wherever it belongs. */
  button: (label: string, testId: string) => ReactNode
}

export function useNarration(src: string, autoplay = false): Narration {
  const audio = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)

  // Try to autoplay when the clip arrives (or changes); if the browser says no, the button stays.
  useEffect(() => {
    if (!autoplay || !src || !audio.current) return
    audio.current.play().catch(() => setPlaying(false))
  }, [autoplay, src])

  const toggle = () => {
    const el = audio.current
    if (!el) return
    if (el.paused) void el.play().catch(() => setPlaying(false))
    else el.pause()
  }

  return {
    element: src ? (
      <audio
        ref={audio}
        src={src}
        preload="auto"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
    ) : null,
    button: (label, testId) =>
      src ? (
        <Button data-testid={testId} variant="link" className="h-auto px-0" onClick={toggle}>
          {playing ? 'Pause' : label}
        </Button>
      ) : null,
  }
}

export function NarrationAudio({
  src,
  label,
  autoplay = false,
  testId,
}: {
  src: string
  label: string
  autoplay?: boolean
  testId: string
}) {
  const narration = useNarration(src, autoplay)
  return (
    <span className="inline-flex items-center">
      {narration.element}
      {narration.button(label, testId)}
    </span>
  )
}
