// The pet as folded from the base and every session's ledger
export type Pet = {
  name: string
  // The time of the last event folded in, in ms since the epoch
  at: number
  exp: number
  // The collection: how many of each item have dropped
  inventory: Record<string, number>
  turns: number
  drops: number
}

// What Clawd is doing, since when, and where: dx pixels right of the middle
// of the rug. A kind is idle, opening, typing, closing, or home_<dx> (walking
// back to the middle after work found it away from there)
export type Activity = { kind: string; since: number; dx?: number }

export type LastDrop = { item: string; at: number }

// The last reading of the 5-hour plan limit
export type FiveHourLimit = { percentUsed: number; resetsAt: string | null }

declare module 'claude-code' {
  interface PluginState {
    tokengotchi: {
      pet: Pet | null
      activity: Activity
      fiveHour: FiveHourLimit | null
      lastDrop: LastDrop | null
    }
  }
}
