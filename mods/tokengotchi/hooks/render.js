// Draws a sprite grid (see sprites.js) for each surface: terminal cells made of
// half-blocks, two pixels to a cell, or an SVG of crisp squares.

const UPPER_HALF = 0x2580 // ▀
const LOWER_HALF = 0x2584 // ▄
const SPACE = 0x20
const DEFAULT_COLOR = 0x01000000

const hex = (color) => parseInt(color.slice(1), 16)

// The grid as [codePoint, foreground, background] triplets, row-major, one
// cell for each pair of pixel rows. A transparent pixel shows the terminal's
// own background, so a cell with one clear half draws only its other half
export function halfBlockCells(grid, palette) {
  const cols = grid[0].length
  const rows = Math.ceil(grid.length / 2)
  const words = []
  for (let r = 0; r < rows; r++) {
    for (let x = 0; x < cols; x++) {
      const top = palette[grid[r * 2][x]] ?? null
      const bottom = palette[grid[r * 2 + 1]?.[x]] ?? null
      if (top && bottom) words.push(UPPER_HALF, hex(top), hex(bottom))
      else if (top) words.push(UPPER_HALF, hex(top), DEFAULT_COLOR)
      else if (bottom) words.push(LOWER_HALF, hex(bottom), DEFAULT_COLOR)
      else words.push(SPACE, DEFAULT_COLOR, DEFAULT_COLOR)
    }
  }
  return { columns: cols, rows, words }
}

// The grid as a Raster element's props, ready for els.Raster or $.ui.blit
export function rasterProps(key, grid, palette) {
  const { columns, rows, words } = halfBlockCells(grid, palette)
  const cells = new Uint8Array(Uint32Array.from(words).buffer).toBase64()
  return { key, columns, rows, cells }
}

// The grid as an SVG, each pixel `scale` CSS pixels square. Runs of one color
// along a row merge into one rect, which keeps the source small
export function svgSprite(grid, palette, scale) {
  const w = grid[0].length
  const h = grid.length
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w * scale}" height="${h * scale}" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges">${svgRects(grid, palette)}</svg>`
}

// Frames played in order as one SVG, `frames` being [grid, ms] pairs, or
// [grid, ms, x, y] to draw that frame offset: each frame is a group shown for
// its slice of the cycle by a discrete SMIL animation, which runs in a plain
// SVG image. A loop repeats; a one-shot holds its last frame
export function animatedSvg(frames, palette, scale, { loop = true } = {}) {
  const w = frames[0][0][0].length
  const h = frames[0][0].length
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w * scale}" height="${h * scale}" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges">${frameGroups(frames, palette, loop)}</svg>`
}

// Each distinct grid is drawn once, in <defs>, and every frame that shows it
// is a <use> of it, so a long animation that reuses its frames stays small
function frameGroups(frames, palette, loop, prefix = 'f') {
  const total = frames.reduce((sum, [, ms]) => sum + ms, 0)
  const ids = new Map()
  const defs = []
  const idOf = (grid) => {
    const key = grid.join('\n')
    if (!ids.has(key)) {
      ids.set(key, prefix + ids.size)
      defs.push(`<g id="${prefix}${ids.size - 1}">${svgRects(grid, palette)}</g>`)
    }
    return ids.get(key)
  }
  const dur = (total / 1000).toFixed(3) + 's'
  let start = 0
  const groups = frames.map(([grid, ms, x, y], i) => {
    const from = start / total
    const to = (start + ms) / total
    start += ms
    const inner = `<use href="#${idOf(grid)}"${x ? ` x="${x}"` : ''}${y ? ` y="${y}"` : ''}/>`
    if (frames.length === 1) return `<g>${inner}</g>`
    const isLast = i === frames.length - 1
    let values, keyTimes
    if (i === 0) { values = 'visible;hidden'; keyTimes = `0;${to.toFixed(4)}` }
    else if (isLast) { values = 'hidden;visible'; keyTimes = `0;${from.toFixed(4)}` }
    else { values = 'hidden;visible;hidden'; keyTimes = `0;${from.toFixed(4)};${to.toFixed(4)}` }
    const repeat = loop ? ' repeatCount="indefinite"' : ' fill="freeze"'
    return `<g visibility="${i === 0 ? 'visible' : 'hidden'}"><animate attributeName="visibility" calcMode="discrete" values="${values}" keyTimes="${keyTimes}" dur="${dur}"${repeat}/>${inner}</g>`
  })
  return `<defs>${defs.join('')}</defs>${groups.join('')}`
}

// A grid as SVG paths, one per color, each run of a color along a row one
// subpath: far smaller than a rect per run
function svgRects(grid, palette) {
  const runs = new Map()
  grid.forEach((line, y) => {
    let x = 0
    while (x < line.length) {
      let run = 1
      while (x + run < line.length && line[x + run] === line[x]) run++
      const color = palette[line[x]] ?? null
      if (color) runs.set(color, (runs.get(color) ?? '') + `M${x} ${y}h${run}v1h-${run}z`)
      x += run
    }
  })
  return [...runs].map(([color, d]) => `<path fill="${color}" d="${d}"/>`).join('')
}

// The pixel a frame marks with SHADOW darkens whatever the scene has beneath
// it, through `shade` (scene color key → its darker key), so a shadow falls
// right on the rug and the planks alike
export const SHADOW = ','

// A frame drawn over the scene at `at`: the frame's transparent pixels show
// the scene through, its shadow pixels darken it
export function composite(scene, frame, at, shade = {}) {
  return scene.map((line, y) => {
    const row = frame[y - at.y]
    if (!row) return line
    let out = ''
    for (let x = 0; x < line.length; x++) {
      const p = row[x - at.x]
      out += p === SHADOW ? (shade[line[x]] ?? line[x]) : p && p !== '.' ? p : line[x]
    }
    return out
  })
}

// The cloud strip `step` pixels along: it drifts left, wrapping around
export function cloudGrid(clouds, step) {
  return clouds.rows.map((row) => {
    const w = row.length
    const k = ((step % w) + w) % w
    return row.slice(k) + row.slice(0, k)
  })
}

// The scene with its clouds `step` pixels along
export function withClouds(scene, clouds, step) {
  return composite(scene, cloudGrid(clouds, step), { x: clouds.x, y: clouds.y })
}

// A frame's shadow pixels resolved against the scene beneath it at `at`
function shadeFrame(scene, frame, at, shade) {
  return frame.map((line, y) =>
    [...line].map((p, x) => (p === SHADOW ? (shade[scene[at.y + y]?.[at.x + x]] ?? '.') : p)).join(''),
  )
}

// The scene as one SVG: the background drawn once, the clouds drifting over
// it on a loop of their own, and the frames played over both.
// `frames` are [grid, ms] or [grid, ms, dx]: a frame with dx is drawn that
// many pixels right of `at` (left when negative), which is how Clawd walks.
// `clouds` is { strip, stepMs, step }: the strip drifts a pixel every stepMs,
// starting `step` pixels along, so a redraw carries on where the last left off
export function animatedScene(scene, frames, at, palette, scale, { loop = true, shade = {}, clouds = null } = {}) {
  const w = scene[0].length
  const h = scene.length
  const placed = frames.map(([grid, ms, dx = 0]) => {
    const pos = { x: at.x + dx, y: at.y }
    return [shadeFrame(scene, grid, pos, shade), ms, pos.x, pos.y]
  })
  let sky = ''
  if (clouds) {
    const width = clouds.strip.rows[0].length
    const steps = Array.from({ length: width }, (_, i) => [cloudGrid(clouds.strip, clouds.step + i), clouds.stepMs, clouds.strip.x, clouds.strip.y])
    sky = frameGroups(steps, palette, true, 'c')
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w * scale}" height="${h * scale}" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges">${svgRects(scene, palette)}${sky}${frameGroups(placed, palette, loop)}</svg>`
}

// Problems with a grid: wrong size or characters not in the palette
export function gridProblems(name, grid, palette, width, height) {
  const problems = []
  if (grid.length !== height) problems.push(`${name}: ${grid.length} rows, expected ${height}`)
  grid.forEach((row, y) => {
    if (row.length !== width) problems.push(`${name} row ${y}: ${row.length} columns, expected ${width}`)
    for (const ch of row) if (!(ch in palette) && ch !== SHADOW) problems.push(`${name} row ${y}: '${ch}' is not in the palette`)
  })
  return problems
}
