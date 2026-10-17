// What Clawd is doing, as frame sequences. Each time work starts, Clawd picks
// one of its works at random (never the same twice running): the laptop,
// painting at an easel, watering a plant until it blooms, or building a
// tower of blocks. Each work has three animations: <work>_open as it sets up,
// <work>_loop until the work ends, and <work>_close as it puts things away.

// Key poses hold two or three times longer than the in-betweens between
// them, so the motion eases in and out; the typing beats vary so they read as
// bursts of typing, not a metronome. A frame is [name, ms] or [name, ms, dx]:
// dx is how many pixels right of its spot Clawd stands (left when negative)

// How far Clawd wanders from the middle of the rug, and how long a step takes
export const WANDER = 6
const STEP_MS = 130
const EASE_MS = 210

// A crab's walk from dx `from` to `to`: each step lifts a leg pair, then puts
// it down a pixel along, so the feet never slide; the first and last steps
// are held longer, easing in and out
export function walk(from, to) {
  const dir = Math.sign(to - from)
  const side = dir > 0 ? 'r' : 'l'
  const frames = []
  let x = from
  let phase = 0
  while (x !== to) {
    frames.push([`walk_${side}_${phase}`, STEP_MS, x])
    x += dir
    frames.push([`walk_${side}_${phase + 1}`, STEP_MS, x])
    phase = (phase + 2) % 4
  }
  if (frames.length) {
    frames[0][1] = EASE_MS
    frames[frames.length - 1][1] = EASE_MS
  }
  return frames
}

const pause = (dx, poses) => poses.map(([name, ms]) => [name, ms, dx])

export const ANIMATIONS = {
  // Idle: a breath in the middle, a glance, a wander right, a look back, all
  // the way left, and home again
  idle: {
    loop: true,
    frames: [
      ...pause(0, [['idle_0', 600], ['idle_1', 500], ['idle_0', 400], ['idle_look_r', 500]]),
      ...walk(0, WANDER),
      ...pause(WANDER, [['idle_1', 450], ['idle_0', 450], ['idle_blink', 120], ['idle_0', 300], ['idle_look_l', 600]]),
      ...walk(WANDER, -WANDER),
      ...pause(-WANDER, [['idle_0', 500], ['idle_1', 500], ['idle_0', 400], ['idle_look_r', 500]]),
      ...walk(-WANDER, 0),
      ...pause(0, [['idle_blink', 120], ['idle_0', 300]]),
    ],
  },
  // Hello: a hop, three waves, a blink, and back to wandering
  wave: {
    loop: false,
    then: 'idle',
    frames: [
      ['wave_hop', 120], ['idle_0', 100], ['wave_up', 160],
      ['wave_out', 180], ['wave_up', 120], ['wave_in', 180], ['wave_up', 120],
      ['wave_out', 180], ['wave_up', 120], ['wave_in', 180], ['wave_up', 120],
      ['wave_out', 180], ['wave_blink', 140], ['wave_up', 200], ['idle_0', 300],
    ],
  },

  laptop_open: {
    loop: false,
    then: 'laptop_loop',
    frames: [['open_0', 120], ['open_1', 70], ['open_2', 90], ['open_3', 80], ['open_4', 80], ['open_5', 80], ['open_6', 300]],
  },
  laptop_loop: {
    loop: true,
    frames: [['type_0', 100], ['type_1', 100], ['type_2', 100], ['type_3', 220], ['type_4', 100], ['type_5', 100], ['type_6', 220], ['type_7', 140]],
  },
  laptop_close: {
    loop: false,
    frames: [['close_0', 80], ['close_1', 80], ['close_2', 80], ['close_3', 120], ['close_4', 70], ['close_5', 110], ['close_6', 180]],
  },

  // Painting: reach, dab, reach, dab, stroke by stroke, then a step back to
  // admire it, a sparkle when it's done, and a fresh canvas
  paint_open: { loop: false, then: 'paint_loop', frames: [['paint_open_0', 160], ['paint_open_1', 260], ['paint_open_2', 300]] },
  paint_loop: {
    loop: true,
    frames: [
      ...[0, 1, 2, 3, 4, 5].flatMap((i) => [[`paint_reach_${i}`, 150], [`paint_dab_${i}`, i % 2 ? 260 : 200]]),
      ['paint_admire', 500], ['paint_admire_blink', 120], ['paint_admire', 300], ['paint_done', 450], ['paint_fresh', 260],
    ],
  },
  paint_close: { loop: false, frames: [['paint_admire', 200], ['paint_close_0', 200]] },

  // Gardening: water pouring, the plant growing a stage at a time from a
  // sprout to a flower, a step back to admire the bloom, and a new sprout
  garden_open: { loop: false, then: 'garden_loop', frames: [['garden_open_0', 160], ['garden_open_1', 300]] },
  garden_loop: {
    loop: true,
    frames: [
      ...[0, 1, 2, 3].flatMap((stage) => [
        [`garden_pour_${stage}_0`, 150], [`garden_pour_${stage}_1`, 150], [`garden_pour_${stage}_2`, 150],
        [`garden_pour_${stage}_0`, 150], [`garden_pour_${stage}_1`, 150], [`garden_pour_${stage}_2`, 150],
        [`garden_grow_${stage}`, 320],
      ]),
      ['garden_admire', 500], ['garden_admire_blink', 120], ['garden_admire', 300], ['garden_bloom', 500], ['garden_open_1', 300],
    ],
  },
  garden_close: { loop: false, frames: [['garden_admire', 200], ['garden_close_0', 200]] },

  // Building: carry a block, set it down, three times; a proud bounce, a
  // wobble, the tower comes down, a startled look, and off they go
  blocks_open: { loop: false, then: 'blocks_loop', frames: [['blocks_open_0', 200]] },
  blocks_loop: {
    loop: true,
    frames: [
      ...[0, 1, 2].flatMap((i) => [[`blocks_carry_${i}`, 300], [`blocks_place_${i}`, 260]]),
      ['blocks_proud', 300], ['blocks_place_2', 400], ['blocks_wobble_0', 140], ['blocks_wobble_1', 140], ['blocks_wobble_0', 140],
      ['blocks_toppled', 450], ['blocks_look', 500], ['blocks_clear', 220],
    ],
  },
  blocks_close: { loop: false, frames: [['blocks_clear', 220]] },
}

// The works Clawd picks from, and what the header says it's doing at each
export const WORKS = ['laptop', 'paint', 'garden', 'blocks']
export const WORK_LABEL = { laptop: 'typing', paint: 'painting', garden: 'gardening', blocks: 'building' }
export const WORK_ALT = { laptop: 'typing on a laptop', paint: 'painting at an easel', garden: 'watering a plant', blocks: 'building a tower of blocks' }

// The work an activity belongs to, or null for idle and walking home
export function workOf(kind) {
  const work = kind.split('_')[0]
  return WORKS.includes(work) ? work : null
}

// A work for this turn: random, from `roll` in [0, 1), but never the one
// Clawd just did
export function pickWork(roll, last = null) {
  const choices = WORKS.filter((w) => w !== last)
  return choices[Math.min(choices.length - 1, Math.floor(roll * choices.length))]
}

// Walking home to the middle from wherever work found Clawd: `home_<dx>`
for (let d = -WANDER; d <= WANDER; d++) {
  if (d !== 0) ANIMATIONS['home_' + d] = { loop: false, then: 'idle', frames: walk(0, -d) }
}

// An activity this version knows, or idle: state kept across a reload can
// name one an older version had (opening, typing, closing)
export function known(kind) {
  return typeof kind === 'string' && ANIMATIONS[kind] ? kind : 'idle'
}

export function duration(kind) {
  return ANIMATIONS[known(kind)].frames.reduce((sum, [, ms]) => sum + ms, 0)
}

// The frame to show `elapsed` ms into an animation, and how far right of its
// spot Clawd stands then (`dx`, negative for left). A one-shot animation
// holds its last frame once done
export function poseAt(kind, elapsed) {
  const { loop, frames } = ANIMATIONS[known(kind)]
  const total = duration(kind)
  let t = loop ? ((elapsed % total) + total) % total : Math.min(Math.max(0, elapsed), total - 1)
  for (const [frame, ms, dx = 0] of frames) {
    if (t < ms) return { frame, dx }
    t -= ms
  }
  const [frame, , dx = 0] = frames[frames.length - 1]
  return { frame, dx }
}

export function frameAt(kind, elapsed) {
  return poseAt(kind, elapsed).frame
}

// Where an activity goes once its one-shot animation has played: a work's
// open becomes its loop; its close becomes idle, by way of a walk home when
// work found Clawd away from the middle. Null while it is still playing, or for a loop.
// An activity's `dx` is where it happens: work happens where Clawd stood
export function nextActivity(activity, now) {
  if (known(activity.kind) !== activity.kind) return { kind: 'idle', since: now, dx: 0 }
  const a = ANIMATIONS[activity.kind]
  if (a.loop || now - activity.since < duration(activity.kind)) return null
  const since = activity.since + duration(activity.kind)
  const dx = activity.dx ?? 0
  if (activity.kind.endsWith('_close')) return dx !== 0 ? { kind: 'home_' + dx, since, dx } : { kind: 'idle', since, dx: 0 }
  if (activity.kind.startsWith('home_')) return { kind: 'idle', since, dx: 0 }
  return { kind: a.then, since, dx }
}

// Where Clawd stands now: the activity's spot plus its frame's own dx
export function standingAt(activity, now) {
  return (activity.dx ?? 0) + poseAt(activity.kind, now - activity.since).dx
}
