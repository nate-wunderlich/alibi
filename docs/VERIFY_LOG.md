# VERIFY LOG -- alibi

One line per dispatch or slice:
D# | agent did: ... | verified: what + how | changed by hand: ... or none

## Pre-repo setup (2026-09-22)
D1 | agent did: read-only environment check (node, npm, git identity, gh, Downloads path, home dirs, published deepspace versions, integrations catalog) | verified: node v24.15.0, npm 11.12.1, git identity set, deepspace and create-deepspace 0.33.1, catalog 45 integrations; gh NOT logged in; Downloads = /mnt/c/Users/natew/Downloads | changed by hand: none
D2 | agent did: read-only catalog detail (openweathermap, serpapi blocks, forecast grep, header count) | verified: endpoint names and prices read from `integrations list` output, 45 headers by uncapped grep -c | changed by hand: none
Settings | agent did: architect tidied wording and filled gaps (marked in chat) | verified: Nate reviewed each draft in the browser chat | changed by hand: Nate wrote the 12 setting concepts (docs/SETTINGS.md)
D3 | agent did: two runs stopped at step 1 (not logged in; top-level `deepspace whoami` is not a 0.33.1 command); third run scaffolded alibi; app init (approved by Nate) registered it and made the initial commit, installed the agent skill, added docs | verified: see D3 v3 report | changed by hand: Nate installed wslu (sudo apt install wslu) and signed in with BROWSER=wslview npx deepspace auth login
D4 | agent did: read deploy --help and app source, then stopped before deploying because the first deploy permanently latches the source authority | verified: app source read "unclaimed" | changed by hand: none
D5 | agent did: rewrote the 2 local commits to the GitHub noreply identity, added R28, set a repo-local credential helper, and lease-pushed over GitHub's auto-generated README (approved by Nate) | verified: gh api commit list shows exactly 3 commits, all noreply; value-shaped secrets scan empty | changed by hand: Nate created the repo, turned on email privacy, created a fine-grained token scoped to alibi, and logged in gh with it
D6 | agent did: first deploy with no flags | verified: exit 0; app source = GitHub nate-wunderlich/alibi; HTTP 200 with title alibi; visual gate on the live URL (landing page and sign-in page), screenshots taken by Nate and judged by the architect | changed by hand: none
D8 | agent did: read-only SDK research (skill, package types, docs pages, integrations info for 3 endpoints) | verified: permission, action, and billing claims cited to file:line and spot-checked by the agent | changed by hand: none
D9 | agent did: wrote the rules/settings/questions tests first (confirmed red), then the modules | verified: unit tests green, type-check and build clean | changed by hand: none
