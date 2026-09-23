/**
 * The one way screens call server actions: POST /api/actions/:name with the
 * signed-in user's bearer token (from the SDK's getAuthToken).
 *
 * Always resolves to { success, data, error }; it never throws, so a screen
 * can show `error` inline in plain words.
 */

import { useCallback, useState } from 'react'
import { getAuthToken } from 'deepspace'

export interface ActionResult<T> {
  success: boolean
  data?: T
  error?: string
}

export async function callAction<T = Record<string, unknown>>(
  name: string,
  params: Record<string, unknown>,
): Promise<ActionResult<T>> {
  try {
    const token = await getAuthToken()
    if (!token) return { success: false, error: 'Please sign in first.' }
    const res = await fetch(`/api/actions/${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(params),
    })
    const body = (await res.json().catch(() => null)) as ActionResult<T> | null
    if (body && typeof body.success === 'boolean') return body
    return { success: false, error: `Something went wrong on the server (${res.status}). Please try again.` }
  } catch {
    return { success: false, error: 'Could not reach the server. Check your connection and try again.' }
  }
}

/**
 * Track one action at a time for a screen: `run` calls it, `pending` drives
 * the button's loading state, and `error` holds the last failure to show inline.
 */
export function useAction() {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(async <T = Record<string, unknown>>(name: string, params: Record<string, unknown>) => {
    setPending(true)
    setError(null)
    const result = await callAction<T>(name, params)
    setPending(false)
    if (!result.success) setError(result.error ?? 'Something went wrong. Please try again.')
    return result
  }, [])

  return { run, pending, error, clearError: () => setError(null) }
}
