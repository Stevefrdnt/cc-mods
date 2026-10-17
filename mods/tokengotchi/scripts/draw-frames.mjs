// Dev only: draws Clawd's frames and writes them into hooks/sprites.js (its
// FRAMES block, the frame size, the shading colors and SHADE). Hand edits to
// FRAMES are overwritten; change the drawing here instead.
//
//   node scripts/draw-frames.mjs
//
// Clawd is the Claude Code welcome-screen sprite (its quadrant-block rows
// doubled, so the pixels are square), given volume: the light comes from the
// office window, up and to the left, so the top face and the left column
// catch it, the right column and the bottom row fall away into shade, and the
// legs sit in the shadow under the body. Clawd and the laptop cast shadows on
// the floor, down and to the right, marked ',' and darkened from whatever the
// scene has beneath (SHADE).

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../hooks/sprites.js')
// Clawd and the laptop are drawn on a 20-wide grid, then padded to the frame's
// full width: Clawd in the middle, room on each side for an easel, a
// potted plant or a tower of blocks
const W = 20
const WIDE = 32
const PAD = (WIDE - W) / 2
const H = 16

// Clawd's ramp, the base its own (rgb 215,119,87): the highlight lighter and
// warmer, the shades darker and cooler, toward purple
const CLAWD = {
  o: '#D77757', // base
  q: '#F0A07C', // lit: the top face, the left column
  d: '#AE5550', // shade: the right column, the bottom row
  e: '#B85A4B', // the legs, under the body
  O: '#E99A7C', // the face lit by the laptop screen
}
const LAPTOP = {
  s: '#B9BFC7', // lid
  L: '#E1E6EC', // lid's lit edge
  j: '#8C939D', // lid's shaded side
  z: '#5E6570', // hinge, the deck's dark end
  S: '#7A818A', // deck
}

const blank = () => Array.from({ length: H }, () => Array(W).fill('.'))
const put = (g, x, y, c) => { if (x >= 0 && x < g[0].length && y >= 0 && y < H) g[y][x] = c }
const fill = (g, x0, x1, y0, y1, c) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(g, x, y, c) }
const at = (g, x, y) => (x >= 0 && x < g[0].length && y >= 0 && y < H ? g[y][x] : '.')
// A 20-wide drawing padded to the full frame width, Clawd in the middle
const widen = (g) => (g[0].length === WIDE ? g : g.map((row) => [...Array(PAD).fill('.'), ...row, ...Array(PAD).fill('.')]))
// A shadow pixel, only where nothing is drawn
const shadow = (g, x0, x1, y) => { for (let x = x0; x <= x1; x++) if (at(g, x, y) === '.') put(g, x, y, ',') }

// Clawd. Body x4..15 rows 4..11, eyes x6/x13 rows 6..7, legs x5,7,12,14 rows
// 12..13.
//   dy      sinks the body a pixel (a breath, a squash, a step's low point)
//   look    -1 / 0 / 1: the eyes glance left or right
//   arms    out | up (raised overhead) | left / right / none (typing beats)
//   left, right   one arm on its own: out | up | down | none, or a row number
//                 to hold it out sideways at that height (holding a brush,
//                 a marker, a block)
//   lift    legs lifted off the floor this frame, each stepping `step` px
//   glow    the face lit by the laptop screen
function clawd({ dy = 0, blink = false, look = 0, arms = 'out', left, right, glow = false, lift = [], step = 0 } = {}) {
  const g = blank()
  const top = 4 + dy
  const bottom = 11 + dy
  fill(g, 4, 15, top, bottom, 'o')
  // Volume: the lit top face and left column, the right column and bottom row in shade
  fill(g, 4, 14, top, top, 'q')
  fill(g, 4, 4, top, bottom - 1, 'q')
  fill(g, 15, 15, top + 1, bottom, 'd')
  fill(g, 5, 15, bottom, bottom, 'd')
  if (glow) fill(g, 5, 14, 6 + dy, 7 + dy, 'O')
  for (const x of [6 + look, 13 + look]) { put(g, x, 7 + dy, 'k'); if (!blink) put(g, x, 6 + dy, 'k') }

  // Legs, in the body's shadow; a lifted one is a pixel shorter and steps ahead
  for (const x of [5, 7, 12, 14]) {
    if (lift.includes(x)) put(g, x + step, 12 + dy, 'e')
    else fill(g, x, x, 12 + dy, 13, 'e')
  }

  // Arms: the left one catches the light along its top, the right one is shaded under
  const arm = (side, kind) => {
    const isLeft = side === 'left'
    const [outer, inner] = isLeft ? [2, 3] : [17, 16]
    const y = 8 + dy
    if (kind === 'out') {
      fill(g, Math.min(outer, inner), Math.max(outer, inner), y, y, isLeft ? 'q' : 'o')
      fill(g, Math.min(outer, inner), Math.max(outer, inner), y + 1, y + 1, isLeft ? 'o' : 'd')
    }
    if (kind === 'up') { fill(g, inner, inner, 2 + dy, 8 + dy, isLeft ? 'q' : 'd'); put(g, outer, 8 + dy, isLeft ? 'o' : 'd') }
    if (kind === 'down') { fill(g, inner, inner, y + 1, y + 2, isLeft ? 'q' : 'd'); if (glow) put(g, inner, y + 1, 'O') }
    // Waving: the arm raised beside the head, two pixels wide like the others,
    // the hand lit along its top: tipped out at the elbow, straight up, tipped in
    if (typeof kind === 'string' && kind.startsWith('wave_')) {
      const [a, b] = [Math.min(outer, inner), Math.max(outer, inner)]
      const tilt = { wave_out: isLeft ? -1 : 1, wave_up: 0, wave_in: isLeft ? 1 : -1 }[kind]
      fill(g, a, a, 5 + dy, 9 + dy, isLeft ? 'q' : 'o')
      fill(g, b, b, 5 + dy, 9 + dy, isLeft ? 'o' : 'd')
      fill(g, a + tilt, a + tilt, 2 + dy, 4 + dy, isLeft ? 'q' : 'o')
      fill(g, b + tilt, b + tilt, 2 + dy, 4 + dy, isLeft ? 'o' : 'd')
      fill(g, a + tilt, b + tilt, 2 + dy, 2 + dy, 'q')
    }
    if (typeof kind === 'number') {
      fill(g, Math.min(outer, inner), Math.max(outer, inner), kind + dy, kind + dy, isLeft ? 'q' : 'o')
      fill(g, Math.min(outer, inner), Math.max(outer, inner), kind + dy + 1, kind + dy + 1, isLeft ? 'o' : 'd')
    }
  }
  const beat = { out: ['out', 'out'], up: ['up', 'up'], left: ['down', 'out'], right: ['out', 'down'], none: [null, null] }[arms]
  arm('left', left === undefined ? beat[0] : left === 'none' ? null : left)
  arm('right', right === undefined ? beat[1] : right === 'none' ? null : right)

  // Its shadow on the floor, down and right of it
  shadow(g, 5, 16, 13)
  shadow(g, 6, 16, 14)
  return g
}

// The laptop, front view: Clawd behind it, so we see the lid's back. lid 0 is
// shut (a slab on the deck), 1-4 rise toward Clawd, 4 open. The lid narrows a
// pixel at the top once it's up, as a lid tipped away would, catches the light
// along its top and left edges, and is shaded down its right side.
// `lift` raises the laptop off the floor; its shadow stays on the floor,
// smaller the higher it goes
function laptop(g, lid, lift = 0) {
  const y = (r) => r - lift
  fill(g, 4, 15, y(13), y(13), 'S')
  put(g, 15, y(13), 'z')
  if (lid === 0) {
    fill(g, 4, 15, y(12), y(12), 's')
    put(g, 4, y(12), 'L')
    put(g, 15, y(12), 'j')
  } else {
    const top = 12 - lid
    fill(g, 5, 14, y(top), y(12), 's')
    fill(g, 5, 5, y(top), y(12), 'L')
    fill(g, 14, 14, y(top), y(12), 'j')
    if (lid >= 2) { put(g, 5, y(top), '.'); put(g, 14, y(top), '.') }
    fill(g, lid >= 2 ? 6 : 5, lid >= 2 ? 13 : 14, y(top), y(top), 'L')
    fill(g, 5, 14, y(12), y(12), 'z') // the hinge
    if (lid >= 3) { put(g, 9, y(top + 2), 'o'); put(g, 10, y(top + 2), 'o') }
  }
  if (lift === 0) {
    shadow(g, 5, 16, 14)
    if (lid >= 3) shadow(g, 7, 15, 15)
  } else if (lift < 8) {
    shadow(g, 6, 15, 14)
  } else {
    shadow(g, 8, 13, 14)
  }
}

// Code bits drifting up off the screen, a pixel a beat
const BITS = [[3, 0], [16, 2], [17, 1], [2, 3]]
function bits(g, t) {
  for (const [x, phase] of BITS) {
    const s = (t + phase) % 4
    put(g, x + (s === 3 ? (x < 10 ? -1 : 1) : 0), 3 - s, s >= 2 ? 'B' : 'b')
  }
}

const frames = {}
const add = (name, g) => { frames[name] = widen(g).map((r) => r.join('')) }

// Idle: standing, breathing, blinking, glancing about
add('idle_0', clawd())
add('idle_1', clawd({ dy: 1 }))
add('idle_blink', clawd({ blink: true }))
add('idle_look_l', clawd({ look: -1 }))
add('idle_look_r', clawd({ look: 1 }))

// Waving hello when you start or come back to a session: a hop, the right
// arm waving out, up, in, with a sparkle by the hand
add('wave_hop', clawd({ dy: 1 }))
add('wave_up', clawd({ right: 'wave_up' }))
{ const g = clawd({ right: 'wave_out' }); put(g, 19, 1, 'Y'); put(g, 19, 3, 'y'); add('wave_out', g) }
{ const g = clawd({ right: 'wave_in' }); put(g, 14, 1, 'y'); put(g, 13, 2, 'Y'); add('wave_in', g) }
add('wave_blink', clawd({ right: 'wave_up', blink: true }))

// Walking sideways, a crab's walk: the leg pairs lift in turn, each stepping
// ahead a pixel, the body dipping a pixel as the feet come down, the eyes
// looking where it's going. Four phases each way
for (const [dir, side] of [[1, 'r'], [-1, 'l']]) {
  add(`walk_${side}_0`, clawd({ look: dir, lift: [5, 12], step: dir }))
  add(`walk_${side}_1`, clawd({ look: dir, dy: 1 }))
  add(`walk_${side}_2`, clawd({ look: dir, lift: [7, 14], step: dir }))
  add(`walk_${side}_3`, clawd({ look: dir, dy: 1 }))
}

// Opening: the laptop comes down from overhead, lands with a squash, the lid
// rises in four steps, and the arms come in to type
{ const g = clawd({ arms: 'up' }); laptop(g, 0, 10); add('open_0', g) }
{ const g = clawd({ arms: 'up' }); laptop(g, 0, 4); add('open_1', g) }
{ const g = clawd({ dy: 1 }); laptop(g, 0); add('open_2', g) }
{ const g = clawd(); laptop(g, 1); add('open_3', g) }
{ const g = clawd({ blink: true }); laptop(g, 2); add('open_4', g) }
{ const g = clawd({ glow: true }); laptop(g, 3); add('open_5', g) }
{ const g = clawd({ glow: true }); laptop(g, 4); add('open_6', g) }

// Typing: eight beats, the arms tapping in turn, bits drifting up
const BEATS = ['left', 'none', 'right', 'none', 'left', 'right', 'none', 'none']
BEATS.forEach((arms, t) => {
  const g = clawd({ arms, glow: true, blink: t === 7 })
  laptop(g, 4)
  if (arms === 'left') put(g, 2, 11, 'w')
  if (arms === 'right') put(g, 17, 11, 'w')
  bits(g, t)
  add(`type_${t}`, g)
})

// Closing: the lid shuts in steps, the laptop goes back up overhead, a poof
{ const g = clawd({ glow: true }); laptop(g, 3); add('close_0', g) }
{ const g = clawd(); laptop(g, 2); add('close_1', g) }
{ const g = clawd(); laptop(g, 1); add('close_2', g) }
{ const g = clawd({ dy: 1 }); laptop(g, 0); add('close_3', g) }
{ const g = clawd({ arms: 'up' }); laptop(g, 0, 4); add('close_4', g) }
{ const g = clawd({ arms: 'up' }); laptop(g, 0, 10); add('close_5', g) }
{
  const g = clawd()
  for (const [x, y] of [[3, 11], [9, 12], [16, 11], [6, 13], [13, 13]]) put(g, x, y, 'y')
  for (const [x, y] of [[4, 12], [10, 11], [15, 12]]) put(g, x, y, 'Y')
  add('close_6', g)
}


// --- Painting: an easel on Clawd's left ---
// Full-width coordinates from here: Clawd's body is x10..21, its left arm
// x8..9, its right arm x22..23

// The picture, revealed a stroke at a time: sky with a sun, hills
const PAINTING = ['bbbbyb', 'bbbbbb', 'GGbbbG', 'GGGGGG', 'DDDGDD']
const STROKES = [
  { row: 0, xs: [0, 1, 2] },
  { row: 0, xs: [3, 4, 5] },
  { row: 1, xs: [0, 1, 2, 3, 4, 5] },
  { row: 2, xs: [0, 1, 2, 3, 4, 5] },
  { row: 3, xs: [0, 1, 2, 3, 4, 5] },
  { row: 4, xs: [0, 1, 2, 3, 4, 5] },
]
const sparkle = (g, spots) => {
  spots.forEach(([x, y], i) => put(g, x, y, i % 2 ? 'Y' : 'y'))
}
// The easel: canvas x0..7 rows 3..9 (its wooden edge 'n', the white inside
// x1..6 rows 4..8), a ledge, three legs, and its shadow on the floor
function easel(g, strokes, { done = false } = {}) {
  fill(g, 0, 7, 3, 9, 'n')
  fill(g, 1, 6, 4, 8, 'w')
  STROKES.slice(0, strokes).forEach(({ row, xs }) => xs.forEach((x) => put(g, 1 + x, 4 + row, PAINTING[row][x])))
  if (done) sparkle(g, [[0, 2], [7, 2], [8, 5]])
  fill(g, 0, 7, 10, 10, 'P')
  for (const [x, y] of [[1, 11], [1, 12], [1, 13], [6, 11], [6, 12], [6, 13]]) put(g, x, y, 'P')
  for (const y of [11, 12, 13]) put(g, 4, y, 'n')
  shadow(g, 2, 8, 14)
}
// Clawd's left arm held out at `row` with a brush whose tip, in `color`, is at the canvas
function brush(g, row, color) {
  put(g, 8, row - 1, 'P')
  put(g, 7, row, color)
}
const painter = (opts) => widen(clawd({ look: -1, ...opts }))

{ const g = painter({}); sparkle(g, [[1, 6], [4, 4], [6, 9], [3, 11]]); add('paint_open_0', g) }
{ const g = painter({}); easel(g, 0); add('paint_open_1', g) }
{ const g = painter({ left: 6 }); easel(g, 0); brush(g, 6, 'b'); add('paint_open_2', g) }
STROKES.forEach(({ row }, i) => {
  const at = 4 + row
  const color = PAINTING[row][STROKES[i].xs[0]]
  { const g = painter({ left: at }); easel(g, i); brush(g, at, color); add(`paint_reach_${i}`, g) }
  { const g = painter({ left: at, dy: i % 2 }); easel(g, i + 1); brush(g, at, color); add(`paint_dab_${i}`, g) }
})
{ const g = painter({}); easel(g, STROKES.length); add('paint_admire', g) }
{ const g = painter({ blink: true }); easel(g, STROKES.length); add('paint_admire_blink', g) }
{ const g = widen(clawd({})); easel(g, STROKES.length, { done: true }); add('paint_done', g) }
{ const g = painter({ left: 6 }); easel(g, 0); brush(g, 6, 'b'); add('paint_fresh', g) }
{ const g = widen(clawd({})); sparkle(g, [[1, 6], [4, 4], [6, 9], [3, 11], [5, 7]]); add('paint_close_0', g) }

// --- Gardening: watering a potted plant on Clawd's left ---
// On the left, the open side of the room, so it isn't mistaken for the
// office's own plant in the corner

// The pot: a dark rim x0..5 on row 11, its body x1..4 rows 12..13, shaded on
// the right, and its shadow on the floor
function pot(g) {
  fill(g, 0, 5, 11, 11, 'n')
  fill(g, 1, 4, 12, 13, 'P')
  fill(g, 4, 4, 12, 13, 'n')
  shadow(g, 2, 6, 14)
}
// The plant at each stage, from a sprout to a flower in bloom, its stem at x3
const PLANT = [
  [[3, 10, 'G'], [2, 9, 'G'], [4, 9, 'G']],
  [[3, 10, 'G'], [3, 9, 'G'], [3, 8, 'G'], [2, 9, 'G'], [1, 8, 'D'], [4, 8, 'G'], [5, 7, 'D']],
  [[3, 10, 'G'], [3, 9, 'G'], [3, 8, 'G'], [3, 7, 'G'], [3, 6, 'G'], [2, 9, 'G'], [1, 8, 'D'], [4, 8, 'G'], [5, 7, 'D'], [2, 6, 'G'], [4, 5, 'D']],
  [[3, 10, 'G'], [3, 9, 'G'], [3, 8, 'G'], [3, 7, 'G'], [3, 6, 'G'], [3, 5, 'p'], [2, 9, 'G'], [1, 8, 'D'], [4, 8, 'G'], [5, 7, 'D'], [2, 6, 'G'], [4, 6, 'D']],
  [[3, 10, 'G'], [3, 9, 'G'], [3, 8, 'G'], [3, 7, 'G'], [3, 6, 'G'], [3, 4, 'y'], [2, 4, 'p'], [4, 4, 'p'], [3, 3, 'p'], [3, 5, 'p'], [2, 9, 'G'], [1, 8, 'D'], [4, 8, 'G'], [5, 7, 'D'], [2, 6, 'G'], [4, 6, 'D']],
]
function plant(g, stage) {
  pot(g)
  for (const [x, y, c] of PLANT[stage]) put(g, x, y, c)
}
// The watering can in Clawd's left hand, tipped toward the pot: a blue body
// x5..7 rows 4..5 lit along its top, a spout, and drops falling from it,
// `drop` (0-2) saying how far down they've got
function can(g, drop = null) {
  fill(g, 5, 7, 4, 5, 'x')
  fill(g, 5, 7, 4, 4, 'H')
  put(g, 6, 3, 'x') // the handle's top
  put(g, 4, 5, 'x')
  put(g, 4, 6, 'x') // the spout, tipped down
  if (drop !== null) for (const y of [7 + drop, 10 - drop]) if (y <= 10) put(g, 4, y, 'b')
}
const gardener = (opts) => widen(clawd({ look: -1, ...opts }))

{ const g = gardener({}); sparkle(g, [[2, 12], [5, 10], [3, 8], [1, 11]]); add('garden_open_0', g) }
{ const g = gardener({}); plant(g, 0); add('garden_open_1', g) }
for (let stage = 0; stage < PLANT.length - 1; stage++) {
  for (let d = 0; d < 3; d++) { const g = gardener({ left: 4 }); plant(g, stage); can(g, d); add(`garden_pour_${stage}_${d}`, g) }
  { const g = gardener({ left: 4 }); plant(g, stage + 1); can(g); add(`garden_grow_${stage}`, g) }
}
{ const g = gardener({}); plant(g, 4); add('garden_admire', g) }
{ const g = gardener({ blink: true }); plant(g, 4); add('garden_admire_blink', g) }
{ const g = widen(clawd({})); plant(g, 4); sparkle(g, [[1, 3], [5, 2], [5, 5]]); add('garden_bloom', g) }
{ const g = widen(clawd({})); sparkle(g, [[2, 12], [5, 10], [3, 6], [1, 11], [3, 4]]); add('garden_close_0', g) }

// --- Blocks: a tower on the floor to Clawd's right ---

// Toy blocks, 3x3, lit along the top: [base, highlight]
const BLOCKS = [['r', 'E'], ['t', 'F'], ['x', 'H']]
function block(g, x, y, [base, hi], rows = 3) {
  fill(g, x, x + 2, y, y + rows - 1, base)
  fill(g, x, x + 2, y, y, hi)
}
// The tower at x25..27, block i resting on rows 11-3i..13-3i
const towerTop = (n) => 13 - 3 * n + 1
function tower(g, n, sway = 0) {
  for (let i = 0; i < n; i++) block(g, 25 + (i === n - 1 ? sway : 0), 11 - 3 * i, BLOCKS[i])
  if (n) shadow(g, 26, 29, 14)
}
const builder = (opts) => widen(clawd({ look: 1, ...opts }))

{ const g = builder({}); sparkle(g, [[25, 12], [28, 10], [27, 13], [30, 11]]); add('blocks_open_0', g) }
BLOCKS.forEach((colors, i) => {
  // Carried in the right hand just above the tower, then set down on it
  const row = towerTop(i) - 3
  { const g = builder({ right: row + 1 }); tower(g, i); block(g, 24, row, colors); add(`blocks_carry_${i}`, g) }
  { const g = builder({}); tower(g, i + 1); add(`blocks_place_${i}`, g) }
})
{ const g = builder({ dy: 1 }); tower(g, 3); add('blocks_proud', g) }
{ const g = builder({}); tower(g, 3, 1); add('blocks_wobble_0', g) }
{ const g = builder({}); tower(g, 3, -1); add('blocks_wobble_1', g) }
{
  // Down it comes: the blocks tumbled across the floor, Clawd startled
  const g = builder({ dy: 1, blink: true })
  block(g, 24, 11, BLOCKS[0])
  block(g, 27, 11, BLOCKS[1])
  block(g, 29, 12, BLOCKS[2], 2)
  shadow(g, 25, 31, 14)
  add('blocks_toppled', g)
}
{
  const g = builder({ look: 0 })
  block(g, 24, 11, BLOCKS[0])
  block(g, 27, 11, BLOCKS[1])
  block(g, 29, 12, BLOCKS[2], 2)
  shadow(g, 25, 31, 14)
  add('blocks_look', g)
}
{ const g = widen(clawd({})); sparkle(g, [[25, 12], [28, 10], [27, 13], [30, 11], [26, 8]]); add('blocks_clear', g) }

// --- Writing sprites.js ---

let src = readFileSync(OUT, 'utf8')

// The scene's colors that a shadow can fall on, each with a darker, slightly
// cooler key for SHADE
const darker = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const out = [r * 0.72, g * 0.72, b * 0.78].map((v) => Math.round(v).toString(16).padStart(2, '0'))
  return '#' + out.join('')
}
const SHADOW_KEYS = { '5': '%', '6': '^', '7': '&', '8': '*', '3': '~' }
const palette = (() => {
  const block = src.slice(src.indexOf('export const PALETTE = {'), src.indexOf('\n}\n', src.indexOf('export const PALETTE = {')))
  return Object.fromEntries([...block.matchAll(/'(.)': '(#[0-9A-Fa-f]{6})'/g)].map((m) => [m[1], m[2]]))
})()

// Set (or add) each color in PALETTE
const setColor = (key, hex, note) => {
  const line = new RegExp(`  '${key.replace(/[\\^$*+?.()|[\]{}]/g, '\\$&')}': '#[0-9A-Fa-f]{6}',[^\\n]*`)
  const entry = `  '${key}': '${hex}',${note ? ' // ' + note : ''}`
  if (line.test(src)) src = src.replace(line, entry)
  else {
    const end = src.indexOf('\n}\n', src.indexOf('export const PALETTE = {'))
    src = src.slice(0, end) + '\n' + entry + src.slice(end)
  }
}
for (const [k, v] of Object.entries(CLAWD)) setColor(k, v, { o: "Clawd's body, rgb(215,119,87) as in Claude Code", q: 'Clawd, lit', d: 'Clawd, in shade', e: "Clawd's legs", O: 'the face lit by the screen' }[k])
for (const [k, v] of Object.entries(LAPTOP)) setColor(k, v, { s: 'laptop lid', L: "lid's lit edge", j: "lid's shaded side", z: 'hinge', S: 'laptop deck' }[k])
for (const [k, v, note] of [
  ['r', '#E5484D', 'toy block, red'],
  ['E', '#FF8A85', '  lit'],
  ['t', '#F2B630', 'toy block, yellow'],
  ['F', '#FFE38A', '  lit'],
  ['x', '#4FA8FF', 'toy block, blue'],
  ['H', '#B0DBFF', '  lit'],
  ['g', '#4CC35A', 'marker, green'],
]) setColor(k, v, note)
for (const [from, to] of Object.entries(SHADOW_KEYS)) setColor(to, darker(palette[from]), `shadow on '${from}'`)

// SHADE, after PALETTE
const shadeBlock = `// What a shadow pixel (',' in a frame) turns each scene color into
export const SHADE = ${JSON.stringify(SHADOW_KEYS).replace(/"/g, "'").replace(/,/g, ', ').replace(/:/g, ': ')}
`
if (src.includes('export const SHADE')) src = src.replace(/\/\/ What a shadow pixel[^\n]*\nexport const SHADE = [^\n]*\n/, shadeBlock)
else src = src.replace('export const SPRITE_W', shadeBlock + '\nexport const SPRITE_W')
src = src.replace(/export const SPRITE_H = \d+/, `export const SPRITE_H = ${H}`)
src = src.replace(/export const SPRITE_W = \d+/, `export const SPRITE_W = ${WIDE}`)

// FRAMES
const fmt = (grid) => '[\n' + grid.map((r) => `    '${r}',`).join('\n') + '\n  ]'
const fStart = src.indexOf('export const FRAMES = {')
const fEnd = src.indexOf('\n}\n', fStart) + 3
src = src.slice(0, fStart) + `export const FRAMES = {\n${Object.entries(frames).map(([k, g]) => `  ${k}: ${fmt(g)},`).join('\n')}\n}\n` + src.slice(fEnd)

// The header's list of frames
src = src.replace(/\/\/ Frames, by what the pet is doing[\s\S]*?\n\n/, `// Frames, by what the pet is doing (animation.js says which play when):
//   idle_0, idle_1, idle_blink, idle_look_l, idle_look_r
//                                standing, breathing, blinking, glancing about
//   walk_r_0 .. 3, walk_l_0 .. 3 crab-walking right, and left
//   wave_*                       waving hello as a session starts
//   open_*, type_*, close_*      at the laptop: it comes down and opens, the
//                                typing loop, the lid shuts and it goes away
//   paint_*                      painting a landscape on an easel
//   garden_*                     watering a potted plant until it blooms
//   blocks_*                     building a tower of blocks, which topples
//
// The frames are drawn by scripts/draw-frames.mjs; change them there. A ','
// pixel is a shadow, darkening the scene beneath it (SHADE).

`)
src = src.replace(/Pet frames are \d+x\d+, item icons\n\/\/ 8x8\./, `Pet frames are ${WIDE}x${H}, item icons\n// 8x8.`)
writeFileSync(OUT, src)
console.log('wrote', Object.keys(frames).length, 'frames,', WIDE + 'x' + H)
