// Dev only: checks every sprite grid, writes a PNG contact sheet to
// docs/sprites/sheet.png, and with --terminal prints the frames the way the
// terminal draws them (the same half-block cells the mod uses).
//
//   node scripts/preview-sprites.mjs [--terminal]

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'
import { CLAWD_AT, FRAMES, ITEMS, PALETTE, SCENE, SCENE_H, SCENE_W, SHADE, SPRITE_W, SPRITE_H, ITEM_SIZE } from '../hooks/sprites.js'
import { composite, gridProblems, halfBlockCells } from '../hooks/render.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const problems = [
  ...Object.entries(FRAMES).flatMap(([n, g]) => gridProblems(n, g, PALETTE, SPRITE_W, SPRITE_H)),
  ...Object.entries(ITEMS).flatMap(([n, g]) => gridProblems(n, g, PALETTE, ITEM_SIZE, ITEM_SIZE)),
  ...gridProblems('SCENE', SCENE, PALETTE, SCENE_W, SCENE_H),
]
if (problems.length) {
  console.error(problems.join('\n'))
  process.exit(1)
}

// The sheet: one row per animation, each frame drawn in the office, items on
// the last row
const SCALE = 4
const PAD = 4
const CELL_W = SCENE_W * SCALE + PAD * 2
const CELL_H = SCENE_H * SCALE + PAD * 2
const groups = {}
for (const name of Object.keys(FRAMES)) (groups[name.split('_')[0]] ??= []).push(name)
const sheetRows = [...Object.values(groups).map((names) => names.map((n) => composite(SCENE, FRAMES[n], CLAWD_AT, SHADE))), Object.values(ITEMS)]
const cols = Math.max(...sheetRows.map((r) => r.length))
const W = cols * CELL_W
const H = sheetRows.length * CELL_H
const px = new Uint8Array(W * H * 4)

// A soft checkerboard so transparency is visible
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    const v = ((x >> 3) + (y >> 3)) % 2 ? 0x2a : 0x32
    px.set([v, v, v + 4, 255], (y * W + x) * 4)
  }

sheetRows.forEach((row, ry) =>
  row.forEach((grid, cx) => {
    const scale = grid.length === ITEM_SIZE ? SCALE * 2 : SCALE
    const ox = cx * CELL_W + PAD
    const oy = ry * CELL_H + PAD
    grid.forEach((line, gy) =>
      [...line].forEach((ch, gx) => {
        const color = PALETTE[ch]
        if (!color) return
        const rgb = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16))
        for (let dy = 0; dy < scale; dy++)
          for (let dx = 0; dx < scale; dx++) px.set([...rgb, 255], ((oy + gy * scale + dy) * W + ox + gx * scale + dx) * 4)
      }),
    )
  }),
)

const out = join(root, 'docs/sprites/sheet.png')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, png(W, H, px))
console.log(`checked ${Object.keys(FRAMES).length} frames and ${Object.keys(ITEMS).length} items; wrote ${out}`)

if (process.argv.includes('--terminal')) {
  const ansi = (c, bg) => (c === 0x01000000 ? (bg ? '\x1b[49m' : '\x1b[39m') : `\x1b[${bg ? 48 : 38};2;${c >> 16};${(c >> 8) & 255};${c & 255}m`)
  for (const [name, grid] of Object.entries(FRAMES)) {
    const { columns, rows, words } = halfBlockCells(composite(SCENE, grid, CLAWD_AT, SHADE), PALETTE)
    console.log('\n' + name)
    for (let r = 0; r < rows; r++) {
      let line = ''
      for (let c = 0; c < columns; c++) {
        const i = (r * columns + c) * 3
        line += ansi(words[i + 1], false) + ansi(words[i + 2], true) + String.fromCodePoint(words[i])
      }
      console.log(line + '\x1b[0m')
    }
  }
}

// A minimal RGBA PNG encoder
function png(width, height, rgba) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (buf) => {
    let c = 0xffffffff
    for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data])
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const sum = Buffer.alloc(4)
    sum.writeUInt32BE(crc(body))
    return Buffer.concat([len, body, sum])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 6, 0, 0, 0], 8)
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) Buffer.from(rgba.buffer, y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1)
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
