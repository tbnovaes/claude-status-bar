import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextUsage, SessionRateLimit } from 'claude-code'

import type { Meter, ModelInfo } from '../types'

const meter = atom(
  { plugin: 'status-bar', key: 'meter' } as const,
  { ctx: null, ctxTokens: null, fiveHour: null, week: null, fiveHourResets: null, weekResets: null },
)

// Wall-clock reading that redraws the footer once a minute, so the reset
// countdown keeps moving between turns. 0 until the first reading.
const tick = atom({ plugin: 'status-bar', key: 'tick' } as const, 0)

const modelInfo = atom(
  { plugin: 'status-bar', key: 'modelInfo' } as const,
  { model: null, effort: null },
)

const toMeter = (
  context: SessionContextUsage,
  rateLimits: readonly SessionRateLimit[],
): Meter => {
  const find = (kind: string) => rateLimits.find(r => r.kind === kind)

  return {
    ctx: context.percent ?? null,
    ctxTokens: context.tokens ?? null,
    fiveHour: find('five_hour')?.percentUsed ?? null,
    week: find('seven_day')?.percentUsed ?? null,
    fiveHourResets: find('five_hour')?.resetsAt ?? null,
    weekResets: find('seven_day')?.resetsAt ?? null,
  }
}

const fmt = (n: number | null) => (n === null ? '--' : `${Math.round(n)}%`)

// Time left until a window resets: "4d 3h", "2h 13m", "12m", "<1m".
// "reset" once the time has passed (the percentage is then stale); null when
// the reset time is unknown, so nothing is drawn.
export const remaining = (resetsAt: string | null | undefined, now: number): string | null => {
  if (!resetsAt) return null
  const at = Date.parse(resetsAt)
  if (Number.isNaN(at)) return null
  const ms = at - now
  if (ms <= 0) return 'reset'
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return '<1m'
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  if (days >= 1) return `${days}d ${hours}h`
  if (hours >= 1) return `${hours}h ${minutes % 60}m`
  return `${minutes}m`
}

const withReset = (pct: number | null, resetsAt: string | null | undefined, now: number) => {
  const left = remaining(resetsAt, now)
  return `${fmt(pct)}${left ? ` (${left})` : ''}`
}

// "claude-opus-5-5[1m]" -> "Opus 5.5 [1m]"; display names pass through.
export const prettyModel = (raw: string): string => {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d+))?(?:-\d{8})?(\[.*\])?$/.exec(raw.trim())
  if (!m) return raw.trim()
  const [, family = '', major = '', minor, suffix] = m
  const name = family.charAt(0).toUpperCase() + family.slice(1)
  return `${name} ${major}${minor ? `.${minor}` : ''}${suffix ? ` ${suffix}` : ''}`
}

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']

let lastSent: string | null = null
let configuredEffort: string | null = null

const syncEffort = async ($: EngineInterface) => {
  try {
    const v: unknown = await $.settings.read({ key: 'effortLevel' } as any)
    configuredEffort = typeof v === 'string' && EFFORTS.includes(v) ? v : null
  } catch {
    // keep the last known value
  }
  const effort = configuredEffort ?? lastSent
  await update($, modelInfo, prev => ({ ...prev, effort: effort ?? prev.effort }))
}

// Context states by fill. The ranges asked for leave 40-50% open; Good runs to 50.
export const advice = (ctx: number | null): string | null => {
  if (ctx === null) return null
  if (ctx >= 75) return 'Degraded'
  if (ctx >= 60) return 'Compact'
  if (ctx >= 50) return 'Wrap up'
  if (ctx >= 20) return 'Good'
  return 'Great'
}

export const adviceColor = (ctx: number | null): string | undefined => {
  if (ctx === null) return undefined
  if (ctx >= 75) return '#ef4444' // red
  if (ctx >= 60) return '#a855f7' // purple
  if (ctx >= 50) return '#f97316' // orange
  if (ctx >= 20) return '#eab308' // yellow
  return '#22c55e' // green
}

// Tokens as "850", "42k", "1.2M".
export const fmtTokens = (n: number | null | undefined): string => {
  if (n === null || n === undefined) return '--'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(Math.round(n))
}

let warned = 0 // highest threshold toasted this session
let tickTimer: { cancel: () => void } | undefined

const refreshClock = async ($: EngineInterface) => {
  const now = await $.clock.now()
  await update($, tick, () => now)
}

const setModel = async ($: EngineInterface, model: string) =>
  update($, modelInfo, (prev: ModelInfo) => ({ ...prev, model: prettyModel(model) }))

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const { context, rateLimits } = await $.session.usage()
    await update($, meter, () => toMeter(context, rateLimits))
    await setModel($, await $.session.model())
    await syncEffort($)
    await refreshClock($)

    // A minute is the finest the countdown shows. Hot reload stops the old timer.
    tickTimer?.cancel()
    tickTimer = $.clock.every(60_000, () => void refreshClock($))

    return result
  })

  // The engine re-reads settings whenever a settings file changes (/effort too).
  on('settings.read', async ($, e, next) => {
    const result = await next(e)
    const level = (result as { effortLevel?: unknown } | undefined)?.effortLevel
    if (e.source === undefined) {
      configuredEffort = typeof level === 'string' && EFFORTS.includes(level) ? level : null
      await update($, modelInfo, prev => ({ ...prev, effort: configuredEffort ?? lastSent ?? prev.effort }))
    }

    return result
  })

  on('session.measure', async ($, e, next) => {
    const m = toMeter(e.context, e.rateLimits)
    await update($, meter, () => m)
    await refreshClock($)
    await setModel($, await $.session.model())
    await syncEffort($)

    const level = m.ctx === null ? 0 : m.ctx >= 75 ? 75 : m.ctx >= 60 ? 60 : m.ctx >= 50 ? 50 : 0
    if (level > warned) {
      warned = level
      const pct = Math.round(m.ctx!)
      $.ui.toast(
        level >= 75
          ? `Context ${pct}% full: quality is degraded. Start a new session (/clear) with a short summary.`
          : level >= 60
            ? `Context ${pct}% full: time to /compact.`
            : `Context ${pct}% full: finish this task, then compact or start fresh.`,
      )
    } else if (level < warned) {
      warned = level // fell back after /clear or /compact
    }

    return next(e)
  })

  // The main loop's requests carry the effort level in force.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      if (e.effort !== undefined) lastSent = String(e.effort)
      await syncEffort($)
    }

    return yield* next(e)
  })

  // /config changes to model or effort show up without waiting for a turn.
  on('config.set', async ($, e, next) => {
    const result = await next(e)
    if (/model/i.test(e.key)) await setModel($, await $.session.model())
    if (/effort/i.test(e.key)) await syncEffort($)

    return result
  })

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const m = await read($, meter)
    const info = await read($, modelInfo)
    const now = (await read($, tick)) || (await $.clock.now())
    const { Box, Text } = $.ui.resolve(e)

    const tip = advice(m.ctx)
    const color = adviceColor(m.ctx)
    const lead = e.props.modes.length ? ' & ' : ''
    const before = `${lead}${info.model ?? '--'} | ${info.effort ?? 'default'} | ctx: `
    // Values stored by an older version lack tokens and reset times: read them as unknown.
    const used = `${fmt(m.ctx)} ${fmtTokens(m.ctxTokens)}${tip ? ` (${tip})` : ''}`
    const after = ` | 5h: ${withReset(m.fiveHour, m.fiveHourResets, now)} | wk: ${withReset(m.week, m.weekResets, now)}`

    // The engine's own mode labels first, untouched; then ours.
    const engine = await next(e)

    return (
      <Box flexDirection="row">
        {engine}
        <Text dimColor>{before}</Text>
        {color ? <Text color={color} weight="bold">{used}</Text> : <Text dimColor>{used}</Text>}
        <Text dimColor>{after}</Text>
      </Box>
    )
  })
}
