/**
 * Dev-only actions. devSamples (R38 (4)) runs one setting through the real
 * text pipeline and returns the prose and how each step went; `npm run
 * samples` calls it. It refuses in a production build (import.meta.env.DEV
 * is compiled to false there), so the live site never exposes it.
 */

import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'
import { SETTINGS } from '../game/settings'
import { runSample } from '../server/samples'
import { action, loadGame, loadRound, must, refuse, requireSeat, textParam } from './helpers'

const devSamples = action(async ({ params, tools }) => {
  if (!import.meta.env.DEV) refuse('Samples run only on the local dev server.')
  const setting = SETTINGS.find((s) => s.id === textParam(params, 'settingId'))
  if (!setting) refuse('Unknown setting id.')
  // Fake names, only to exercise the R39 guard; they never reach a prompt.
  const guardNames = Array.isArray(params.guardNames) ? params.guardNames.map(String) : []
  // R44: a fake list of names from "earlier cases", to exercise the avoid-names rule.
  const avoidNames = Array.isArray(params.avoidNames) ? params.avoidNames.map(String) : []
  return runSample(tools, setting, guardNames, avoidNames)
})

/**
 * R49: turn a round's aiPaused flag on or off, so the no-scroll spec can
 * measure the banner. Dev only (refuses in a production build), and only for
 * a player of that game.
 */
const devForceAiPaused = action(async ({ userId, params, tools }) => {
  if (!import.meta.env.DEV) refuse('Dev only.')
  const round = await loadRound(tools, textParam(params, 'roundId'))
  requireSeat(await loadGame(tools, round.gameId), userId)
  must(await tools.update('rounds', round.id, { aiPaused: params.on === false ? 0 : 1 }), 'Setting aiPaused')
  return { roundId: round.id }
})

export const devActions: Record<string, ActionHandler<Env>> = { devSamples, devForceAiPaused }
