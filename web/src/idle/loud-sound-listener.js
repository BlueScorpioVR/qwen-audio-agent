import { createLoudnessDetector, rmsOf, toDb } from './loudness-detector.js'

const FRAME_MS = 50

/**
 * Local, non-AI listener used while the voice session is asleep. It measures
 * microphone loudness only; no audio leaves the device and nothing is sent to
 * a model. Calls onLoud() once when a sound stays above the threshold.
 */
export async function startLoudSoundListener({
  thresholdDb,
  holdMs = 150,
  onLoud,
  mediaDevices = globalThis.navigator?.mediaDevices,
  AudioContextConstructor = globalThis.AudioContext || globalThis.webkitAudioContext,
  now = () => performance.now(),
} = {}) {
  if (!mediaDevices?.getUserMedia || !AudioContextConstructor) {
    throw Object.assign(new Error('microphone listening is not supported here'), { name: 'NotSupportedError' })
  }
  // Raw level only: AGC and noise suppression would flatten exactly the
  // loudness differences this gate relies on.
  const media = await mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  })
  const context = new AudioContextConstructor()
  const source = context.createMediaStreamSource(media)
  const analyser = context.createAnalyser()
  analyser.fftSize = 2048
  source.connect(analyser)
  if (context.state === 'suspended') void context.resume().catch(() => {})

  const detector = createLoudnessDetector({ thresholdDb, holdMs })
  detector.reset(now())
  const buffer = new Float32Array(analyser.fftSize)
  let stopped = false

  const timer = setInterval(() => {
    if (stopped) return
    analyser.getFloatTimeDomainData(buffer)
    if (detector.push(toDb(rmsOf(buffer)), now())) {
      stopped = true
      clearInterval(timer)
      onLoud?.()
    }
  }, FRAME_MS)

  return {
    setThreshold: value => detector.setThreshold(value),
    stop() {
      stopped = true
      clearInterval(timer)
      media.getTracks().forEach(track => track.stop())
      source.disconnect()
      void context.close().catch(() => {})
    },
  }
}
