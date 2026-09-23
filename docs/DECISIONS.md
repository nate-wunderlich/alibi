# DECISIONS -- alibi

Every ruling, dated. Check here before making a new one. Disk beats
chat memory.

## 2026-09-22 (Tue)
R1. Product: a multiplayer whodunit deduction game with a freshly
    generated cast each game. (Nate)
R2. (Superseded by R21.) Customization is option B: the host sets theme and tone, and every
    player adds one optional wish. All of it feeds a single generation
    step. (Nate)
R3. The code picks the solution and deals the cards. AI only names and
    describes them. This guarantees every game is solvable.
R4. The AI never sees the solution until the reveal, when it writes the
    confession.
R5. Secrecy is enforced server-side: a browser receives only what its
    user may see. Proven by a multi-user test written before the
    permissions.
R6. All game rules live in one pure module, src/game/rules.ts, with unit
    tests. Server actions call it; the UI never re-implements it.
R7. The game must be fully playable with 2 players. Image generation
    never blocks play: placeholders first, art fills in.
R8. No "Clue" or "Cluedo" name, characters, or card names anywhere.
    Hasbro trademarks.
R9. Cut: interrogating AI suspects. Named in the writeup as the next
    feature. (Art fallback superseded by R20.)
R10. Integration defaults (text: anthropic/chat-completion; art:
    openai/generate-image; voice: speech/text-to-speech), to be
    confirmed with `integrations info` before use.
R11. Text to speech earns its place by voicing the reveal for the whole
    table at once. If it cannot do that, the writeup says so.
R12. Every integration call is behind sign-in, server-triggered, and
    stored with the game. Nothing regenerates on page load.
R13. Schedule: Tue setup and blank deploy; Wed game engine; Thu
    generation chain and tests; Fri visual gates, fixes, writeup
    draft, feature freeze; Sat submit by afternoon.
R14. The detective grid (private marks, auto-filled with what the
    player provably knows) moves from SHOULD to MUST. "Pick your
    target" was considered and not adopted. (Nate)
R15. FORMAT CHANGE: a two-player duel played as a series of short
    rounds, best of 3, 5, or 7 (host picks). Every round is a new
    generated case. Supersedes the 2-6 player format; R7's "playable
    with 2" becomes "exactly 2". (Nate)
R16. Deck per round: 4 suspects, 4 weapons, 4 locations. 4 cards each,
    1 face up. Measured by a 20,000-round simulation: 3.2 guesses to
    solve on average, max 4. The 3/3/3 deck was rejected (2.5 average,
    38% solved in 2 or fewer: too much luck). (Nate)
R17. The starting player alternates each round. A turn is a guess with
    an optional accusation after it, or an accusation alone. A wrong
    accusation gives the round to the opponent.
R18. (Superseded by R21: no prefetch.)
R19. Phone-first single-column layout moves from WON'T to MUST. No
    native app. (Nate)
R20. Art per round is the 4 suspect portraits only (supersedes R9's
    art fallback). A scene image per case is SHOULD.
R21. CASE QUESTIONS replace the host theme, tone, and free-text wish
    (supersedes R2). Before every round, code draws 4 questions from a
    preset bank, one per category, 2 per player. Players answer by
    tapping preset options; the case is generated from all 4 answers.
    Answers stay hidden from the opponent until the reveal. Round 1 is
    answered in the lobby, later rounds on the previous reveal screen.
    (Nate; the tap-answer format and hidden answers are the
    architect's, open to Nate's veto)
R22. Integration set confirmed against the rubric: AI text, image
    generation, text to speech. Reasons and the left-out list live in
    SPEC.md and go in the writeup.
R23. Presence ("opponent online / choosing a card") added as SHOULD. It
    is a cheap DeepSpace primitive that makes a duel feel live.
R24. Platform primitives are used rather than re-implemented. If the SDK
    documents its own way to call a model, that way wins.
R25. Settings and questions (refines R21): code picks a random preset
    setting per round (12, written by Nate, no repeats in a series). The AI writes 4 questions specific to that setting, with
    4 tap answers each, in a background job ahead of need. A generic
    question bank is the fallback. Nate does not write the questions.
    (Nate; AI-written questions and the timing are the architect's)
R26. The setting's hook describes the incident; the 4 weapon cards are
    4 possible ways it was done, only one true. All 12 cards belong to
    the setting, and every suspect gets a believable motive, because
    the culprit is picked at random by code.
R27. The 12 settings are locked in docs/SETTINGS.md (Nate's ideas,
    wording tidied by the architect). Defaults applied where Nate
    delegated: Zoroastro kept; setting 9 is a race to stop the launch;
    no dimensional-double twist; mermaids ambiguous; "In the Tall
    Grass" kept; setting 12 as adjusted (stowaway suspects, robot
    victim). (Nate)
R28. GitHub is alibi's source authority (DeepSpace latches the source
    permanently on first deploy; a GitHub remote must exist first). The
    repo is public on Nate's personal account, commits use his GitHub
    noreply email, and the CLI uses a fine-grained token scoped to the
    alibi repo only. (Nate)

## 2026-09-23 (Wed)
R29. Secrecy: hands, answers, and notes use read: 'own' with an explicit
    userId ownerField; the solution uses '*' all-false, so no client
    (including the app owner) can read it. Clients cannot create or edit
    any secret row; server actions write them and must check the caller
    themselves, because actions bypass RBAC.
R30. Reveal: at round end, the reveal action copies the solution, both
    hands, and both players' answers into the round's public record.
    Secret collections are never opened up.
R31. AI text calls use tools.integration('anthropic/chat-completion')
    inside server actions, with model claude-haiku-4-5 set explicitly
    (the default is claude-sonnet-5, which is off standard pricing).

## Open
- App name: alibi unless Nate objects (delegated to the architect).
- [CONFIRM D3] RBAC expressiveness for owner-only and no-client rows.
- [CONFIRM D3] deepspace/worker AI helpers vs the integration client.
