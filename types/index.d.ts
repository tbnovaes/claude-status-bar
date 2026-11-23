export type Meter = {
  ctx: number | null
  /** Tokens in the context window; absent in values an older version stored. */
  ctxTokens?: number | null
  fiveHour: number | null
  week: number | null
  /** ISO 8601 time each window resets; absent in values an older version stored. */
  fiveHourResets?: string | null
  weekResets?: string | null
}

export type ModelInfo = {
  model: string | null
  effort: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'status-bar': { meter: Meter; modelInfo: ModelInfo; tick: number }
  }
}
