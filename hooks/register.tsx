import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextUsage, SessionRateLimit } from 'claude-code'

import type { Meter, ModelInfo } from '../types'

const meter = atom(
  { plugin: 'status-bar', key: 'meter' } as const,
  { ctx: null, fiveHour: null, week: null },
)

const modelInfo = atom(
  { plugin: 'status-bar', key: 'modelInfo' } as const,
  { model: null, effort: null },
)

const toMeter = (
  context: SessionContextUsage,
  rateLimits: readonly SessionRateLimit[],
): Meter => {
  const pct = (kind: string) => rateLimits.find(r => r.kind === kind)?.percentUsed ?? null

  return { ctx: context.percent ?? null, fiveHour: pct('five_hour'), week: pct('seven_day') }
}

const fmt = (n: number | null) => (n === null ? '--' : `${Math.round(n)}%`)

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

// Advice on when to start fresh, by context fill.
export const advice = (ctx: number | null): string | null => {
  if (ctx === null) return null
  if (ctx >= 85) return 'New Session'
  if (ctx >= 70) return 'Wrap up'
  if (ctx >= 50) return 'Good'
  return 'Great'
}

// Theme colors, so they follow your theme (colorblind-friendly ones included).
export const adviceColor = (ctx: number | null): 'warning' | 'error' | undefined =>
  ctx === null ? undefined : ctx >= 85 ? 'error' : ctx >= 70 ? 'warning' : undefined

let warned = 0 // highest threshold toasted this session

const setModel = async ($: EngineInterface, model: string) =>
  update($, modelInfo, (prev: ModelInfo) => ({ ...prev, model: prettyModel(model) }))

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const { context, rateLimits } = await $.session.usage()
    await update($, meter, () => toMeter(context, rateLimits))
    await setModel($, await $.session.model())
    await syncEffort($)

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
    await setModel($, await $.session.model())
    await syncEffort($)

    const level = m.ctx === null ? 0 : m.ctx >= 85 ? 85 : m.ctx >= 70 ? 70 : 0
    if (level > warned) {
      warned = level
      $.ui.toast(
        level >= 85
          ? `Context ${Math.round(m.ctx!)}% full: start a new session (/clear) and carry over a short summary.`
          : `Context ${Math.round(m.ctx!)}% full: finish this task, then start a new session.`,
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
    const { Box, Text } = $.ui.resolve(e)

    const tip = advice(m.ctx)
    const color = adviceColor(m.ctx)
    const lead = e.props.modes.length ? ' & ' : ''
    const before = `${lead}${info.model ?? '--'} | ${info.effort ?? 'default'} | ctx: ${fmt(m.ctx)}${tip ? ' (' : ''}`
    const after = `${tip ? ')' : ''} | 5h: ${fmt(m.fiveHour)} | wk: ${fmt(m.week)}`

    // The engine's own mode labels first, untouched; then ours.
    const engine = await next(e)

    return (
      <Box flexDirection="row">
        {engine}
        <Text dimColor>{before}</Text>
        {tip ? color ? <Text color={color} weight="bold">{tip}</Text> : <Text dimColor>{tip}</Text> : null}
        <Text dimColor>{after}</Text>
      </Box>
    )
  })
}
