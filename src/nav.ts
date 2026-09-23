/**
 * Navigation Config
 *
 * Add one entry per nav item. Routes are handled by generouted
 * (file-based routing in src/pages/), this just controls what
 * appears in the navigation bar.
 */

import type { Role } from './constants'

export interface NavItem {
  path: string
  label: string
  roles?: Role[]
  devOnly?: boolean
}

// alibi has one place to go: the wordmark links home (/home), and a game
// lives at /game/:id. /settings (in the account menu) and /api-status still
// exist but stay out of the main nav.
export const nav: NavItem[] = [
  // ── Features add nav items below this line ──
]
