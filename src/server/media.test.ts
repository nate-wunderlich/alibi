import { afterEach, describe, expect, it, vi } from 'vitest'
import { bytesToBase64, mediaPath, parseDataUri, toBase64, uploadMedia } from './media'

describe('parseDataUri', () => {
  it('splits a base64 image data URI into mime type and data', () => {
    expect(parseDataUri('data:image/png;base64,AAAA')).toEqual({ mimeType: 'image/png', base64: 'AAAA' })
  })

  it('handles audio too', () => {
    expect(parseDataUri('data:audio/mpeg;base64,SUQz')).toEqual({ mimeType: 'audio/mpeg', base64: 'SUQz' })
  })

  it('returns null for a plain https URL, a non-base64 data URI, and garbage', () => {
    expect(parseDataUri('https://example.com/a.png')).toBeNull()
    expect(parseDataUri('data:text/plain,hello')).toBeNull()
    expect(parseDataUri('data:image/png;base64,')).toBeNull()
    expect(parseDataUri('not a uri at all')).toBeNull()
    expect(parseDataUri('')).toBeNull()
  })
})

describe('mediaPath', () => {
  it('builds the app-relative path, with no origin and the key not re-encoded', () => {
    expect(mediaPath('apps/app_X/123-a.png')).toBe('/api/files/apps/app_X/123-a.png?scope=app')
  })
})

describe('bytesToBase64', () => {
  it('round-trips more than 1 MB exactly (so it must chunk; btoa on one huge string would overflow)', () => {
    const size = 1_500_000
    const bytes = new Uint8Array(size)
    for (let i = 0; i < size; i++) bytes[i] = (i * 31 + 7) % 256
    const base64 = bytesToBase64(bytes)
    const back = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
    expect(back.length).toBe(size)
    expect(back).toEqual(bytes)
  })

  it('matches btoa on a small input', () => {
    const bytes = new Uint8Array([104, 105, 33])
    expect(bytesToBase64(bytes)).toBe(btoa('hi!'))
  })
})

describe('toBase64', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('parses a data URI without fetching', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    expect(await toBase64('data:image/png;base64,AAAA')).toEqual({ mimeType: 'image/png', base64: 'AAAA' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('fetches an https URL server-side and uses its content type', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Uint8Array([104, 105, 33]), { headers: { 'content-type': 'image/webp' } })),
    )
    expect(await toBase64('https://images.example/one.webp')).toEqual({ mimeType: 'image/webp', base64: btoa('hi!') })
  })

  it('rejects a non-2xx download, and anything that is neither a data URI nor https', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('gone', { status: 404 })))
    await expect(toBase64('https://images.example/gone.png')).rejects.toThrow(/404/)
    await expect(toBase64('ftp://x/y.png')).rejects.toThrow()
  })
})

describe('uploadMedia', () => {
  /** A fake platform-worker binding that records the request and answers with `reply`. */
  function fakeEnv(reply: Response) {
    const calls: { url: string; init: RequestInit }[] = []
    const env = {
      PLATFORM_WORKER: {
        fetch: async (url: string, init: RequestInit) => {
          calls.push({ url, init })
          return reply
        },
      },
      APP_IDENTITY_TOKEN: 'identity-token',
      DEEPSPACE_APP_ID: 'app_TEST',
    }
    return { env, calls }
  }

  const okReply = () =>
    new Response(
      JSON.stringify({
        success: true,
        key: 'apps/app_TEST/1-portrait.png',
        url: 'https://platform-worker.deep.space/api/files/apps/app_TEST/1-portrait.png?scope=app',
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )

  it('sends the D23 request: POST /internal/files/upload?scope=app, JSON body, identity headers, a real user', async () => {
    const { env, calls } = fakeEnv(okReply())
    await uploadMedia(env as never, 'user_host', { base64: 'AAAA', name: 'portrait.png', mimeType: 'image/png' })
    expect(calls).toHaveLength(1)
    const { url, init } = calls[0]
    expect(new URL(url).pathname + new URL(url).search).toBe('/internal/files/upload?scope=app')
    expect(init.method).toBe('POST')
    const headers = new Headers(init.headers)
    expect(headers.get('content-type')).toBe('application/json')
    expect(headers.get('x-app-identity-token')).toBe('identity-token')
    expect(headers.get('x-app-id')).toBe('app_TEST')
    expect(headers.get('x-user-id')).toBe('user_host')
    expect(JSON.parse(String(init.body))).toEqual({ data: 'AAAA', name: 'portrait.png', mimeType: 'image/png' })
  })

  it("returns the app-relative path, never the platform's url", async () => {
    const { env } = fakeEnv(okReply())
    const path = await uploadMedia(env as never, 'user_host', { base64: 'AAAA', name: 'p.png', mimeType: 'image/png' })
    expect(path).toBe('/api/files/apps/app_TEST/1-portrait.png?scope=app')
    expect(path).not.toContain('platform-worker')
  })

  it('throws on a non-2xx answer, and on success !== true', async () => {
    const denied = fakeEnv(new Response(JSON.stringify({ error: 'nope' }), { status: 401 }))
    await expect(
      uploadMedia(denied.env as never, 'u', { base64: 'AAAA', name: 'p.png', mimeType: 'image/png' }),
    ).rejects.toThrow(/401/)

    const refused = fakeEnv(new Response(JSON.stringify({ success: false, error: 'too big' }), { status: 200 }))
    await expect(
      uploadMedia(refused.env as never, 'u', { base64: 'AAAA', name: 'p.png', mimeType: 'image/png' }),
    ).rejects.toThrow(/too big/)
  })

  it('refuses to upload without a user id (the platform requires one for writes)', async () => {
    const { env, calls } = fakeEnv(okReply())
    await expect(uploadMedia(env as never, '', { base64: 'AAAA', name: 'p.png', mimeType: 'image/png' })).rejects.toThrow()
    expect(calls).toHaveLength(0)
  })
})
