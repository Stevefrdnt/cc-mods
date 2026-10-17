// usage-bars: plan usage and context left, drawn as one row above the prompt
//
//   5h usage (2h 15m)     Weekly usage (3d 6h)     Context (80k left)
//   ▪▪▪▪▪▫▫▫▫▫▫▫ 42%      ▪▪▪▪▪▪▪▪▪▪▪▫ 90%         ▪▪▪▪▪▪▫▫▫▫▫▫ 50%
//
// Each bar is a grid of tiny squares, like a token-usage grid or a GitHub
// activity graph: the used part brightens toward its leading edge, the rest
// stays muted. A plan-limit bar's color says how close the limit is: green
// with a slight glow up to 74%, Claude orange from 75% to 90%, red from 91%.
// The context bar is purple, red from 91%. The desktop app draws the bars as
// SVG; the terminal draws them as a row of colored cells.
//
// A second row shows the tokens this session has spent, in and out, and what
// the session has cost.
//
// The figures come from $.session.usage(), the same numbers the status line
// reads. Claude Code pushes fresh ones through session.measure after each turn
// and whenever a plan limit moves a whole point.

import { atom, read, update } from 'claude-code'
import { ICONS, iconSvg } from './icons.js'

// The latest figures, refreshed by refresh() below
let rateLimits = []
let context = null
let compactAt = null
let costUsd = null

// Tokens this session has spent, kept in $.state so a reload doesn't lose them
const tokens = atom({ plugin: 'usage-bars', key: 'tokens' }, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })

const GREEN = { base: '#3FB950', bright: '#B4F5BE', dark: '#123A1C', glow: true }
const ORANGE = { base: '#D97757', bright: '#FFC2A0', dark: '#5C2C1E' }
const PURPLE = { base: '#8B7CF6', bright: '#D6CEFF', dark: '#2E2766' }
const RED = { base: '#E5484D', bright: '#FFA3A5', dark: '#5E1A1C' }

// Where a plan-limit bar turns orange, and where any bar turns red, by the
// whole percentage it shows
const ORANGE_FROM = 75
const RED_FROM = 91

function planColors(percent) {
  const shown = Math.round(percent)
  if (shown >= RED_FROM) return RED
  if (shown >= ORANGE_FROM) return ORANGE
  return GREEN
}

function contextColors(percent) {
  return Math.round(percent) >= RED_FROM ? RED : PURPLE
}

// The SVG bar, in CSS pixels
// Every bar is one width: wide enough for the longest label above any bar,
// at roughly this many pixels per character of the label's font, never
// narrower than MIN_BAR_W
const PX_PER_CHAR = 7.2
const MIN_BAR_W = 108
// Unused squares: a translucent gray, so they sit quietly on a dark or light theme
const MUTED_CELL = '#8A8A8A'
const MUTED_OPACITY = 0.25
// The terminal has no translucency, so its unused cells take a solid dark gray
const TERM_MUTED = 0x3a3a40
const CELL = 2
const PITCH = 3
// Squares stacked in each column of the bar
const ROWS = 5
const BAR_H = ROWS * PITCH - (PITCH - CELL)

// The terminal bar, in cells
const MIN_TERM_COLS = 12
const TERM_GLYPH = 0x25aa // ▪
const DEFAULT_COLOR = 0x01000000

export function register(on) {
  on('session.start', async ($, e, next) => {
    await refresh($)
    // Redraw once a minute so the reset countdowns stay current
    $.clock.every(60_000, () => $.ui.invalidate('ui.render'))
    return next(e)
  })

  // Fires after each turn, and when a plan limit moves
  on('session.measure', async ($, e, next) => {
    await refresh($)
    return next(e)
  })

  // After a compaction or /clear the context fill resets, so read it again. If
  // the read fails, let the session start as usual
  on('classic.SessionStart', async ($, e, next) => {
    await refresh($)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    // Every turn's tokens count, a subagent's included
    const u = e.usage
    if (u) {
      await update($, tokens, (t) => ({
        input: t.input + u.input_tokens,
        output: t.output + u.output_tokens,
        cacheRead: t.cacheRead + u.cache_read_input_tokens,
        cacheWrite: t.cacheWrite + u.cache_creation_input_tokens,
      }))
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // A survey holds the band, so step aside
    if (e.props.hasSurvey) return next(e)

    const els = $.ui.resolve(e)
    const { Box, Text } = els
    const now = await $.clock.now()
    const isTerminal = e.surface === 'terminal'

    // Work out each meter first, so every bar can share the longest label's width
    const meters = [
      planMeter('five-hour', '5h usage', 'five_hour', now),
      planMeter('weekly', 'Weekly usage', 'seven_day', now),
    ]
    // The context is measured against the auto-compact point when it's on
    if (context && typeof context.tokens === 'number') {
      const limit = compactAt ?? context.window
      const used = Math.min(100, (context.tokens / limit) * 100)
      const tokensLeft = Math.max(0, limit - context.tokens)
      meters.push({ key: 'context', title: titled('Context', formatTokens(tokensLeft) + ' left'), colors: contextColors(used), percent: used })
    } else {
      meters.push({ key: 'context', title: 'Context', colors: PURPLE, percent: null })
    }

    const longest = Math.max(...meters.map((m) => m.title.length))
    const barW = Math.max(MIN_BAR_W, Math.ceil((longest * PX_PER_CHAR) / PITCH) * PITCH)
    const termCols = Math.max(MIN_TERM_COLS, longest)

    // One meter: the label on top, the bar and its percentage under it. A
    // meter with no figure yet (percent null) draws an empty bar and a dash
    const draw = (m) => {
      const colors = m.colors
      const isKnown = m.percent !== null
      const percent = isKnown ? m.percent : 0
      const shown = isKnown ? Math.round(percent) + '%' : '–'
      let bar = null
      if (isTerminal) {
        bar = els.Raster({ key: m.key, columns: termCols, rows: 1, cells: terminalCells(colors, percent, termCols) })
      } else if (els.Svg) {
        bar = els.Svg({ source: svgBar(colors, percent, barW), alt: m.title + ' ' + (isKnown ? shown : 'no reading yet'), width: barW, height: BAR_H })
      }
      return Box({
        key: m.key,
        flexDirection: 'column',
        children: [
          Text({ dimColor: true, children: [m.title] }),
          Box({
            flexDirection: 'row',
            columnGap: 1,
            alignItems: 'center',
            children: [
              ...(bar ? [Box({ flexShrink: 0, children: [bar] })] : []),
              isKnown ? Text({ color: colors.base, children: [shown] }) : Text({ dimColor: true, children: [shown] }),
            ],
          }),
        ],
      })
    }

    // Left: the plan limits. Right: the context
    const left = Box({ flexDirection: 'row', columnGap: 3, children: [draw(meters[0]), draw(meters[1])] })
    const right = draw(meters[2])

    const row = Box({
      flexDirection: 'row',
      justifyContent: 'space-between',
      columnGap: 3,
      children: [left, right],
    })

    // The second row: the tokens this session has spent, and its cost
    const t = await read($, tokens)
    const total = t.input + t.output + t.cacheRead + t.cacheWrite
    // A figure with its icon in front: an SVG icon on the desktop, a glyph in the terminal
    const figure = (icon, text) =>
      Box({
        flexDirection: 'row',
        columnGap: 1,
        alignItems: 'center',
        children: [
          isTerminal || !els.Svg
            ? Text({ color: ICONS[icon].color, children: [ICONS[icon].glyph] })
            : Box({ flexShrink: 0, children: [els.Svg({ source: iconSvg(icon), alt: ICONS[icon].alt, width: 12, height: 12 })] }),
          Text({ dimColor: true, children: [text] }),
        ],
      })
    const tokenRow = Box({
      key: 'session-tokens',
      flexDirection: 'column',
      children: [
        Text({ dimColor: true, children: ['Session tokens'] }),
        Box({
          flexDirection: 'row',
          columnGap: 2,
          alignItems: 'center',
          children: [
            Text({ bold: true, children: [formatTokens(total)] }),
            figure('input', formatTokens(t.input + t.cacheRead + t.cacheWrite) + ' in'),
            figure('output', formatTokens(t.output) + ' out'),
            ...(costUsd !== null ? [figure('cost', '$' + costUsd.toFixed(2))] : []),
          ],
        }),
      ],
    })

    const rows = Box({ flexDirection: 'column', rowGap: 1, children: [row, tokenRow] })

    // Keep whatever mods after this one draw in the band
    const theirs = await next(e)
    return theirs ? Box({ flexDirection: 'column', children: [rows, theirs] }) : rows
  })
}

// A plan-limit meter. The last reading wins; once its window has reset, the
// window is empty again, so it shows 0% until a new reading arrives. With no
// reading at all, percent is null and the meter draws an empty bar
function planMeter(key, label, kind, now) {
  const r = rateLimits.find((limit) => limit.kind === kind)
  if (!r) return { key, title: label, colors: GREEN, percent: null }
  if (r.resetsAt && Date.parse(r.resetsAt) <= now) return { key, title: label, colors: GREEN, percent: 0 }
  return { key, title: titled(label, resetText(r.resetsAt, now)), colors: planColors(r.percentUsed), percent: r.percentUsed }
}

// Plan limits come from the headers of the session's latest API response, so a
// session has none until its first reply. Keep the last reading in $.store,
// which every session on this machine shares, and show it until a fresh one
// arrives
async function rememberLimits($, live) {
  try {
    if (live.length > 0) {
      await $.store.set('rateLimits', live)
      return live
    }
    const saved = await $.store.get('rateLimits')
    return Array.isArray(saved) ? saved : []
  } catch {
    return live
  }
}

// Read the latest figures and ask for a redraw
async function refresh($) {
  try {
    // 'summary' estimates locally and sends no request; it gives the auto-compact point
    const usage = await $.session.usage({ breakdown: 'summary' })
    rateLimits = await rememberLimits($, usage.rateLimits ?? [])
    context = usage.context ?? null
    costUsd = usage.cost?.usd ?? null
    const b = usage.context?.breakdown
    compactAt = b && b.isAutoCompactEnabled && b.autoCompactThreshold ? b.autoCompactThreshold : null
  } catch {
    // Without a breakdown (no session bound yet), fall back to the plain figures
    const usage = await $.session.usage()
    rateLimits = await rememberLimits($, usage.rateLimits ?? [])
    context = usage.context ?? null
    costUsd = usage.cost?.usd ?? null
    compactAt = null
  }
  $.ui.invalidate('ui.render')
}

// The bar as an SVG: a grid of tiny squares, the used ones brightening
// toward the leading edge and the rest muted, with a shimmer: a slow wave in
// which each used square glows to a brighter tint and fades back, column by
// column. The shimmer is SMIL, which runs in a plain SVG image; the bar is not
// drawn with isInteractive, whose frame paints a white page behind the squares.
function svgBar(colors, percent, barW) {
  const fillW = (Math.max(0, Math.min(100, percent)) / 100) * barW
  const muted = []
  const used = []
  for (let x = 0; x + CELL <= barW; x += PITCH) {
    const isUsed = x + CELL <= fillW || (x < fillW && fillW >= barW - CELL)
    const ramp = Math.pow(x / Math.max(fillW, 1), 1.6)
    for (let r = 0; r < ROWS; r++) {
      const n = noise(x, r)
      // A square, with an optional attribute string and an optional animation inside it
      const square = (color, extra = '', inner = '') => {
        const open = `<rect x="${x}" y="${r * PITCH}" width="${CELL}" height="${CELL}" rx="0.4" fill="${color}"${extra}`
        return inner ? `${open}>${inner}</rect>` : `${open}/>`
      }
      if (isUsed) {
        const t = Math.min(1, 0.4 + ramp * 0.6 + (n - 0.5) * 0.35)
        const color = mix(colors.dark, n > 0.85 ? colors.bright : colors.base, Math.max(0, t))
        used.push(square(color, '', glowPulse(color, colors, x, fillW, n)))
      } else {
        muted.push(square(MUTED_CELL, ` fill-opacity="${MUTED_OPACITY}"`))
      }
    }
  }
  // A slight glow: the used squares, blurred, under themselves
  const glow = colors.glow
    ? '<filter id="glow" x="-10%" y="-50%" width="120%" height="200%"><feGaussianBlur stdDeviation="0.8"/><feComponentTransfer result="b"><feFuncA type="linear" slope="0.45"/></feComponentTransfer><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>'
    : ''
  const usedGroup = `<g${colors.glow ? ' filter="url(#glow)"' : ''}>${used.join('')}</g>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${barW}" height="${BAR_H}" viewBox="0 0 ${barW} ${BAR_H}"><defs>${glow}</defs>${muted.join('')}${usedGroup}</svg>`
}

// The bar as terminal cells: small squares on a dark track, brightening
// toward the leading edge
function terminalCells(colors, percent, cols) {
  const filled = Math.round((Math.max(0, Math.min(100, percent)) / 100) * cols)
  const words = []
  for (let i = 0; i < cols; i++) {
    let fg = TERM_MUTED
    if (i < filled) {
      const ramp = filled === 1 ? 1 : i / (filled - 1)
      const n = noise(i, 7)
      const t = Math.min(1, 0.3 + ramp * 0.7 + (n - 0.5) * 0.25)
      fg = hex(mix(colors.dark, i === filled - 1 ? colors.bright : colors.base, Math.max(0, t)))
    }
    words.push(TERM_GLYPH, fg, DEFAULT_COLOR)
  }
  return new Uint8Array(Uint32Array.from(words).buffer).toBase64()
}

// The shimmer: each used square glows to a brighter tint and fades back. The
// glow travels from the first column to the leading edge over SHIMMER_SWEEP_S,
// then the bar rests until the next wave; each square's glow is a little
// stronger or weaker than its neighbours', so the wave twinkles
const SHIMMER_SWEEP_S = 3.2
const SHIMMER_CYCLE_S = 7
const GLOW_S = 1.2

function glowPulse(color, colors, x, fillW, n) {
  const begin = (x / Math.max(fillW, 1)) * SHIMMER_SWEEP_S
  const peak = mix(color, colors.bright, 0.45 + n * 0.45)
  // Rise and fall within GLOW_S, then hold the square's own color for the rest of the cycle
  const rise = (GLOW_S / 2 / SHIMMER_CYCLE_S).toFixed(3)
  const fall = (GLOW_S / SHIMMER_CYCLE_S).toFixed(3)
  return `<animate attributeName="fill" values="${color};${peak};${color};${color}" keyTimes="0;${rise};${fall};1" dur="${SHIMMER_CYCLE_S}s" begin="${begin.toFixed(2)}s" repeatCount="indefinite"/>`
}

// A steady pseudo-random number in [0, 1) for a cell, so the texture doesn't
// shimmer between redraws
function noise(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

// Blend two #rrggbb colors, t from 0 (a) to 1 (b)
function mix(a, b, t) {
  const channel = (c, at) => parseInt(c.slice(at, at + 2), 16)
  const out = [1, 3, 5].map((at) => Math.round(channel(a, at) + (channel(b, at) - channel(a, at)) * t))
  return '#' + out.map((n) => n.toString(16).padStart(2, '0')).join('')
}

function hex(color) {
  return parseInt(color.slice(1), 16)
}

// A label with its detail in brackets, as in '5h usage (2h 15m)'
function titled(label, detail) {
  return detail ? label + ' (' + detail + ')' : label
}

function formatTokens(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1000) return Math.round(n / 1000) + 'k'
  return String(n)
}

function resetText(resetsAt, now) {
  if (!resetsAt) return ''
  const ms = Date.parse(resetsAt) - now
  if (!(ms > 0)) return 'resetting'
  const mins = Math.floor(ms / 60_000)
  const days = Math.floor(mins / 1440)
  const hours = Math.floor((mins % 1440) / 60)
  if (days > 0) return days + 'd ' + hours + 'h'
  if (hours > 0) return hours + 'h ' + (mins % 60) + 'm'
  return mins + 'm'
}
