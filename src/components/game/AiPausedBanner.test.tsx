import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AiPausedBanner } from './AiPausedBanner'

describe('AiPausedBanner (R49)', () => {
  it('renders the plain line when the round is flagged', () => {
    const html = renderToStaticMarkup(<AiPausedBanner paused />)
    expect(html).toContain('data-testid="ai-paused"')
    expect(html).toContain('AI features are paused: this demo&#x27;s credits ran out. You&#x27;re playing a built-in case.')
  })

  it('renders nothing otherwise', () => {
    expect(renderToStaticMarkup(<AiPausedBanner paused={false} />)).toBe('')
  })
})
