// Dev only: renders the 30-second showcase video's frames with the mod's own
// drawing code (the office, the clouds, Clawd's animations, the HUD bars and
// the collection strip) and streams them to scripts/encode-video.swift, which
// draws the captions and toasts and encodes the MP4.
//
//   node scripts/render-demo.mjs | swift scripts/encode-video.swift docs/demo.mp4
//   node scripts/render-demo.mjs --poster | swift scripts/encode-video.swift docs/preview.png
//
// The stream: a header, then each frame, each a little-endian u32 length and
// that much JSON (the frame's text), and for a frame, its pixels after the
// JSON: width x height x 4 bytes, BGRA, opaque.

import { writeSync } from 'node:fs'
import { CLAWD_AT, CLOUDS, CLOUD_STEP_MS, FRAMES, PALETTE, SCENE, SHADE } from '../hooks/sprites.js'
import { composite, withClouds } from '../hooks/render.js'
import { ANIMATIONS, WORK_LABEL, nextActivity, poseAt, standingAt, workOf } from '../hooks/animation.js'
import { collectionSvg, statRowSvg } from '../hooks/hud.js'
import { ITEMS, levelProgress } from '../hooks/pet.js'

const W = 1280
const H = 720
const FPS = 30
const DURATION_MS = 30_000
const isPoster = process.argv.includes('--poster')

// Layout: captions on top, then a card like the pane: a header line, the
// office, and below it the bars and the collection
const CARD = { x: 248, y: 122, w: 784, h: 578, r: 18 }
const SCALE = 16
const SCENE_AT = { x: (W - 44 * SCALE) / 2, y: 168 }
const HUD_SCALE = 3
const HUD_Y = SCENE_AT.y + 26 * SCALE + 18
const STRIP_X = SCENE_AT.x + 44 * SCALE - 222

const BG = [0x13, 0x13, 0x19]
const CARD_BG = [0x1d, 0x1d, 0x26]
const ORANGE = '#D77757'

// --- The story: when each turn starts and ends, and what it earns ---

const TURNS = [
  { work: 'laptop', start: 4300, end: 8120, exp: 25, energy: 93, drop: 'bit_cookie' },
  { work: 'paint', start: 9500, end: 13720, exp: 40, energy: 91, drop: null },
  { work: 'garden', start: 15300, end: 21860, exp: 30, energy: 88, drop: 'cache_cake' },
  { work: 'blocks', start: 22900, end: 26750, exp: 28, energy: 86, drop: 'context_crystal' },
]
const START = { exp: 80, energy: 95, inventory: { token_tea: 1, byte_bun: 2 } }

const CAPTIONS = [
  { from: 0, to: 4300, title: 'Tokengotchi', sub: 'Clawd, the Claude Code mascot, lives in a pixel office beside your session' },
  { from: 4300, to: 9400, title: 'When Claude works, Clawd works', sub: 'Every turn earns EXP and levels from the tokens it used' },
  { from: 9400, to: 15200, title: 'Something different every turn', sub: 'Typing, painting, gardening or building, picked at random' },
  { from: 15200, to: 22800, title: 'Energy is your 5-hour limit', sub: '5% used shows 95% energy, refilling when the window resets' },
  { from: 22800, to: 27100, title: 'Finished work drops collectibles', sub: 'Seven items to find, from common cookies to a legendary semicolon' },
  { from: 27100, to: 30000, title: 'Tokengotchi', sub: '/plugin install tokengotchi --marketplace stevefrdnt/cc-mods', mono: true },
]

// --- Drawing ---

const hexRGB = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
const px = Buffer.alloc(W * H * 4)

function rect(x, y, w, h, [r, g, b], alpha = 1) {
  const x0 = Math.max(0, Math.round(x))
  const y0 = Math.max(0, Math.round(y))
  const x1 = Math.min(W, Math.round(x + w))
  const y1 = Math.min(H, Math.round(y + h))
  for (let yy = y0; yy < y1; yy++)
    for (let xx = x0; xx < x1; xx++) {
      const i = (yy * W + xx) * 4
      if (alpha >= 1) { px[i] = b; px[i + 1] = g; px[i + 2] = r } else {
        px[i] = Math.round(px[i] * (1 - alpha) + b * alpha)
        px[i + 1] = Math.round(px[i + 1] * (1 - alpha) + g * alpha)
        px[i + 2] = Math.round(px[i + 2] * (1 - alpha) + r * alpha)
      }
      px[i + 3] = 255
    }
}

// The background and the card, drawn once and copied into each frame
const base = (() => {
  rect(0, 0, W, H, BG)
  const { x, y, w, h, r } = CARD
  for (let yy = y; yy < y + h; yy++)
    for (let xx = x; xx < x + w; xx++) {
      const dx = Math.max(x + r - xx, 0, xx - (x + w - 1 - r))
      const dy = Math.max(y + r - yy, 0, yy - (y + h - 1 - r))
      if (dx * dx + dy * dy <= r * r) rect(xx, yy, 1, 1, CARD_BG)
    }
  return Buffer.from(px)
})()

function drawGrid(grid, ox, oy, scale) {
  grid.forEach((line, y) => {
    for (let x = 0; x < line.length; x++) {
      const color = PALETTE[line[x]]
      if (color) rect(ox + x * scale, oy + y * scale, scale, scale, hexRGB(color))
    }
  })
}

// An SVG of rects and paths, as the HUD draws them, rasterized at `scale`.
// The EXP glint is an animation the still frames leave out
function drawSvg(svg, ox, oy, scale) {
  svg = svg.replace(/<clipPath[\s\S]*?<\/rect>/g, '')
  for (const m of svg.matchAll(/<rect x="(-?[\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" fill="(#\w{6})"(?: fill-opacity="([\d.]+)")?/g)) {
    const [x, y, w, h] = [m[1], m[2], m[3], m[4]].map(Number)
    rect(ox + Math.max(0, x) * scale, oy + y * scale, w * scale, h * scale, hexRGB(m[5]), m[6] ? Number(m[6]) : 1)
  }
}

// --- The story as the mod would live it ---

function stateAt(t) {
  let act = { kind: 'wave', since: 0, dx: 0 }
  let exp = START.exp
  let energy = START.energy
  const inventory = { ...START.inventory }
  const toasts = []
  let lastLevel = levelProgress(exp).level
  const settle = (until) => {
    for (let n = nextActivity(act, until); n && n.since <= until; n = nextActivity(act, until)) act = n
  }
  for (const turn of TURNS) {
    if (turn.start > t) break
    settle(turn.start)
    act = { kind: turn.work + '_open', since: turn.start, dx: standingAt(act, turn.start) }
    if (turn.end > t) break
    settle(turn.end)
    act = { kind: workOf(act.kind) + '_close', since: turn.end, dx: standingAt(act, turn.end) }
    exp += turn.exp
    energy = turn.energy
    if (turn.drop) {
      inventory[turn.drop] = (inventory[turn.drop] ?? 0) + 1
      const { name, rarity } = ITEMS[turn.drop]
      const words = rarity === 'common' ? name : `${rarity} ${name}`
      toasts.push({ at: turn.end, text: `Clawd found ${/^[aeiou]/i.test(words) ? 'an' : 'a'} ${words}!` })
    }
    const level = levelProgress(exp).level
    if (level > lastLevel) toasts.push({ at: turn.end + (turn.drop ? 2300 : 0), text: `Clawd reached level ${level}!` })
    lastLevel = level
  }
  settle(t)
  return { act, exp, energy, inventory, toasts }
}

// The bars ease toward a new value over EASE_MS after each turn ends
const EASE_MS = 700
function eased(t, pick) {
  const before = stateAt(Math.max(0, t - EASE_MS))
  const now = stateAt(t)
  const last = TURNS.filter((turn) => turn.end <= t).pop()
  if (!last || t - last.end >= EASE_MS) return pick(now)
  const k = (t - last.end) / EASE_MS
  const ease = 1 - Math.pow(1 - k, 3)
  const a = pick(stateAt(last.end - 1))
  const b = pick(now)
  return a + (b - a) * ease
}

function fade(t, from, to, ms = 260) {
  return Math.max(0, Math.min(1, (t - from) / ms, (to - t) / ms))
}

function frame(t, { captions = true } = {}) {
  base.copy(px)
  const { act, inventory, toasts } = stateAt(t)
  const expNow = eased(t, (s) => s.exp)
  const energyNow = eased(t, (s) => s.energy)

  // The office, its clouds drifting, Clawd in it
  const { frame: name } = poseAt(act.kind, t - act.since)
  const dx = standingAt(act, t)
  const sky = (Math.floor(t / CLOUD_STEP_MS) + 3) % CLOUDS.rows[0].length
  const scene = composite(withClouds(SCENE, CLOUDS, sky), FRAMES[name], { x: CLAWD_AT.x + dx, y: CLAWD_AT.y }, SHADE)
  drawGrid(scene, SCENE_AT.x, SCENE_AT.y, SCALE)

  // The bars and the collection
  const { level, into, needed } = levelProgress(Math.round(expNow))
  const expPct = ((expNow - (Math.round(expNow) - into)) / needed) * 100
  drawSvg(statRowSvg('exp', Math.min(100, expPct), Math.floor(Math.min(99, expPct)) + '%'), SCENE_AT.x, HUD_Y, HUD_SCALE)
  drawSvg(statRowSvg('energy', energyNow, Math.round(energyNow) + '%'), SCENE_AT.x, HUD_Y + 37, HUD_SCALE)
  const items = Object.keys(ITEMS).map((id) => ({ id, count: inventory[id] ?? 0 }))
  drawSvg(collectionSvg(items), STRIP_X, HUD_Y, HUD_SCALE)

  // The text, drawn by the encoder
  const texts = []
  const working = workOf(act.kind)
  const doing = working ? WORK_LABEL[working] : act.kind === 'wave' ? 'saying hi' : 'waiting'
  texts.push({ text: 'Clawd', x: SCENE_AT.x, y: CARD.y + 16, size: 22, weight: 'bold', color: '#EDEDF2' })
  texts.push({ text: `Lv ${level}`, x: SCENE_AT.x + 74, y: CARD.y + 16, size: 22, weight: 'bold', color: ORANGE })
  texts.push({ text: `· ${doing}`, x: SCENE_AT.x + 128, y: CARD.y + 16, size: 22, color: '#8A8597' })
  const found = items.filter((i) => i.count > 0).length
  texts.push({ text: `Collection ${found}/7`, x: STRIP_X, y: HUD_Y + 52, size: 16, color: '#8A8597' })

  for (const toast of toasts) {
    const a = fade(t, toast.at, toast.at + 2200, 200)
    if (a > 0) texts.push({ text: toast.text, x: CARD.x + CARD.w - 28, y: SCENE_AT.y + 14, size: 18, weight: 'bold', color: '#1D1D26', align: 'right', alpha: a, box: { pad: 10, color: '#F2B630', radius: 10 } })
  }

  if (captions)
    for (const c of CAPTIONS) {
      const a = fade(t, c.from, c.to)
      if (a <= 0) continue
      texts.push({ text: c.title, x: W / 2, y: 22, size: 38, weight: 'bold', color: '#F4F4F8', align: 'center', alpha: a })
      texts.push({ text: c.sub, x: W / 2, y: 74, size: c.mono ? 21 : 22, mono: !!c.mono, color: c.mono ? '#F0A07C' : '#A09BB0', align: 'center', alpha: a })
    }
  return { texts }
}

// --- The stream ---

function send(json, pixels) {
  const body = Buffer.from(JSON.stringify(json))
  const len = Buffer.alloc(4)
  len.writeUInt32LE(body.length)
  writeSync(1, len)
  writeSync(1, body)
  if (pixels) {
    let off = 0
    while (off < pixels.length) off += writeSync(1, pixels, off, Math.min(1 << 20, pixels.length - off))
  }
}

if (isPoster) {
  // A still for the README: Clawd typing, its bars and collection, no captions
  send({ width: W, height: H, fps: FPS, frames: 1, crop: { x: CARD.x - 24, y: CARD.y - 24, w: CARD.w + 48, h: CARD.h + 48 } })
  send(frame(6400, { captions: false }), px)
} else {
  const frames = Math.round((DURATION_MS / 1000) * FPS)
  send({ width: W, height: H, fps: FPS, frames })
  for (let i = 0; i < frames; i++) {
    const json = frame((i * 1000) / FPS)
    send(json, px)
  }
}
