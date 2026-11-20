import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { playIdleChime, unlockIdleChime } from './idle-chime.js'
import { createIdleTimer, isConversationActivity } from './idle-timer.js'
import {
  idleTimeoutMs,
  loadIdleSettings,
  saveIdleSettings,
  wakeThresholdDb,
} from './idle-voice-settings.js'
import { startLoudSoundListener } from './loud-sound-listener.js'

function announce(name, detail) {
  try {
    globalThis.dispatchEvent?.(new CustomEvent(name, { detail }))
  } catch {
    // Non-browser test environments have no CustomEvent.
  }
}

/**
 * Idle timeout for the Gateway voice connection.
 *
 * - After `timeoutMinutes` without conversation activity the connection is
 *   closed (paused), which ends the paid Realtime session, and a chime plays.
 * - While paused a local loudness gate (no AI, no network) can reconnect, and
 *   `wake()` is the manual reconnect button.
 *
 * `enabled` should be true only while the user wants live voice.
 */
export default function useIdleVoice({
  enabled,
  paused,
  setPaused,
  inputReady = false,
  isBusy = () => false,
}) {
  const [settings, setSettings] = useState(() => loadIdleSettings())
  const [listening, setListening] = useState(false)
  const [listenError, setListenError] = useState('')
  const timerRef = useRef(null)
  const settingsRef = useRef(settings)
  const busyRef = useRef(isBusy)
  settingsRef.current = settings
  busyRef.current = isBusy

  const timeoutMs = idleTimeoutMs(settings)

  const updateSettings = useCallback(patch => {
    setSettings(current => saveIdleSettings({ ...current, ...patch }))
  }, [])

  const wake = useCallback((reason = 'manual') => {
    announce('qwaudio:voice-idle', { idle: false, reason })
    setPaused(false)
  }, [setPaused])

  const touch = useCallback(event => {
    if (event === undefined || isConversationActivity(event)) timerRef.current?.touch()
  }, [])

  const testChime = useCallback(() => playIdleChime(), [])

  // Unlock Web Audio on the first gesture so a later timer-driven chime is audible.
  useEffect(() => {
    const unlock = () => unlockIdleChime()
    const options = { once: true, passive: true }
    globalThis.addEventListener?.('pointerdown', unlock, options)
    globalThis.addEventListener?.('keydown', unlock, options)
    return () => {
      globalThis.removeEventListener?.('pointerdown', unlock)
      globalThis.removeEventListener?.('keydown', unlock)
    }
  }, [])

  // Tell the native shell when voice is actually capturing so it can start the
  // foreground service only once the microphone permission exists.
  useEffect(() => {
    if (enabled && inputReady) announce('qwaudio:voice-active', { active: true })
  }, [enabled, inputReady])

  // Idle countdown while connected.
  useEffect(() => {
    if (!enabled || paused || timeoutMs <= 0) return undefined
    const timer = createIdleTimer({
      timeoutMs,
      shouldDefer: () => busyRef.current(),
      onIdle: () => {
        if (settingsRef.current.chime) void playIdleChime()
        announce('qwaudio:voice-idle', { idle: true, reason: 'timeout' })
        setPaused(true)
      },
    })
    timerRef.current = timer
    timer.start()
    return () => {
      timer.stop()
      if (timerRef.current === timer) timerRef.current = null
    }
  }, [enabled, paused, timeoutMs, setPaused])

  // Local loud-sound listener while asleep.
  const wakeOnLoud = settings.wakeOnLoudSound
  const thresholdDb = wakeThresholdDb(settings)
  const thresholdRef = useRef(thresholdDb)
  thresholdRef.current = thresholdDb
  const listenerRef = useRef(null)

  useEffect(() => {
    if (!enabled || !paused || !wakeOnLoud) return undefined
    let cancelled = false
    setListenError('')
    startLoudSoundListener({
      thresholdDb: thresholdRef.current,
      onLoud: () => wake('loud-sound'),
    }).then(listener => {
      if (cancelled) return listener.stop()
      listenerRef.current = listener
      setListening(true)
    }).catch(error => {
      if (!cancelled) setListenError(error?.message || 'microphone unavailable')
    })
    return () => {
      cancelled = true
      listenerRef.current?.stop()
      listenerRef.current = null
      setListening(false)
    }
  }, [enabled, paused, wakeOnLoud, wake])

  useEffect(() => {
    listenerRef.current?.setThreshold(thresholdDb)
  }, [thresholdDb])

  return useMemo(() => ({
    settings,
    updateSettings,
    paused,
    listening,
    listenError,
    wake,
    touch,
    testChime,
  }), [settings, updateSettings, paused, listening, listenError, wake, touch, testChime])
}
