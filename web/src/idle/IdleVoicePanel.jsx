import { useCallback, useEffect, useState } from 'react'
import './idle.css'

function mediaAudioPlugin() {
  return globalThis.Capacitor?.Plugins?.MediaAudio || null
}

/**
 * Microphone choice. Only the Android app exposes it: a Bluetooth headset mic
 * needs the call (SCO) profile, which also carries the reply at call quality.
 */
function MicrophoneControl() {
  const [state, setState] = useState(null)
  const [note, setNote] = useState('')

  const refresh = useCallback(() => {
    let active = true
    mediaAudioPlugin()?.listInputs?.({}).then(result => {
      if (active && result?.inputs?.length) setState(result)
    }).catch(() => {})
    return () => { active = false }
  }, [])

  useEffect(() => refresh(), [refresh])
  if (!state) return null

  const change = async route => {
    setState(current => ({ ...current, route }))
    try {
      const result = await mediaAudioPlugin()?.setInputRoute?.({ route })
      if (result?.route) setState(current => ({ ...current, route: result.route }))
      setNote(result?.error || '')
      // Capture keeps the old device until it is re-acquired.
      globalThis.dispatchEvent?.(new Event('qwaudio:capture-restart'))
    } catch (error) {
      setNote(error?.message || 'Could not switch microphone')
    }
  }

  return <label>
    Microphone
    <select value={state.route} onChange={event => void change(event.target.value)}>
      {state.inputs.map(input =>
        <option key={input.id} value={input.id}>{input.label}</option>)}
    </select>
    {state.route === 'bluetooth'
      ? <small>Headset mic uses the call profile, so replies play at call quality.</small>
      : <small>Replies play in full quality; the phone microphone records.</small>}
    {note ? <small>{note}</small> : null}
  </label>
}

/** Media volume of the assistant's voice; only present in the Android app. */
function VolumeControl() {
  const [level, setLevel] = useState(null)
  const [max, setMax] = useState(0)

  useEffect(() => {
    let active = true
    mediaAudioPlugin()?.volume?.({}).then(result => {
      if (!active || !result) return
      setLevel(Number(result.volume))
      setMax(Number(result.maxVolume))
    }).catch(() => {})
    return () => { active = false }
  }, [])

  const change = useCallback(value => {
    setLevel(value)
    void mediaAudioPlugin()?.volume?.({ level: value }).catch(() => {})
  }, [])

  if (level === null || max <= 0) return null
  return <label>
    {`Voice volume (${level}/${max})`}
    <input
      type="range"
      min="0"
      max={max}
      step="1"
      value={level}
      onChange={event => change(Number(event.target.value))}
    />
  </label>
}

const SENSITIVITY_LABELS = {
  low: 'Low (loud sounds only)',
  medium: 'Medium',
  high: 'High (quiet sounds wake it)',
}

export default function IdleVoicePanel({ idle }) {
  const [open, setOpen] = useState(false)
  const {
    settings, updateSettings, paused, reason, listening, listenError, wake, hangUp, testChime, enabled,
  } = idle
  const hungUp = reason === 'manual'

  return <>
    {paused && <section className="idle-banner" role="status" aria-live="polite">
      <div className="idle-banner-text">
        <strong>{hungUp ? 'Call ended' : 'Voice is asleep'}</strong>
        <small>
          {hungUp
            ? 'You are still paired. Tap Reconnect to start a new conversation.'
            : listenError
              ? `Tap Reconnect to continue. (${listenError})`
              : settings.wakeOnLoudSound
                ? listening
                  ? 'The live connection is closed to save cost. Say something loud, or tap Reconnect.'
                  : 'The live connection is closed. Starting the sound listener...'
                : 'The live connection is closed. Tap Reconnect to continue.'}
        </small>
      </div>
      <button type="button" className="idle-reconnect" onClick={() => wake('button')}>
        Reconnect
      </button>
    </section>}

    {!paused && enabled && <button
      type="button"
      className="idle-hangup"
      onClick={hangUp}
      aria-label="Hang up and end the live conversation"
    >
      Hang up
    </button>}

    <button
      type="button"
      className="idle-gear"
      aria-label="Idle settings"
      aria-expanded={open}
      onClick={() => setOpen(value => !value)}
    >
      {'☾'}
    </button>

    {open && <section className="idle-settings" aria-label="Idle settings">
      <label>
        Go idle after (minutes, 0 = never)
        <input
          type="number"
          min="0"
          max="120"
          step="0.5"
          inputMode="decimal"
          value={settings.timeoutMinutes}
          onChange={event => updateSettings({ timeoutMinutes: event.target.value })}
        />
      </label>
      <label className="idle-check">
        <input
          type="checkbox"
          checked={settings.wakeOnLoudSound}
          onChange={event => updateSettings({ wakeOnLoudSound: event.target.checked })}
        />
        Reconnect on loud sound
      </label>
      <label>
        Loud-sound sensitivity
        <select
          value={settings.sensitivity}
          disabled={!settings.wakeOnLoudSound}
          onChange={event => updateSettings({ sensitivity: event.target.value })}
        >
          {Object.entries(SENSITIVITY_LABELS).map(([value, label]) =>
            <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label className="idle-check">
        <input
          type="checkbox"
          checked={settings.chime}
          onChange={event => updateSettings({ chime: event.target.checked })}
        />
        Play a sound when going idle
      </label>
      <MicrophoneControl />
      <VolumeControl />
      <button type="button" onClick={() => void testChime()}>Test sound</button>
      <small>
        While asleep the microphone stays on locally to hear loud sounds. Nothing is
        recorded or sent anywhere until you reconnect.
      </small>
    </section>}
  </>
}
