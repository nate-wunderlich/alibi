import { describe, expect, it, vi } from 'vitest'
import { SETTINGS } from '../game/settings'
import { portraitPrompt, portraitsEnabled, runPortraits, type PortraitDeps } from './portraits'

const setting = SETTINGS[7] // The Siren's Light
const suspect = { name: 'Captain Roswell', description: 'A merchant captain who owed the keeper money.' }

describe('portraitPrompt', () => {
  const prompt = portraitPrompt(setting, suspect)

  it("names the suspect, their description, and the setting", () => {
    expect(prompt).toContain('Captain Roswell')
    expect(prompt).toContain('A merchant captain who owed the keeper money.')
    expect(prompt).toContain(setting.name)
  })

  it('asks for a head-and-shoulders illustrated portrait in one consistent style', () => {
    expect(prompt).toMatch(/head-and-shoulders/i)
    expect(prompt).toMatch(/illustrat/i)
    // The style sentence is fixed, so all four suspects share it.
    expect(portraitPrompt(setting, { name: 'X', description: 'Y' })).toContain(prompt.match(/Style: [^.]+\./)![0])
  })

  it('forbids text, letters, and logos, and stays family-friendly', () => {
    expect(prompt).toMatch(/no text, no words, no letters, no writing, no logos/i)
    expect(prompt).toMatch(/family-friendly/i)
  })
})

describe('portraitsEnabled', () => {
  it('is off under the dev server and tests (import.meta.env.DEV is true here)', () => {
    expect(import.meta.env.DEV).toBe(true)
    expect(portraitsEnabled()).toBe(false)
  })
})

/** Fakes for the cron context (records + integrations) and the upload helper. */
function fakeDeps(options: {
  cards: { recordId: string; name: string; imageUrl?: string }[]
  image?: (cardName: string) => string
  failFor?: string[]
}) {
  const cards = options.cards.map((c) => ({
    recordId: c.recordId,
    data: { roundId: 'r1', kind: 'suspect', name: c.name, description: `${c.name} has a motive.`, imageUrl: c.imageUrl ?? '' },
  }))
  const integrationCalls: { endpoint: string; params: Record<string, unknown> }[] = []
  const uploads: { userId: string; file: { base64: string; name: string; mimeType: string } }[] = []
  const updates: { collection: string; recordId: string; data: Record<string, unknown> }[] = []
  const queries: { collection: string; where?: Record<string, unknown> }[] = []

  const deps: PortraitDeps = {
    records: {
      query: vi.fn(async (collection: string, opts?: { where?: Record<string, unknown> }) => {
        queries.push({ collection, where: opts?.where })
        if (collection === 'rounds') return [{ recordId: 'r1', data: { settingId: setting.id } }]
        if (collection === 'cards') return cards
        return []
      }),
      create: vi.fn(),
      update: vi.fn(async (collection: string, recordId: string, data: Record<string, unknown>) => {
        updates.push({ collection, recordId, data })
        const card = cards.find((c) => c.recordId === recordId)
        if (card) Object.assign(card.data, data)
        return {}
      }),
      delete: vi.fn(),
    },
    integrations: {
      call: vi.fn(async (endpoint: string, params: Record<string, unknown> = {}) => {
        integrationCalls.push({ endpoint, params })
        const prompt = String(params.prompt)
        const card = cards.find((c) => prompt.includes(c.data.name))!
        if (options.failFor?.includes(card.data.name)) throw new Error(`generation failed for ${card.data.name}`)
        return { images: [options.image ? options.image(card.data.name) : 'data:image/png;base64,AAAA'], usage: {} }
      }),
    },
    upload: vi.fn(async (userId: string, file: { base64: string; name: string; mimeType: string }) => {
      uploads.push({ userId, file })
      return `/api/files/apps/app_T/${file.name}?scope=app`
    }),
  }
  return { deps, cards, integrationCalls, uploads, updates, queries }
}

const FOUR = [
  { recordId: 'c1', name: 'Captain Roswell' },
  { recordId: 'c2', name: 'Eliza Crow' },
  { recordId: 'c3', name: 'Thomas Wrenn' },
  { recordId: 'c4', name: 'Iris Strand' },
]

describe('runPortraits', () => {
  it("queries only the round's suspect cards, and generates one low-quality mini image per card", async () => {
    const f = fakeDeps({ cards: FOUR })
    await runPortraits(f.deps, { roundId: 'r1', hostId: 'host_1' })
    expect(f.queries.find((q) => q.collection === 'cards')?.where).toEqual({ roundId: 'r1', kind: 'suspect' })
    expect(f.integrationCalls).toHaveLength(4)
    for (const call of f.integrationCalls) {
      expect(call.endpoint).toBe('openai/generate-image')
      expect(call.params).toMatchObject({ model: 'gpt-image-1-mini', quality: 'low', n: 1 })
    }
  })

  it('uploads each image as the host and sets that card to the returned path', async () => {
    const f = fakeDeps({ cards: FOUR })
    await runPortraits(f.deps, { roundId: 'r1', hostId: 'host_1' })
    expect(f.uploads).toHaveLength(4)
    expect(f.uploads.every((u) => u.userId === 'host_1' && u.file.mimeType === 'image/png' && u.file.base64 === 'AAAA')).toBe(true)
    for (const card of f.cards) expect(card.data.imageUrl).toMatch(/^\/api\/files\/.+\?scope=app$/)
  })

  it('handles an https image (downloaded on the server) as well as a data URI', async () => {
    const fetchSpy = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/webp' } }))
    vi.stubGlobal('fetch', fetchSpy)
    try {
      const f = fakeDeps({ cards: FOUR.slice(0, 1), image: () => 'https://images.example/roswell.webp' })
      await runPortraits(f.deps, { roundId: 'r1', hostId: 'host_1' })
      expect(fetchSpy).toHaveBeenCalledWith('https://images.example/roswell.webp')
      expect(f.uploads[0].file.mimeType).toBe('image/webp')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('skips any card that already has an image, so it never pays twice', async () => {
    const f = fakeDeps({ cards: [...FOUR.slice(0, 3), { recordId: 'c4', name: 'Iris Strand', imageUrl: '/api/files/x?scope=app' }] })
    await runPortraits(f.deps, { roundId: 'r1', hostId: 'host_1' })
    expect(f.integrationCalls).toHaveLength(3)
    expect(f.integrationCalls.some((c) => String(c.params.prompt).includes('Iris Strand'))).toBe(false)
  })

  it('one failing card leaves the other three updated, then throws so the job retries', async () => {
    const f = fakeDeps({ cards: FOUR, failFor: ['Thomas Wrenn'] })
    await expect(runPortraits(f.deps, { roundId: 'r1', hostId: 'host_1' })).rejects.toThrow(/Thomas Wrenn|1 of 4/)
    const withImage = f.cards.filter((c) => c.data.imageUrl)
    expect(withImage.map((c) => c.data.name).sort()).toEqual(['Captain Roswell', 'Eliza Crow', 'Iris Strand'])
    expect(f.cards.find((c) => c.data.name === 'Thomas Wrenn')!.data.imageUrl).toBe('')
  })

  it('a retry after partial success calls the image integration only for the missing card', async () => {
    const f = fakeDeps({ cards: FOUR, failFor: ['Thomas Wrenn'] })
    await expect(runPortraits(f.deps, { roundId: 'r1', hostId: 'host_1' })).rejects.toThrow()
    // The retry sees the card store as the first attempt left it, now with no failures.
    const cardsAfterFirst = f.cards.map((c) => ({ recordId: c.recordId, name: c.data.name, imageUrl: c.data.imageUrl }))
    const second = fakeDeps({ cards: cardsAfterFirst })
    await runPortraits(second.deps, { roundId: 'r1', hostId: 'host_1' })
    expect(second.integrationCalls).toHaveLength(1)
    expect(String(second.integrationCalls[0].params.prompt)).toContain('Thomas Wrenn')
  })

  it('does nothing when every card already has an image', async () => {
    const f = fakeDeps({ cards: FOUR.map((c) => ({ ...c, imageUrl: '/api/files/done?scope=app' })) })
    await runPortraits(f.deps, { roundId: 'r1', hostId: 'host_1' })
    expect(f.integrationCalls).toHaveLength(0)
    expect(f.uploads).toHaveLength(0)
  })
})
