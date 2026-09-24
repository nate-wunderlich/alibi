import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { askForJson, type IntegrationCaller } from './ai'

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
    expect(await askForJson(tools, 'test', prompt, check, 100, report)).toBeNull()
    expect(report).toHaveBeenCalledWith({ attempts: 2, ok: false })
  })
})
