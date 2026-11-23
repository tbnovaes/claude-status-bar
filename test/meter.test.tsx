import { expect, test } from 'claude-code/testing'

import { advice, adviceColor, fmtTokens, prettyModel, remaining } from '../hooks/register'

const MODE = {
  plugin: 'status-bar',
  component: 'SessionMode',
  props: { modes: [] as string[] },
} as const

const NOW = Date.parse('2026-11-21T12:00:00Z')

const engine = (on: any) => {
  on('clock.now', () => ({ value: NOW }))
  on('clock.every', () => ({ value: { cancel() {} } }))
  return on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.modes.join(' & ')}</Text>
  })
}

const line = async (ui: any) =>
  (await ui.findAll({ type: 'Text' })).map((t: any) => t.text).join('')

test('shows dashes before any reading', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({ ...MODE, surface: 'terminal' })
  expect(await line(ui)).toBe('-- | default | ctx: -- | -- tokens | 5h: -- | wk: --')
  await ui.unmount()
})

test('shows model, effort, ctx, 5h and weekly', async ($, on) => {
  engine(on)
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.measure', (_: any, e: any) => ({ changed: e.changed }))
  on('turn.step', async function* (_: any, e: any) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null } as any
  })

  await $.session.measure({
    context: { tokens: 42000, window: 200000, percent: 21 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 37.5 },
      { kind: 'seven_day', percentUsed: 8 },
    ],
    changed: ['context', 'rateLimits'],
  })
  const s = $.turn.step({ turnId: 't', index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 1 } as any) as any
  for await (const _ of s) { /* drain */ }

  const ui = await $.ui.mount({ ...MODE, surface: 'terminal' })
  expect(await line(ui)).toBe('Opus 5.5 | high | ctx: 21% (Good) | 42k tokens | 5h: 38% | wk: 8%')
  await ui.unmount()
})

test('model names read nicely', () => {
  expect(prettyModel('claude-opus-5-5')).toBe('Opus 5.5')
  expect(prettyModel('claude-sonnet-5-5[1m]')).toBe('Sonnet 5.5 [1m]')
  expect(prettyModel('Opus 5.5')).toBe('Opus 5.5')
})

test('the configured effort wins over what a request sent, and advice shows', async ($, on) => {
  engine(on)
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: { effortLevel: 'xhigh' } }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.measure', (_: any, e: any) => ({ changed: e.changed }))

  await $.session.measure({
    context: { tokens: 176000, window: 200000, percent: 88 },
    rateLimits: [],
    changed: ['context'],
  })

  const ui = await $.ui.mount({ ...MODE, surface: 'terminal' })
  expect(await line(ui)).toBe(
    'Opus 5.5 | xhigh | ctx: 88% (Degraded) | 176k tokens | 5h: -- | wk: --',
  )
  expect((await ui.find({ type: 'Text', text: /Degraded/ }))?.props.color).toBe('#ef4444')
  await ui.unmount()
})

test('advice thresholds and colors', () => {
  expect(advice(null)).toBe(null)
  const cases: [number, string, string][] = [
    [0, 'Great', '#22c55e'], [19, 'Great', '#22c55e'],
    [20, 'Good', '#eab308'], [49, 'Good', '#eab308'],
    [50, 'Wrap up', '#f97316'], [59, 'Wrap up', '#f97316'],
    [60, 'Compact', '#a855f7'], [74, 'Compact', '#a855f7'],
    [75, 'Degraded', '#ef4444'], [100, 'Degraded', '#ef4444'],
  ]
  for (const [pct, label, color] of cases) {
    expect(advice(pct)).toBe(label)
    expect(adviceColor(pct)).toBe(color)
  }
  expect(adviceColor(null)).toBe(undefined)
})

test('token counts read short', () => {
  expect(fmtTokens(null)).toBe('--')
  expect(fmtTokens(850)).toBe('850')
  expect(fmtTokens(42000)).toBe('42k')
  expect(fmtTokens(1_200_000)).toBe('1.2M')
})

test('compact is drawn in purple with its tokens, the engine modes kept', async ($, on) => {
  engine(on)
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.measure', (_: any, e: any) => ({ changed: e.changed }))
  await $.session.measure({
    context: { tokens: 130000, window: 200000, percent: 65 },
    rateLimits: [],
    changed: ['context'],
  })

  const ui = await $.ui.mount({ ...MODE, props: { modes: ['focus'] }, surface: 'terminal' })
  expect(await line(ui)).toBe('focus & Opus 5.5 | default | ctx: 65% (Compact) | 130k tokens | 5h: -- | wk: --')
  expect((await ui.find({ type: 'Text', text: /Compact/ }))?.props.color).toBe('#a855f7')
  await ui.unmount()
})

test('remaining time formats', () => {
  const at = (ms: number) => new Date(NOW + ms).toISOString()
  const min = 60_000
  expect(remaining(at(30_000), NOW)).toBe('<1m')
  expect(remaining(at(12 * min), NOW)).toBe('12m')
  expect(remaining(at(133 * min), NOW)).toBe('2h 13m')
  expect(remaining(at(60 * min), NOW)).toBe('1h 0m')
  expect(remaining(at((4 * 24 * 60 + 3 * 60 + 20) * min), NOW)).toBe('4d 3h')
  expect(remaining(at(-5 * min), NOW)).toBe('reset')
  expect(remaining(null, NOW)).toBe(null)
  expect(remaining(undefined, NOW)).toBe(null)
  expect(remaining('not a date', NOW)).toBe(null)
})

test('the footer shows the time left for each limit', async ($, on) => {
  engine(on)
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.measure', (_: any, e: any) => ({ changed: e.changed }))

  await $.session.measure({
    context: { tokens: 42000, window: 200000, percent: 21 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 37.5, resetsAt: new Date(NOW + 133 * 60_000).toISOString() },
      { kind: 'seven_day', percentUsed: 8, resetsAt: new Date(NOW + (2 * 1440 + 5 * 60) * 60_000).toISOString() },
    ],
    changed: ['context', 'rateLimits'],
  })

  const ui = await $.ui.mount({ ...MODE, surface: 'terminal' })
  expect(await line(ui)).toBe('Opus 5.5 | default | ctx: 21% (Good) | 42k tokens | 5h: 38% (2h 13m) | wk: 8% (2d 5h)')
  await ui.unmount()
})

test('a limit with no reset time shows only its percentage', async ($, on) => {
  engine(on)
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.measure', (_: any, e: any) => ({ changed: e.changed }))

  await $.session.measure({
    context: { tokens: 1000, window: 200000, percent: 1 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 10 }],
    changed: ['rateLimits'],
  })

  const ui = await $.ui.mount({ ...MODE, surface: 'terminal' })
  expect(await line(ui)).toContain('5h: 10% | wk: --')
  await ui.unmount()
})

test('a value an earlier version stored, without reset times, still draws', async ($, on) => {
  engine(on)
  on('state.get', () => ({
    value: { value: { ctx: 40, fiveHour: 20, week: 5 }, version: 1 },
  }))
  const ui = await $.ui.mount({ ...MODE, surface: 'terminal' })
  expect(await line(ui)).toContain('5h: 20% | wk: 5%')
  await ui.unmount()
})
