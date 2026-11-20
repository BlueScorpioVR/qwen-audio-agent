import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_IDLE_SETTINGS,
  idleTimeoutMs,
  loadIdleSettings,
  normalizeIdleSettings,
  saveIdleSettings,
  wakeThresholdDb,
} from '../src/idle/idle-voice-settings.js'
import { createIdleTimer, isConversationActivity } from '../src/idle/idle-timer.js'
import { createLoudnessDetector, rmsOf, toDb } from '../src/idle/loudness-detector.js'

function fakeClock() {
  let time = 0
  const timers = new Map()
  let nextId = 1
  return {
    now: () => time,
    setTimer(callback, delay) {
      const id = nextId++
      timers.set(id, { callback, at: time + delay })
      return id
    },
    clearTimer(id) {
      timers.delete(id)
    },
    advance(ms) {
      const target = time + ms
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        timers.delete(due[0])
        time = Math.max(time, due[1].at)
        due[1].callback()
      }
      time = target
    },
    get pending() {
      return timers.size
    },
  }
}

test('settings default to a three minute timeout', () => {
  assert.equal(DEFAULT_IDLE_SETTINGS.timeoutMinutes, 3)
  assert.deepEqual(normalizeIdleSettings(undefined), { ...DEFAULT_IDLE_SETTINGS })
  assert.equal(idleTimeoutMs(DEFAULT_IDLE_SETTINGS), 180_000)
})

test('settings are clamped and unknown values fall back to defaults', () => {
  assert.equal(normalizeIdleSettings({ timeoutMinutes: -5 }).timeoutMinutes, 0)
  assert.equal(normalizeIdleSettings({ timeoutMinutes: 9999 }).timeoutMinutes, 120)
  assert.equal(normalizeIdleSettings({ timeoutMinutes: 'abc' }).timeoutMinutes, 3)
  assert.equal(normalizeIdleSettings({ timeoutMinutes: 0 }).timeoutMinutes, 0)
  assert.equal(normalizeIdleSettings({ sensitivity: 'loud' }).sensitivity, 'medium')
  assert.equal(normalizeIdleSettings({ chime: 'yes' }).chime, true)
})

test('sensitivity maps to progressively lower dB thresholds', () => {
  const low = wakeThresholdDb({ sensitivity: 'low' })
  const medium = wakeThresholdDb({ sensitivity: 'medium' })
  const high = wakeThresholdDb({ sensitivity: 'high' })
  assert.ok(low > medium && medium > high)
})

test('settings persist through storage and survive corrupt data', () => {
  const store = new Map()
  const storage = {
    getItem: key => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
  }
  saveIdleSettings({ timeoutMinutes: 7, sensitivity: 'high' }, storage)
  assert.equal(loadIdleSettings(storage).timeoutMinutes, 7)
  assert.equal(loadIdleSettings(storage).sensitivity, 'high')
  store.set([...store.keys()][0], '{not json')
  assert.deepEqual(loadIdleSettings(storage), { ...DEFAULT_IDLE_SETTINGS })
})

test('idle timer fires after the timeout with no activity', () => {
  const clock = fakeClock()
  let idle = 0
  const timer = createIdleTimer({ timeoutMs: 180_000, onIdle: () => { idle += 1 }, ...clock })
  timer.start()
  clock.advance(179_999)
  assert.equal(idle, 0)
  clock.advance(1)
  assert.equal(idle, 1)
  assert.equal(timer.running, false)
})

test('touch pushes the deadline back without rescheduling per call', () => {
  const clock = fakeClock()
  let idle = 0
  const timer = createIdleTimer({ timeoutMs: 100_000, onIdle: () => { idle += 1 }, ...clock })
  timer.start()
  clock.advance(60_000)
  timer.touch()
  clock.advance(60_000)
  assert.equal(idle, 0)
  assert.equal(clock.pending, 1)
  clock.advance(40_000)
  assert.equal(idle, 1)
})

test('shouldDefer postpones idle while a response is in progress', () => {
  const clock = fakeClock()
  let busy = true
  let idle = 0
  const timer = createIdleTimer({
    timeoutMs: 10_000,
    onIdle: () => { idle += 1 },
    shouldDefer: () => busy,
    ...clock,
  })
  timer.start()
  clock.advance(10_000)
  assert.equal(idle, 0)
  busy = false
  clock.advance(10_000)
  assert.equal(idle, 1)
})

test('stop cancels and a zero timeout never fires', () => {
  const clock = fakeClock()
  let idle = 0
  const stopped = createIdleTimer({ timeoutMs: 1_000, onIdle: () => { idle += 1 }, ...clock })
  stopped.start()
  stopped.stop()
  clock.advance(5_000)
  const never = createIdleTimer({ timeoutMs: 0, onIdle: () => { idle += 1 }, ...clock })
  never.start()
  clock.advance(10 ** 9)
  assert.equal(idle, 0)
})

test('changing the timeout re-arms from the last activity', () => {
  const clock = fakeClock()
  let idle = 0
  const timer = createIdleTimer({ timeoutMs: 100_000, onIdle: () => { idle += 1 }, ...clock })
  timer.start()
  clock.advance(30_000)
  timer.setTimeoutMs(40_000)
  clock.advance(9_999)
  assert.equal(idle, 0)
  clock.advance(1)
  assert.equal(idle, 1)
})

test('only real conversation events count as activity', () => {
  assert.equal(isConversationActivity({ type: 'audio.delta' }), true)
  assert.equal(isConversationActivity({ type: 'transcript.final' }), true)
  assert.equal(isConversationActivity({ type: 'voice.state', state: 'listening' }), true)
  assert.equal(isConversationActivity({ type: 'voice.state', state: 'idle' }), false)
  assert.equal(isConversationActivity({ type: 'gateway.connected' }), false)
  assert.equal(isConversationActivity({ type: 'task.progress' }), false)
  assert.equal(isConversationActivity(null), false)
})

test('rms and dB conversions', () => {
  assert.equal(rmsOf(new Float32Array(0)), 0)
  assert.ok(Math.abs(rmsOf(new Float32Array([0.5, -0.5, 0.5, -0.5])) - 0.5) < 1e-6)
  assert.ok(Math.abs(toDb(1)) < 1e-9)
  assert.ok(Math.abs(toDb(0.1) + 20) < 1e-9)
  assert.ok(toDb(0) < -100)
})

test('loudness detector needs a sustained loud sound after it is armed', () => {
  const detector = createLoudnessDetector({ thresholdDb: -30, holdMs: 150, armAfterMs: 2_000 })
  detector.reset(0)
  assert.equal(detector.push(-10, 100), false, 'ignored while arming (chime tail)')
  assert.equal(detector.push(-10, 2_000), false, 'first loud frame starts the hold')
  assert.equal(detector.push(-10, 2_100), false)
  assert.equal(detector.push(-10, 2_150), true)
})

test('a short click or a dip below the threshold does not trigger', () => {
  const detector = createLoudnessDetector({ thresholdDb: -30, holdMs: 150, armAfterMs: 0 })
  detector.reset(0)
  assert.equal(detector.push(-10, 100), false)
  assert.equal(detector.push(-50, 150), false, 'dip resets the hold')
  assert.equal(detector.push(-10, 200), false)
  assert.equal(detector.push(-10, 300), false)
  assert.equal(detector.push(-10, 350), true)
})

test('threshold can be changed while listening', () => {
  const detector = createLoudnessDetector({ thresholdDb: -20, holdMs: 0, armAfterMs: 0 })
  detector.reset(0)
  assert.equal(detector.push(-30, 10), false)
  detector.setThreshold(-35)
  assert.equal(detector.push(-30, 20), true)
})
