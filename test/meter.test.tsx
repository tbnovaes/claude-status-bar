import { expect, test } from 'claude-code/testing'

import { advice, prettyModel } from '../hooks/register'

const MODE = {
  plugin: 'status-bar',
  component: 'SessionMode',
  props: { modes: [] as string[] },
} as const

const engine = (on: any) =>
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.modes.join(' & ')}</Text>
  })

const line = async (ui: any) =>
  (await ui.findAll({ type: 'Text' })).map((t: any) => t.text).join('')

test('shows dashes before any reading', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({ ...MODE, surface: 'terminal' })
  expect(await line(ui)).toBe('-- | default | ctx: -- | 5h: -- | wk: --')
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
  expect(await line(ui)).toBe('Opus 5.5 | high | ctx: 21% (Great) | 5h: 38% | wk: 8%')
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
    'Opus 5.5 | xhigh | ctx: 88% (New Session) | 5h: -- | wk: --',
  )
  expect((await ui.find({ type: 'Text', text: /New Session/ }))?.props.color).toBe('error')
  await ui.unmount()
})

test('advice thresholds', () => {
  expect(advice(null)).toBe(null)
  expect(advice(30)).toBe('Great')
  expect(advice(49)).toBe('Great')
  expect(advice(50)).toBe('Good')
  expect(advice(69)).toBe('Good')
  expect(advice(70)).toBe('Wrap up')
  expect(advice(84)).toBe('Wrap up')
  expect(advice(85)).toBe('New Session')
})

test('wrap up is drawn in the warning color, the engine modes kept', async ($, on) => {
  engine(on)
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.measure', (_: any, e: any) => ({ changed: e.changed }))
  await $.session.measure({
    context: { tokens: 150000, window: 200000, percent: 75 },
    rateLimits: [],
    changed: ['context'],
  })

  const ui = await $.ui.mount({ ...MODE, props: { modes: ['focus'] }, surface: 'terminal' })
  expect(await line(ui)).toBe('focus & Opus 5.5 | default | ctx: 75% (Wrap up) | 5h: -- | wk: --')
  expect((await ui.find({ type: 'Text', text: /Wrap up/ }))?.props.color).toBe('warning')
  expect((await ui.find({ type: 'Text', text: /^Good$|^Great$/ }))).toBeUndefined()
  await ui.unmount()
})
