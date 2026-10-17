import { expect, mock, test } from 'claude-code/testing'
import { EXP_CAP_PER_TURN, ITEMS, apply, collection, doing, energyFrom, expForTurn, fold, levelFor, newBase, newPet, rollDrop } from '../hooks/pet.js'
import { ANIMATIONS, WORKS, WORK_ALT, WORK_LABEL, frameAt, known, nextActivity, pickWork, poseAt, workOf } from '../hooks/animation.js'
import { CLAWD_AT, CLOUDS, FRAMES, ITEMS as ITEM_ART, PALETTE, SCENE, SCENE_H, SCENE_W, SHADE, SPRITE_H, SPRITE_W, ITEM_SIZE } from '../hooks/sprites.js'
import { animatedScene, animatedSvg, cloudGrid, composite, gridProblems, halfBlockCells, withClouds } from '../hooks/render.js'
import { LOW, STATS, collectionSvg, statBarWords, statRowSvg } from '../hooks/hud.js'

const NOW = Date.parse('2026-10-17T10:00:00Z')
const HOUR = 3_600_000
const USAGE = { input_tokens: 2000, output_tokens: 3000, cache_read_input_tokens: 50_000, cache_creation_input_tokens: 1000, model: 'claude-test' }

// The first turn ids that do and don't drop something
const DROPPING = Array.from({ length: 200 }, (_, i) => 'turn-' + i).find((id) => rollDrop(id) !== null)!
const EMPTY = Array.from({ length: 200 }, (_, i) => 'turn-' + i).find((id) => rollDrop(id) === null)!

const PANE = (surface: 'terminal' | 'desktop') =>
  ({
    plugin: 'tokengotchi',
    component: 'Pane',
    requestId: 'tokengotchi',
    surface,
    viewport: { columns: 60, rows: 40 },
    props: { title: 'Clawd', isFocused: false, bodyColumns: 56, placement: 'dock' },
  }) as const

const LIMITS = [{ kind: 'five_hour', percentUsed: 40, resetsAt: '2026-10-17T12:00:00Z' }]

async function start($, on, surface: 'terminal' | 'desktop', stored = {}, sessionId = 'sess-a', toasts: string[] = [], store?: Map<string, unknown>, rateLimits: unknown[] = LIMITS) {
  const clock = mock.clock(on, { now: NOW })
  if (store) {
    // A store the test can change underneath the mod, as another session would
    on('store.get', ($, e) => ({ value: structuredClone(store.get(e.key)) }))
    on('store.set', ($, e) => {
      store.set(e.key, structuredClone(e.value))
      return { value: undefined }
    })
    on('store.delete', ($, e) => {
      store.delete(e.key)
      return { value: undefined }
    })
    on('store.keys', () => ({ value: [...store.keys()] }))
  } else {
    mock.store(on, stored)
  }
  on('session.id', () => ({ value: sessionId }))
  on('session.usage', () => ({ value: { rateLimits } }))
  on('session.start', () => ({ cwd: '/work' }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('command.register', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  await $.session.start({ surface, isInteractive: true, cwd: '/work' })
  return clock
}

const finish = ($, turnId: string, extra = {}) =>
  $.turn.complete({ turnId, answer: 'done', durationMs: 1000, isAborted: false, reason: 'answer', usage: USAGE, ...extra })

// The rules

test('every frame and item is the declared size and uses only palette colors', () => {
  const problems = [
    ...Object.entries(FRAMES).flatMap(([n, g]) => gridProblems(n, g, PALETTE, SPRITE_W, SPRITE_H)),
    ...Object.entries(ITEM_ART).flatMap(([n, g]) => gridProblems(n, g, PALETTE, ITEM_SIZE, ITEM_SIZE)),
    ...gridProblems('SCENE', SCENE, PALETTE, SCENE_W, SCENE_H),
  ]
  expect(problems).toEqual([])
  // Every animation's frames exist, and every item has its art
  for (const a of Object.values(ANIMATIONS)) for (const [name] of a.frames) expect(FRAMES[name]).toBeDefined()
  for (const id of Object.keys(ITEMS)) expect(ITEM_ART[id]).toBeDefined()
})

test('EXP grows with tokens but is capped, and a subagent earns half', () => {
  expect(expForTurn(undefined)).toBe(0)
  const small = expForTurn({ input_tokens: 100, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })
  const big = expForTurn(USAGE)
  expect(big).toBeGreaterThan(small)
  expect(expForTurn({ input_tokens: 50_000_000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })).toBe(EXP_CAP_PER_TURN)
  expect(expForTurn(USAGE, true)).toBe(Math.round(big * 0.5))
  expect(levelFor(0)).toBe(0)
  expect(levelFor(50)).toBe(1)
  expect(levelFor(49)).toBe(0)
})

test('a turn always rolls the same drop', () => {
  expect(rollDrop(DROPPING)).toBe(rollDrop(DROPPING))
  expect(ITEMS[rollDrop(DROPPING)!]).toBeDefined()
  expect(rollDrop(EMPTY)).toBeNull()
})

test("energy is what's left of the 5-hour limit, and all of it once the window resets", () => {
  expect(energyFrom(null, NOW)).toBeNull()
  expect(energyFrom({ percentUsed: 5, resetsAt: '2026-10-17T12:00:00Z' }, NOW)).toBe(95)
  expect(energyFrom({ percentUsed: 100, resetsAt: '2026-10-17T12:00:00Z' }, NOW)).toBe(0)
  expect(energyFrom({ percentUsed: 80, resetsAt: '2026-10-17T09:00:00Z' }, NOW)).toBe(100)
  expect(doing('laptop_loop', 50)).toBe('typing')
  expect(doing('paint_open', 50)).toBe('painting')
  expect(doing('wave', 50)).toBe('saying hi')
  expect(doing('idle', 50)).toBe('waiting')
  expect(doing('idle', 5)).toBe('resting')
})

test('folding is idempotent and merges every session in time order', () => {
  const base = newBase(NOW)
  const ledgers = {
    'ledger:a': [{ type: 'turn', id: 'a1', at: NOW + 1, exp: 10, isAnswer: true, drop: 'bit_cookie' }],
    'ledger:b': [{ type: 'turn', id: 'b1', at: NOW + 2, exp: 5, isAnswer: true, drop: 'bit_cookie' }],
  }
  const once = fold(base, ledgers)
  // Both sessions' work counts, and both cookies are in the collection
  expect(once.pet.exp).toBe(15)
  expect(once.pet.inventory).toEqual({ bit_cookie: 2 })
  expect(collection(once.pet).found).toBe(1)
  expect(once.folded).toEqual({ 'ledger:a': 1, 'ledger:b': 1 })
  // Folding the same ledgers again changes nothing
  expect(fold(once, ledgers)).toEqual(once)
  // A ledger that is gone, or never had an event, keeps no count
  expect(fold({ ...base, folded: { 'ledger:gone': 3 } }, { 'ledger:new': [] }).folded).toEqual({})
  // Events from older versions (feeding, a failed turn's mood dip) change nothing
  const pet = newPet(NOW)
  expect(apply(pet, { type: 'use', id: 'x', at: NOW, item: 'bit_cookie' })).toEqual(pet)
  expect(apply(pet, { type: 'abort', id: 'y', at: NOW })).toEqual(pet)
})

test('opening plays once and then types; closing plays once and then idles', () => {
  expect(frameAt('laptop_open', 0)).toBe('open_0')
  expect(frameAt('laptop_open', 10_000)).toBe('open_6')
  expect(nextActivity({ kind: 'laptop_open', since: 0 }, 100)).toBeNull()
  expect(nextActivity({ kind: 'laptop_open', since: 0 }, 10_000)?.kind).toBe('laptop_loop')
  expect(nextActivity({ kind: 'laptop_close', since: 0 }, 10_000)?.kind).toBe('idle')
  expect(nextActivity({ kind: 'laptop_loop', since: 0 }, 10_000)).toBeNull()
  expect(frameAt('laptop_loop', 220)).toBe('type_2')
  // Key poses hold longer than the in-betweens
  expect(frameAt('laptop_loop', 310)).toBe('type_3')
  expect(frameAt('laptop_loop', 510)).toBe('type_3')
  // Every work opens into its loop and closes back to idle
  for (const w of WORKS) {
    expect(nextActivity({ kind: w + '_open', since: 0 }, 60_000)?.kind).toBe(w + '_loop')
    expect(ANIMATIONS[w + '_loop'].loop).toBe(true)
    expect(nextActivity({ kind: w + '_close', since: 0 }, 60_000)?.kind).toBe('idle')
  }
})

test('the terminal sprite is half-blocks, two pixels to a cell, transparent where empty', () => {
  const { columns, rows, words } = halfBlockCells(FRAMES.idle_0, PALETTE)
  expect([columns, rows]).toEqual([32, 8])
  // The top-left cell is empty: a space on the terminal's own colors
  expect(words.slice(0, 3)).toEqual([0x20, 0x01000000, 0x01000000])
  // Row 2 of cells is the top of Clawd's head: its lit top face over its orange
  const head = (2 * 32 + 14) * 3
  expect(words.slice(head, head + 3)).toEqual([0x2580, parseInt(PALETTE.q.slice(1), 16), 0xd77757])
})

test('the desktop sprite is one SVG whose frames take turns', () => {
  const svg = animatedSvg([[FRAMES.type_0, 200], [FRAMES.type_1, 200]], PALETTE, 8)
  expect(svg).toContain('shape-rendering="crispEdges"')
  expect((svg.match(/attributeName="visibility"/g) ?? []).length).toBe(2)
  expect(svg).toContain('repeatCount="indefinite"')
  expect(animatedSvg([[FRAMES.open_0, 200], [FRAMES.open_1, 200]], PALETTE, 8, { loop: false })).toContain('fill="freeze"')
  // In the scene, the office is drawn once and Clawd's frames over it
  const scene = animatedScene(SCENE, [[FRAMES.type_0, 200], [FRAMES.type_1, 200]], CLAWD_AT, PALETTE, 5)
  expect(scene).toContain(`width="${SCENE_W * 5}" height="${SCENE_H * 5}"`)
  expect(scene).toContain(`<use href="#f0" x="${CLAWD_AT.x}" y="${CLAWD_AT.y}"/>`)
  // A frame shown twice is drawn once and used twice
  const twice = animatedScene(SCENE, [[FRAMES.idle_0, 200], [FRAMES.idle_1, 200], [FRAMES.idle_0, 200]], CLAWD_AT, PALETTE, 5)
  expect((twice.match(/<g id=/g) ?? []).length).toBe(2)
  // Every animation fits the desktop's SVG limit
  for (const [kind, a] of Object.entries(ANIMATIONS)) {
    const svg = animatedScene(SCENE, a.frames.map(([n, ms, dx = 0]) => [FRAMES[n], ms, dx]), CLAWD_AT, PALETTE, 5, { loop: a.loop, shade: SHADE })
    expect([kind, svg.length < 131_072]).toEqual([kind, true])
  }
})

// The mod in a session

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: Clawd opens the laptop when work starts and types until it ends`, async ($, on) => {
    const clock = await start($, on, surface)
    const ui = await $.ui.mount(PANE(surface))
    expect(await ui.find({ type: 'Text', text: 'Clawd' })).toBeDefined()
    // A new session opens with a wave, then Clawd goes back to waiting
    expect(await ui.find({ type: 'Text', text: '· saying hi' })).toBeDefined()
    await clock.advance(3000)
    expect(await ui.find({ type: 'Text', text: '· waiting' })).toBeDefined()

    await $.turn.start({ text: 'fix the bug', turnId: 't1' })
    // It's at one of its works, and the header says which
    const labels = await Promise.all(WORKS.map((w) => ui.find({ type: 'Text', text: '· ' + WORK_LABEL[w] })))
    expect(labels.filter(Boolean).length).toBe(1)
    if (surface === 'terminal') {
      const raster = await ui.find({ type: 'Raster' })
      expect(raster?.props.key).toBe('clawd')
      expect([raster?.props.columns, raster?.props.rows]).toEqual([SCENE_W, SCENE_H / 2])
    } else {
      const svg = await ui.find({ type: 'Svg' })
      expect(WORKS.map((w) => 'Clawd in the office, ' + WORK_ALT[w])).toContain(svg?.props.alt)
      expect(svg?.props.source).toContain('fill="freeze"')
    }

    // Once set up, the work's loop runs
    await clock.advance(1500)
    if (surface === 'desktop') expect((await ui.find({ type: 'Svg' }))?.props.source).toContain('repeatCount="indefinite"')

    await finish($, EMPTY)
    await clock.advance(1500)
    expect(await ui.find({ type: 'Text', text: '· waiting' })).toBeDefined()
  })

  test(`${surface}: finished work drops an item into the collection`, async ($, on) => {
    await start($, on, surface)
    const ui = await $.ui.mount(PANE(surface))
    expect(await ui.find({ type: 'Text', text: 'Collection 0/7' })).toBeDefined()
    await finish($, DROPPING)
    const item = rollDrop(DROPPING)!
    expect(await ui.find({ type: 'Text', text: `Last drop: ${ITEMS[item].name} (${ITEMS[item].rarity[0].toUpperCase() + ITEMS[item].rarity.slice(1)})` })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Collection 1/7' })).toBeDefined()
    if (surface === 'desktop') {
      expect((await ui.find({ key: 'collection' }))?.children[1].children[0].props.alt).toBe('1 of 7 items collected')
    } else {
      expect(await ui.find({ type: 'Text', text: `${ITEMS[item].name} ×1` })).toBeDefined()
    }
  })
}

test('a subagent turn gives EXP but no drop and no laptop', async ($, on) => {
  await start($, on, 'desktop')
  await finish($, DROPPING, { agentId: 'agent-1' })
  const out = await $.command.run({ command: 'pet', args: 'collection' })
  expect(out.text).toBe('Nothing found yet: 0 of 7. Finished work sometimes drops an item.')
  const stats = await $.command.run({ command: 'pet', args: 'stats' })
  expect(stats.text).toContain('0 pieces of work finished, 0 drops, 0 of 7 items collected')
})

test('progress from another session on this machine shows up', async ($, on) => {
  const other = [{ type: 'turn', id: 'x1', at: NOW - HOUR, exp: 60, isAnswer: true, drop: 'cache_cake' }]
  await start($, on, 'desktop', { base: newBase(NOW - 2 * HOUR), 'ledger:sess-other': other })
  const stats = await $.command.run({ command: 'pet', args: 'stats' })
  expect(stats.text).toContain('Clawd, level 1')
  expect((await $.command.run({ command: 'pet', args: 'collection' })).text).toBe('1 of 7 found: Cache Cake ×1.')
})

test('/pet rename and /pet reset', async ($, on) => {
  await start($, on, 'desktop')
  await finish($, EMPTY)
  expect((await $.command.run({ command: 'pet', args: 'rename Pixel' })).text).toBe('Your pet is now called Pixel.')
  expect((await $.command.run({ command: 'pet', args: 'stats' })).text).toContain('Pixel, level')
  expect((await $.command.run({ command: 'pet', args: 'reset' })).text).toContain('/pet reset confirm')
  await $.command.run({ command: 'pet', args: 'reset confirm' })
  expect((await $.command.run({ command: 'pet', args: 'stats' })).text).toContain('Clawd, level 0 (0/50 EXP')
})

test('options: a custom name, no status line', { options: { name: 'Bitsy', statusLine: false } }, async ($, on) => {
  await start($, on, 'desktop')
  expect((await $.command.run({ command: 'pet', args: 'stats' })).text).toContain('Bitsy, level 0')
})

test("the terminal paints the work's loop in place while Claude works", async ($, on) => {
  const blits: { key: string; columns?: number; rows?: number; cells: string }[] = []
  on('ui.blit', ($, e) => {
    blits.push(e)
    return { value: {} }
  })
  const clock = await start($, on, 'terminal')
  await $.ui.mount(PANE('terminal'))
  await $.turn.start({ text: 'go', turnId: 't1' })
  await clock.advance(2000)

  const typing = WORKS.flatMap((w) => ANIMATIONS[w + '_loop'].frames.map(([name]) => FRAMES[name]))
  const cellsOf = (grid, sky) => {
    const { words } = halfBlockCells(composite(withClouds(SCENE, CLOUDS, sky), grid, CLAWD_AT, SHADE), PALETTE)
    return new Uint8Array(Uint32Array.from(words).buffer).toBase64()
  }
  const typingCells = new Set(typing.flatMap((grid) => CLOUDS.rows[0].split('').map((_, sky) => cellsOf(grid, sky))))
  const painted = blits.filter((b) => b.key === 'clawd' && typingCells.has(b.cells))
  expect(painted.length).toBeGreaterThan(1)
  // More than one of the loop's frames shows: it animates
  expect(new Set(painted.map((b) => b.cells)).size).toBeGreaterThan(1)
})

test('a drop toast reads naturally', async ($, on) => {
  const toasts: string[] = []
  await start($, on, 'desktop', {}, 'sess-a', toasts)
  await finish($, DROPPING)
  const item = ITEMS[rollDrop(DROPPING)!]
  const words = item.rarity === 'common' ? item.name : item.rarity + ' ' + item.name
  expect(toasts).toContain(`Clawd found ${/^[aeiou]/i.test(words) ? 'an' : 'a'} ${words}!`)
})

test('a ledger another session merged away is not counted twice', async ($, on) => {
  const store = new Map<string, unknown>()
  const clock = await start($, on, 'desktop', {}, 'sess-a', [], store)
  await finish($, EMPTY)
  const before = (await $.command.run({ command: 'pet', args: 'stats' })).text
  expect(before).toContain('1 pieces of work finished')

  // Another session folds this one's ledger into the base and deletes it, as
  // compaction does for a ledger whose last event is days old
  const merged = fold(store.get('base') ?? newBase(NOW), { 'ledger:sess-a': store.get('ledger:sess-a') })
  store.set('base', { ...merged, folded: {} })
  store.delete('ledger:sess-a')

  await clock.advance(61_000)
  expect((await $.command.run({ command: 'pet', args: 'stats' })).text).toBe(before)
  // And the next turn adds on top, once
  await finish($, 'turn-next-' + EMPTY)
  expect((await $.command.run({ command: 'pet', args: 'stats' })).text).toContain('2 pieces of work finished')
})

test('every stat row is one fixed-size pixel SVG, so the bars line up', () => {
  const rows = Object.keys(STATS).map((k) => statRowSvg(k, 60))
  const sizes = rows.map((svg) => svg.match(/width="(\d+)" height="(\d+)"/)!.slice(1).join('x'))
  expect(new Set(sizes).size).toBe(1)
  // The bar's frame starts at the same x in every row
  for (const svg of rows) expect(svg).toContain('<rect x="37" y="0" width="50"')
  // EXP glints; low energy blinks its frame red; high energy doesn't
  expect(statRowSvg('exp', 50)).toContain('attributeName="x"')
  expect(statRowSvg('energy', LOW)).toContain('#FF4D4D')
  expect(statRowSvg('energy', 80)).not.toContain('#FF4D4D')
  expect(statRowSvg('exp', 10)).not.toContain('#FF4D4D')
  // Unknown energy: an empty track and a dash
  expect(statRowSvg('energy', null)).not.toContain(`height="3" fill="${STATS.energy.colors.base}"`) // no fill
  expect(statRowSvg('energy', 50)).toContain(`<rect x="37" y="1" width="25" height="1" fill="${STATS.energy.colors.hi}"/>`)
})

test('the terminal stat bar is 20 half-block cells, filled to the value', () => {
  const words = statBarWords('energy', 50)
  expect(words.length).toBe(20 * 3)
  const filled = Array.from({ length: 20 }, (_, i) => words[i * 3 + 2] === parseInt(STATS.energy.colors.base.slice(1), 16)).filter(Boolean).length
  expect(filled).toBe(10)
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: the pane draws EXP and Energy, energy from the 5-hour limit`, async ($, on) => {
    await start($, on, surface)
    const ui = await $.ui.mount(PANE(surface))
    for (const key of ['exp', 'energy']) expect(await ui.find({ key: 'stat-' + key })).toBeDefined()
    for (const key of ['fullness', 'happiness']) expect(await ui.find({ key: 'stat-' + key })).toBeUndefined()
    // 40% of the 5-hour limit used: 60% energy left
    if (surface === 'desktop') {
      expect((await ui.find({ key: 'stat-energy' }))?.children[0].props.alt).toBe('Energy 60%')
    } else {
      expect((await ui.find({ key: 'bar-energy' }))?.props.columns).toBe(20)
      expect(await ui.find({ type: 'Text', text: ' 60%' })).toBeDefined()
    }
  })
}

test('Clawd stands centered on the rug, clear of the props', () => {
  // Clawd's arms span x8..23 of its 32-wide frame
  const left = CLAWD_AT.x + 8
  const right = SCENE_W - (CLAWD_AT.x + 24)
  expect(left).toBe(right)
  // Its feet (the frame's row 13) are on the rug
  const feetRow = SCENE[CLAWD_AT.y + 13]
  for (const x of [11, 13, 18, 20]) expect(['7', '8']).toContain(feetRow[CLAWD_AT.x + x])
  // Wherever it wanders, its frame (props included) stays inside the scene
  expect(CLAWD_AT.x - 6).toBeGreaterThanOrEqual(0)
  expect(CLAWD_AT.x + 6 + SPRITE_W).toBeLessThanOrEqual(SCENE_W)
})

test('energy shows the last 5-hour reading in a new session, before any reply', async ($, on) => {
  await start($, on, 'desktop', { fiveHour: { percentUsed: 5, resetsAt: '2026-10-17T12:00:00Z' } }, 'sess-a', [], undefined, [])
  expect((await $.command.run({ command: 'pet', args: 'stats' })).text).toContain('Energy 95%')
})

test('the collection strip silhouettes what has not dropped yet', () => {
  const svg = collectionSvg([{ id: 'bit_cookie', count: 2 }, { id: 'cache_cake', count: 0 }])
  expect(svg).toContain('#3A3550')
  expect(svg).toContain(PALETTE.l) // the cookie in color
})

test('idle wanders right and left and comes home, the feet never sliding', () => {
  const idle = ANIMATIONS.idle.frames
  const xs = idle.map(([, , dx = 0]) => dx)
  expect(Math.max(...xs)).toBe(6)
  expect(Math.min(...xs)).toBe(-6)
  expect(xs[0]).toBe(0)
  expect(xs[xs.length - 1]).toBe(0)
  // Clawd moves only on the frames where a lifted pair comes down, a pixel at a time
  for (let i = 1; i < idle.length; i++) {
    const moved = Math.abs(xs[i] - xs[i - 1])
    expect(moved <= 1).toBe(true)
    if (moved === 1) expect(['walk_r_1', 'walk_r_3', 'walk_l_1', 'walk_l_3']).toContain(idle[i][0])
  }
})

test('work found away from the middle happens there, then Clawd walks home', () => {
  // Opening where it stands, closing there, then home to the middle
  const after = nextActivity({ kind: 'paint_close', since: 0, dx: 4 }, 10_000)
  expect(after?.kind).toBe('home_4')
  expect(after?.dx).toBe(4)
  const home = ANIMATIONS.home_4.frames
  expect((home[home.length - 1][2] ?? 0) + 4).toBe(0)
  expect(nextActivity({ kind: 'home_4', since: 0, dx: 4 }, 10_000)).toEqual({ kind: 'idle', since: expect.any(Number), dx: 0 })
  expect(nextActivity({ kind: 'laptop_close', since: 0, dx: 0 }, 10_000)?.kind).toBe('idle')
})

test('Clawd and the laptop cast shadows that darken the floor beneath', () => {
  const scene = composite(SCENE, FRAMES.type_0, CLAWD_AT, SHADE)
  const row = scene[CLAWD_AT.y + 14]
  const shaded = [...row].filter((c) => Object.values(SHADE).includes(c)).length
  expect(shaded).toBeGreaterThan(5)
})

test('the clouds drift left a pixel a step, wrap around, and stay above the skyline', () => {
  const width = CLOUDS.rows[0].length
  expect(cloudGrid(CLOUDS, 0)).toEqual(CLOUDS.rows)
  expect(cloudGrid(CLOUDS, 1)[0]).toBe(CLOUDS.rows[0].slice(1) + CLOUDS.rows[0][0])
  expect(cloudGrid(CLOUDS, width)).toEqual(CLOUDS.rows)
  expect(gridProblems('CLOUDS', CLOUDS.rows, PALETTE, width, CLOUDS.rows.length)).toEqual([])
  // Every cloud pixel lands on the window's sky, moon or stars, never the skyline or frame
  for (let step = 0; step < width; step++)
    cloudGrid(CLOUDS, step).forEach((row, y) =>
      [...row].forEach((p, x) => {
        if (p !== '.') expect(['9', 'M']).toContain(SCENE[CLOUDS.y + y][CLOUDS.x + x])
      }),
    )
  // On desktop the clouds are their own loop, one step per pixel of the strip
  const svg = animatedScene(SCENE, [[FRAMES.idle_0, 200]], CLAWD_AT, PALETTE, 5, { clouds: { strip: CLOUDS, stepMs: 1500, step: 3 } })
  expect((svg.match(/<g id="c\d+"/g) ?? []).length).toBe(width)
  expect(svg).toContain(`dur="${(width * 1.5).toFixed(3)}s"`)
})

test('each turn picks a work at random, never the same twice running', () => {
  // Across the range of rolls, every work comes up
  const picked = new Set(Array.from({ length: 40 }, (_, i) => pickWork(i / 40)))
  expect([...picked].sort()).toEqual([...WORKS].sort())
  for (const last of WORKS) for (let i = 0; i < 20; i++) expect(pickWork(i / 20, last)).not.toBe(last)
  expect(workOf('paint_loop')).toBe('paint')
  expect(workOf('home_3')).toBeNull()
})

test('two turns in a row get different works, and both draw', async ($, on) => {
  const clock = await start($, on, 'desktop')
  const ui = await $.ui.mount(PANE('desktop'))
  const altNow = async () => (await ui.find({ type: 'Svg' }))?.props.alt
  await $.turn.start({ text: 'one', turnId: 'turn-a' })
  const first = await altNow()
  await finish($, EMPTY)
  await clock.advance(3000)
  await $.turn.start({ text: 'two', turnId: 'turn-b' })
  const second = await altNow()
  expect(first).not.toBe(second)
  expect(second).not.toBe('Clawd in the office, waiting')
})

test('the painting fills in stroke by stroke, the plant grows, the tower too', () => {
  const white = (name) => FRAMES[name].join('').split('w').length
  // More of the canvas painted at each dab
  expect(white('paint_dab_5')).toBeLessThan(white('paint_dab_0'))
  // The plant grows a stage with each watering, and ends in a pink bloom
  const leaves = (name) => FRAMES[name].map((row) => row.slice(0, 8)).join('').split('').filter((c) => 'GDp'.includes(c)).length
  for (let stage = 1; stage < 4; stage++) expect(leaves(`garden_grow_${stage}`)).toBeGreaterThan(leaves(`garden_grow_${stage - 1}`))
  expect(FRAMES.garden_bloom.join('')).toContain('p')
  // Water falls from the can while it pours
  expect(FRAMES.garden_pour_0_0.join('')).toContain('b')
  // The tower grows a block at a time
  const blocks = (name) => FRAMES[name].join('').split('').filter((c) => 'rtxEFH'.includes(c)).length
  expect(blocks('blocks_place_0')).toBeLessThan(blocks('blocks_place_1'))
  expect(blocks('blocks_place_1')).toBeLessThan(blocks('blocks_place_2'))
})

test('Clawd waves when a session starts, and again after /clear or /resume', async ($, on) => {
  const clock = await start($, on, 'desktop')
  const ui = await $.ui.mount(PANE('desktop'))
  const alt = async () => (await ui.find({ type: 'Svg' }))?.props.alt
  expect(await alt()).toBe('Clawd in the office, waving hello')
  await clock.advance(3000)
  expect(await alt()).toBe('Clawd in the office, waiting')

  await $.session.end({ reason: 'clear', sessionId: 'sess-a', resume: { sessionId: 'sess-a' } })
  expect(await alt()).toBe('Clawd in the office, waving hello')
  await clock.advance(3000)
  await $.session.end({ reason: 'resume', sessionId: 'sess-a', resume: { sessionId: 'sess-a' } })
  expect(await alt()).toBe('Clawd in the office, waving hello')

  // Quitting is not a hello
  await clock.advance(3000)
  await $.session.end({ reason: 'prompt_input_exit', sessionId: 'sess-a', resume: { sessionId: 'sess-a' } })
  expect(await alt()).toBe('Clawd in the office, waiting')
})

test('a wave never interrupts work', async ($, on) => {
  const clock = await start($, on, 'desktop')
  const ui = await $.ui.mount(PANE('desktop'))
  await clock.advance(3000)
  await $.turn.start({ text: 'go', turnId: 'turn-w' })
  const busy = (await ui.find({ type: 'Svg' }))?.props.alt
  await $.session.end({ reason: 'clear', sessionId: 'sess-a', resume: { sessionId: 'sess-a' } })
  expect((await ui.find({ type: 'Svg' }))?.props.alt).toBe(busy)
  // The wave is one-shot: it settles back into the idle wander
  expect(nextActivity({ kind: 'wave', since: 0, dx: 0 }, 60_000)?.kind).toBe('idle')
})

test('state an older version left behind after a reload never breaks it', () => {
  // Activity names from before the works were renamed fall back to idle
  for (const old of ['opening', 'typing', 'closing', undefined, 42]) {
    expect(known(old)).toBe('idle')
    expect(() => poseAt(old, 1000)).not.toThrow()
  }
  expect(nextActivity({ kind: 'typing', since: 0, dx: 3 }, 5000)).toEqual({ kind: 'idle', since: 5000, dx: 0 })
  // The 5-hour reading as an older version kept it: the bare percent used
  expect(energyFrom(40, NOW)).toBe(60)
  expect(energyFrom({ junk: true }, NOW)).toBeNull()
})
