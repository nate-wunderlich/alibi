/**
 * Suspect portraits (R35): one background job per round paints the 4 suspect
 * cards, off the request path. For each suspect card that has no image yet,
 * it asks openai/generate-image for a portrait (gpt-image-1-mini, low
 * quality), stores it with uploadMedia (R34), and sets the card's imageUrl.
 *
 * Cards that already have an image are skipped, so a retry never pays twice.
 * A failed portrait stays a placeholder and never blocks play (R7); if any
 * card failed, the job throws at the end so its one retry (maxAttempts 2)
 * repaints only the missing ones.
 *
 * The job is enqueued only in a production build (portraitsEnabled): the dev
 * server and every automated test run with import.meta.env.DEV = true, so they
 * never call image generation. Real art is checked on the live gate.
 */

import type { CronContext } from 'deepspace/worker'
import { SETTINGS, type Setting } from '../game/settings'
import { toBase64 } from './media'

/** True only in a production build (measured in D29: the dev server has DEV=true, the build compiles it to false). */
export function portraitsEnabled(): boolean {
  return !import.meta.env.DEV
}

/** One fixed style for every portrait, so a round's four suspects look like a set. */
const STYLE =
  'Style: a painted storybook illustration with soft lamplight, muted warm colors, and a plain dark background.'

/** The image prompt for one suspect. Family-friendly, and never any text in the picture. */
export function portraitPrompt(setting: Pick<Setting, 'name' | 'mood'>, suspect: { name: string; description: string }): string {
  return [
    `A head-and-shoulders illustrated portrait of ${suspect.name}, a character in a family-friendly mystery game.`,
    `About them: ${suspect.description}`,
    `The story takes place in: ${setting.name} (${setting.mood})`,
    STYLE,
    'Facing the viewer, expressive but not frightening, nothing gruesome.',
    'No text, no words, no letters, no writing, no logos.',
  ].join('\n')
}

/** What the job needs: the cron context's records and integrations, and a way to store a file as a user. */
export interface PortraitDeps {
  records: CronContext['records']
  integrations: CronContext['integrations']
  upload: (userId: string, file: { base64: string; name: string; mimeType: string }) => Promise<string>
}

interface Row<T> {
  recordId: string
  data: T
}

const EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }

/**
 * Paint every suspect card in a round that has no image yet, in parallel.
 * Throws at the end if any card failed (the others are already saved).
 */
export async function runPortraits(deps: PortraitDeps, job: { roundId: string; hostId: string }): Promise<{ painted: number }> {
  const rounds = (await deps.records.query('rounds', { where: { recordId: job.roundId }, limit: 1 })) as Row<{ settingId: string }>[]
  const setting = SETTINGS.find((s) => s.id === rounds[0]?.data.settingId) ?? { name: 'a mystery', mood: 'suspenseful' }

  const cards = (await deps.records.query('cards', {
    where: { roundId: job.roundId, kind: 'suspect' },
    limit: 10,
  })) as Row<{ name: string; description: string; imageUrl?: string }>[]
  const missing = cards.filter((c) => !c.data.imageUrl)

  const results = await Promise.allSettled(
    missing.map(async (card) => {
      console.info(`[portraits] round ${job.roundId} card ${card.recordId}: image call`)
      const generated = (await deps.integrations.call('openai/generate-image', {
        prompt: portraitPrompt(setting, card.data),
        model: 'gpt-image-1-mini',
        quality: 'low',
        n: 1,
      })) as { images?: string[] }
      const source = generated?.images?.[0]
      if (!source) throw new Error('the image integration returned no image')
      const media = await toBase64(source)
      const extension = EXTENSIONS[media.mimeType] ?? 'img'
      const imageUrl = await deps.upload(job.hostId, {
        base64: media.base64,
        name: `portrait-${card.recordId}.${extension}`,
        mimeType: media.mimeType,
      })
      await deps.records.update('cards', card.recordId, { imageUrl })
    }),
  )

  const failed = results
    .map((r, i) => (r.status === 'rejected' ? `${missing[i].data.name}: ${String((r.reason as Error)?.message ?? r.reason)}` : null))
    .filter((f): f is string => f !== null)
  if (failed.length > 0) {
    throw new Error(`Portraits failed for ${failed.length} of ${missing.length} suspects: ${failed.join('; ')}`)
  }
  return { painted: missing.length }
}
