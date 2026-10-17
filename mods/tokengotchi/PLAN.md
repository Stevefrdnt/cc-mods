# Tokengotchi: plan

A virtual pet for Claude Code, inspired by the old Tamagotchi handhelds. The pet is **Clawd**, the pixel mascot from the Claude Code welcome screen. It lives in a pane beside the conversation and, while Claude works, opens a laptop and types away. It grows from what you do in Claude Code: tokens spent give it EXP, each finished piece of work rolls a random drop (food or an item), and your plan limits and context fill set its mood and energy.

`Tokengotchi` is a working name. See [Open decisions](#open-decisions).


> **Revision, 2026-10-17: gamified, not a care game.** Fullness, happiness, feeding, decay over time and the Pace setting are gone. Clawd has nothing to look after; it reflects how you use Claude Code. What stays: EXP and levels from tokens, drops (now a collection of 7 items, silhouetted until found), and Energy, which is what's left of the 5-hour plan limit (5% used shows 95%). Sections below that describe hunger, happiness, feeding or decay are superseded by this note.

---

## 1. Goals and non-goals

**Goals**
- A fun showcase mod that anyone can install with one command from the `stevefrdnt` marketplace.
- Every mechanic is driven by a real Claude Code signal, with nothing faked.
- Works in the terminal and in the desktop app, from one sprite source.
- Never punishing. You can step away for a weekend and come back to a sulky pet, not a dead one.
- Local and private. The pet never records prompt or answer text, only counts.

**Non-goals for v0.1**
- Multiplayer, leaderboards, trading, or any network calls.
- Sound. `$.audio.play` exists, so it can come later.
- Paid or locked content.

---

## 2. Signals → mechanics

All of these are confirmed in this build's mod API (`claude-code.d.ts`).

| Claude Code signal | Where it comes from | What it does to the pet |
| --- | --- | --- |
| Tokens used in a turn | `turn.complete` → `e.usage` (`input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`) | **EXP.** Uses log scaling with a per-turn cap (see 2.1). |
| Work finished | `turn.complete` with `reason === 'answer'` on the main loop (`e.agentId` unset) | **Loot roll**: food or an item from a weighted table. |
| Subagent work | `turn.complete` with `e.agentId` set | EXP only (reduced), **no drops**. Otherwise an agent swarm would be a loot farm. |
| Interrupted turn or API error | `reason === 'aborted'` / `'error'` | No drop and a small mood dip ("startled"). |
| Refusal | `reason === 'refusal'` | No effect. Don't punish the user for model behaviour. |
| 5h and weekly plan limits | `session.measure` → `$.session.usage().rateLimits` | **Energy.** The pet gets drowsy from 75% and falls asleep near the limit. It wakes when the window resets. |
| Context fill | `$.session.usage().context` | **Fullness or "brain fog".** The pet looks stuffed near auto-compact, and a compaction (`classic.SessionStart` source `compact`) gives a "refreshed" boost. |
| Bonus moments (v0.2) | `tool.call` → `await next(e)`, then check `isError` on Bash results such as `git commit` or a passing test run | Rare-drop chance and achievements. |
| Time away | `now - lastSeen`, computed at `session.start` | **Hunger and happiness decay**, computed from timestamps when the mod loads. It does not tick in the background, because the mod only runs while a session is open. |

### 2.1 EXP formula (first draft, to tune)

```
turnTokens = input + output + cacheWrite + cacheRead * 0.1   // cache reads are cheap, so weight them low
exp        = min(EXP_CAP_PER_TURN, round(10 * log10(1 + turnTokens / 100)))
subagent   → exp * 0.5
level N needs 50 * N^1.5 total EXP
```

Log scaling plus the cap means a Max-plan user running long agent loops levels faster than a light user, but not 100× faster. Daily soft caps are a possible v0.2 lever.

### 2.2 Stats

| Stat | Range | Goes up by | Goes down by |
| --- | --- | --- | --- |
| Hunger | 0–100 | Feeding food items | About 4 per hour away, floor 10 |
| Happiness | 0–100 | Finished work, toys, petting | Aborts, long neglect, floor 10 |
| Energy | 0–100 | A plan-limit window resetting, sleep | Rises in step with 5h usage |
| EXP / Level | — | Tokens | Never goes down |

Floors keep stats from reaching zero, so the pet never dies. The worst states are "hungry", "sulking" and "asleep".

### 2.3 The work loop (the main interaction)

Clawd stays Clawd, with no evolution stages. Its animation follows what Claude is doing:

| Claude Code moment | Signal | Clawd |
| --- | --- | --- |
| Waiting for you | no turn running | `idle`: stands, blinks now and then |
| Work starts | `turn.start` on the main loop | `laptop_0 → 2`: puts a laptop down and opens it |
| Working | between `turn.start` and `turn.complete` | `typing` loop: arms tap, keys spark, code bits float off the screen |
| Work ends | `turn.complete` | the laptop frames played backwards, back to `idle`. On `reason === 'answer'` the drop roll from 2.4 runs and the drop shows as a toast. |

Levels show up as numbers and cosmetics (v0.2), not as new body shapes.

### 2.4 Drops and inventory

On each main-loop `answer`, roll the drop chance (about 35%), then roll the rarity:

| Rarity | Weight | Examples |
| --- | --- | --- |
| Common | 70 | Bit Cookie, Token Tea, Byte Bun |
| Uncommon | 22 | Cache Cake (big hunger fill), Rubber Duck (toy) |
| Rare | 7 | Context Crystal (+happiness, cosmetic sparkle) |
| Legendary | 1 | Golden Semicolon (a hat) |

The RNG is seeded per turn from `turnId`, so a redraw or reload can't re-roll the same turn. That makes drops idempotent.

---

## 3. Persistence: one pet across all sessions

- The pet lives in **`$.store`**, a JSON file under the user's Claude config, shared by every session on the machine. `$.state` is per session and only survives hot reloads, so it can't hold the pet.
- **The race:** `$.store` has only `get`, `set`, `delete` and `keys`, with no compare-and-set. Two open sessions doing read-modify-write would lose EXP or duplicate drops.
- **Design: per-session ledgers plus a fold.**
  - Each session writes only its own key, `ledger:<sessionId>`: an append-only list of events (`{turnId, exp, drop?, at}`). With one writer per key, no updates are lost.
  - `pet:base` holds the folded snapshot. On `session.start` (and when ledgers grow past N entries), fold old ledgers into the base and delete them. Folding is idempotent because it is keyed by `turnId`.
  - User actions such as feeding go into the same ledger as events (`{type:'feed', item}`), so the inventory also stays consistent.
- `$.store` writes don't redraw by themselves. Call `$.ui.invalidate('ui.render')` after each write, as usage-bars does.
- Store cap is 4 MiB. Prune folded ledgers so this never gets close.

---

## 4. UI surfaces

| Surface | What it shows | API |
| --- | --- | --- |
| **Pane** (main home) | The animated sprite, stat bars, level and EXP bar, the latest drop, and Feed / Play / Inventory buttons | `$.ui.open({ id: 'pet', title })` + `ui.render` on `{ component: 'Pane', requestId }` |
| **Status line** (always visible) | A compact line, e.g. `🥚 Bit Lv3 ♥♥♥♡ 🍪2`, toggleable | `$.ui.status(text)` |
| **Toast** | "Bit found a **Cache Cake**!", "Level up!", "Evolved!" | `$.ui.toast(text)` |
| **Slash commands** | `/pet` (open the pane), `/pet feed [item]`, `/pet inv`, `/pet stats`, `/pet rename`, `/pet reset` | `$.command.register` + `command.run` |

- The full sprite goes in the pane, **not** the band above the prompt. A 20×14 frame takes 7 terminal rows and would stack on top of usage-bars.
- Check `isPlaced` from `$.ui.open`. If no surface can place the pane, fall back to the status line and commands.
- Buttons: confirm per surface that `Button` from `$.ui.resolve(e)` is available. The `/pet feed` command is the guaranteed path everywhere.

---

## 5. Sprite pipeline (pixel art)

### 5.1 Source of truth: palette-indexed text grids

Each frame is an array of strings, one character per pixel, stored in `hooks/sprites.js`:

```js
export const PALETTE = {
  '.': null,        // transparent
  'o': '#D77757',   // Clawd's body, rgb(215,119,87) as in Claude Code
  'k': '#000000',   // eyes
  's': '#B9BFC7',   // laptop lid
  // …
}

export const FRAMES = {
  idle_0: [
    '....................',
    '....................',
    '....................',
    '....................',
    '....oooooooooooo....',
    '....oooooooooooo....',
    '....ookooooookoo....',
    '....ookooooookoo....',
    '..oooooooooooooooo..',
    '..oooooooooooooooo..',
    '....oooooooooooo....',
    '....oooooooooooo....',
    '.....o.o....o.o.....',
    '.....o.o....o.o.....',
  ],
  // idle_1, laptop_0..2, typing_0..2
}
```

**The silhouette is the Claude Code welcome sprite, exactly.** That sprite is three rows of quadrant blocks (` ▐▛███▜▌` / `▝▜█████▛▘` / `  ▘▘ ▝▝`). Decoded, it is 18×5 quadrant pixels. Each quadrant pixel is about twice as tall as it is wide, so each row is doubled here to make square pixels: an 18×10 figure on a 20×14 canvas, with 4 rows of headroom for effects.

Why this approach:
- Diffable, reviewable in a PR, and needs no binary assets or image decoder (the mod runtime has no DOM and no Node).
- One source draws both surfaces.
- Community sprite packs later are just another `FRAMES` file.

### 5.2 Rendering

- **Terminal: `Raster` with half-blocks.** Each cell holds 2 vertical pixels, so a 20×14 frame becomes 20 columns × 7 rows. The body's rows land on whole cells, so Clawd draws as cleanly as on the welcome screen.
  - Both pixels set: `▀` with fg = top colour and bg = bottom colour.
  - Only the top pixel set: `▀` with fg = top and bg = `0x01000000` (terminal default).
  - Only the bottom pixel set: `▄` with fg = bottom and bg = default.
  - Both transparent: a space. *Without this rule, transparent pixels paint as solid blocks.*
  - Pixels are about 2:1 tall in most terminals, so half-blocks give roughly square pixels.
- **Desktop: SVG `<rect>`s** with `shape-rendering="crispEdges"`, scaled ×4–×6. Merge horizontal runs of the same colour into one rect to keep the SVG small.
- **Animation**
  - Terminal: `$.clock.every(500, …)` + `$.ui.blit({ requestId, key, cells })` swaps frames on the Raster without redrawing the tree.
  - Desktop: either the same blit on a keyed Image, or SMIL `<animate>` on frame groups, as the usage-bars shimmer does.
  - Animation stops when the pane isn't placed, to save cycles.

### 5.3 Frame list for v0.1

| Animation | Frames | Played |
| --- | --- | --- |
| `idle` | ×2 (open, blink) | Mostly `idle_0`, with `idle_1` for one beat every few seconds |
| `laptop` | ×3 (closed on the floor, half open, open) | Forward when work starts, backward when it ends, about 150 ms a frame |
| `typing` | ×3 (left tap, right tap, both) | Looped while working, about 200 ms a frame |
| Items | 7 icons, 8×8 | In the toast, the pane and the inventory |

That's 8 pet frames, all drawn (`docs/sprites/sheet.png`). Later options include a happy hop when a drop lands, sleeping near plan limits, and stats-driven looks such as a thin or chubby Clawd by hunger.

### 5.4 Authoring workflow

1. **Reference:** the welcome-screen sprite is the base for every frame. Keep its silhouette, eye slits and colour as they are, and add only the laptop and effects around it.
2. **Draw:** in **Aseprite** or the free **Piskel** at 20×14 (pet) and 8×8 (items), with the palette in `sprites.js`.
3. **Convert:** a dev-only script, `scripts/png-to-grid.mjs`, turns exported PNGs into `FRAMES` strings and fails on colours that aren't in the palette. Hand-editing the strings also works for small tweaks.
4. **Preview:** `node scripts/preview-sprites.mjs` checks every grid and writes the contact sheet `docs/sprites/sheet.png`. Add `--terminal` to print the frames with the same half-block cells the mod draws. *(Done: v0.1 programmer art is in `hooks/sprites.js`.)*
5. **Test:** a unit test checks that every frame has the declared size, uses only palette characters, and that every animation has all its frames. `gridProblems` in `hooks/render.js` already does the first two.

---

## 6. Reusability and packaging

Follows this repo's conventions (see the root README, "Adding a new mod"):

```
mods/tokengotchi/
  .claude-plugin/plugin.json     name, version, description, types, userConfig
  hooks/hooks.json               { "modules": ["./register.js"] }
  hooks/register.js              events, commands, UI
  hooks/pet.js                   pure game logic: EXP, decay, loot, fold (easy to unit-test)
  hooks/sprites.js               PALETTE + FRAMES
  hooks/render.js                grid → Raster cells / SVG
  hooks/animation.js             which frames play for each activity, and for how long
  types/index.d.ts               PluginState contract for any $.state keys
  tests/*.test.ts                logic + UI, looped over ['terminal', 'desktop']
  scripts/                       png-to-grid, grid-to-png (dev only)
  docs/                          preview.png, demo.mp4, sprite sheet
  README.md, LICENSE
```

- **`userConfig` options:** pet name, difficulty (decay speed: chill / normal / hardcore-but-still-no-death), show status line on/off, toasts on/off.
- **Privacy:** only counts and timestamps are stored. No prompt or answer text, no network. `/pet reset` wipes it all. Document this in the README.
- **Ship checklist:** marketplace entry with `"source": "./mods/tokengotchi"`, a catalog row in the root README, `claude plugin validate --strict` passing at the root and in the mod, and `claude plugin test` green.

---

## 7. Phases

**v0.1: MVP (the showcase)** — *built: 16 tests pass and `claude plugin validate --strict` is clean. Next is a live run in the terminal and the desktop app, plus a demo GIF.*
- Clawd with idle, laptop and typing animations tied to the work loop
- 3 stats + EXP/level
- EXP from tokens, drops on finished work, inventory, feeding
- Pane with an animated sprite, status line, toasts, `/pet` commands
- Ledger persistence across sessions, decay from timestamps
- Tests, README with GIF, marketplace listing

**v0.2**
- Item effects beyond food (toys, hats as cosmetic overlays)
- Bonus drops from commits and passing tests, achievements, daily streaks
- Care-style evolution branches

**Later / maybe**
- Community sprite packs (a `FRAMES` file per skin, chosen in `userConfig`)
- Sound effects, a tiny mini-game in the pane, export a "pet card" PNG to share

---

## 8. Risks

| Risk | Mitigation |
| --- | --- |
| Lost or duplicated progress with multiple sessions open | Per-session ledgers and an idempotent fold keyed by `turnId` |
| Heavy users level absurdly fast | Log EXP, per-turn cap, subagents give half EXP and no drops |
| Feels punishing | Stat floors, no death, decay capped |
| Terminal rendering looks off (transparency, aspect ratio) | Half-block rules in 5.2, test on 2–3 terminals (iTerm2, Terminal.app, Ghostty) |
| Animation cost | Blit only (no tree redraw), pause while the pane isn't placed |
| Trademark or IP in a public showcase | See open decisions |

---

## Open decisions

1. ~~Which mascot?~~ **Decided: Clawd**, the Claude Code mascot, as fan art. The README must keep the "not affiliated with or endorsed by Anthropic" note, and the mod should not use the Anthropic or Claude logos.
2. **Name.** "Tamagotchi" is a Bandai trademark, so avoid it in the mod's name. `tokengotchi` is a placeholder. Alternatives: `claude-pet`, `bitling`, `pocket-claude`.
3. ~~Who draws the sprites?~~ **Decided:** Claude drafted v0.1 in code, and you polish them later.
4. **Default visibility.** Pane only, or also the status line by default?
