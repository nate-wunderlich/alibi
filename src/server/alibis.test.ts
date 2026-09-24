import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { templateAlibi } from '../game/alibis'
import { PRESET_CASE } from '../game/presetCase'
import { SETTINGS } from '../game/settings'
import { runAlibis, type AlibiDeps } from './alibis'

const setting = SETTINGS[7]
const cards = PRESET_CASE.cards.map((c, i) => ({ recordId: `c${i + 1}`, data: c }))

function fakeDeps(reply: string) {
  const texts = cards.map((c) => ({ recordId: `t-${c.recordId}`, data: { cardId: c.recordId, text: templateAlibi(c.data) } }))
  const queried: string[] = []
  const prompts: string[] = []
  const deps: AlibiDeps = {
    records: {
      query: vi.fn(async (collection: string) => {
        queried.push(collection)
        if (collection === 'rounds') return [{ recordId: 'r1', data: { settingId: setting.id, gameId: 'g1' } }]
        if (collection === 'cards') return cards
        if (collection === 'alibiTexts') return texts
        if (collection === 'players') return [{ recordId: 'p1', data: { displayName: 'Sam Porter' } }]
        return []
      }),
      create: vi.fn(),
      update: vi.fn(async (_collection: string, id: string, data: Record<string, unknown>) => {
        const row = texts.find((t) => t.recordId === id)!
        row.data.text = String(data.text)
        return {}
      }),
      delete: vi.fn(),
    },
    integrations: {
      call: vi.fn(async (_endpoint: string, params: Record<string, unknown> = {}) => {
        prompts.push(JSON.stringify(params))
        return { content: [{ type: 'text', text: reply }] }
      }),
    } as unknown as AlibiDeps['integrations'],
  }
  return { deps, texts, queried, prompts }
}

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('runAlibis (R41)', () => {
  const good = JSON.stringify({
    alibis: cards.map((c) => ({ card: c.data.name, alibi: `${c.data.name} was seen by the harbor watch all night.` })),
  })

  it("overwrites the templates with the AI's alibis, and never reads the solution", async () => {
    const { deps, texts, queried } = fakeDeps(good)
    expect(await runAlibis(deps, { roundId: 'r1' })).toEqual({ written: 12 })
    for (const t of texts) expect(t.data.text).toMatch(/harbor watch/)
    expect(queried).not.toContain('solution')
  })

  it('keeps the templates when the AI fails twice', async () => {
    const { deps, texts } = fakeDeps('not json')
    expect(await runAlibis(deps, { roundId: 'r1' })).toEqual({ written: 0 })
    for (const t of texts) expect(t.data.text).toBe(templateAlibi(cards.find((c) => c.recordId === t.data.cardId)!.data))
  })

  it('never sends a player name to the AI', async () => {
    const { deps, prompts } = fakeDeps(good)
    await runAlibis(deps, { roundId: 'r1' })
    expect(prompts.join(' ')).not.toMatch(/\bSam\b|\bPorter\b/)
  })

  it('does not pay again once every text has been written', async () => {
    const { deps } = fakeDeps(good)
    await runAlibis(deps, { roundId: 'r1' })
    expect(await runAlibis(deps, { roundId: 'r1' })).toEqual({ written: 0 })
    expect(deps.integrations.call).toHaveBeenCalledTimes(1)
  })
})
