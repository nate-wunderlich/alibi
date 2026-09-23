/**
 * The built-in preset case (docs/SPEC.md, Generation step 1): used when the
 * AI's case fails validation twice, so a round always starts. Until the AI
 * step exists, every round uses it.
 *
 * Written to fit any setting: the names are roles, not people from one world.
 */

import type { CardKind } from './rules'

export interface CaseCard {
  kind: CardKind
  name: string
  /** One sentence. */
  description: string
}

export interface PresetCase {
  title: string
  victim: string
  openingNarration: string
  cards: CaseCard[]
}

export const PRESET_CASE: PresetCase = {
  title: 'The Locked Room',
  victim: 'The Keeper, who held every key to the place',
  openingNarration:
    'The doors are sealed and no one can leave. At dawn the Keeper was found still and silent, ' +
    'the ring of keys missing from their belt. Four people had reason to want those keys, four ' +
    'objects could have done the deed, and four places could have hidden it. One of the people in ' +
    'this room is lying. Find out who, with what, and where.',
  cards: [
    { kind: 'suspect', name: 'The Newcomer', description: 'Arrived only yesterday and asks a lot of questions.' },
    { kind: 'suspect', name: 'The Veteran', description: 'Has been here longest and resents being ignored.' },
    { kind: 'suspect', name: 'The Planner', description: 'Keeps careful notes and never explains them.' },
    { kind: 'suspect', name: 'The Charmer', description: 'Everyone likes them, which is exactly the problem.' },
    { kind: 'weapon', name: 'A Heavy Tool', description: 'Left where anyone could pick it up.' },
    { kind: 'weapon', name: 'A Sleeping Draught', description: 'A few drops in a cup, and no one would notice.' },
    { kind: 'weapon', name: 'A Frayed Rope', description: 'Strong enough for the job, and cut clean at one end.' },
    { kind: 'weapon', name: 'A Staged Accident', description: 'Made to look like nobody was to blame.' },
    { kind: 'location', name: 'The Storeroom', description: 'Dark, cluttered, and rarely checked.' },
    { kind: 'location', name: 'The Lookout', description: 'High up, with a view of everyone coming and going.' },
    { kind: 'location', name: 'The Common Room', description: 'Crowded all evening, empty just after midnight.' },
    { kind: 'location', name: 'The Back Passage', description: 'A shortcut only the staff are meant to know.' },
  ],
}
