import { describe, expect, it } from 'vitest'
import { alibiPrompt, alibiOrder, validateAlibis } from '../game/alibis'
import { buildCasePrompt, buildQuestionPrompt, TWISTS, validateCase } from '../game/caseGen'
import { PRESET_CASE } from '../game/presetCase'
import { validateQuestions } from '../game/questions'
import { SETTINGS } from '../game/settings'
import { STANDIN_MARKER, standInReply } from './aiStandIn'
import { confessionPrompt, validateConfession } from './narration'

const setting = SETTINGS[4]
const players = ['Alice Example', 'Bob Example']
const reply = (label: string, prompt: { system: string; user: string }, attempt = 1) =>
  JSON.parse(standInReply(label, prompt, attempt)) as unknown

describe('the test-only AI stand-in (R48)', () => {
  it('has a marker a production bundle can be searched for', () => {
    expect(STANDIN_MARKER).toMatch(/^alibi-ai-standin/)
  })

  it('returns questions that pass validateQuestions', () => {
    const result = validateQuestions(reply('questions for round 1 (x)', buildQuestionPrompt(setting)), { playerNames: players })
    expect(result.ok, result.ok ? '' : result.errors.join(' ')).toBe(true)
  })

  it('returns a case that passes validateCase, with player names and an avoid list', () => {
    const avoidNames = ['Marcus Webb', 'Dr. Vex', 'Iris Thorne', 'Captain Reeves']
    const prompt = buildCasePrompt(setting, [], [], { avoidNames, twist: TWISTS[0] })
    const result = validateCase(reply('case for round 1 (x)', prompt), { settingName: setting.name, playerNames: players, avoidNames })
    expect(result.ok, result.ok ? '' : result.errors.join(' ')).toBe(true)
  })

  it('picks fresh names when its own earlier names are on the avoid list', () => {
    const first = validateCase(reply('case for round 1 (x)', buildCasePrompt(setting, [], [])), { settingName: setting.name })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const avoidNames = [first.case.victim, ...first.case.cards.filter((c) => c.kind === 'suspect').map((c) => c.name)]
    const prompt = buildCasePrompt(setting, [], [], { avoidNames })
    const second = validateCase(reply('case for round 2 (x)', prompt), { settingName: setting.name, avoidNames })
    expect(second.ok, second.ok ? '' : second.errors.join(' ')).toBe(true)
  })

  it('never runs out of fresh names, even when a long history blocks every name it used before (D74 e2e)', () => {
    let avoidNames: string[] = []
    for (let round = 1; round <= 40; round++) {
      const prompt = buildCasePrompt(setting, [], [], { avoidNames })
      const result = validateCase(reply(`case for round ${round} (x)`, prompt), { settingName: setting.name, avoidNames })
      expect(result.ok, `round ${round}: ${result.ok ? '' : result.errors.join(' ')}`).toBe(true)
      if (!result.ok) return
      avoidNames = [...avoidNames, result.case.victim.split(',')[0], ...result.case.cards.filter((c) => c.kind === 'suspect').map((c) => c.name)]
    }
  })

  it('returns 12 alibis that all pass validateAlibis, naming no other card', () => {
    const cards = alibiOrder(PRESET_CASE.cards)
    const checked = validateAlibis(reply('alibis for round r1', alibiPrompt(setting, cards)), cards, players)
    expect(checked.ok).toBe(true)
    if (checked.ok) expect(checked.results.every((r) => r.ok)).toBe(true)
  })

  it('returns a confession that names the culprit and passes validateConfession', () => {
    const culprit = { name: 'Dr. Harrison Ashford', description: 'A doctor with debts.' }
    const prompt = confessionPrompt({
      title: 'A Case',
      victim: 'Someone',
      settingName: setting.name,
      culprit,
      method: { name: 'A Frayed Rope', description: 'Old rope.' },
      place: { name: 'The Cellar', description: 'Damp.' },
      answers: [],
    })
    const result = validateConfession(reply('confession for round r1', prompt), culprit.name, players)
    expect(result.ok, result.ok ? '' : result.errors.join(' ')).toBe(true)
  })

  it('refuses a label it does not know, rather than guessing', () => {
    expect(() => standInReply('something else', { system: '', user: '' }, 1)).toThrow()
  })
})
