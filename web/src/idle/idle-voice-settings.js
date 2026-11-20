export const IDLE_SETTINGS_KEY = 'qwaudio.idleVoice.v1'

export const DEFAULT_IDLE_SETTINGS = Object.freeze({
  // 0 disables the idle timeout entirely.
  timeoutMinutes: 3,
  // How loud a sound must be to wake a sleeping voice session.
  sensitivity: 'medium',
  chime: true,
  wakeOnLoudSound: true,
})

export const MAX_IDLE_TIMEOUT_MINUTES = 120

// RMS level in dBFS measured on the raw microphone (no AGC, no noise
// suppression). Normal speech a metre from the phone sits around -35..-28.
export const SENSITIVITY_THRESHOLDS_DB = Object.freeze({
  low: -22,
  medium: -30,
  high: -38,
})

export function normalizeIdleSettings(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const minutes = Number(source.timeoutMinutes)
  return {
    timeoutMinutes: Number.isFinite(minutes)
      ? Math.min(MAX_IDLE_TIMEOUT_MINUTES, Math.max(0, Math.round(minutes * 10) / 10))
      : DEFAULT_IDLE_SETTINGS.timeoutMinutes,
    sensitivity: Object.hasOwn(SENSITIVITY_THRESHOLDS_DB, source.sensitivity)
      ? source.sensitivity
      : DEFAULT_IDLE_SETTINGS.sensitivity,
    chime: typeof source.chime === 'boolean' ? source.chime : DEFAULT_IDLE_SETTINGS.chime,
    wakeOnLoudSound: typeof source.wakeOnLoudSound === 'boolean'
      ? source.wakeOnLoudSound
      : DEFAULT_IDLE_SETTINGS.wakeOnLoudSound,
  }
}

export function loadIdleSettings(storage = globalThis.localStorage) {
  try {
    return normalizeIdleSettings(JSON.parse(storage?.getItem(IDLE_SETTINGS_KEY) || 'null'))
  } catch {
    return normalizeIdleSettings(null)
  }
}

export function saveIdleSettings(settings, storage = globalThis.localStorage) {
  const normalized = normalizeIdleSettings(settings)
  try {
    storage?.setItem(IDLE_SETTINGS_KEY, JSON.stringify(normalized))
  } catch {
    // Storage can be unavailable (private mode); the in-memory value still applies.
  }
  return normalized
}

export function idleTimeoutMs(settings) {
  return Math.round(normalizeIdleSettings(settings).timeoutMinutes * 60_000)
}

export function wakeThresholdDb(settings) {
  return SENSITIVITY_THRESHOLDS_DB[normalizeIdleSettings(settings).sensitivity]
}
