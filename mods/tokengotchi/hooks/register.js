// tokengotchi: Clawd, the Claude Code mascot, as a pet that lives in a pane.
//
// While Claude works, Clawd opens a laptop and types; when the work ends it
// closes the laptop. Tokens spent give EXP and levels, finished work sometimes
// drops an item for the collection, and Energy is what's left of the 5-hour
// plan limit.
//
// One pet is shared by every session on the machine. Each session appends what
// happened to its own ledger in $.store, and the pet is folded from a base
// snapshot plus every ledger (see pet.js), so two sessions never overwrite
// each other's progress.

import { atom, read, update } from 'claude-code'
import { CLAWD_AT, CLOUDS, CLOUD_STEP_MS, FRAMES, PALETTE, SCENE, SCENE_H, SCENE_W, SHADE } from './sprites.js'
import { ANIMATIONS, WORK_ALT, known, nextActivity, pickWork, poseAt, standingAt, workOf } from './animation.js'
import { animatedScene, composite, rasterProps, withClouds } from './render.js'
import { ROW_W, SCALE as HUD_SCALE, STATS, STRIP_H, STRIP_SCALE, TERM_COLS, TERM_GLYPH, TERM_LABEL, collectionSvg, statBarCells, statRowSvg, stripWidth } from './hud.js'
import { ITEMS, RARITY, collection, doing, energyFrom, expForTurn, fold, isWorking, levelFor, levelProgress, newBase, rollDrop, seeded } from './pet.js'

const PANE = 'tokengotchi'
const SPRITE_KEY = 'clawd'
// CSS pixels per scene pixel on desktop
const SCALE = 5
const TICK_MS = 40
// A ledger left by a session that ended this long ago is folded into the base and removed
const STALE_MS = 2 * 24 * 3_600_000

// What the pane draws from
const petView = atom({ plugin: 'tokengotchi', key: 'pet' }, null)
const activity = atom({ plugin: 'tokengotchi', key: 'activity' }, { kind: 'idle', since: 0, dx: 0 })
const fiveHour = atom({ plugin: 'tokengotchi', key: 'fiveHour' }, null)
const lastDrop = atom({ plugin: 'tokengotchi', key: 'lastDrop' }, null)

// This session's ledger: its store key and its events so far
let ledgerKey = null
let events = []
// The terminal frame last painted, so the timer blits only on a change
let painted = null
// The work Clawd did last, so the next one is different
let lastWork = null
// The mod's settings, from the manifest's userConfig
let config = { name: undefined, showStatus: true }

// Fold the base and every ledger into the pet, and publish it to the pane
async function refresh($) {
  const { base, ledgers } = await readAll($)
  const pet = fold(base, ledgers).pet
  await update($, petView, () => pet)
  status($, pet, await read($, activity))
  return pet
}

async function readAll($) {
  const keys = await $.store.keys()
  const now = await $.clock.now()
  const base = (await $.store.get('base')) ?? newBase(now, config.name)
  const ledgers = {}
  for (const key of keys) {
    if (!key.startsWith('ledger:')) continue
    const list = await $.store.get(key)
    if (Array.isArray(list)) ledgers[key] = list
  }
  if (ledgerKey) {
    // Our ledger gone from the store while we hold events means another
    // session merged it into the base (we were open for days): those events
    // are in the base now, so start a fresh ledger rather than count them twice
    if (events.length > 0 && !keys.includes(ledgerKey)) events = []
    ledgers[ledgerKey] = events
  }
  return { base, ledgers }
}

// Add an event to this session's ledger. Returns the pet before and after
async function record($, event) {
  const before = await read($, petView)
  await readAll($)
  events = [...events, event]
  await $.store.set(ledgerKey, events)
  const after = await refresh($)
  return { before, after }
}

// Fold old sessions' ledgers into the base and drop them, so the store stays small
async function compact($) {
  const { base, ledgers } = await readAll($)
  const now = await $.clock.now()
  const next = fold(base, ledgers)
  await $.store.set('base', next)
  for (const [key, list] of Object.entries(ledgers)) {
    if (key === ledgerKey) continue
    const lastAt = list.length ? list[list.length - 1].at : 0
    if (now - lastAt < STALE_MS) continue
    // Only once the base we wrote is the one that stands, with this ledger in it
    const stands = await $.store.get('base')
    if (stands?.folded?.[key] === list.length) {
      await $.store.delete(key)
      const { [key]: _, ...rest } = stands.folded
      await $.store.set('base', { ...stands, folded: rest })
    }
  }
}

function status($, pet, act) {
  if (!config.showStatus || !pet) return
  const working = isWorking(act.kind) ? ' · working' : ''
  $.ui.status(`${pet.name} Lv ${levelFor(pet.exp)}${working}`)
}

// Clawd waves hello, unless it's busy at work
async function wave($) {
  const act = await read($, activity)
  if (!isWorking(act.kind)) await setActivity($, 'wave')
}

// Work starts or ends where Clawd stands, so it never jumps
async function setActivity($, kind) {
  const now = await $.clock.now()
  await update($, activity, (act) => ({ kind, since: now, dx: standingAt(act, now) }))
  status($, await read($, petView), { kind })
}

// The 5-hour plan limit, for Energy. Readings arrive with Claude's replies, so
// a new session has none until its first: keep the last one in the store,
// shared by every session, and show it meanwhile
async function readUsage($) {
  let limit = null
  try {
    const usage = await $.session.usage()
    const live = (usage.rateLimits ?? []).find((r) => r.kind === 'five_hour')
    if (live) {
      limit = { percentUsed: live.percentUsed, resetsAt: live.resetsAt ?? null }
      await $.store.set('fiveHour', limit)
    }
  } catch {
    // No usage yet
  }
  if (!limit) {
    const saved = await $.store.get('fiveHour')
    if (saved && typeof saved.percentUsed === 'number') limit = saved
  }
  if (limit) await update($, fiveHour, () => limit)
}

export function register(on, options = {}) {
  config = { name: options.name || undefined, showStatus: options.statusLine !== false }
  const showToasts = options.toasts !== false

  on('session.start', async ($, e, next) => {
    ledgerKey = 'ledger:' + (await $.session.id())
    const mine = await $.store.get(ledgerKey)
    events = Array.isArray(mine) ? mine : []
    try {
      await compact($)
    } catch {
      // A store that can't be compacted now is compacted next time
    }
    await refresh($)
    await readUsage($)
    // Idle starts from the middle of the rug, at the start of its route, and a
    // starting or resumed session opens with a wave hello
    const now = await $.clock.now()
    await update($, activity, (act) => (act.since === 0 || known(act.kind) !== act.kind ? { kind: 'idle', since: now, dx: 0 } : act))
    await wave($)

    await $.command.register({
      name: 'pet',
      description: "Open Clawd's pane, or check its level and collection",
      argumentHint: '[stats | collection | rename <name> | reset]',
      immediate: true,
    })
    if (options.openOnStart !== false) void $.ui.open({ id: PANE, title: 'Clawd' })

    // Move one-shot animations on (opening → typing, closing → idle) and paint
    // the terminal's frames
    $.clock.every(TICK_MS, async () => {
      const act = await read($, activity)
      const now = await $.clock.now()
      const moved = nextActivity(act, now)
      if (moved) {
        await update($, activity, () => moved)
        return
      }
      if (painted === null) return
      const { frame } = poseAt(act.kind, now - act.since)
      const dx = standingAt(act, now)
      const sky = cloudStep(now)
      const pose = frame + '@' + dx + '~' + sky
      if (pose === painted) return
      const result = await $.ui.blit({ requestId: PANE, key: SPRITE_KEY, ...sceneRaster(frame, dx, sky) })
      painted = result && 'deny' in result ? null : pose
    })
    // Other sessions' progress, and Energy coming back when the 5-hour window resets
    $.clock.every(60_000, async () => {
      await refresh($)
      await readUsage($)
    })

    return next(e)
  })

  // Clearing the conversation or resuming another one in this window: a new
  // conversation, so Clawd says hello again
  on('session.end', async ($, e, next) => {
    const ended = await next(e)
    if (e.reason === 'clear' || e.reason === 'resume') await wave($)
    return ended
  })

  on('session.measure', async ($, e, next) => {
    await readUsage($)
    return next(e)
  })

  // Work starts on the main loop: Clawd picks something to work at, never
  // what it did last time
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      const act = await read($, activity)
      const isSettingUp = act.kind.endsWith('_open') || act.kind.endsWith('_loop')
      if (!isSettingUp) {
        const work = pickWork(seeded(e.turnId, 4), lastWork)
        lastWork = work
        await setActivity($, work + '_open')
      }
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const isSubagent = e.agentId !== undefined
    const now = await $.clock.now()
    const isAnswer = e.reason === 'answer' && !isSubagent
    const exp = expForTurn(e.usage, isSubagent)
    const drop = isAnswer ? rollDrop(e.turnId) : null

    if (!isSubagent) {
      const work = workOf((await read($, activity)).kind)
      if (work) await setActivity($, work + '_close')
    }
    if (exp > 0 || isAnswer) {
      const { before, after } = await record($, { type: 'turn', id: e.turnId, at: now, exp, isAnswer, drop })
      if (drop) {
        await update($, lastDrop, () => ({ item: drop, at: now }))
        if (showToasts) {
          $.ui.toast(`${after.name} found ${dropPhrase(drop)}!`)
        }
      }
      const levelBefore = before ? levelFor(before.exp) : 0
      const levelAfter = levelFor(after.exp)
      if (showToasts && levelAfter > levelBefore) $.ui.toast(`${after.name} reached level ${levelAfter}!`)
    }
    return result
  })

  on('command.run', { command: 'pet' }, async ($, e) => {
    const [verb = '', ...rest] = e.args.trim().split(/\s+/)
    const arg = rest.join(' ')
    const pet = await read($, petView)
    if (!pet) return { text: 'Clawd is still waking up. Try again in a moment.' }

    switch (verb.toLowerCase()) {
      case '':
      case 'open': {
        const opened = await $.ui.open({ id: PANE, title: 'Clawd' })
        return { text: opened.isPlaced ? `${pet.name} is in the pane.` : `${pet.name}'s pane is waiting for room: ${opened.reason}` }
      }
      case 'collection':
      case 'bag': {
        const c = collection(pet)
        if (c.found === 0) return { text: `Nothing found yet: 0 of ${c.total}. Finished work sometimes drops an item.` }
        return { text: `${c.found} of ${c.total} found: ${collectionText(pet)}.` }
      }
      case 'stats': {
        const { level, into, needed } = levelProgress(pet.exp)
        const energy = energyFrom(await read($, fiveHour), await $.clock.now())
        const c = collection(pet)
        return {
          text: [
            `${pet.name}, level ${level} (${into}/${needed} EXP to the next)`,
            `Energy ${energy === null ? 'unknown' : Math.round(energy) + '%'} (what's left of your 5-hour limit)`,
            `${pet.turns} pieces of work finished, ${pet.drops} drops, ${c.found} of ${c.total} items collected`,
          ].join('\n'),
        }
      }
      case 'rename': {
        const name = arg.slice(0, 24)
        if (!name) return { text: 'Give a name: /pet rename <name>' }
        const now = await $.clock.now()
        await record($, { type: 'rename', id: `${ledgerKey}:${events.length}`, at: now, name })
        return { text: `Your pet is now called ${name}.` }
      }
      case 'reset': {
        if (arg !== 'confirm') return { text: `This starts over with a new pet and loses ${pet.name}'s level and collection. Run /pet reset confirm to go ahead.` }
        const now = await $.clock.now()
        const { ledgers } = await readAll($)
        await $.store.set('base', newBase(now, config.name, ledgers))
        await update($, lastDrop, () => null)
        await refresh($)
        return { text: 'A new Clawd has arrived.' }
      }
      default:
        return { text: 'Try /pet, /pet stats, /pet collection, /pet rename <name> or /pet reset.' }
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text } = els
    const pet = await read($, petView)
    const act = await read($, activity)
    const limit = await read($, fiveHour)
    const drop = await read($, lastDrop)
    const now = await $.clock.now()
    if (!pet) return Text({ dimColor: true, children: ['Clawd is waking up…'] })

    // The office with Clawd in it: a Raster the timer repaints in the terminal,
    // an animated SVG elsewhere
    let sprite
    if (e.surface === 'terminal') {
      const { frame } = poseAt(act.kind, now - act.since)
      const dx = standingAt(act, now)
      const sky = cloudStep(now)
      painted = frame + '@' + dx + '~' + sky
      sprite = els.Raster(sceneRaster(frame, dx, sky))
    } else if (els.Svg) {
      const anim = ANIMATIONS[known(act.kind)]
      const frames = anim.frames.map(([name, ms, dx = 0]) => [FRAMES[name], ms, (act.dx ?? 0) + dx])
      sprite = els.Svg({
        source: animatedScene(SCENE, frames, CLAWD_AT, PALETTE, SCALE, {
          loop: anim.loop,
          shade: SHADE,
          clouds: { strip: CLOUDS, stepMs: CLOUD_STEP_MS, step: cloudStep(now) },
        }),
        alt: `${pet.name} in the office, ${isWorking(act.kind) ? WORK_ALT[workOf(act.kind)] ?? 'working' : act.kind === 'wave' ? 'waving hello' : 'waiting'}`,
        width: SCENE_W * SCALE,
        height: SCENE_H * SCALE,
      })
    }

    const { level, into, needed } = levelProgress(pet.exp)
    const energy = energyFrom(limit, now)

    // One stat: a pixel-art SVG row where the surface draws SVG, a padded
    // label and a half-block bar in the terminal
    const bar = (key, value, shown) => {
      const isKnown = value !== null
      const text = shown ?? (isKnown ? String(Math.round(value)) : '–')
      if (e.surface !== 'terminal' && els.Svg) {
        return Box({
          key: 'stat-' + key,
          flexShrink: 0,
          children: [els.Svg({ source: statRowSvg(key, value, shown), alt: `${TERM_LABEL[key]} ${text}`, width: ROW_W * HUD_SCALE, height: 9 * HUD_SCALE })],
        })
      }
      const { colors } = STATS[key]
      return Box({
        key: 'stat-' + key,
        flexDirection: 'row',
        columnGap: 1,
        children: [
          Text({ color: colors.base, children: [TERM_GLYPH[key]] }),
          Text({ dimColor: true, children: [TERM_LABEL[key].padEnd(9)] }),
          ...(els.Raster ? [els.Raster({ key: 'bar-' + key, columns: TERM_COLS, rows: 1, cells: statBarCells(key, value) })] : []),
          Text({ color: isKnown ? colors.base : undefined, dimColor: !isKnown, children: [text.padStart(4)] }),
        ],
      })
    }

    // The collection: every item's icon, silhouetted until found, on desktop;
    // a line of what's been found in the terminal
    const c = collection(pet)
    const strip =
      e.surface !== 'terminal' && els.Svg
        ? els.Svg({ source: collectionSvg(c.items), alt: `${c.found} of ${c.total} items collected`, width: stripWidth(c.items.length), height: STRIP_H * STRIP_SCALE })
        : Text({ dimColor: c.found === 0, children: [c.found ? collectionText(pet) : 'Finished work sometimes drops an item.'] })

    return Box({
      flexDirection: 'column',
      alignItems: 'center',
      rowGap: 1,
      children: [
        Box({
          flexDirection: 'row',
          columnGap: 1,
          children: [Text({ bold: true, children: [pet.name] }), Text({ color: '#D77757', children: [`Lv ${level}`] }), Text({ dimColor: true, children: [`· ${doing(act.kind, energy)}`] })],
        }),
        ...(sprite ? [Box({ flexShrink: 0, children: [sprite] })] : []),
        Box({
          flexDirection: 'column',
          children: [
            bar('exp', (into / needed) * 100, Math.floor((into / needed) * 100) + '%'),
            bar('energy', energy, energy === null ? undefined : Math.round(energy) + '%'),
          ],
        }),
        ...(drop ? [Text({ dimColor: true, children: [`Last drop: ${ITEMS[drop.item].name} (${RARITY[ITEMS[drop.item].rarity].label})`] })] : []),
        Box({
          key: 'collection',
          flexDirection: 'column',
          alignItems: 'center',
          children: [Text({ dimColor: true, children: [`Collection ${c.found}/${c.total}`] }), Box({ flexShrink: 0, children: [strip] })],
        }),
      ],
    })
  })
}

// 'a Bit Cookie', 'an uncommon Cache Cake', 'a rare Context Crystal'
function dropPhrase(item) {
  const { name, rarity } = ITEMS[item]
  const words = rarity === 'common' ? name : RARITY[rarity].label.toLowerCase() + ' ' + name
  return (/^[aeiou]/i.test(words) ? 'an ' : 'a ') + words
}

// How many pixels along the clouds have drifted, by the clock, so every
// surface and every redraw agrees
function cloudStep(now) {
  return Math.floor(now / CLOUD_STEP_MS) % CLOUDS.rows[0].length
}

// The scene with its clouds `sky` pixels along and a frame of Clawd in it,
// `dx` pixels from its spot, as terminal cells. Each pose's cells are worked
// out once, the cache cleared when it grows large
const sceneCells = new Map()
const skies = new Map()
function sceneRaster(frame, dx = 0, sky = 0) {
  const pose = frame + '@' + dx + '~' + sky
  if (!sceneCells.has(pose)) {
    if (sceneCells.size > 400) sceneCells.clear()
    if (!skies.has(sky)) skies.set(sky, withClouds(SCENE, CLOUDS, sky))
    const at = { x: CLAWD_AT.x + dx, y: CLAWD_AT.y }
    sceneCells.set(pose, rasterProps(SPRITE_KEY, composite(skies.get(sky), FRAMES[frame], at, SHADE), PALETTE))
  }
  return sceneCells.get(pose)
}

function collectionText(pet) {
  return collection(pet)
    .items.filter((item) => item.count > 0)
    .map(({ id, count }) => `${ITEMS[id].name} ×${count}`)
    .join(', ')
}
