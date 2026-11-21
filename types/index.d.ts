export type Meter = {
  ctx: number | null
  fiveHour: number | null
  week: number | null
}

export type ModelInfo = {
  model: string | null
  effort: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'status-bar': { meter: Meter; modelInfo: ModelInfo }
  }
}
