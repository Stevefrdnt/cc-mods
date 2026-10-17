// The gamified part: EXP and levels from tokens, and items finished work
// drops into a collection. Pure functions over plain data, so register.js
// stays wiring and tests stay simple.
//
// The pet is never stored as one value that sessions read, change and write
// back: two sessions open at once would overwrite each other. Instead each
// session appends what happened to its own ledger, and the pet is folded from
// a base snapshot plus every ledger, in time order. See fold().

import { WORK_LABEL, workOf } from './animation.js'

export const DEFAULT_NAME = 'Clawd'

// EXP for a turn: log-scaled on its tokens and capped, so a long agent run
// doesn't level the pet a hundred times faster than a short chat
export const EXP_CAP_PER_TURN = 40
const SUBAGENT_EXP = 0.5

// A finished turn drops something DROP_CHANCE of the time
export const DROP_CHANCE = 0.35

export const RARITY = {
  common: { weight: 70, label: 'Common' },
  uncommon: { weight: 22, label: 'Uncommon' },
  rare: { weight: 7, label: 'Rare' },
  legendary: { weight: 1, label: 'Legendary' },
}

// The items finished work can drop, rarest last. The keys match ITEMS in sprites.js
export const ITEMS = {
  bit_cookie: { name: 'Bit Cookie', rarity: 'common' },
  token_tea: { name: 'Token Tea', rarity: 'common' },
  byte_bun: { name: 'Byte Bun', rarity: 'common' },
  cache_cake: { name: 'Cache Cake', rarity: 'uncommon' },
  rubber_duck: { name: 'Rubber Duck', rarity: 'uncommon' },
  context_crystal: { name: 'Context Crystal', rarity: 'rare' },
  golden_semicolon: { name: 'Golden Semicolon', rarity: 'legendary' },
}

// `inventory` is the collection: how many of each item have dropped
export function newPet(at, name = DEFAULT_NAME) {
  return { name, at, exp: 0, inventory: {}, turns: 0, drops: 0 }
}

// Tokens a turn counted, with cache reads weighted low: they are cheap
export function turnTokens(usage) {
  if (!usage) return 0
  return (
    (usage.input_tokens ?? 0) +
    (usage.output_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0) * 0.1
  )
}

export function expForTurn(usage, isSubagent = false) {
  const tokens = turnTokens(usage)
  if (tokens <= 0) return 0
  const exp = Math.min(EXP_CAP_PER_TURN, Math.round(10 * Math.log10(1 + tokens / 100)))
  return isSubagent ? Math.round(exp * SUBAGENT_EXP) : exp
}

// Level N takes 50 * N^1.5 EXP in all
export function expToReach(level) {
  return Math.round(50 * Math.pow(level, 1.5))
}

export function levelFor(exp) {
  let level = 0
  while (expToReach(level + 1) <= exp) level++
  return level
}

// Where the pet is within its level, for the EXP bar
export function levelProgress(exp) {
  const level = levelFor(exp)
  const from = expToReach(level)
  const to = expToReach(level + 1)
  return { level, into: exp - from, needed: to - from }
}

// A steady random number in [0, 1) from a string, so a turn rolls the same
// drop however many times it is folded
export function seeded(text, salt = 0) {
  let h = 2166136261 ^ salt
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  h = Math.imul(h ^ (h >>> 15), 2246822507)
  h = Math.imul(h ^ (h >>> 13), 3266489909)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

// The drop for a finished turn, or null
export function rollDrop(turnId) {
  if (seeded(turnId, 1) >= DROP_CHANCE) return null
  const total = Object.values(RARITY).reduce((sum, r) => sum + r.weight, 0)
  let pick = seeded(turnId, 2) * total
  let rarity = 'common'
  for (const [key, r] of Object.entries(RARITY)) {
    if (pick < r.weight) { rarity = key; break }
    pick -= r.weight
  }
  const pool = Object.keys(ITEMS).filter((id) => ITEMS[id].rarity === rarity)
  return pool[Math.floor(seeded(turnId, 3) * pool.length)]
}

// One ledger event applied to the pet. Events:
//   { type: 'turn', id, at, exp, isAnswer, drop }   a finished turn
//   { type: 'rename', id, at, name }
// Older ledgers may hold 'abort' and 'use' events from when the pet had needs
// to look after; they change nothing now
export function apply(pet, event) {
  const p = { ...pet, at: Math.max(pet.at, event.at) }
  switch (event.type) {
    case 'turn': {
      const inventory = { ...p.inventory }
      if (event.drop && ITEMS[event.drop]) inventory[event.drop] = (inventory[event.drop] ?? 0) + 1
      return {
        ...p,
        exp: p.exp + event.exp,
        turns: p.turns + (event.isAnswer ? 1 : 0),
        drops: p.drops + (event.drop ? 1 : 0),
        inventory,
      }
    }
    case 'rename':
      return { ...p, name: event.name }
    default:
      return p
  }
}

// The pet from its base and every session's ledger.
//
// base:    { pet, folded: { [ledgerId]: count }, resetAt }   (resetAt: when it began)
// ledgers: { [ledgerId]: event[] }
//
// `folded` says how many of each ledger's events the base already holds, so
// folding twice changes nothing. A reset starts a base that counts every
// ledger's events so far as folded, so nothing from before it comes back.
export function fold(base, ledgers) {
  // Time order across ledgers; a ledger's own order where two events share a moment
  const fresh = []
  for (const [id, events] of Object.entries(ledgers)) {
    const done = base.folded[id] ?? 0
    events.slice(done).forEach((event, i) => fresh.push({ event, ledger: id, i: done + i }))
  }
  fresh.sort((a, b) => a.event.at - b.event.at || (a.ledger < b.ledger ? -1 : a.ledger > b.ledger ? 1 : a.i - b.i))
  let pet = base.pet
  for (const { event } of fresh) pet = apply(pet, event)
  // Only ledgers that still stand: one merged away and deleted needs no count
  const folded = {}
  for (const [id, events] of Object.entries(ledgers)) if (events.length > 0) folded[id] = Math.max(events.length, base.folded[id] ?? 0)
  return { pet, folded, resetAt: base.resetAt }
}

// A fresh pet. `ledgers`, when given, are the ones that stand now, counted as
// already folded
export function newBase(at, name, ledgers = {}) {
  const folded = {}
  for (const [id, events] of Object.entries(ledgers)) if (events.length > 0) folded[id] = events.length
  return { pet: newPet(at, name), folded, resetAt: at }
}

// Energy, 0 to 100: what's left of the 5-hour plan limit. `limit` is the last
// reading, { percentUsed, resetsAt }; once its window has reset, it's all back
export function energyFrom(limit, now) {
  // An older version kept the reading as the bare percent used
  if (typeof limit === 'number') limit = { percentUsed: limit, resetsAt: null }
  if (!limit || typeof limit.percentUsed !== 'number') return null
  if (limit.resetsAt && Date.parse(limit.resetsAt) <= now) return 100
  return Math.max(0, Math.min(100, 100 - limit.percentUsed))
}

// Whether Clawd is at work rather than idling, saying hi or walking home
export function isWorking(activityKind) {
  return workOf(activityKind) !== null
}

// What the pet is up to, for the header: what it's working at while Claude
// works, resting when the plan limit is nearly spent, waiting otherwise
export function doing(activityKind, energy) {
  if (isWorking(activityKind)) return WORK_LABEL[workOf(activityKind)] ?? 'working'
  if (activityKind === 'wave') return 'saying hi'
  if (energy !== null && energy <= 10) return 'resting'
  return 'waiting'
}

// The collection: which items have dropped, in the order of ITEMS
export function collection(pet) {
  const ids = Object.keys(ITEMS)
  const found = ids.filter((id) => pet.inventory[id] > 0)
  return { found: found.length, total: ids.length, items: ids.map((id) => ({ id, count: pet.inventory[id] ?? 0 })) }
}
