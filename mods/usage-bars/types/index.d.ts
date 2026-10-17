// Tokens this session has spent so far, summed from each turn's usage
export type SessionTokens = { input: number; output: number; cacheRead: number; cacheWrite: number }

declare module 'claude-code' {
  interface PluginState {
    'usage-bars': { tokens: SessionTokens }
  }
}
