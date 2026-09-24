/**
 * The 12 preset settings, copied from docs/SETTINGS.md (concepts by Nate,
 * wording tidied by the architect, R27). The code picks one per round at
 * random and never repeats one within a series.
 *
 * If docs/SETTINGS.md changes, change this list to match.
 */

import { randomIndex, type Rng } from './rules'

export interface Setting {
  /** Stable id, stored with each round so the series knows what it has used. */
  id: string
  name: string
  /** The incident the case is built around. */
  hook: string
  whyNoOneCanLeave: string
  mood: string
}

export const SETTINGS: readonly Setting[] = [
  // 1
  {
    id: "lost-city-of-zoroastro",
    name: "The Lost City of Zoroastro",
    hook: "A 1940s expedition follows an old map to the legendary \"hidden grail,\" a tiny diamond small enough to hide anywhere. At the spot where the treasure should be, one researcher falls through the crumbling floor onto a spike trap and dies, and the diamond is gone. The trap guarded the treasure, so one of the party must have taken it. Was the fall an accident, murder, or a planned \"sacrifice\" to reach the diamond?",
    whyNoOneCanLeave: "fear of more traps in the ruins.",
    mood: "adventurous, shocking, betrayal; overgrown ruins and lost-civilization wonder.",
  },
  // 2
  {
    id: "orion-asteroid-run",
    name: "The Orion Asteroid Run",
    hook: "In 2125, an expedition deep in the Orion star cluster is mining an asteroid for a mineral so rare it can power a technology that would bring sustainable energy to the whole galaxy. While the ship threads a sudden asteroid field, a crew member is found dead in the airlock terminal, where someone tampered with the ejection override. Some aboard profit from today's energy sources and would lose everything if the mission succeeds.",
    whyNoOneCanLeave: "the ship is trapped inside the asteroid field.",
    mood: "tense, high-stakes, sci-fi thriller.",
  },
  // 3
  {
    id: "ransom-tide",
    name: "The Ransom Tide",
    hook: "In the 1720s, a pirate crew holds a captured princess for ransom. The night before the exchange, someone runs out the plank under cover of darkness, and by dawn the quartermaster, the one crew member who knew where the ransom was to be delivered, is gone overboard. Any of the crew might want the ransom for themselves, and the princess has her own reasons to wreck the deal.",
    whyNoOneCanLeave: "open sea, days from any port.",
    mood: "swashbuckling, rowdy, double-crossing.",
  },
  // 4
  {
    id: "match-point",
    name: "Match Point",
    hook: "At a present-day, invitation-only tennis club, the championship final ends in disaster. The star player's racket was secretly swapped for an identical one rigged with a hidden high-tech device that detonates on a hard impact. Only someone with access to the clubhouse before the match could have made the switch.",
    whyNoOneCanLeave: "security has locked down the clubhouse until investigators arrive.",
    mood: "glamorous, high-tech, cutthroat.",
  },
  // 5
  {
    id: "bunker-9",
    name: "Bunker 9",
    hook: "In 2050, years after a nuclear war, a sealed underground bunker discovers its last crate of rations has been stolen. A search party heads to the boiler room, where the food is rumored to be hidden, and the quartermaster who kept the ration records is found dead beside the boilers. Whoever took the rations would do anything to keep them.",
    whyNoOneCanLeave: "the surface is still radioactive.",
    mood: "bleak, paranoid, survival.",
  },
  // 6
  {
    id: "atlantis-accord",
    name: "The Atlantis Accord",
    hook: "A submarine crew is welcomed into the dome of Atlantis for a historic peace exchange between the surface world and the Atlanteans. On the eve of signing the treaty, one of the crew is found dead. Several parties gain if the peace collapses: hardliners on both sides, a surface company eyeing Atlantean treasures, and someone who would lose power once the two worlds unite.",
    whyNoOneCanLeave: "the dome seals its doors until the treaty ceremony ends.",
    mood: "wondrous, diplomatic, uneasy.",
  },
  // 7
  {
    id: "rift-engine",
    name: "The Rift Engine",
    hook: "A team of military technologists has built a ship that jumps between dimensions through wormholes. Mid-voyage, the engine's chief designer, the only person who can fully operate it, is found dead. Whoever controls the Rift Engine controls every reality it can reach, and more than one person aboard wants it.",
    whyNoOneCanLeave: "the ship is caught between dimensions; stepping off means being lost forever.",
    mood: "mind-bending, paranoid, high-tech.",
  },
  // 8
  {
    id: "sirens-light",
    name: "The Siren's Light",
    hook: "On a remote rocky island, the old lighthouse keeper has long claimed that mermaids sing beneath the cliffs on stormy nights. A ship's crew and a few travelers shelter in the lighthouse during a storm. By morning the keeper lies dead at the foot of the tower and the lamp has gone dark. Some blame the mermaids, but someone inside wanted the keeper silenced. (Whether the mermaids are real stays ambiguous.)",
    whyNoOneCanLeave: "the storm has cut the island off from the mainland.",
    mood: "spooky, folkloric, stormy.",
  },
  // 9
  {
    id: "code-red-at-station-halcyon",
    name: "Code Red at Station Halcyon",
    hook: "Two fictional nations stand at the brink of war. Deep in a missile command bunker, the officer holding the launch codes is found dead and the codes are gone. A launch sequence has already started. Whoever killed the officer means to fire the missiles, and the countdown is running.",
    whyNoOneCanLeave: "the bunker is on full lockdown until the sequence is resolved.",
    mood: "high-stakes, tense, thriller.",
  },
  // 10
  {
    id: "a-very-wealthy-christmas",
    name: "A Very Wealthy Christmas",
    hook: "A hugely rich, wildly eccentric family gathers for Christmas at their secluded mountain resort cabin. The father can't stand his daughter's new boyfriend, the cousins have a long-running feud, and the brother was overheard that morning saying he wished his sister were dead. By the time the presents are opened, the daughter is dead. Everyone blames the boyfriend, which is exactly what the real killer wants.",
    whyNoOneCanLeave: "a blizzard has snowed in the only road down the mountain.",
    mood: "wacky, dramatic, festive.",
  },
  // 11
  {
    id: "in-the-tall-grass",
    name: "In the Tall Grass",
    hook: "At a luxury wildlife reserve full of exotic animals, a tiger's enclosure is found open overnight. By morning one of the park's guides is found dead deep in the tall grass beyond the fence, and everyone is quick to blame the missing tiger. The grass hides any tracks, the gate latch was opened from the outside, and the guide had enemies among his coworkers. Was it really the tiger, or someone who wanted the tiger to take the blame?",
    whyNoOneCanLeave: "the reserve is locked down while the tiger is still loose somewhere in the grass.",
    mood: "wild, suspenseful, exotic.",
  },
  // 12
  {
    id: "prehistoric-joyride",
    name: "The Prehistoric Joyride",
    hook: "In the year 2550, two alien brothers with ridiculous names \"borrow\" their dad's time machine for a joyride to the age of dinosaurs, not realizing a few adults stowed away aboard. When they land, the ship's beloved robot navigator is found smashed beyond repair, and without it nobody knows the way home. One of the stowaways sabotaged it, and history is already starting to go strange. (The boys are not suspects; the stowaways are.)",
    whyNoOneCanLeave: "stranded among the dinosaurs until the saboteur is found.",
    mood: "goofy, chaotic, adventurous.",
  },
]

/** One earlier play of a setting, by either player (R44): when its round was created, in ms. */
export interface SettingPlay {
  settingId: string
  playedAt: number
}

/**
 * Pick a setting that this series has not used yet (R44): the one the
 * players have played least recently, judged by each setting's most recent
 * play in `history` (never played counts as least recent), ties at random.
 * With no history this is a random unused setting, as before.
 * Throws if all 12 are used (a best-of-7 series needs at most 7).
 */
export function pickSetting(usedIds: readonly string[], rng: Rng, history: readonly SettingPlay[] = []): Setting {
  const unused = SETTINGS.filter((s) => !usedIds.includes(s.id))
  if (unused.length === 0) {
    throw new Error('All 12 settings have already been used in this series.')
  }
  const lastPlayed = (id: string) =>
    history.reduce((latest, h) => (h.settingId === id && h.playedAt > latest ? h.playedAt : latest), -Infinity)
  const oldest = Math.min(...unused.map((s) => lastPlayed(s.id)))
  const candidates = unused.filter((s) => lastPlayed(s.id) === oldest)
  return candidates[randomIndex(candidates.length, rng)]
}
