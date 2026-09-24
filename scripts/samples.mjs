#!/usr/bin/env node
/**
 * npm run samples [-- N | setting-id ...] [--host=Name] [--guest=Name]
 *
 * R38 (4): measure prose quality instead of eyeballing it. Runs N settings
 * (default 3, picked at random without repeats) or the named setting ids
 * through the real text pipeline on the LOCAL dev server (the devSamples
 * action, which refuses in a production build), then prints the scene beats,
 * the assembled opening, the confession, and first-try / retry / fallback per
 * step, with totals. Text AI only: about 3 calls per setting.
 *
 * Needs: the dev server running (npm run dev) and a local test account
 * (npx deepspace test accounts create ...).
 */

import { readFileSync } from 'node:fs'
import { chromium } from '@playwright/test'
import { loadAllTestAccounts, newSignedInContext } from 'deepspace/testing'

const BASE = `http://localhost:${process.env.DEEPSPACE_PORT ?? 5173}`
const args = process.argv.slice(2)
const flag = (name, fallback) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback
const players = { host: flag('host', 'Nathan'), guest: flag('guest', 'Nate') }
const positional = args.filter((a) => !a.startsWith('--'))

// The setting ids, read from the source so this list never drifts.
const allIds = [...readFileSync(new URL('../src/game/settings.ts', import.meta.url), 'utf8').matchAll(/^\s+id: "([^"]+)"/gm)].map((m) => m[1])
const requested = positional.filter((a) => !/^\d+$/.test(a))
const count = Number(positional.find((a) => /^\d+$/.test(a)) ?? 3)
const unknown = requested.filter((id) => !allIds.includes(id))
if (unknown.length) {
  console.error(`Unknown setting id(s): ${unknown.join(', ')}. Known: ${allIds.join(', ')}`)
  process.exit(1)
}
const ids = requested.length ? requested : [...allIds].sort(() => Math.random() - 0.5).slice(0, count)

try {
  await fetch(`${BASE}/api/auth/ok`)
} catch {
  console.error(`No dev server at ${BASE}. Start it first: npm run dev`)
  process.exit(1)
}
const account = loadAllTestAccounts()[0]
if (!account) {
  console.error('No local test account. Create one: npx deepspace test accounts create --email <you>@deepspace.test --password-stdin')
  process.exit(1)
}

const browser = await chromium.launch()
const page = await (await newSignedInContext(browser, account, BASE)).newPage()
await page.goto(`${BASE}/home`)

const words = (t) => (t ?? '').trim().split(/\s+/).filter(Boolean).length
const totals = { questions: {}, case: {}, confession: {} }
let failures = 0

for (const settingId of ids) {
  const res = await page.evaluate(
    async (body) => {
      const { token } = await (await fetch('/api/auth/token', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' } })).json()
      const r = await fetch('/api/actions/devSamples', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      })
      return r.json()
    },
    { settingId, hostName: players.host, guestName: players.guest },
  )
  console.log(`\n==================== ${settingId} ====================`)
  if (!res.success) {
    console.log(`ERROR: ${res.error}`)
    failures++
    continue
  }
  const s = res.data
  for (const step of ['questions', 'case', 'confession']) totals[step][s.steps[step]] = (totals[step][s.steps[step]] ?? 0) + 1
  console.log(`steps: questions ${s.steps.questions} · case ${s.steps.case} · confession ${s.steps.confession}`)
  const qs = [...s.questions.host.map((q) => [s.players.host, q]), ...s.questions.guest.map((q) => [s.players.guest, q])]
  qs.forEach(([who, q], i) => {
    console.log(`\n[Q${i + 1} · ${who}] (${words(q.beat)} words) ${q.beat}`)
    console.log(`   ${q.text}  -> tapped "${q.answers[1]}"`)
  })
  console.log(`\nCASE: "${s.caseTitle}" · victim: ${s.victim}`)
  console.log(`\nOPENING (${words(s.openingNarration)} words, ${s.openingNarration.length} chars):\n${s.openingNarration}`)
  console.log(`\nSOLUTION: ${s.solution.culprit} / ${s.solution.method} / ${s.solution.place}`)
  console.log(`CONFESSION (${words(s.confession)} words, ${s.confession.length} chars):\n${s.confession}`)
}

await browser.close()
const n = ids.length - failures
const rate = (step) => `${totals[step]['first-try'] ?? 0}/${n} first try, ${totals[step].retry ?? 0} retried, ${totals[step].fallback ?? 0} fell back`
console.log(`\n==================== TOTALS (${n} settings) ====================`)
console.log(`questions:  ${rate('questions')}`)
console.log(`case:       ${rate('case')}`)
console.log(`confession: ${rate('confession')}`)
if (failures) process.exit(1)
