import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SETTINGS } from '../game/settings'
import {
  CONFESSION_MAX,
  confessionPrompt,
  runConfession,
  runOpening,
  templateConfession,
  validateConfession,
  type NarrationDeps,
} from './narration'

const setting = SETTINGS[7] // The Siren's Light
const culprit = { name: 'Captain Roswell', description: 'A merchant captain who owed the keeper money.' }
const method = { name: 'Frayed Rope', description: 'A rope cut halfway through.' }
const place = { name: 'The Cellar', description: 'Damp, dark, and full of barrels.' }

describe('templateConfession', () => {
  it('names the culprit, the method, and the place', () => {
    const text = templateConfession({ culprit: culprit.name, method: method.name, place: place.name })
    expect(text).toContain('Captain Roswell')
    expect(text).toContain('Frayed Rope')
    expect(text).toContain('The Cellar')
  })
})

describe('confessionPrompt', () => {
  const prompt = confessionPrompt({
    title: "The Keeper's Final Watch",
    victim: 'Aldus Thorne, the lighthouse keeper',
    settingName: setting.name,
    culprit,
    method,
    place,
  })
  const text = prompt.system + prompt.user

  it('gives the AI the solution and the case', () => {
    for (const piece of [
      "The Keeper's Final Watch",
      'Aldus Thorne, the lighthouse keeper',
      setting.name,
      culprit.name,
      culprit.description,
      method.name,
      place.name,
    ]) {
      expect(text).toContain(piece)
    }
  })

  it('asks for a family-friendly first-person confession of about 60-80 words, as JSON', () => {
    expect(text).toMatch(/first person/i)
    expect(text).toMatch(/60.{1,4}80 words/)
    expect(text).toMatch(/family-friendly/i)
    expect(text).toMatch(/JSON/)
  })
})

describe('validateConfession', () => {
  const good = `I am Captain Roswell, and I did it. I cut the Frayed Rope in The Cellar because I owed the keeper more than I could ever repay.`

  it('accepts a confession that names the culprit', () => {
    expect(validateConfession({ confession: good }, culprit.name)).toEqual({ ok: true, value: good })
  })

  it('rejects over-length text, graphic terms, and text that does not name the culprit', () => {
    expect(validateConfession({ confession: `Captain Roswell ${'x'.repeat(CONFESSION_MAX)}` }, culprit.name).ok).toBe(false)
    expect(validateConfession({ confession: `${good} There was blood everywhere.` }, culprit.name).ok).toBe(false)
    expect(validateConfession({ confession: 'I did it, and I am not sorry.' }, culprit.name).ok).toBe(false)
    expect(validateConfession({ nope: good }, culprit.name).ok).toBe(false)
    expect(validateConfession(null, culprit.name).ok).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Fakes for the job runners
// ---------------------------------------------------------------------------

type Round = Record<string, unknown>

function fakeDeps(options: {
  round?: Round
  aiReplies?: (string | Error)[]
  ttsFails?: boolean
}) {
  const round: Round = {
    caseTitle: "The Keeper's Final Watch",
    victim: 'Aldus Thorne',
    settingId: setting.id,
    openingNarration: 'The storm had not let up for three days.',
    openingAudioUrl: '',
    revealedSolution: JSON.stringify({ suspect: 'c1', weapon: 'c5', location: 'c9' }),
    confession: templateConfession({ culprit: culprit.name, method: method.name, place: place.name }),
    confessionAudioUrl: '',
    ...options.round,
  }
  const cards = [
    { recordId: 'c1', data: { kind: 'suspect', ...culprit } },
    { recordId: 'c5', data: { kind: 'weapon', ...method } },
    { recordId: 'c9', data: { kind: 'location', ...place } },
  ]
  const aiReplies = [...(options.aiReplies ?? [])]
  const calls: { endpoint: string; params: Record<string, unknown> }[] = []
  const updates: Record<string, unknown>[] = []
  const uploads: { userId: string; name: string; mimeType: string }[] = []

  const deps: NarrationDeps = {
    records: {
      query: vi.fn(async (collection: string) => {
        if (collection === 'rounds') return [{ recordId: 'r1', data: round }]
        if (collection === 'cards') return cards
        return []
      }),
      create: vi.fn(),
      update: vi.fn(async (_collection: string, _id: string, data: Record<string, unknown>) => {
        updates.push(data)
        Object.assign(round, data)
        return {}
      }),
      delete: vi.fn(),
    },
    integrations: {
      call: vi.fn(async (endpoint: string, params: Record<string, unknown> = {}) => {
        calls.push({ endpoint, params })
        if (endpoint === 'speech/text-to-speech') {
          if (options.ttsFails) throw new Error('tts is down')
          return { audioUrl: 'data:audio/mpeg;base64,SUQz', model: 'tts-1', voice: 'fable', response_format: 'mp3', usage: {} }
        }
        const next = aiReplies.shift() ?? new Error('no reply scripted')
        if (next instanceof Error) throw next
        return { content: [{ type: 'text', text: next }] }
      }),
    },
    upload: vi.fn(async (userId: string, file: { base64: string; name: string; mimeType: string }) => {
      uploads.push({ userId, name: file.name, mimeType: file.mimeType })
      return `/api/files/apps/app_T/${file.name}?scope=app`
    }),
  }
  const tts = () => calls.filter((c) => c.endpoint === 'speech/text-to-speech')
  const ai = () => calls.filter((c) => c.endpoint === 'anthropic/chat-completion')
  return { deps, round, calls, updates, uploads, tts, ai }
}

const aiConfession = JSON.stringify({
  confession: 'I am Captain Roswell. I frayed that rope in The Cellar myself, because the keeper knew about my debts.',
})

let logs: string[]
beforeEach(() => {
  logs = []
  vi.spyOn(console, 'info').mockImplementation((...args: unknown[]) => void logs.push(args.join(' ')))
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => void logs.push(args.join(' ')))
})
afterEach(() => vi.restoreAllMocks())

describe('runOpening', () => {
  it('voices the opening with tts-1 / fable / mp3 as the host and sets openingAudioUrl', async () => {
    const f = fakeDeps({})
    await runOpening(f.deps, { roundId: 'r1', hostId: 'host_1' })
    expect(f.tts()).toHaveLength(1)
    expect(f.tts()[0].params).toMatchObject({
      input: 'The storm had not let up for three days.',
      model: 'tts-1',
      voice: 'fable',
      response_format: 'mp3',
    })
    expect(f.uploads).toEqual([{ userId: 'host_1', name: 'opening-r1.mp3', mimeType: 'audio/mpeg' }])
    expect(f.round.openingAudioUrl).toMatch(/^\/api\/files\/.+\?scope=app$/)
  })

  it('skips when the audio already exists', async () => {
    const f = fakeDeps({ round: { openingAudioUrl: '/api/files/done?scope=app' } })
    await runOpening(f.deps, { roundId: 'r1', hostId: 'host_1' })
    expect(f.calls).toHaveLength(0)
  })

  it('logs one line per paid call', async () => {
    const f = fakeDeps({})
    await runOpening(f.deps, { roundId: 'r1', hostId: 'host_1' })
    expect(logs.filter((l) => l.includes('[narration]') && l.includes('tts call'))).toHaveLength(1)
  })
})

describe('runConfession', () => {
  it('replaces the template with the AI confession and voices it', async () => {
    const f = fakeDeps({ aiReplies: [aiConfession] })
    await runConfession(f.deps, { roundId: 'r1', hostId: 'host_1' })
    expect(f.ai()).toHaveLength(1)
    expect(f.round.confession).toContain('I frayed that rope')
    expect(f.tts()).toHaveLength(1)
    expect(f.tts()[0].params).toMatchObject({ model: 'tts-1', voice: 'fable', input: f.round.confession })
    expect(f.round.confessionAudioUrl).toMatch(/^\/api\/files\/.+\?scope=app$/)
  })

  it('the AI sees the solution: the prompt names the culprit, method, and place', async () => {
    const f = fakeDeps({ aiReplies: [aiConfession] })
    await runConfession(f.deps, { roundId: 'r1', hostId: 'host_1' })
    const sent = JSON.stringify(f.ai()[0].params)
    for (const piece of [culprit.name, method.name, place.name]) expect(sent).toContain(piece)
  })

  it('AI failing twice keeps the template and still voices it', async () => {
    const f = fakeDeps({ aiReplies: [new Error('overloaded'), JSON.stringify({ confession: 'I did it.' })] })
    const template = f.round.confession
    await runConfession(f.deps, { roundId: 'r1', hostId: 'host_1' })
    expect(f.ai()).toHaveLength(2)
    expect(f.round.confession).toBe(template)
    expect(f.tts()).toHaveLength(1)
    expect(f.round.confessionAudioUrl).not.toBe('')
  })

  it('TTS failing leaves the written confession and throws; the retry voices only', async () => {
    const f = fakeDeps({ aiReplies: [aiConfession], ttsFails: true })
    await expect(runConfession(f.deps, { roundId: 'r1', hostId: 'host_1' })).rejects.toThrow(/tts/i)
    expect(f.round.confession).toContain('I frayed that rope')
    expect(f.round.confessionAudioUrl).toBe('')

    const retry = fakeDeps({ round: { confession: f.round.confession } })
    await runConfession(retry.deps, { roundId: 'r1', hostId: 'host_1' })
    expect(retry.ai()).toHaveLength(0)
    expect(retry.tts()).toHaveLength(1)
  })

  it('skips entirely when the confession audio already exists', async () => {
    const f = fakeDeps({ round: { confession: 'Done.', confessionAudioUrl: '/api/files/done?scope=app' } })
    await runConfession(f.deps, { roundId: 'r1', hostId: 'host_1' })
    expect(f.calls).toHaveLength(0)
  })

  it('logs one line per paid call (AI and TTS)', async () => {
    const f = fakeDeps({ aiReplies: [aiConfession] })
    await runConfession(f.deps, { roundId: 'r1', hostId: 'host_1' })
    expect(logs.filter((l) => /\[ai\] .*: call \d/.test(l))).toHaveLength(1)
    expect(logs.filter((l) => l.includes('[narration]') && l.includes('tts call'))).toHaveLength(1)
  })
})
