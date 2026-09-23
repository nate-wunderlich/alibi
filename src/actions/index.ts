import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'
import { gameActions } from './games'
import { turnActions } from './turns'

export const actions: Record<string, ActionHandler<Env>> = { ...gameActions, ...turnActions }
