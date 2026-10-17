// The pane's stat bars, drawn as pixel art to match Clawd.
//
// Desktop: each stat is one SVG row on a fixed pixel grid (icon, label in a
// 3x5 pixel font, bar, value), so every bar starts at the same x whatever the
// surface's font. The bar has a notched dark frame, a dark inset track, a
// three-tone fill (highlight row, base, shadow rows) cut into 10 chunks, a
// glint that sweeps EXP, and a blinking frame when energy runs low.
//
// The collection strip: every item that can drop, in color once found, a
// dark silhouette until then, with how many have dropped under each.
//
// Terminal: the font is monospace, so the label pads to a column and the bar
// is one row of half-block cells, the highlight over the base.

import { ITEMS as ITEM_ART, PALETTE } from './sprites.js'

export const STATS = {
  exp: {
    label: 'EXP',
    icon: 'star',
    colors: { base: '#F2B630', hi: '#FFE38A', shade: '#B9761C', track: '#3A2E14', frame: '#1F180A' },
    glint: true,
  },
  energy: {
    label: 'ENERGY',
    icon: 'bolt',
    colors: { base: '#4FA8FF', hi: '#B0DBFF', shade: '#2766C8', track: '#142A44', frame: '#0A1626' },
    blinkLow: true,
  },
}

// At or below this, energy's frame blinks red
export const LOW = 25
const ALERT = '#FF4D4D'

// 7x7 icons: 'a' the stat's base, 'b' its highlight, 'c' its shade, 'k' a dark
// outline
const ICONS = {
  star: ['...a...', '..aba..', 'aaabaaa', '.aaaaa.', '..aaa..', '.aac.aa', '.c...c.'],
  bolt: ['....aa.', '...ab..', '..aa...', '.abaaa.', '...aa..', '..ac...', '.c.....'],
}
const ICON_EXTRA = { k: '#1A1622' }

// A 3x5 pixel font, just the letters and digits the bars use
const FONT = {
  A: ['.#.', '#.#', '###', '#.#', '#.#'],
  E: ['###', '#..', '##.', '#..', '###'],
  F: ['###', '#..', '##.', '#..', '#..'],
  G: ['.##', '#..', '#.#', '#.#', '.##'],
  H: ['#.#', '#.#', '###', '#.#', '#.#'],
  L: ['#..', '#..', '#..', '#..', '###'],
  N: ['##.', '#.#', '#.#', '#.#', '#.#'],
  P: ['##.', '#.#', '##.', '#..', '#..'],
  R: ['##.', '#.#', '##.', '#.#', '#.#'],
  U: ['#.#', '#.#', '#.#', '#.#', '###'],
  X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
  Y: ['#.#', '#.#', '.#.', '.#.', '.#.'],
  0: ['###', '#.#', '#.#', '#.#', '###'],
  1: ['.#.', '##.', '.#.', '.#.', '###'],
  2: ['##.', '..#', '.#.', '#..', '###'],
  3: ['##.', '..#', '.#.', '..#', '##.'],
  4: ['#.#', '#.#', '###', '..#', '..#'],
  5: ['###', '#..', '##.', '..#', '##.'],
  6: ['.##', '#..', '###', '#.#', '###'],
  7: ['###', '..#', '.#.', '.#.', '.#.'],
  8: ['###', '#.#', '###', '#.#', '###'],
  9: ['###', '#.#', '###', '..#', '##.'],
  '%': ['#.#', '..#', '.#.', '#..', '#.#'],
  '-': ['...', '...', '###', '...', '...'],
}

// The row's grid, in logical pixels (each drawn SCALE CSS pixels square)
export const SCALE = 2
const ROW_H = 9
const LABEL_X = 10
const BAR_X = 36
const BAR_W = 52 // the frame, outside to outside
const INNER_W = BAR_W - 2
const VALUE_X = BAR_X + BAR_W + 3
export const ROW_W = VALUE_X + 15
const LABEL_COLOR = '#8A8597'
const CHUNKS = 10

const rect = (x, y, w, h, fill, extra = '') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"${extra}/>`

function pixelText(text, x, y, fill) {
  const out = []
  let cx = x
  for (const ch of text) {
    const glyph = FONT[ch]
    if (glyph) glyph.forEach((line, gy) => [...line].forEach((p, gx) => { if (p === '#') out.push(rect(cx + gx, y + gy, 1, 1, fill)) }))
    cx += 4
  }
  return out.join('')
}

function icon(name, colors, x, y) {
  const fill = { a: colors.base, b: colors.hi, c: colors.shade, ...ICON_EXTRA }
  const out = []
  ICONS[name].forEach((line, gy) => [...line].forEach((p, gx) => { if (fill[p]) out.push(rect(x + gx, y + gy, 1, 1, fill[p])) }))
  return out.join('')
}

// One stat as an SVG row. `value` is 0-100, or null when unknown; `shown` is
// the text after the bar (the number by default)
export function statRowSvg(key, value, shown) {
  const stat = STATS[key]
  const c = stat.colors
  const isKnown = value !== null && value !== undefined
  const v = isKnown ? Math.max(0, Math.min(100, value)) : 0
  const isLow = isKnown && stat.blinkLow && v <= LOW
  const parts = []

  parts.push(icon(stat.icon, c, 0, 1))
  parts.push(pixelText(stat.label, LABEL_X, 2, LABEL_COLOR))

  // The frame, its four corner pixels left out so it reads as rounded
  const frameBlink = isLow
    ? `<animate attributeName="fill" calcMode="discrete" values="${c.frame};${ALERT}" dur="0.6s" repeatCount="indefinite"/>`
    : ''
  parts.push(`<rect x="${BAR_X + 1}" y="0" width="${BAR_W - 2}" height="${ROW_H}" fill="${c.frame}">${frameBlink}</rect>`)
  parts.push(`<rect x="${BAR_X}" y="1" width="${BAR_W}" height="${ROW_H - 2}" fill="${c.frame}">${frameBlink}</rect>`)

  // The track, a darker top row making it look inset
  const tx = BAR_X + 1
  parts.push(rect(tx, 1, INNER_W, ROW_H - 2, c.track))
  parts.push(rect(tx, 1, INNER_W, 1, c.frame, ' fill-opacity="0.6"'))

  // The fill: highlight row, base, two shadow rows
  const fillW = Math.round((v / 100) * INNER_W)
  if (fillW > 0) {
    parts.push(rect(tx, 1, fillW, 1, c.hi))
    parts.push(rect(tx, 2, fillW, 3, c.base))
    parts.push(rect(tx, 5, fillW, 2, c.shade))
    // A bright pixel on the leading edge's highlight
    parts.push(rect(tx + fillW - 1, 1, 1, 2, '#FFFFFF', ' fill-opacity="0.55"'))
    // Chunk gaps: a track-colored column every tenth of the bar
    for (let i = 1; i < CHUNKS; i++) {
      const gx = tx + Math.round((i * INNER_W) / CHUNKS) - 1
      if (gx < tx + fillW - 1) parts.push(rect(gx, 1, 1, ROW_H - 2, c.track, ' fill-opacity="0.85"'))
    }
    // A glint that sweeps the fill now and then
    if (stat.glint && fillW > 3) {
      parts.push(
        `<clipPath id="g-${key}"><rect x="${tx}" y="1" width="${fillW}" height="${ROW_H - 2}"/></clipPath>` +
          `<rect x="${tx - 3}" y="1" width="2" height="${ROW_H - 2}" fill="#FFFFFF" fill-opacity="0.6" clip-path="url(#g-${key})">` +
          `<animate attributeName="x" values="${tx - 3};${tx + fillW + 1};${tx + fillW + 1}" keyTimes="0;0.4;1" dur="3.5s" repeatCount="indefinite"/></rect>`,
      )
    }
  }

  const text = shown ?? (isKnown ? String(Math.round(v)) : '-')
  parts.push(pixelText(text, VALUE_X, 2, isKnown ? (isLow ? ALERT : c.base) : LABEL_COLOR))

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${ROW_W * SCALE}" height="${ROW_H * SCALE}" viewBox="0 0 ${ROW_W} ${ROW_H}" shape-rendering="crispEdges">${parts.join('')}</svg>`
}

// The terminal bar: `cols` half-block cells, the highlight over the base where
// filled, the track's two tones where not, the leading cell brighter
export const TERM_COLS = 20
const UPPER_HALF = 0x2580
const hex = (color) => parseInt(color.slice(1), 16)

export function statBarWords(key, value, cols = TERM_COLS) {
  const c = STATS[key].colors
  const v = value === null || value === undefined ? 0 : Math.max(0, Math.min(100, value))
  const filled = Math.round((v / 100) * cols)
  const words = []
  for (let i = 0; i < cols; i++) {
    if (i < filled) words.push(UPPER_HALF, hex(i === filled - 1 ? '#FFFFFF' : c.hi), hex(c.base))
    else words.push(UPPER_HALF, hex(c.frame), hex(c.track))
  }
  return words
}

export function statBarCells(key, value, cols = TERM_COLS) {
  return new Uint8Array(Uint32Array.from(statBarWords(key, value, cols)).buffer).toBase64()
}

// The icon's stand-in glyph in the terminal, one cell wide
export const TERM_GLYPH = { exp: '★', energy: 'ϟ' }
export const TERM_LABEL = { exp: 'EXP', energy: 'Energy' }

// The collection strip, in logical pixels: 8x8 icons on an 11-pixel pitch,
// each count in the pixel font under its icon
const SLOT = 11
const SILHOUETTE = '#3A3550'
export const STRIP_SCALE = 3
export const STRIP_H = 15

export function collectionSvg(items) {
  const w = items.length * SLOT - 3
  const parts = []
  items.forEach(({ id, count }, i) => {
    const x0 = i * SLOT
    ITEM_ART[id].forEach((line, y) =>
      [...line].forEach((p, x) => {
        const color = PALETTE[p]
        if (color) parts.push(rect(x0 + x, y, 1, 1, count > 0 ? color : SILHOUETTE))
      }),
    )
    if (count > 0) {
      const text = String(Math.min(count, 99))
      parts.push(pixelText(text, x0 + Math.floor((8 - (text.length * 4 - 1)) / 2), 10, LABEL_COLOR))
    }
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w * STRIP_SCALE}" height="${STRIP_H * STRIP_SCALE}" viewBox="0 0 ${w} ${STRIP_H}" shape-rendering="crispEdges">${parts.join('')}</svg>`
}

export function stripWidth(n) {
  return (n * SLOT - 3) * STRIP_SCALE
}
