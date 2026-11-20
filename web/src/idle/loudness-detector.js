const SILENCE_FLOOR = 1e-8

export function rmsOf(samples) {
  if (!samples?.length) return 0
  let sum = 0
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i]
  return Math.sqrt(sum / samples.length)
}

export function toDb(rms) {
  return 20 * Math.log10(Math.max(Number(rms) || 0, SILENCE_FLOOR))
}

/**
 * Plain energy gate, no speech model: reports true once the level has stayed
 * at or above thresholdDb for holdMs. Ignores everything for armAfterMs after
 * reset() so the chime that announces idle cannot wake the session again.
 */
export function createLoudnessDetector({
  thresholdDb,
  holdMs = 150,
  armAfterMs = 2_000,
} = {}) {
  let threshold = Number(thresholdDb)
  let armedAt = 0
  let loudSince = null

  return {
    reset(nowMs) {
      armedAt = nowMs + armAfterMs
      loudSince = null
    },
    setThreshold(value) {
      threshold = Number(value)
    },
    push(db, nowMs) {
      if (nowMs < armedAt) return false
      if (!(db >= threshold)) {
        loudSince = null
        return false
      }
      if (loudSince === null) loudSince = nowMs
      return nowMs - loudSince >= holdMs
    },
  }
}
