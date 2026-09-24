/**
 * The alibis job (R41): after a round's case is written, ask the AI for one
 * short in-setting alibi per card and overwrite the code templates that
 * layOutAndDeal stored in alibiTexts. Production builds only (R35's switch),
 * like the portraits and narration jobs.
 *
 * The AI sees the setting and all 12 cards, never the envelope: this job
 * never reads the solution. Replies go through the name guard (R39, with
 * R40's substitution), the tone guard, and R42's other-card check, card by
 * card (R43): each valid alibi replaces its template, each invalid one keeps
 * it. An alibi already drawn into the round keeps the text it was drawn
 * with. askForJson logs one line per paid call ("[ai] alibis for round ...").
 */

import { askForAlibis, integrationFromCron } from '../actions/ai'
import { alibiOrder, templateAlibi } from '../game/alibis'
import type { CardKind } from '../game/rules'
import { SETTINGS } from '../game/settings'
import type { PortraitDeps } from './portraits'

/** Records and integrations through the cron context, as the other media jobs have them. */
export type AlibiDeps = Pick<PortraitDeps, 'records' | 'integrations'>

interface Row<T> {
  recordId: string
  data: T
}

export async function runAlibis(deps: AlibiDeps, job: { roundId: string }): Promise<{ written: number }> {
  const rounds = (await deps.records.query('rounds', { where: { recordId: job.roundId }, limit: 1 })) as Row<{
    settingId?: string
    gameId?: string
  }>[]
  const round = rounds[0]?.data
  const setting = SETTINGS.find((s) => s.id === round?.settingId)
  if (!round || !setting) throw new Error(`Round ${job.roundId} or its setting was not found`)

  const cards = (await deps.records.query('cards', { where: { roundId: job.roundId }, limit: 20 })) as Row<{
    kind: CardKind
    name: string
    description: string
  }>[]
  const texts = (await deps.records.query('alibiTexts', { where: { roundId: job.roundId }, limit: 20 })) as Row<{
    cardId: string
    text: string
  }>[]
  // A retry never pays twice: skip once every card has a text that is not its template.
  const templateOf = (cardId: string) => {
    const card = cards.find((c) => c.recordId === cardId)
    return card ? templateAlibi(card.data) : ''
  }
  if (texts.length === cards.length && texts.every((t) => t.data.text !== templateOf(t.data.cardId))) return { written: 0 }

  // The players' display names are loaded only for the guard; they never go into the prompt (R39, R40).
  const players = (await deps.records.query('players', { where: { gameId: round.gameId ?? '' }, limit: 10 })) as Row<{
    displayName?: string
  }>[]
  const playerNames = players.map((p) => p.data.displayName ?? '').filter((n) => n.trim() !== '')
  const ordered = alibiOrder(cards.map((c) => ({ id: c.recordId, ...c.data })))
  // R43: card by card. null keeps that card's template.
  const written = await askForAlibis(
    integrationFromCron(deps.integrations),
    `alibis for round ${job.roundId}`,
    setting,
    ordered,
    playerNames,
  )

  let count = 0
  for (const [i, card] of ordered.entries()) {
    const text = written[i]
    const row = texts.find((t) => t.data.cardId === card.id)
    if (text && row) {
      await deps.records.update('alibiTexts', row.recordId, { text })
      count++
    }
  }
  return { written: count }
}
