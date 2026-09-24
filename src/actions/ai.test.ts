import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { askForCase, askForJson, CASE_ATTEMPTS, type IntegrationCaller } from './ai'
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
