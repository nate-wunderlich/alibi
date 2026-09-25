import { describe, expect, it, vi } from 'vitest'
import { creditsWatch, recordAiPaused } from './aiPaused'

describe('the round-level aiPaused writer (R49)', () => {
  it('sets aiPaused on the round only when a call was refused for credits', async () => {
    const update = vi.fn(async () => ({}))
    const watch = creditsWatch()
    await recordAiPaused(update, 'r1', watch)
    expect(update).not.toHaveBeenCalled()
    watch.onCreditsPaused()
    await recordAiPaused(update, 'r1', watch)
    expect(update).toHaveBeenCalledWith('r1', { aiPaused: 1 })
  })
})
