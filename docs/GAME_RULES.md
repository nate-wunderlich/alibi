# GAME RULES -- alibi

A two-player detective duel, played as a series of short rounds. Every
round is a new, freshly generated case. The rules below are fixed; only
the names, descriptions, and art change between rounds. All rules are
implemented in one pure module (src/game/rules.ts) with unit tests.

## Players and series
- Exactly 2 players. The host creates the game; the guest joins with a
  code.
- The host picks the series length when creating the game: best of 3,
  5, or 7.
- The first player to win a majority of rounds (2, 3, or 4) wins the
  series. There are no ties.

## Cards (per round)
- 12 cards: 4 suspects, 4 weapons, 4 locations.
- Names and descriptions are generated for each round (see SPEC.md).
  The rules never depend on what the cards are called.

## Before every round: the setting and the case questions
1. The code picks the round's SETTING at random from a preset list (for
   example: a research dome in sunken Atlantis, a satellite in orbit).
   No setting repeats within a series.
2. Four questions written for THAT setting are prepared, 2 for each
   player, each with 4 answers to tap. (On a satellite: "What went
   wrong on the station just before the crime?")
3. Each player answers their 2 questions. Answers stay hidden from the
   opponent until the round's reveal.
4. When both players have answered, the round's case is generated from
   the setting plus all 4 answers (SPEC.md, Generation).
Round 1's questions are answered in the lobby. Every later round's
questions are answered on the previous round's reveal screen.

## Round setup (done by code on the server, never by AI)
1. Pick the solution: one random suspect, one random weapon, one random
   location. These 3 cards go in the envelope.
2. Shuffle the remaining 9 cards.
3. Deal 4 to each player. The 1 leftover card is placed FACE UP for both
   players to see.
4. Round 1's starting player is chosen at random (a coin flip). The
   starting player alternates every round after that (R41).

Invariant: the envelope, both hands, and the face-up card together
contain each of the 12 cards exactly once.

## A turn
On your turn you do ONE of these:
- GUESS, then you may ACCUSE on the same turn; or
- ACCUSE directly.
If you guess and do not accuse, the turn passes to your opponent.

## Guessing
1. Name one suspect, one weapon, and one location. You may name cards
   you hold yourself (a legal way to bluff or to test fewer cards).
2. If your opponent holds any of the three:
   - Exactly one: it is shown to you automatically.
   - Two or three: your opponent chooses which ONE to show.
   Only you and your opponent know which card was shown.
3. If your opponent holds none of the three, both players see
   "no match".
4. Both players always see the guess itself.

## Alibis (R41)
1. After every second full turn pair (after turns 4, 8, 12, ...), one
   alibi clears one card from the STARTER's hand (the player who moved
   first this round) that is not already public.
2. Both players see the cleared card and its alibi: a short line, in the
   round's setting, saying why that card could not be the answer.
3. Code chooses the card at random; the AI never chooses it and never
   knows the envelope. A cleared card is never in the envelope.
4. If every card in the starter's hand is already public, there is no
   alibi.

## Accusing
1. Name one suspect, one weapon, and one location as final.
2. The server checks it against the envelope.
3. Correct: you win the round.
4. Wrong: your opponent wins the round.

## End of round
- The reveal shows the envelope, plays the narrated confession
  (SPEC.md, Generation), shows both hands, and shows which player's
  answers shaped which parts of the case.
- The series score updates. If nobody has won the series, the host
  starts the next round once both players have answered its questions.

## Known edges (by design, named in the writeup)
- A player who leaves mid-round stalls it. The host can end the series.
  No turn timers in this version.
- No reconnect-to-seat logic beyond what signing back in provides.
- Two actions arriving at the same instant on one round are not
  transactional; the later write can overwrite the earlier. Play is
  turn-based, so this is unlikely.
- Writing a case takes a few seconds; the host's Start/Next request waits
  for it while both players see 'Writing your case...'.
