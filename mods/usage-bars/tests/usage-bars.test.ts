import { expect, mock, test } from 'claude-code/testing'

const NOW = Date.parse('2026-10-04T10:00:00Z')

// What Claude Code passes to a ui.render hook for the band above the prompt
const BAND = {
  plugin: 'usage-bars',
  component: 'AbovePrompt',
  surface: 'terminal',
  viewport: { columns: 100, rows: 30 },
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

function usage(overrides = {}) {
  return {
    rateLimits: [
      { kind: 'five_hour', percentUsed: 42, resetsAt: '2026-10-04T12:15:00Z' },
      { kind: 'seven_day', percentUsed: 90, resetsAt: '2026-10-07T16:00:00Z' },
    ],
    context: {
      tokens: 80_000,
      window: 200_000,
      percent: 40,
      breakdown: { isAutoCompactEnabled: true, autoCompactThreshold: 160_000 },
    },
    ...overrides,
  }
}

async function mountBand($, on, surface, value, stored = {}) {
  mock.clock(on, { now: NOW })
  mock.store(on, stored)
  on('session.usage', () => ({ value }))
  on('session.start', () => ({ cwd: '/work' }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
  await $.session.start({ surface, isInteractive: true, cwd: '/work' })
  return $.ui.mount({ ...BAND, surface })
}

test('desktop draws an SVG bar per meter, colored by how close the limit is', async ($, on) => {
  const ui = await mountBand($, on, 'desktop', usage())

  expect(await ui.find({ type: 'Text', text: '5h usage (2h 15m)' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Weekly usage (3d 6h)' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Context (80k left)' })).toBeDefined()
  // 42% is green, 90% is still orange, the context is purple
  expect((await ui.find({ type: 'Text', text: '42%' }))?.props.color).toBe('#3FB950')
  expect((await ui.find({ type: 'Text', text: '90%' }))?.props.color).toBe('#D97757')
  expect((await ui.find({ type: 'Text', text: '50%' }))?.props.color).toBe('#8B7CF6')

  // A meter is a Box keyed by its name: the label, then the bar's row
  const svgOf = async (key) => (await ui.find({ key }))?.children[1].children[0].children[0]

  const fiveHour = await svgOf('five-hour')
  expect(fiveHour?.type).toBe('Svg')
  expect(fiveHour?.props.alt).toBe('5h usage (2h 15m) 42%')
  expect(fiveHour?.props.source).toContain('#3fb950')
  // Green glows; the unused part is muted squares
  expect(fiveHour?.props.source).toContain('filter="url(#glow)"')
  expect(fiveHour?.props.source).toContain('fill="#8A8A8A" fill-opacity="0.25"')
  // A shimmer sweeps across the used squares, in a plain image: an
  // interactive frame would paint a white page behind the squares
  expect(fiveHour?.props.isInteractive).toBeUndefined()
  // Each used square glows in turn: one fill animation per used square
  const source = fiveHour?.props.source ?? ''
  const usedSquares = (source.match(/<rect [^>]*>(?=<animate)/g) ?? []).length
  expect(usedSquares).toBeGreaterThan(0)
  expect((source.match(/<animate attributeName="fill"/g) ?? []).length).toBe(usedSquares)
  expect(source).not.toContain('url(#shine)')
  expect(source).not.toContain('</rect/>')
  expect((source.match(/<\/rect>/g) ?? []).length).toBe(usedSquares)
  const weekly = await svgOf('weekly')
  expect(weekly?.props.source).toContain('#d97757')
  expect(weekly?.props.source).not.toContain('filter="url(#glow)"')
  // 80k used of a 160k auto-compact point
  const ctx = await svgOf('context')
  expect(ctx?.props.alt).toBe('Context (80k left) 50%')
  expect(ctx?.props.source).toContain('#8b7cf6')

  // Every bar is one width, at least as wide as the longest label
  const widths = [fiveHour, weekly, ctx].map((svg) => svg?.props.width)
  expect(new Set(widths).size).toBe(1)
  // Five squares tall: the first column has a square at each of y = 0, 3, 6, 9, 12
  for (const y of [0, 3, 6, 9, 12]) expect(fiveHour?.props.source).toContain(`x="0" y="${y}"`)
  expect(fiveHour?.props.source).not.toContain('x="0" y="15"')
  expect(widths[0] >= 'Weekly usage (3d 6h)'.length * 7.2).toBe(true)
})

test('a bar turns orange at 75% and red at 91%', async ($, on) => {
  const ui = await mountBand($, on, 'desktop', usage({
    rateLimits: [
      { kind: 'five_hour', percentUsed: 74.4, resetsAt: '2026-10-04T12:15:00Z' },
      { kind: 'seven_day', percentUsed: 91, resetsAt: '2026-10-07T16:00:00Z' },
    ],
  }))

  expect((await ui.find({ type: 'Text', text: '74%' }))?.props.color).toBe('#3FB950')
  expect((await ui.find({ type: 'Text', text: '91%' }))?.props.color).toBe('#E5484D')
})

test('terminal draws the bars as cell grids', async ($, on) => {
  const ui = await mountBand($, on, 'terminal', usage())

  const raster = await ui.find({ type: 'Raster' })
  expect(raster?.props.key).toBe('five-hour')
  // As many cells as the longest label has characters
  expect(raster?.props.columns).toBe('Weekly usage (3d 6h)'.length)
  expect(await ui.find({ type: 'Text', text: '5h usage (2h 15m)' })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: '42%' }))?.props.color).toBe('#3FB950')
  expect((await ui.find({ type: 'Text', text: '90%' }))?.props.color).toBe('#D97757')
  expect((await ui.find({ type: 'Text', text: '50%' }))?.props.color).toBe('#8B7CF6')
})

test('with no reading anywhere, each meter draws an empty bar and a dash', async ($, on) => {
  const ui = await mountBand($, on, 'desktop', { rateLimits: [], context: { window: 200_000 } })

  expect(await ui.find({ type: 'Text', text: 'no reading yet' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '5h usage' })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: '–' }))?.props.dimColor).toBe(true)
  // The bar is there, all muted squares and no colored ones
  const svg = (await ui.find({ key: 'five-hour' }))?.children[1].children[0].children[0]
  expect(svg?.type).toBe('Svg')
  expect(svg?.props.source).toContain('fill-opacity="0.25"')
  expect(svg?.props.source).not.toContain('<animate')
})

test('a new session shows the last reading another session saved', async ($, on) => {
  const saved = [
    { kind: 'five_hour', percentUsed: 30, resetsAt: '2026-10-04T12:15:00Z' },
    // This window reset an hour ago, so it's empty again
    { kind: 'seven_day', percentUsed: 80, resetsAt: '2026-10-04T09:00:00Z' },
  ]
  const ui = await mountBand($, on, 'desktop', { rateLimits: [], context: { window: 200_000 } }, { rateLimits: saved })

  expect(await ui.find({ type: 'Text', text: '5h usage (2h 15m)' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '30%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Weekly usage' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '0%' })).toBeDefined()
})

test('counts the tokens each turn spends, a subagent turn included', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on, {})
  on('session.usage', () => ({ value: { ...usage(), cost: { usd: 1.5 } } }))
  on('session.start', () => ({ cwd: '/work' }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))

  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  const turnUsage = { input_tokens: 1000, output_tokens: 2000, cache_read_input_tokens: 40_000, cache_creation_input_tokens: 5000, model: 'claude-test' }
  await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 10, isAborted: false, reason: 'answer', usage: turnUsage })
  await $.turn.complete({ turnId: 't2', answer: 'ok', durationMs: 10, isAborted: false, reason: 'answer', usage: turnUsage, agentId: 'a1' })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: 'Session tokens' })).toBeDefined()
  // Two turns of 48k each
  expect(await ui.find({ type: 'Text', text: '96k' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '92k in' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '4k out' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '$1.50' })).toBeDefined()
  // Each figure has an icon in front of it
  const row = (await ui.find({ key: 'session-tokens' }))?.children[1]
  const icons = row?.children.slice(1).map((figure) => figure.children[0].children[0].props.alt)
  expect(icons).toEqual(['Input tokens', 'Output tokens', 'Cost'])
})
