import { registerPlugin } from '@capacitor/core'

// Registering by name also exposes it as Capacitor.Plugins.VoiceKeepAlive,
// which the shared web client uses for the native idle chime.
const VoiceKeepAlive = registerPlugin('VoiceKeepAlive')
const MediaAudio = registerPlugin('MediaAudio')

// Notification text shown by the foreground service.
const ACTIVE_TEXT = 'Listening. Tap to open.'
const IDLE_TEXT = 'Asleep. Say something loud or tap to reconnect.'

/**
 * Keeps the app alive with the screen off while voice is in use, and keeps
 * audio on media routing so a Bluetooth headset plays it over A2DP and the
 * hardware volume keys work. The web client announces its state through window
 * events (see useIdleVoice), so it stays free of Capacitor imports.
 */
export function installVoiceKeepAlive() {
  let disposed = false

  const start = async text => {
    try {
      const result = await VoiceKeepAlive.start({ text })
      if (!result?.started && result?.reason) {
        console.warn('[voice-keep-alive] not started:', result.reason)
      }
    } catch (error) {
      console.warn('[voice-keep-alive] start failed:', error?.message || error)
    }
  }

  const onActive = () => {
    if (disposed) return
    void start(ACTIVE_TEXT)
    void MediaAudio.start({}).catch(error => {
      console.warn('[media-audio] start failed:', error?.message || error)
    })
  }
  const onIdle = event => {
    if (disposed) return
    const idle = event?.detail?.idle === true
    void VoiceKeepAlive.update({ text: idle ? IDLE_TEXT : ACTIVE_TEXT }).catch(() => {})
    if (idle) void MediaAudio.stop({}).catch(() => {})
    else void MediaAudio.start({}).catch(() => {})
  }

  globalThis.addEventListener('qwaudio:voice-active', onActive)
  globalThis.addEventListener('qwaudio:voice-idle', onIdle)

  return () => {
    disposed = true
    globalThis.removeEventListener('qwaudio:voice-active', onActive)
    globalThis.removeEventListener('qwaudio:voice-idle', onIdle)
    void VoiceKeepAlive.stop().catch(() => {})
    void MediaAudio.stop({}).catch(() => {})
  }
}
