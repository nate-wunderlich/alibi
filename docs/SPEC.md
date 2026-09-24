# SPEC -- alibi

Product and architecture. Game rules live in GAME_RULES.md. Rulings live
in DECISIONS.md. Items marked [CONFIRM D3] are assumptions about the
DeepSpace SDK that must be measured against the docs before they are
built on.

## One-line pitch
A two-player detective duel in short rounds. Before every round, each
player answers two randomly drawn questions, and a brand-new case is
generated from all four answers, and each player's cards stay
secret, enforced by the server rather than the honor system.

## Core path (must work on the live URL)
1. Sign in.
2. Host creates a game (series length) and gets a short join code.
3. Guest joins with the code. Each player answers their 2 case
   questions for round 1.
4. Host starts the series. Round 1's case is generated from the 4
   answers; the server picks the solution, deals, and flips a coin for
   who moves first (R41; later rounds alternate).
5. Players take turns guessing and accusing. Shown cards stay private;
   the round log updates live for both. After turns 4, 8, ..., an alibi
   clears one card from the starter's hand for both players (R41).
6. Someone wins the round. The reveal plays with narration. The score
   updates. Both players answer the next round's questions on the
   reveal screen, the next case generates, and play continues until
   someone wins the series.

## Screens (phone-first single column; must also work on desktop)
- HOME: sign in; create game; join by code.
- LOBBY: both players (live), host-only series length, my 2 case
  questions, whether the opponent has answered, host-only Start button
  (enabled once both have answered).
- GENERATING: shown while a case is written (text first, about 10
  seconds; portraits fill in during play).
- TABLE: series score; case title and setting; my hand; the face-up
  card; the cast (12 cards, suspect portraits where ready); whose turn;
  guess builder; round log (guesses, and each alibi in turn order with
  an "Alibi" label and its in-setting text); the detective grid; accuse
  button.
- REVEAL (per round): envelope cards, confession text, narration audio,
  both hands, both players' answers, updated score, my 2 questions for
  the next case, Next case (host, once both have answered).
- SERIES END: winner, round-by-round results, Rematch.

## Detective grid
A private grid on the TABLE screen: the 12 cards down the side and three
columns (me, opponent, envelope). The player marks each cell (has it /
doesn't / maybe). The game pre-fills what the player provably knows:
their own hand, the face-up card, every card shown to them, and every
card an alibi cleared (not in the envelope; held by the starter). Stored
in `notes`, owner only.

## Data and visibility
The secrecy rule: a browser only ever receives data its user is allowed
to see. Hiding data in the UI does not count.

| Collection  | Holds                                          | Readable by                           |
|-------------|------------------------------------------------|---------------------------------------|
| games       | code, host, guest, best-of,                    | both players                          |
|             | score, current round, status, series winner,   |                                       |
|             | first starter (R41 coin flip)                  |                                       |
| players     | game, user, display name, seat                 | both players                          |
| questions   | round, user, 2 questions with 4 answers each   | owner only                            |
| answers     | round, user, question id, chosen answer        | owner only; both after the reveal     |
| rounds      | game, number, status, setting id, case title,  | both players                          |
|             | victim, opening narration, starter, turn,      |                                       |
|             | face-up card id, winner, confession + audio    |                                       |
|             | (after reveal), turns played, drawn alibis     |                                       |
|             | (card id, text, after turn; R41)               |                                       |
| cards       | round, kind, name, description, image url      | both players                          |
| hands       | round, user, card ids                          | owner only; both after the reveal     |
| solution    | round, suspect, weapon, location               | no client until the round is revealed |
| alibiTexts  | round, card id, alibi text (one per card)      | no client, ever; a drawn alibi is     |
|             |                                                | copied into the round (R41)           |
| guesses     | round, by, suspect, weapon, location, result   | both players                          |
|             | (shown / no match), sequence number            |                                       |
| shown_cards | guess, card id                                 | the guesser and the shower only       |
| accusations | round, by, cards, correct                      | both, after the round is revealed     |
| notes       | round, user, marks                             | owner only                            |

[CONFIRM D3] Whether per-collection RBAC can express "owner only" and
"no client" rows. If it cannot, those collections are written and read
only through server actions that return the caller's own rows.

Series status: lobby -> playing -> finished.
Round status: generating -> ready -> playing -> revealed.

## Server actions (all secret state is written here, never by clients)
- createGame(bestOf) -> game + join code
- joinGame(code)
- submitAnswers(roundId, answers) each player once per round; the
  question ids must be the ones prepared for that player
- startSeries() host only
- guess(suspect, weapon, location) active player only
- showCard(cardId) the opponent only, when they hold 2+ matches; the
  card must be in their hand and in the guess
- accuse(suspect, weapon, location) active player only
- nextRound() host only, after a reveal, if the series is not over
- endSeries() host only: NOT BUILT. A player who leaves stalls the round,
  and a series cannot be ended early (see GAME_RULES.md, Known edges).
Every action validates turn and membership on the server using the pure
rules module. The client is never trusted about whose turn it is.

## Generation chain (three integrations, run per round)
0. SETTING AND QUESTIONS.
   a. SETTING (code, no AI). The 12 settings in docs/SETTINGS.md, each
      a name, hook, reason no one can leave, and mood, are copied into
      src/game/settings.ts. Code picks one at random, never repeating
      within a series. Written by
      Nate (logged as a by-hand change).
   b. QUESTIONS (AI text, background job). Given the setting, the AI
      writes 4 questions specific to it, each with 4 short tap answers,
      covering 4 different aspects (who, what, where within the
      setting, mood or motive). 2 go to each player.
      - Validated in code: exactly 4 questions, 4 answers each, length
        limits, no duplicates. One retry, then fall back to a generic
        bank in src/game/questions.ts that fits any setting.
      - Timing: generated in the background ahead of need, so players
        never wait for questions. Round 1's are made when the game is
        created (while waiting for the guest); round N+1's are made
        while round N is played.
      - The AI never sees answers or the solution at this step.
1. CASE (AI text). Input: the setting, the 4 answers (with their
   questions), and the titles of earlier rounds in this series (so no
   case repeats). Each answer must visibly shape the case. Output: JSON with a case title, a setting paragraph, the
   victim, 4 suspects, 4 weapons, and 4 locations (each a name plus a
   one-sentence description; all 12 belong to the setting, and every
   suspect gets a believable motive), and an opening narration of about 60
   words.
   - Validated in code: exact counts, unique names, length limits. One
     retry on failure, then fall back to a built-in preset case so a
     round always starts.
   - The prompt keeps content family-friendly. Answers are chosen from
     generated options, so no player free text reaches the prompt.
   - The AI never sees the solution here. Code picks it after the case
     exists.
2. SUSPECT ART (image generation). A background job makes 4 suspect
   portraits per round and stores them with file uploads. Cards show a
   styled placeholder until the image arrives. A failed image stays a
   placeholder; it never blocks play.
3. NARRATION (text to speech). The opening narration is voiced at the
   start of each round. At the reveal, the AI text integration writes a
   short confession FROM the solution (the first time the AI sees it),
   and it is voiced and played on both screens.

No prefetch: a case cannot exist before its answers do. Generation
starts the moment both players have answered, and the text arrives in
about 10 seconds [CONFIRM when measured]. Portraits fill in during
play.

Default endpoints [CONFIRM D3 via `npx deepspace integrations info`]:
- text: anthropic/chat-completion (claude-haiku-4-5)
- art: openai/generate-image (gpt-image-1-mini)
- voice: speech/text-to-speech

## Why each integration earns its place (writeup material)
- AI TEXT: without it there is no case. Personalization from the 4
  answers is the product.
- IMAGE GENERATION: suspects are what players reason about. A face
  makes 4 new names memorable on a phone screen, and fresh art is the
  visible proof that every case is new.
- TEXT TO SPEECH: turns the reveal into one shared moment, played on
  both screens at once, as the payoff of every round. The weakest of the
  three; if it does not land in testing, the writeup says so (R11).
- Considered and left out: weather, places, and calendar (no role in a
  fictional case); web search such as exa (cases are fiction, so
  grounding adds latency and no value); ElevenLabs (pricier voice with
  no need for it here); openai-realtime voice (belongs to the cut
  interrogation feature, the natural next step).
- Versus StoryNest, which chains the same three categories: StoryNest
  produces one artifact for one person. Here the chain's output is a
  playable case with hidden information between two people, shaped by
  both of them.

## DeepSpace primitives used (and what each does here)
- Auth: sign-in gate; every paid call sits behind it.
- Synced records: games, rounds, and guesses update live on both
  screens.
- Per-collection RBAC: hands, solution, answers, and shown cards are
  readable only by the right player.
- Server actions: every secret write and every turn check.
- Background jobs: portrait generation off the request path.
- File uploads: portraits and narration audio.
- Integrations client: the three-call chain.
- Presence (SHOULD): "opponent online" and "opponent is choosing a
  card".
- deepspace/testing: the two-user secrecy tests.
[CONFIRM D3] Whether the AI helpers in deepspace/worker are the
documented way to call a model. If so, they replace the integration
client for text, per the platform-primitives rule.

Cost controls: every integration call is behind sign-in and triggered
only by the server (after both players answer, and at the reveal), never by page
loads. Results are stored with the round and never regenerated. Worst
case per series (best of 7): 7 question sets, 7 cases, 7 confessions,
28 portraits, 14 narrations.

## Scope
- MUST: the core path; the secrecy table enforced; the rules module
  with unit tests; the setting list and per-setting questions with
  the generic fallback; the generation chain with fallbacks; the detective grid; phone-first layout.
- SHOULD: presence indicators; a scene image per case; a Rematch that
  keeps the same pair.
- WON'T (named in the writeup): more than 2 players; interrogating AI
  suspects in private chats; turn timers; spectators; reconnect logic;
  a native mobile app.

## Tests
- Unit (rules.ts): the deal covers all 12 cards exactly once; the
  envelope is never dealt; each hand has 4 and exactly 1 is face up;
  single-match auto-show; multi-match requires a choice from the
  guesser's opponent; "no match" when the opponent holds none;
  accusation right wins, wrong loses; round 1's starter is a coin flip
  and later rounds alternate; alibis are due after turns 4, 8, 12 and
  clear a non-public card from the starter's hand, never the envelope;
  series ends at the majority for 3, 5, and 7.
- Unit (settings.ts, questions.ts): no setting repeats within a
  series; the question validator rejects wrong counts, duplicates, and
  over-length text; the fallback always yields 4 valid questions, 2 per
  player.
- Multi-user (deepspace/testing, 2 users): player B cannot read player
  A's hand, the solution, or the alibi texts (written first, must fail
  before the permissions exist); player B cannot read player A's answers before
  the reveal; a guess appears live on both screens; the shown card is
  visible to the guesser only.
- Visual gate per slice on the live URL: two windows, two accounts.

## How a reviewer tests it alone (goes in the README)
Open the URL in a normal window and a private window, sign in as two
accounts, create in one, and join with the code in the other.
