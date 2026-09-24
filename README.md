# alibi

A two-player detective duel: each round is a new case written from both players' answers, and each player's cards stay secret, enforced by the server.

Live: https://alibi.app.space

## How a reviewer tests it alone

1. Open https://alibi.app.space in a normal window and in a private window, and sign in with a different account in each.
2. In the first window, create a game (best of 3). A 6-character join code appears.
3. In the second window, join with that code.
4. Each player answers their 2 case questions. The host then starts the series, and the case is written (a few seconds).
5. The player on turn names a suspect, a method, and a place. If the other player holds two or three of the named cards, they choose which one to show. Then the player on turn presses End turn.
6. Keep guessing without accusing. After turn 4, an alibi appears in both round logs and clears one card.
7. Accuse to reach the reveal: the envelope, both hands, both players' answers, and the confession.

## How to play

- Each round has 12 cards: 4 suspects, 4 methods, 4 places. One of each goes into the envelope.
- The other 9 are dealt: 4 to each player, 1 face up for both.
- On your turn, guess three cards. If your opponent holds any of them, they show you one, privately. Then accuse or end your turn.
- An accusation names the envelope. Right wins the round; wrong gives it to your opponent.
- After every second turn pair (turns 4, 8, ...), an alibi clears one card from the starter's hand for both players.
- The first player in a series is a coin flip; the starter alternates each round. Series are best of 3, 5, or 7.

## How it works

- **Rules.** All game rules live in one pure module, `src/game/rules.ts` (deal, guess resolution, accusation, starter, alibi scheduling), with unit tests. Server actions call it; the client never decides an outcome.
- **Secrecy.** Per-collection permissions decide what each browser receives. Hands, the solution, answers, shown cards, notes, and alibi texts are never sent to the wrong browser. The multi-user secrecy spec (`tests/secrecy.spec.ts`) proves it with two signed-in accounts.
- **Server actions.** Every write to secret state goes through a server action that checks the caller's seat and turn itself (`src/actions/`).
- **Background jobs.** Suspect portraits, the voiced opening and confession, and the AI-written alibis run as background jobs (`src/jobs.ts`), in production builds only. Play never waits for them; each has a text or placeholder fallback.
- **Media storage.** Generated images and audio are stored from server code only (`src/server/media.ts`); records keep a relative path.
- **Rulings.** Every design decision and its reason is in `docs/DECISIONS.md`.

## Integrations and why

- **AI text** writes the case questions, the case (victim, 12 cards, opening), the alibis, and the confession. Without it there is no case; shaping each case from both players' answers is the product.
- **Image generation** paints the 4 suspect portraits. Suspects are what players reason about, and a face makes 4 new names memorable on a phone.
- **Text to speech** voices the opening and the confession, so the reveal is one shared moment on both screens.
- **Left out:** weather, places, and calendar (no role in a fictional case); web search (cases are fiction, so grounding adds latency and no value); a pricier voice service (no need here); realtime voice (it belongs to the cut suspect-interrogation feature).

## Quick start

Needs Node 24 (see `engines` in `package.json`).

```
npm install
npm run login            # deepspace auth login
npm run dev              # local dev server on http://localhost:5173
npm run deploy           # deepspace deploy
npm run test:unit        # vitest
npm run test:e2e         # Playwright, two signed-in users
npm run type-check
npm run lint
npm run samples -- 3     # AI prose samples; needs npm run dev and a test account
node scripts/simulate.ts 20000   # round simulator over the real rules
```

The e2e specs sign in as two local test accounts with the display names Alice and Bob. Create them with `npx deepspace test accounts create --email <name>@deepspace.test --name <Name> --password-stdin`.

## Docs

- `docs/SPEC.md`: what the app is, its screens, data and visibility, and the generation chain.
- `docs/GAME_RULES.md`: the rules as implemented in `src/game/rules.ts`.
- `docs/SETTINGS.md`: the 12 settings a case can take place in.
- `docs/DECISIONS.md`: every ruling, numbered, with its reason.
- `docs/VERIFY_LOG.md`: what was done and how it was verified, one line per step.
- `docs/FRICTION.md`: platform friction met along the way.
- `docs/POLISH.md`: small look-and-read fixes, each marked done or known edge.

## Known edges

- A player who leaves mid-round stalls it, and there is no way to end a series early.
- No turn timers.
- No reconnect-to-seat logic beyond signing back in.
- Portraits are large PNGs (1.2 to 1.7 MB each); the image endpoint ignores output format and compression.
- The player who shows a card does not see its name in their own round log; shown cards are readable only by the guesser.
- Name variety is per pair of players: the AI can reuse a favorite name (a surname such as Ashford) across different pairs.
- The AI can drift toward heavy methods; a tone guard rejects graphic terms, but the overall weight of a case varies.
