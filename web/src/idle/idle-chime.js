let sharedContext = null

function audioContextConstructor() {
  return globalThis.AudioContext || globalThis.webkitAudioContext || null
}

function context() {
  if (sharedContext && sharedContext.state !== 'closed') return sharedContext
  const Constructor = audioContextConstructor()
  sharedContext = Constructor ? new Constructor() : null
  return sharedContext
}

/**
 * Browsers only let an AudioContext produce sound after a user gesture. Call
 * this from the first tap/click so the chime still works when it later fires
 * from a timer with the screen off.
 */
export function unlockIdleChime() {
  const ctx = context()
  if (ctx?.state === 'suspended') void ctx.resume().catch(() => {})
}

function playWebChime() {
  const ctx = context()
  if (!ctx) return false
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
  const start = ctx.currentTime + 0.02
  // Two falling notes: unmistakably "going to sleep", not a notification ping.
  ;[[784, 0], [523.25, 0.22]].forEach(([frequency, offset]) => {
    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.value = frequency
    gain.gain.setValueAtTime(0.0001, start + offset)
    gain.gain.exponentialRampToValueAtTime(0.35, start + offset + 0.03)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.34)
    oscillator.connect(gain)
    gain.connect(ctx.destination)
    oscillator.start(start + offset)
    oscillator.stop(start + offset + 0.36)
  })
  return true
}

/**
 * Prefers the native Android chime (works with the screen off even when the
 * WebView audio output is throttled) and falls back to Web Audio.
 */
export async function playIdleChime({
  nativePlugin = globalThis.Capacitor?.Plugins?.VoiceKeepAlive,
} = {}) {
  if (typeof nativePlugin?.playChime === 'function') {
    try {
      await nativePlugin.playChime()
      return 'native'
    } catch {
      // Fall through to Web Audio.
    }
  }
  return playWebChime() ? 'web' : 'none'
}
