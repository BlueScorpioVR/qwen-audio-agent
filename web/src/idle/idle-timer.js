/**
 * Fires onIdle once timeoutMs passes with no touch(). touch() only records a
 * timestamp (audio events arrive many times a second); the single timer
 * re-arms itself for the remaining time when it fires early.
 */
export function createIdleTimer({
  timeoutMs,
  onIdle,
  shouldDefer = () => false,
  now = () => Date.now(),
  setTimer = (callback, delay) => setTimeout(callback, delay),
  clearTimer = timer => clearTimeout(timer),
} = {}) {
  if (typeof onIdle !== 'function') throw new TypeError('onIdle is required')

  let timeout = Math.max(0, Number(timeoutMs) || 0)
  let timer = null
  let running = false
  let lastActivity = 0

  const disarm = () => {
    if (timer !== null) clearTimer(timer)
    timer = null
  }

  const arm = delay => {
    disarm()
    if (!running || timeout <= 0) return
    timer = setTimer(fire, Math.max(0, delay))
  }

  function fire() {
    timer = null
    if (!running || timeout <= 0) return
    const remaining = lastActivity + timeout - now()
    if (remaining > 0) return arm(remaining)
    if (shouldDefer()) {
      lastActivity = now()
      return arm(timeout)
    }
    running = false
    onIdle()
  }

  return {
    start() {
      running = true
      lastActivity = now()
      arm(timeout)
    },
    stop() {
      running = false
      disarm()
    },
    touch() {
      lastActivity = now()
    },
    setTimeoutMs(value) {
      timeout = Math.max(0, Number(value) || 0)
      if (running) arm(Math.max(0, lastActivity + timeout - now()))
    },
    get running() {
      return running
    },
  }
}

const ACTIVITY_EVENTS = new Set([
  'audio.delta',
  'response.started',
  'turn.started',
  'transcript.delta',
  'transcript.final',
  'tool.call',
])

/** True for gateway events that show a conversation is actually happening. */
export function isConversationActivity(event) {
  if (!event || typeof event.type !== 'string') return false
  if (ACTIVITY_EVENTS.has(event.type)) return true
  return event.type === 'voice.state' && event.state !== 'idle'
}
