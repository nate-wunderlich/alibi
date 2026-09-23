/**
 * Storing generated media (suspect portraits, narration audio) from server
 * code (R34). The SDK has no documented server-side upload (FRICTION 7), so
 * this sends the same request the app's /api/files proxy builds: measured in
 * the D23 spike, POST /internal/files/upload?scope=app on the platform worker,
 * with the app's identity headers and a real user id.
 *
 * Records store the app-relative path mediaPath(key). The platform's own `url`
 * points at its host and 404s there (D23), so it is never returned.
 * 'app' scope is public by key: fine for card faces and for audio made at the reveal.
 */

import { platformWorkerFetch, type PlatformWorkerEnv } from 'deepspace/worker'

/** The worker env this helper needs: a way to reach the platform, and the app's identity. */
export type MediaEnv = PlatformWorkerEnv & { APP_IDENTITY_TOKEN?: string; DEEPSPACE_APP_ID: string }

/** Media as base64 plus its type, ready to upload. */
export interface Base64Media {
  mimeType: string
  base64: string
}

/** `data:<type>/<subtype>;base64,<data>`, with non-empty data. */
const DATA_URI = /^data:([\w.+-]+\/[\w.+-]+);base64,([A-Za-z0-9+/]+=*)$/

/** Split a base64 data URI into its mime type and data; null for anything else. */
export function parseDataUri(value: string): Base64Media | null {
  const match = DATA_URI.exec(value)
  return match ? { mimeType: match[1], base64: match[2] } : null
}

/** The app-relative path a record stores for an uploaded file's key (no origin; the key is used as given). */
export function mediaPath(key: string): string {
  return `/api/files/${key}?scope=app`
}

/**
 * Bytes to base64. Works in slices: turning a whole multi-megabyte buffer into
 * characters in one call would overflow the call stack.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  const SLICE = 0x8000
  const parts: string[] = []
  for (let i = 0; i < bytes.length; i += SLICE) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + SLICE)))
  }
  return btoa(parts.join(''))
}

/**
 * Whatever an integration returned, as base64 (D22: the image endpoint may
 * answer with a data URI or a hosted https URL; speech answers with a data URI).
 * A URL is downloaded here, on the server; a failed download throws.
 */
export async function toBase64(source: string): Promise<Base64Media> {
  const parsed = parseDataUri(source)
  if (parsed) return parsed
  if (!source.startsWith('https://')) throw new Error('Expected a base64 data URI or an https URL.')

  const res = await fetch(source)
  if (!res.ok) throw new Error(`Downloading the generated media failed (${res.status}).`)
  const mimeType = (res.headers.get('content-type') ?? 'application/octet-stream').split(';')[0].trim()
  return { mimeType, base64: bytesToBase64(new Uint8Array(await res.arrayBuffer())) }
}

/**
 * Upload base64 media to the app's public file space and return the path to
 * store on a record. `userId` must be a real user (the platform requires one
 * for writes); callers pass the game's host. Throws if the platform refuses.
 */
export async function uploadMedia(
  env: MediaEnv,
  userId: string,
  file: { base64: string; name: string; mimeType: string },
): Promise<string> {
  if (!userId) throw new Error('uploadMedia needs a real user id.')

  const res = await platformWorkerFetch(env, '/internal/files/upload?scope=app', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-app-identity-token': env.APP_IDENTITY_TOKEN ?? '',
      'x-app-id': env.DEEPSPACE_APP_ID,
      'x-user-id': userId,
    },
    body: JSON.stringify({ data: file.base64, name: file.name, mimeType: file.mimeType }),
  })
  const body = (await res.json().catch(() => null)) as { success?: boolean; key?: string; error?: string } | null
  if (!res.ok) throw new Error(`Storing ${file.name} failed (${res.status}): ${body?.error ?? 'no details'}`)
  if (body?.success !== true || !body.key) throw new Error(`Storing ${file.name} failed: ${body?.error ?? 'no key returned'}`)
  return mediaPath(body.key)
}
