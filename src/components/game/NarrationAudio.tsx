/**
 * A narration clip (R36): one <audio> element and a Play/Pause button.
 * With autoplay, it tries to start as soon as the clip arrives; browsers may
 * refuse to play before the user has interacted, and then the Play button is
 * all there is. No autoplay for the opening (the player chooses).
 */

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui'

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
  const audio = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)

  // Try to autoplay when the clip arrives (or changes); if the browser says no, the button stays.
  useEffect(() => {
    if (!autoplay || !audio.current) return
    audio.current.play().catch(() => setPlaying(false))
  }, [autoplay, src])

  const toggle = () => {
    const el = audio.current
    if (!el) return
    if (el.paused) void el.play().catch(() => setPlaying(false))
    else el.pause()
  }

  return (
    <span className="inline-flex items-center">
      <audio
        ref={audio}
        src={src}
        preload="auto"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
      <Button data-testid={testId} variant="link" className="h-auto px-0" onClick={toggle}>
        {playing ? 'Pause' : label}
      </Button>
    </span>
  )
}
