import { useState } from 'react'
import './idle.css'

const SENSITIVITY_LABELS = {
  low: 'Low (loud sounds only)',
  medium: 'Medium',
  high: 'High (quiet sounds wake it)',
}

export default function IdleVoicePanel({ idle }) {
  const [open, setOpen] = useState(false)
  const { settings, updateSettings, paused, listening, listenError, wake, testChime } = idle

  return <>
    {paused && <section className="idle-banner" role="status" aria-live="polite">
      <div className="idle-banner-text">
        <strong>Voice is asleep</strong>
        <small>
          {listenError
            ? `Tap Reconnect to continue. (${listenError})`
            : settings.wakeOnLoudSound
              ? listening
                ? 'The live connection is closed. Say something loud, or tap Reconnect.'
                : 'The live connection is closed. Starting the sound listener...'
              : 'The live connection is closed. Tap Reconnect to continue.'}
        </small>
      </div>
      <button type="button" className="idle-reconnect" onClick={() => wake('button')}>
        Reconnect
      </button>
    </section>}

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
      <button type="button" onClick={() => void testChime()}>Test sound</button>
      <small>
        While asleep the microphone stays on locally to hear loud sounds. Nothing is
        recorded or sent anywhere until you reconnect.
      </small>
    </section>}
  </>
}
