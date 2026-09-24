import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ALIBI_RETRY_OVER, askForAlibis, askForCase, askForJson, CASE_ATTEMPTS, type IntegrationCaller } from './ai'
import { PRESET_CASE } from '../game/presetCase'
import { SETTINGS } from '../game/settings'

/** A fake text integration that replies with the scripted texts in order and records each request. */
function fakeModel(replies: string[]) {
  const requests: { messages: { role: string; content: string }[] }[] = []
  const tools: IntegrationCaller = {
    integration: vi.fn(async (_endpoint: string, data?: unknown) => {
      requests.push(data as { messages: { role: string; content: string }[] })
      return { success: true as const, data: { content: [{ type: 'text', text: replies.shift() ?? '' }] } as never }
    }),
  }
  return { tools, requests }
}

const prompt = { system: 'You write things.', user: 'Write a thing as JSON.' }
const check = (v: unknown) =>
  (v as { n?: number })?.n === 2 ? { ok: true as const, value: 2 } : { ok: false as const, errors: ['n must be 2, got something else.'] }

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('askForJson retries (R38)', () => {
  it('sends the exact validation errors back on the retry', async () => {
    const { tools, requests } = fakeModel(['{"n": 1}', '{"n": 2}'])
    expect(await askForJson(tools, 'test', prompt, check, 100)).toBe(2)
    expect(requests).toHaveLength(2)
    const retry = requests[1].messages
    expect(retry[0]).toEqual({ role: 'user', content: prompt.user })
    expect(retry[1]).toEqual({ role: 'assistant', content: '{"n": 1}' })
    expect(retry[2].role).toBe('user')
    expect(retry[2].content).toContain('n must be 2, got something else.')
  })

  it('says so when the first reply was not JSON', async () => {
    const { tools, requests } = fakeModel(['not json at all', '{"n": 2}'])
    expect(await askForJson(tools, 'test', prompt, check, 100)).toBe(2)
    expect(requests[1].messages.at(-1)?.content).toMatch(/not valid JSON/i)
  })

  it('the first call sends only the prompt', async () => {
    const { tools, requests } = fakeModel(['{"n": 2}'])
    await askForJson(tools, 'test', prompt, check, 100)
    expect(requests[0].messages).toEqual([{ role: 'user', content: prompt.user }])
  })

  it('reports how many calls it took, and null after two failures', async () => {
    const report = vi.fn()
    const { tools } = fakeModel(['{"n": 1}', '{"n": 3}'])
    expect(await askForJson(tools, 'test', prompt, check, 100, { report })).toBeNull()
    expect(report).toHaveBeenCalledWith({ attempts: 2, ok: false })
  })
})

describe('attempts (R40)', () => {
  it('defaults to 2 calls', async () => {
    const { tools, requests } = fakeModel(['{"n": 1}', '{"n": 1}', '{"n": 2}'])
    expect(await askForJson(tools, 'test', prompt, check, 100)).toBeNull()
    expect(requests).toHaveLength(2)
  })

  it('makes up to `attempts` calls and reports the one that passed', async () => {
    const report = vi.fn()
    const { tools, requests } = fakeModel(['{"n": 1}', '{"n": 1}', '{"n": 2}'])
    expect(await askForJson(tools, 'test', prompt, check, 100, { attempts: 3, report })).toBe(2)
    expect(requests).toHaveLength(3)
    expect(report).toHaveBeenCalledWith({ attempts: 3, ok: true })
  })
})

/** A case reply as the AI would send it; `twist` changes one description. */
function caseReply(description = 'A calm pilot.'): string {
  const cards = (p: string) => [1, 2, 3, 4].map((n) => ({ name: `${p} ${n}`, description }))
  return JSON.stringify({
    title: 'The Airlock Affair',
    victim: 'Chief Engineer Vale',
    openingParts: {
      scene: 'The alarm stopped. Nobody could say who opened the airlock.',
      creditHost: 'The host heard the hull groan.',
      creditGuest: 'The guest found the bay door sealed.',
      hook: 'So who wanted the engineer silenced?',
    },
    suspects: cards('Suspect'),
    weapons: cards('Method'),
    locations: cards('Place'),
  })
}

describe('askForCase (R40: the case path)', () => {
  const setting = SETTINGS[1]

  it('allows 3 attempts before the fallback', async () => {
    expect(CASE_ATTEMPTS).toBe(3)
    const { tools, requests } = fakeModel([caseReply('Covered in blood.'), caseReply('A gory past.'), caseReply()])
    const result = await askForCase(tools, 'case', setting, [], [], [])
    expect(result?.title).toBe('The Airlock Affair')
    expect(requests).toHaveLength(3)
  })

  it('returns null after 3 failures', async () => {
    const { tools, requests } = fakeModel([caseReply('blood'), caseReply('blood'), caseReply('blood'), caseReply()])
    expect(await askForCase(tools, 'case', setting, [], [], [])).toBeNull()
    expect(requests).toHaveLength(3)
  })

  it('substitutes a player name token in code without spending a retry', async () => {
    const { tools, requests } = fakeModel([caseReply('Owes Nate money.')])
    const result = await askForCase(tools, 'case', setting, [], [], ['Nate Wunderlich'])
    expect(requests).toHaveLength(1)
    expect(result).not.toBeNull()
    expect(JSON.stringify(result)).not.toMatch(/\bNate\b/)
  })
})

describe('askForAlibis (R43: card by card)', () => {
  const setting = SETTINGS[1]
  const cards = PRESET_CASE.cards
  /** A reply by number; the listed numbers get a graphic (invalid) alibi. */
  const alibiReply = (badNumbers: number[]) =>
    JSON.stringify({
      alibis: cards.map((_, i) => ({
        n: i + 1,
        alibi: badNumbers.includes(i + 1) ? 'It was covered in blood.' : `Witnesses cleared card ${i + 1} all night.`,
      })),
    })

  it('retries only when more than 3 are invalid', () => {
    expect(ALIBI_RETRY_OVER).toBe(3)
  })

  it('2 invalid entries: 10 AI alibis and 2 templates (null), no retry', async () => {
    const { tools, requests } = fakeModel([alibiReply([2, 7])])
    const texts = await askForAlibis(tools, 'alibis', setting, cards, [])
    expect(requests).toHaveLength(1)
    expect(texts.filter((t) => t !== null)).toHaveLength(10)
    expect(texts[1]).toBeNull()
    expect(texts[6]).toBeNull()
    expect(texts[0]).toBe('Witnesses cleared card 1 all night.')
  })

  it('5 invalid entries: one retry that feeds back the per-number errors, then keeps what is valid', async () => {
    const { tools, requests } = fakeModel([alibiReply([1, 3, 5, 7, 9]), alibiReply([3])])
    const texts = await askForAlibis(tools, 'alibis', setting, cards, [])
    expect(requests).toHaveLength(2)
    const feedback = requests[1].messages.at(-1)?.content ?? ''
    for (const n of [1, 3, 5, 7, 9]) expect(feedback).toContain(`Alibi ${n} `)
    expect(texts.filter((t) => t !== null)).toHaveLength(11)
    expect(texts[2]).toBeNull()
  })

  it('never retries more than once, and still keeps the valid ones', async () => {
    const { tools, requests } = fakeModel([alibiReply([1, 2, 3, 4, 5]), alibiReply([1, 2, 3, 4, 5, 6]), alibiReply([])])
    const texts = await askForAlibis(tools, 'alibis', setting, cards, [])
    expect(requests).toHaveLength(2)
    expect(texts.filter((t) => t !== null)).toHaveLength(7)
  })

  it('a missing n keeps that card on its template', async () => {
    const reply = JSON.parse(alibiReply([])) as { alibis: { n: number }[] }
    reply.alibis = reply.alibis.filter((a) => a.n !== 4)
    const { tools } = fakeModel([JSON.stringify(reply)])
    const texts = await askForAlibis(tools, 'alibis', setting, cards, [])
    expect(texts[3]).toBeNull()
    expect(texts.filter((t) => t !== null)).toHaveLength(11)
  })
})
