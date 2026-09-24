/**
 * Alibis (R41), the pure half: the prompt that asks the AI for one alibi per
 * card, the check its reply must pass, and the code template used when the
 * AI fails or under test. Pure code: no network, no database.
 *
 * The AI writes an alibi for ALL 12 cards and is never told which three are
 * in the envelope (R4): code decides which alibi is ever drawn
 * (rules.pickAlibiCard), and only cards from the starter's hand can be.
 */

import {
  containsPlayerName,
  findGraphicTerm,
  GRAPHIC_TERMS,
  playerNameError,
  type Prompt,
} from './caseGen'
import type { CardKind } from './rules'
import type { Setting } from './settings'

/** An alibi is one or two short sentences. */
export const ALIBI_MAX_WORDS = 30

interface AlibiCard {
  kind: CardKind
  name: string
  description: string
}

const KIND_WORD: Record<CardKind, string> = { suspect: 'suspect', weapon: 'method', location: 'place' }

/** The prompt for a round's 12 alibis: the setting and every card, nothing about the answer. */
export function alibiPrompt(setting: Setting, cards: AlibiCard[]): Prompt {
  return {
    system: [
      'You write alibis for alibi, a two-player detective game with 12 cards per case.',
      'During play, an alibi may clear one card: it tells both players why that card cannot be the answer.',
      'Keep everything family-friendly: no gore, no cruelty, nothing a 12-year-old should not read.',
      `Words to avoid entirely (the game rejects any text that contains them or a word starting with them): ${GRAPHIC_TERMS.join(', ')}.`,
      'Reply with JSON only: no code fences, no text before or after it.',
    ].join('\n'),
    user: [
      `Setting: ${setting.name}`,
      `What happened: ${setting.hook}`,
      `Mood: ${setting.mood}`,
      '',
      'The 12 cards:',
      ...cards.map((c, i) => `${i + 1}. ${c.name} (${KIND_WORD[c.kind]}): ${c.description}`),
      '',
      'Write one alibi for each of the 12 cards, in this setting.',
      `Each alibi is one or two sentences, at most ${ALIBI_MAX_WORDS} words. It must name the card exactly as written above, and explain why it cannot be the answer:`,
      'a suspect was seen somewhere else, a method could not have been used, a place was locked, watched, or empty.',
      'Use a concrete, checkable detail from the setting (a witness, a log, a time, a lock).',
      'Return: {"alibis": [{"card": "exact card name", "alibi": "..."}, ...]} with exactly 12 items, one per card.',
    ].join('\n'),
  }
}

const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length

export type AlibiValidation = { ok: true; value: Record<string, string> } | { ok: false; errors: string[] }

/**
 * Check the AI's alibis: one per card (matched by exact card name, ignoring
 * case), each naming its card, at most ALIBI_MAX_WORDS words, passing the
 * tone guard and (with the players' names) the name guard. Errors never
 * repeat a player's name (R39). Returns the alibis by card name.
 */
export function validateAlibis(input: unknown, cardNames: string[], playerNames?: string[]): AlibiValidation {
  const list = (input as { alibis?: unknown } | null)?.alibis
  if (!Array.isArray(list)) return { ok: false, errors: ['Expected {"alibis": [...]} with one item per card.'] }
  const errors: string[] = []
  const value: Record<string, string> = {}
  cardNames.forEach((name, i) => {
    const item = list.find(
      (a: unknown) =>
        typeof (a as { card?: unknown })?.card === 'string' &&
        String((a as { card: string }).card).trim().toLowerCase() === name.toLowerCase(),
    ) as { alibi?: unknown } | undefined
    const text = typeof item?.alibi === 'string' ? item.alibi.trim() : ''
    if (!text) {
      errors.push(`The card "${name}" has no alibi.`)
      return
    }
    const label = `The alibi for card ${i + 1}`
    const named = playerNames ? containsPlayerName(text, playerNames) : false
    if (named) errors.push(playerNameError(label))
    if (!text.toLowerCase().includes(name.toLowerCase())) {
      errors.push(`${named ? label : `The alibi for "${name}"`} does not name its card; include "${name}" exactly.`)
    }
    if (words(text) > ALIBI_MAX_WORDS) errors.push(`${label} is longer than ${ALIBI_MAX_WORDS} words (it has ${words(text)}).`)
    const term = findGraphicTerm(text)
    if (term) errors.push(`${label} is too graphic ("${term}").`)
    value[name] = text
  })
  return errors.length ? { ok: false, errors } : { ok: true, value }
}

/** The alibi code writes when the round opens (and keeps if the AI fails, or under test). */
export function templateAlibi(card: { kind: CardKind; name: string }): string {
  if (card.kind === 'suspect') return `${card.name} has an alibi: two witnesses saw them somewhere else the whole time.`
  if (card.kind === 'weapon') return `${card.name} is cleared: it was locked away and untouched all along.`
  return `${card.name} is cleared: it was locked, and nobody went in or out.`
}
