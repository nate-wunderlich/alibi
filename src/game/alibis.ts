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

/** The prompt for a round's 12 alibis: the setting and every card by number, nothing about the answer (R43). */
export function alibiPrompt(setting: Setting, cards: AlibiCard[]): Prompt {
  // Numbered 1-12 under plain headings; no kind in parentheses, which the AI copied into its labels (D51).
  let n = 0
  const group = (kind: CardKind, heading: string) => [
    heading,
    ...cards.filter((c) => c.kind === kind).map((c) => `${++n}. ${c.name}: ${c.description}`),
  ]
  const numbered = [...group('suspect', 'Suspects:'), ...group('weapon', 'Methods:'), ...group('location', 'Places:')]
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
      'The 12 cards, numbered:',
      ...numbered,
      '',
      'Write one alibi for each of the 12 cards, in this setting.',
      `Each alibi is one or two sentences, at most ${ALIBI_MAX_WORDS} words, and explains why it cannot be the answer:`,
      'a suspect was seen somewhere else, a method could not have been used, a place was locked, watched, or empty.',
      'Use a concrete, checkable detail from the setting (a witness, a log, a time, a lock).',
      "The game shows the card's name beside its alibi, so the alibi may refer to its own card by a short form or a pronoun.",
      'Never mention any other card from the list (no other suspect, method, or place, not even a first name or in passing): the alibi must not read as evidence about another card.',
      'Return: {"alibis": [{"n": 1, "alibi": "..."}, ...]} with exactly 12 items, n being the card\'s number above.',
    ].join('\n'),
  }
}

const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length

/** A card as the alibi check needs it. */
export interface AlibiCardRef {
  kind: CardKind
  name: string
}

/** One card's result: the alibi's text, or why it was rejected (R43: card by card). */
export type AlibiResult = { ok: true; text: string } | { ok: false; errors: string[] }

/** Per-card results in the order of `alibiOrder(cards)`, or an error if the reply is not a list. */
export type AlibiValidation = { ok: true; results: AlibiResult[] } | { ok: false; errors: string[] }

const KIND_ORDER: CardKind[] = ['suspect', 'weapon', 'location']

/**
 * The cards in prompt order (suspects, methods, places), so alibi n is
 * alibiOrder(cards)[n - 1]. Callers must use this order for results.
 */
export function alibiOrder<T extends { kind: CardKind }>(cards: T[]): T[] {
  return KIND_ORDER.flatMap((kind) => cards.filter((c) => c.kind === kind))
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** A whole-phrase pattern: not inside a longer word, case-insensitive. */
const phrase = (s: string, flags = 'iu') => new RegExp(`(?<![\\p{L}\\p{N}])${escape(s)}(?![\\p{L}\\p{N}])`, flags)

/** A card's name without a leading "The" (R42: "the Cockpit" and "cockpit" both mention "The Cockpit"). */
const bareName = (name: string) => name.replace(/^the\s+/i, '')

/** The 3+ letter words of a name, lowercased, never "the". */
const nameTokens = (name: string) =>
  name
    .split(/[^\p{L}]+/u)
    .filter((t) => t.length >= 3 && t.toLowerCase() !== 'the')
    .map((t) => t.toLowerCase())

/**
 * R42, R43: the kind of another card this alibi mentions, or null. A mention
 * is another card's full name (ignoring case, a leading "The" optional), or a
 * capitalized token of 3+ letters from another suspect's name. The alibi's
 * own full name is removed first, and tokens shared with its own name are
 * ignored ("Dr. Ashford" in Dr. Harrison Ashford's alibi is not Gerald Ashford).
 */
function mentionsOtherCard(text: string, own: string, cards: AlibiCardRef[]): CardKind | null {
  const rest = text.replace(phrase(own, 'giu'), ' ')
  const ownTokens = new Set(nameTokens(own))
  for (const other of cards) {
    if (other.name === own) continue
    if (phrase(bareName(other.name)).test(rest)) return other.kind
    if (other.kind !== 'suspect') continue
    for (const token of nameTokens(other.name)) {
      if (ownTokens.has(token)) continue
      if ([...rest.matchAll(phrase(token, 'giu'))].some((m) => m[0][0] !== m[0][0].toLowerCase())) return 'suspect'
    }
  }
  return null
}

/**
 * Check the AI's alibis (R41-R43), card by card. The reply is
 * {"alibis": [{"n", "alibi"}]}, n numbering the cards in alibiOrder. Each
 * alibi must be present, at most ALIBI_MAX_WORDS words, pass the tone guard
 * and (with the players' names) the name guard, and mention no other card.
 * It need not name its own card (the UI shows the name beside it). Errors
 * start "Alibi n" and never repeat a player's name (R39) or another card's
 * name (R42: they say its kind). Results come back in alibiOrder(cards).
 */
export function validateAlibis(input: unknown, cards: AlibiCardRef[], playerNames?: string[]): AlibiValidation {
  const list = (input as { alibis?: unknown } | null)?.alibis
  if (!Array.isArray(list)) return { ok: false, errors: ['Expected {"alibis": [{"n": 1, "alibi": "..."}, ...]} with 12 items.'] }
  const ordered = alibiOrder(cards)
  const results = ordered.map((card, i): AlibiResult => {
    const n = i + 1
    const item = list.find((a: unknown) => Number((a as { n?: unknown })?.n) === n) as { alibi?: unknown } | undefined
    const text = typeof item?.alibi === 'string' ? item.alibi.trim() : ''
    if (!text) return { ok: false, errors: [`Alibi ${n} is missing.`] }
    const errors: string[] = []
    if (playerNames && containsPlayerName(text, playerNames)) errors.push(playerNameError(`Alibi ${n}`))
    const other = mentionsOtherCard(text, card.name, ordered)
    if (other) errors.push(`Alibi ${n} mentions another ${other} card; mention only its own card.`)
    if (words(text) > ALIBI_MAX_WORDS) errors.push(`Alibi ${n} is longer than ${ALIBI_MAX_WORDS} words (it has ${words(text)}).`)
    const term = findGraphicTerm(text)
    if (term) errors.push(`Alibi ${n} is too graphic ("${term}").`)
    return errors.length ? { ok: false, errors } : { ok: true, text }
  })
  return { ok: true, results }
}

/** The alibi code writes when the round opens (and keeps if the AI fails, or under test). */
export function templateAlibi(card: { kind: CardKind; name: string }): string {
  if (card.kind === 'suspect') return `${card.name} has an alibi: two witnesses saw them somewhere else the whole time.`
  if (card.kind === 'weapon') return `${card.name} is cleared: it was locked away and untouched all along.`
  return `${card.name} is cleared: it was locked, and nobody went in or out.`
}
