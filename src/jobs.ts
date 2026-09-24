/**
 * Background-job handler — invoked by AppJobRoom (worker.ts) for every
 * job picked up from the queue. Dispatch on `job.type` and return a
 * result (captured as `job.result`) or throw to fail (retried up to
 * `maxAttempts`, then permanently marked failed).
 *
 * Use this for any work that needs to outlive the HTTP response:
 *   - AI generation that exceeds Cloudflare's 30-second waitUntil window
 *   - Export / render pipelines
 *   - Bulk imports, fan-out side effects
 *
 * Enqueue from a client with the `useJobs(roomId)` hook, or from
 * worker-side code (an HTTP route, an action, a cron task) with
 * `enqueueJob(env.JOB_ROOMS, \`app:${env.DEEPSPACE_APP_ID}\`, type, payload)`.
 *
 * Long-running progress / checkpoint guidance:
 *   - `ctx.progress(0..1, msg?)` publishes a real-time update over the
 *     room's WebSocket so subscribers see progress without polling.
 *   - `ctx.continue(state, { afterMs })` yields and resumes on the next
 *     alarm with `job.resumeFrom = state` — use this for work that
 *     exceeds the 15-minute per-alarm wall-time ceiling.
 *   - `ctx.signal` is an AbortSignal that fires when a client cancels;
 *     forward it to `fetch` and check `.aborted` at loop suspension
 *     points.
 *
 * Example:
 *
 *   export async function runJob(job: Job, ctx: JobContext, env: Env) {
 *     switch (job.type) {
 *       case 'ai-summarize': {
 *         const { text } = job.payload as { text: string }
 *         ctx.progress(0.1, 'starting')
 *         const summary = await summarize(text, { signal: ctx.signal })
 *         return { summary }
 *       }
 *       default:
 *         throw new Error(`Unknown job type: ${job.type}`)
 *     }
 *   }
 */

import { buildCronContext, type Job, type JobContext } from 'deepspace/worker'
import type { Env } from '../worker'
import { uploadMedia } from './server/media'
import { runConfession, runOpening } from './server/narration'
import { runPortraits, type PortraitDeps } from './server/portraits'

/**
 * A media job's tools: records and integrations through the cron context
 * bound to the app's own record room (its default room, 'default', is one the
 * app never reads; FRICTION 8), acting as the host, plus file storage (R34).
 */
function mediaDeps(env: Env, hostId: string): PortraitDeps {
  const ctx = buildCronContext(env, hostId, `app:${env.DEEPSPACE_APP_ID}`)
  return {
    records: ctx.records,
    integrations: ctx.integrations,
    upload: (userId, file) => uploadMedia(env, userId, file),
  }
}

export async function runJob(job: Job, _ctx: JobContext, env: Env): Promise<unknown> {
  const hostId = String(job.enqueuedBy ?? '')
  const { roundId } = (job.payload ?? {}) as { roundId: string }
  switch (job.type) {
    case 'portraits': // R35
      return runPortraits(mediaDeps(env, hostId), { roundId, hostId })
    case 'opening': // R36 (1)
      return runOpening(mediaDeps(env, hostId), { roundId, hostId })
    case 'confession': // R36 (2)
      return runConfession(mediaDeps(env, hostId), { roundId, hostId })
    default:
      throw new Error(`Unknown job type: ${job.type}`)
  }
}
