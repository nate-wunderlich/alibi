/**
 * How to play (R46): the one player-facing guide, used by the public
 * /how-to-play page and by the in-game panel. Plain player language, no
 * technical terms, no player names. No DeepSpace imports, so the public
 * page stays static (no sign-in, no network).
 *
 * Every rule here matches docs/GAME_RULES.md and src/game/rules.ts; each
 * number is cited next to it.
 */

import type { ReactNode } from 'react'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section data-testid="how-to-play-section" className="space-y-2">
      <h2 className="font-display text-xl font-bold leading-tight text-foreground">{title}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  )
}

export function HowToPlayContent() {
  return (
    <div data-testid="how-to-play" className="space-y-6">
      <Section title="The goal">
        <p>
          Someone has committed a crime. Work out who did it, with what, and where, before your opponent does. The
          answer is sealed in an envelope.
        </p>
      </Section>

      <Section title="The cards and the envelope">
        {/* 12 cards, 4 of each kind: rules.ts checkDeck; GAME_RULES.md "Cards (per round)". */}
        <p>Each case has 12 cards: 4 suspects, 4 methods, and 4 places.</p>
        {/* One of each in the envelope, then 4 each and 1 face up: rules.ts deal; GAME_RULES.md "Round setup". */}
        <p>
          One suspect, one method, and one place go into the envelope. The other 9 are dealt: 4 to you, 4 to your
          opponent, and 1 face up for both of you to see.
        </p>
        <p>Your cards are secret. A card in anyone&apos;s hand, or face up, cannot be in the envelope.</p>
      </Section>

      <Section title="Your turn">
        {/* GAME_RULES.md "A turn" and "Guessing"; rules.ts resolveGuess. */}
        <p>
          Name one suspect, one method, and one place. You may name your own cards, to test fewer at once or to
          bluff.
        </p>
        <p>
          If your opponent holds one of them, it is shown to you. If they hold two or three, they choose which one
          to show. Only you see the card. If they hold none, you both see &quot;no match&quot;.
        </p>
        <p>Then accuse, or end your turn. You can also skip the guess and accuse straight away.</p>
        {/* rules.ts checkAccusation; GAME_RULES.md "Accusing". */}
        <p>
          To accuse, name what is in the envelope. If you are right, you win the round. If you are wrong, your
          opponent wins it.
        </p>
      </Section>

      <Section title="Alibis">
        {/* After turns 4, 8, 12, ...: rules.ts alibiDue; from the starter's hand, never the envelope: rules.ts pickAlibiCard; R41. */}
        <p>
          After every second pair of turns (after turn 4, 8, 12, and so on), an alibi clears one card from the hand
          of the player who started the round.
        </p>
        <p>
          You both see it in the round log, with a short line from the story about why that card cannot be the
          answer. A cleared card is never in the envelope.
        </p>
      </Section>

      <Section title="Choice scenes">
        {/* 2 questions each, 4 answers to tap: GAME_RULES.md "Before every round"; R25, R37. */}
        <p>
          Before each case, you each get 2 short scenes, each ending in a question with 4 answers to tap. Your
          answers shape the case that is written: its people, its methods, its places, and its story.
        </p>
        {/* The opening credits each seat's choices (creditHost, creditGuest): R37, R38, R39. */}
        <p>The opening story credits each player&apos;s choices, so you both hear what shaped the case.</p>
      </Section>

      <Section title="The detective grid">
        {/* SPEC.md "Detective grid"; DetectiveGrid.tsx provable(). */}
        <p>
          Your private notes: the 12 cards down the side, and three columns for you, your opponent, and the
          envelope.
        </p>
        <p>
          The game fills in and locks what you know for sure: your own cards, the face-up card, every card shown to
          you, and every card an alibi cleared. Tap any other box to mark it: has it, does not have it, or maybe.
          Only you see your grid.
        </p>
      </Section>

      <Section title="Winning a round and a series">
        {/* First accusation ends the round: GAME_RULES.md "Accusing". */}
        <p>
          The first accusation ends the round, right or wrong. Then the answer is revealed, with both hands and the
          culprit&apos;s confession.
        </p>
        {/* Best of 3, 5, or 7; majority 2, 3, or 4: rules.ts seriesWinner; GAME_RULES.md "Players and series". */}
        <p>
          A series is best of 3, 5, or 7, chosen by the player who creates the game. The first to win 2, 3, or 4
          rounds wins the series.
        </p>
        {/* Coin flip, then alternating: rules.ts firstStarter and starterForRound; R41. */}
        <p>Who moves first in round 1 is a coin flip. After that, the first move alternates every round.</p>
      </Section>
    </div>
  )
}
