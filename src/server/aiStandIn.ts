/**
 * R48: a deterministic, local stand-in for the text AI, used only under the
 * e2e runner, so automated tests never spend credits. It returns replies
 * that pass the real validators (questions, case, alibis, confession), so
 * the tests exercise validation and assembly instead of the fallbacks.
 *
 * It is reachable only from the branch in askForJson (src/actions/ai.ts) that
 * tests `import.meta.env.DEV && import.meta.env.VITE_ALIBI_AI_STANDIN === '1'`:
 * a production build compiles DEV to false, the branch is dropped, and this
 * module with it (checked by grepping the built worker for STANDIN_MARKER).
 * Only the e2e runner sets the switch (tests/playwright.config.ts); plain
 * `npm run dev` never does.
 */

import { nameTokens, type Prompt } from '../game/caseGen'

/** Searched for in the production worker bundle; it must never be there. */
export const STANDIN_MARKER = 'alibi-ai-standin-v1'

// Names are built from syllables, so the supply never runs out however long the players'
// history of names to avoid grows (D74: a fixed pool ran dry in the e2e accounts' history).
const ONSETS = ['Br', 'Cal', 'Dor', 'El', 'Fen', 'Gar', 'Hal', 'Is', 'Jor', 'Kel', 'Lor', 'Mar', 'Nor', 'Or', 'Per', 'Quin', 'Ros', 'Sel', 'Tor', 'Val']
const MIDDLES = ['a', 'e', 'i', 'o', 'ea', 'io']
const ENDINGS = ['bel', 'dric', 'lin', 'mond', 'ra', 'sa', 'ten', 'vin', 'wyn', 'nor', 'ric', 'da']
const SURNAME_ENDINGS = ['brook', 'croft', 'dale', 'field', 'ford', 'gate', 'holm', 'ley', 'mere', 'ridge', 'stone', 'wick']

/** The k-th generated name for a list of endings (k counts up forever without repeating a name). */
function generated(k: number, endings: string[]): string {
  const onset = ONSETS[k % ONSETS.length]
  const middle = MIDDLES[Math.floor(k / ONSETS.length) % MIDDLES.length]
  const ending = endings[Math.floor(k / (ONSETS.length * MIDDLES.length)) % endings.length]
  const round = Math.floor(k / (ONSETS.length * MIDDLES.length * endings.length))
  return `${onset}${middle}${ending}${round > 0 ? 'e'.repeat(round) : ''}`
}

const METHODS = ['A Loosened Railing', 'A Swapped Key', 'A Sleeping Draught', 'A Rigged Lamp', 'A Forged Letter',
  'A Jammed Door', 'A Cut Rope', 'A Hidden Wire']
const PLACES = ['The Old Archive', 'The Boathouse', 'The Signal Room', 'The Glasshouse', 'The Wine Cellar',
  'The North Stair', 'The Map Room', 'The Chapel Loft']

/** A small stable number from text, so each round gets its own picks. */
function seed(text: string): number {
  let h = 7
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) % 100_003
  return h
}

/** The names the case prompt says not to use (R44), as first/last name tokens. */
function avoidedTokens(prompt: Prompt): Set<string> {
  const line = prompt.user.split('\n').find((l) => l.startsWith("Names already used in these players' earlier cases"))
  if (!line) return new Set()
  const list = line.slice(line.indexOf('):') + 2).trim().split('; ')
  return new Set(list.flatMap(nameTokens))
}

/** Five people (a victim and four suspects) whose first and last names are all fresh and all different. */
function freshPeople(prompt: Prompt, start: number): string[] {
  const avoid = avoidedTokens(prompt)
  const used = new Set<string>()
  const next = (from: number, endings: string[]) => {
    for (let k = from; ; k++) {
      const name = generated(k, endings)
      if (!avoid.has(name.toLowerCase()) && !used.has(name)) {
        used.add(name)
        return { name, k }
      }
    }
  }
  const people: string[] = []
  // Start inside the first cycle of names, so they stay short; they only grow past it.
  const cycle = ONSETS.length * MIDDLES.length * ENDINGS.length
  let f = start % cycle
  let l = (start * 7) % cycle
  while (people.length < 5) {
    const first = next(f, ENDINGS)
    const last = next(l, SURNAME_ENDINGS)
    f = first.k + 1
    l = last.k + 1
    people.push(`${first.name} ${last.name}`)
  }
  return people
}

function questions(): unknown {
  const q = (beat: string, text: string, answers: string[]) => ({ beat, text, answers })
  return [
    q('You step into the quiet hall and see that one person keeps to the shadows.', 'Who was acting strangely before the crime?', ['The newcomer', 'The oldest guest', 'The one in charge', 'The quiet helper']),
    q('You notice something small that should not be where you found it.', 'What strange clue was left behind?', ['A torn note', 'A muddy footprint', 'A broken watch', 'A strange smell']),
    q('You retrace the last steps of the evening, and the trail goes cold.', 'Where was the victim last seen?', ['Near the entrance', 'In a hidden corner', 'By the windows', 'Somewhere off-limits']),
    q('You feel old tensions simmer in every glance across the room.', 'What was everyone arguing about?', ['Money', 'A secret', 'An old feud', 'A broken promise']),
  ]
}

function caseReply(prompt: Prompt, start: number): unknown {
  const [victim, ...suspects] = freshPeople(prompt, start)
  const pick = <T,>(list: T[], i: number) => list[(start + i) % list.length]
  const methods = [0, 1, 2, 3].map((i) => pick(METHODS, i * 2))
  const places = [0, 1, 2, 3].map((i) => pick(PLACES, i * 2 + 1))
  const card = (name: string, description: string) => ({ name, description })
  return {
    title: `The ${victim.split(' ')[1]} Inquiry`,
    victim: `${victim}, the keeper of the records`,
    openingParts: {
      scene: 'The lights flicker as the news spreads, and every door is watched. Someone here knows more than they say.',
      creditHost: 'Because the host chose carefully, one suspect had more to hide than the rest.',
      creditGuest: 'Because the guest noticed the details, the place of the crime matters.',
      hook: 'Who wanted the keeper silenced?',
    },
    suspects: suspects.map((s) => card(s, 'Had a quiet reason to want the records kept closed.')),
    weapons: methods.map((m) => card(m, 'It could have been used without anyone noticing at first.')),
    locations: places.map((p) => card(p, 'Few people passed through here that evening.')),
  }
}

function alibis(): unknown {
  return {
    alibis: Array.from({ length: 12 }, (_, i) => ({
      n: i + 1,
      alibi: 'Witnesses and a signed log put it far from the scene all evening.',
    })),
  }
}

function confession(prompt: Prompt): unknown {
  const match = prompt.user.match(/full name, "([^"]+)"/)
  const name = match?.[1] ?? 'the culprit'
  return {
    confession: `I am ${name}, and it was me. I planned it for weeks and was sure nobody would notice. Both detectives saw through me in the end.`,
  }
}

/**
 * The stand-in's reply text for one askForJson call, chosen by its label.
 * `attempt` varies the picks on a retry. Throws on a label it does not know.
 */
export function standInReply(label: string, prompt: Prompt, attempt: number): string {
  console.info(`[${STANDIN_MARKER}] ${label}: stand-in reply (attempt ${attempt})`)
  const start = seed(label) + attempt * 3
  if (/\balibis\b/.test(label)) return JSON.stringify(alibis())
  if (/\bconfession\b/.test(label)) return JSON.stringify(confession(prompt))
  if (/\bquestions\b/.test(label)) return JSON.stringify(questions())
  if (/\bcase\b/.test(label)) return JSON.stringify(caseReply(prompt, start))
  throw new Error(`The AI stand-in has no reply for "${label}"`)
}
