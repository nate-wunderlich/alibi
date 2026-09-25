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
R32. Join codes live in join_codes, readable only by the host (a lobby
    could otherwise be joined by any signed-in user). games, players,
    rounds, and cards stay readable by any signed-in user; they hold no
    secrets, and narrowing them to the two players is a named known edge
    for the writeup.
R33. After a guess resolves, the active player either accuses
    immediately or calls endTurn. A turn cannot end without a guess.
    Only one guess per turn.
R34. Generated media (suspect portraits, narration audio) is stored from server code, never by a browser: one helper in src/server/media.ts uploads base64 with platformWorkerFetch to POST /internal/files/upload?scope=app with the app identity headers (x-app-identity-token, x-app-id) and a real x-user-id (the game's host). Records store the relative path /api/files/<key>?scope=app, never the URL the platform returns (it 404s on the platform host; measured D23). 'app' scope is public by key: fine for portraits (card faces are not secret) and for the confession audio (created only at the reveal). Reason: keeps every paid call server-triggered (R12), no client trust, no multi-MB action payloads. Measured by the D23 spike (upload 200, app-origin fetch 200 image/png, delete 200, then 404).
R35. Suspect portraits run in ONE background job per round, off the
    request path. After the case is written (openRound), the action
    calls enqueueJob(env.JOB_ROOMS, 'app:<DEEPSPACE_APP_ID>',
    'portraits', { roundId }, { enqueuedBy: <host user id>, maxAttempts:
    2 }). The job uses buildCronContext(env, hostId,
    'app:<DEEPSPACE_APP_ID>') for records and for openai/generate-image
    (billed to the app owner), makes the 4 suspect portraits in parallel
    (model gpt-image-1-mini set explicitly, quality low), stores each
    with uploadMedia (R34), and sets that card's imageUrl. It skips any
    card that already has an imageUrl, so a retry never pays twice. A
    failed portrait stays a placeholder and never blocks play (R7).
    Automated tests never call image generation (the job is not enqueued
    under test); real art is verified on the live two-window gate.
    buildCronContext is documented for cron only; its use from a job was
    proven by the D27 spike (enqueue to finish 2.4s, writes visible to
    normal action tools).
R36. Narration (refines R11, R4). Rounds gain openingAudioUrl,
    confession, and confessionAudioUrl. (1) Opening: openRound enqueues
    an 'opening' job (production builds only, like R35) that voices
    openingNarration with speech/text-to-speech (model tts-1, voice
    fable, mp3), stores it with uploadMedia, and sets openingAudioUrl;
    the table shows a Play button beside "Read the opening" once it
    exists; no autoplay. (2) Confession: reveal() writes a code-built
    template confession at once (culprit, method, place; free, always
    present), then enqueues a 'confession' job (production only) that
    asks the AI text integration for a short first-person confession
    FROM the solution (the first time the AI sees it), validated (length
    cap, tone guard, names the culprit; one retry, else keep the
    template), voices it, and sets confession and confessionAudioUrl.
    Both reveal screens try to autoplay the confession audio when it
    arrives and fall back to a Play button if the browser blocks it.
    Every job logs one line per paid call so the app keeps its own call
    count (FRICTION 9). Jobs skip work already done, so a retry never
    pays twice.
R37. Choice scenes and prose (Nate: "the best user experience"; refines
    R21, R25, R36). (1) Each AI question now comes with a scene beat:
    one or two cinematic sentences, second person, present tense, at
    most 30 words, that set up the choice ("The storm hits. Someone
    pounds on the lighthouse door."), shown above the question; the
    generic fallback bank gets beats too. (2) The opening narration
    credits each player's choices by display name ("Because Nathan let
    the merchant captain in..."), names all 4 suspects, and ends on a
    hook question; about 70-90 words. This supersedes R21's "answers
    hidden until the reveal" for the narration only: the answers records
    stay owner-only. (3) The confession is in the culprit's voice, gives
    the motive, pays off at least one choice from each player, and ends
    with a small twist; 60-90 words. The AI still never sees the
    solution before the reveal (R4). Quality is judged by Nate on
    printed samples before deploy.
R38. Structured prose (Nate: output must be good every time without
    hand-tuning prompts; refines R37). Code guarantees structure; the AI
    writes only the parts. (1) Opening: the case JSON returns
    openingParts { scene, creditHost, creditGuest, hook } instead of
    free prose. Code assembles scene + creditHost + creditGuest + "Four
    suspects remain: A, B, C, and D." (exact card names from the case) +
    hook. Validators: each credit contains its player's display name
    exactly once and the other player's not at all; hook ends with "?";
    each part within a word cap; tone guard on all. (2) Beats: must
    address the player ("you" or "your") and must not contain two or
    more of that question's answer options. (3) Retries feed the exact
    validation errors back to the AI. (4) A committed sample command
    (npm run samples, dev only, text AI only) runs N settings through
    the real pipeline and reports first-try pass rate, retries,
    fallbacks, and the assembled text, so quality is measured, not
    eyeballed.
R39. Players' account names never reach the AI and never appear in
    generated prose or narration (Nate, binding; supersedes the
    name-crediting in R37 and R38). Prompts label choices by seat only
    ("the host", "the guest"). Opening credits become creditHost /
    creditGuest that must contain "the host" / "the guest" respectively,
    and not the other seat. As a guard, every generated text (beats,
    case, opening parts, confession) is rejected if it contains any
    token of either player's display name (case-insensitive, whole word,
    tokens of 3+ letters). playerNames() is no longer used for prompts.

R40. Keep AI cases off the fallback (refines R39, R18 tone guard). (1)
    Name guard matches only capitalized whole-word tokens (3+ letters)
    of either player's display name. On a hit, code replaces that token
    everywhere in the generated case (every field, consistently) with a
    neutral name from a fixed list that shares no token with either
    player, then re-validates; no retry is spent and no name reaches the
    AI. The same substitution applies to question sets and the
    confession. (2) The case and question prompts list the tone-guard
    terms explicitly as words to avoid. (3) The case gets up to 3
    attempts before the preset fallback. (4) The In the Tall Grass
    setting text is softened so it does not invite graphic detail; the
    concept is unchanged (architect wording edit, logged).

R41. Alibis (Nate: the story must tie into the cards; measured D45-D47).
    After every second full turn pair (after turns 4, 8, ...), one alibi
    clears one card from the STARTER's hand that is not already public;
    both players see it. Code chooses the card; the AI never chooses and
    never knows the envelope. Simulated over the real rules (20,000
    rounds per cell): starter win rate 69.9% -> 58.5%, CAREFUL beats
    CASUAL 76.7% (baseline 77.7%), mean guesses 2.84 (baseline 2.97).
    Source (ii) rejected (starter 90%); every-pair (B iii) rejected
    (overcorrects to 39.7%). Round 1's starter is a coin flip (was
    always the host: host won 54.4% of best-of-3 under R41 alone); later
    rounds still alternate. Alibi text: a background job after the case
    writes one short in-setting alibi per card (production only, like
    R35/R36; name guard, tone guard); a code template is used if the AI
    fails or under test. Alibi texts are server-only until drawn.

R42. An alibi may name only its own card (refines R41). Each alibi is
    written without knowing the envelope, so a mention of another card
    reads as evidence but is invented, and could mislead a deduction.
    validateAlibis rejects an alibi containing any other card's full
    name (case-insensitive; a leading "The" optional) or any capitalized
    token of 3+ letters from another suspect's name. The prompt says so
    plainly. The name and tone guards still apply.

R43. Alibis by number, card by card (refines R41, R42; D51 diagnosis:
    the AI labelled cards "Name (kind)", so none matched, and R42's
    wording stopped it naming its own card). (1) The prompt numbers the
    12 cards (no kind in parentheses); the reply is {"alibis": [{"n": 1,
    "alibi": "..."}, ...]}; code maps by number. (2) The alibi text need
    not contain the card's name: the UI shows the card name beside each
    alibi; the text may use a short form or a pronoun. (3) R42 stays: no
    other card's full name, and no capitalized token of another
    suspect's name, but tokens shared with the alibi's own card name are
    ignored. (4) Card by card: valid alibis overwrite their templates,
    invalid ones keep the template; one retry only if more than 3 are
    invalid, feeding back the per-number errors; after that, keep what
    is valid.

R44. Variety across games (Nate: nothing should feel repetitive; the
    live gates showed Marcus Webb as victim three times and The Siren's
    Light three times). (1) Setting: the one either player has played
    least recently (from both players' earlier rounds, any game), ties
    at random; still no repeat within a series. (2) Names: the case
    prompt lists every victim and suspect name from both players' last
    20 rounds as names not to use; validateCase rejects a victim or
    suspect sharing a first or last name token (3+ letters, capitalized)
    with that list, feeding the offending names back; on the final
    attempt a repeat is accepted rather than falling back. (3) Twist:
    code draws one complication per round from a fixed list of at least
    12 (e.g. a storm, a blackout, a double-cross, a forged document, a
    missing key, a false alarm) and the case prompt requires the case to
    use it. Player account names are never in these lists (R39). Round
    1's setting uses the host's history only (the guest has not joined
    when it is picked); rounds 2+ use both players'. Only rounds that
    started (playing or revealed) count as played.

R45. Word caps are soft on the final case attempt (refines R38, R40,
    R44; D55: every case fallback came from the scene or credit word
    caps, and the fallback preset is far worse than a few extra words).
    On calls 1-2 the opening-part word caps apply; on the final call
    they are waived, but the assembled opening must still fit
    NARRATION_MAX (750 characters), and the tone guard, player-name
    guard, structure (all parts present, hook ends with "?", each credit
    names its seat), and card counts still apply. The twist stays out of
    the UI: it shows in the story itself. The secrecy spec's time budget
    is raised for the test accounts' long play history.

R46. A player-facing how-to-play guide, viewable at any time (Nate). One
    content component, used by a public route /how-to-play (no sign-in,
    no integration calls) and by an in-game panel. A "How to play" link
    sits in the header on every screen and on the landing and home
    pages; during a game it opens the panel over the table (a dialog
    from the existing UI kit) so play is never left. Sections: the goal;
    the cards and the envelope; your turn (guess, show, accuse or end
    turn); alibis (after every second turn pair, from the starter's
    hand, both players see it); choice scenes before each case; the
    detective grid; winning a round and a series (best of 3/5/7, coin
    flip for the first starter, then alternating). Plain player
    language, phone-first, no technical terms, no player names.

R47. No scrolling, anywhere in the game (Nate: everything must be in
    view without scrolling, ever). Every screen fits a phone viewport of
    390x660 (an iPhone-width screen minus browser bars) and a desktop
    viewport of 1280x720, with no page scroll and no scrolling panel.
    Screens that cannot hold everything at once are split into tabs or
    steps instead: the table gets a fixed bottom tab bar (Play: turn,
    hand, face-up card; Grid; Log, newest first, latest entries only;
    Cast, a compact 3x4 portrait grid with details on tap); the lobby
    shows one question at a time; the reveal is a sequence of steps
    (verdict, confession, hands and answers, next case); home shows the
    most recent cases only; the how-to-play guide becomes tabbed
    sections. Enforced by an e2e test that measures every screen at both
    sizes. The current live build (f5ba554) is the fallback if this is
    not verified before the freeze.

R48. Automated tests never spend credits (D73: the account hit 0 of 500
    credits, almost all from 1,356 text-AI calls made by e2e and samples
    runs; the live game then fell back on every AI step). Under the e2e
    runner, every text-AI call (questions, case, alibis, confession)
    goes to a deterministic local stand-in that returns valid replies,
    so the tests exercise validation and assembly instead of the
    fallback. The stand-in can never be used by a production build (it
    is gated on import.meta.env.DEV AND a test-only switch that only the
    e2e runner sets), and plain local dev is unchanged. npm run samples
    stays real but prints the estimated number of paid calls and
    requires --yes to proceed. When a reply fails validation, the log
    keeps the full error list (was the first 3). The architect checks
    app usage at every session start.

R49. When the AI is refused for lack of credits, players are told
    plainly (D73-D75: the account's free 500 credits ran out; the free
    plan has no one-time top-up). If any text-AI or speech call for a
    round fails with an "Insufficient credits" error, the server sets a
    public flag on that round (aiPaused), and the lobby, table, and
    reveal show one line in the top strip: "AI features are paused: this
    demo's credits ran out. You're playing a built-in case." It must fit
    R47 (no scrolling at 390x660 and 1280x720). The flag is set only by
    that specific error, never by validation failures, and clears on its
    own for the next round once credits exist again, since each round
    starts unflagged.

## Open
- App name: alibi unless Nate objects (delegated to the architect).
- [CLOSED by D8] RBAC expressiveness for owner-only and no-client rows. Yes; see R29.
- [CLOSED by D8] deepspace/worker AI helpers vs the integration client. tools.integration; see R31.
