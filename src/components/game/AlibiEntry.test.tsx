import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AlibiEntry } from './AlibiEntry'

describe('AlibiEntry (R43: the card name beside the alibi)', () => {
  it('renders the Alibi label, the card name, and the text, the name before the text', () => {
    const html = renderToStaticMarkup(
      <AlibiEntry cardId="c7" cardName="Dr. Harrison Ashford" text="He was on a video call all morning." />,
    )
    expect(html).toContain('data-testid="round-alibi"')
    expect(html).toContain('data-card-id="c7"')
    expect(html).toContain('Alibi')
    expect(html).toContain('data-testid="round-alibi-card"')
    const name = html.indexOf('Dr. Harrison Ashford')
    const text = html.indexOf('He was on a video call all morning.')
    expect(name).toBeGreaterThan(-1)
    expect(text).toBeGreaterThan(name)
  })
})
