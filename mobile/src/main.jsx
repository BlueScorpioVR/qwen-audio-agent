import { StrictMode, useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { configureGatewayTransport } from '../../web/src/gateway-transport.js'
import { setRuntimeLanguage } from '../../web/src/i18n.js'
import '../../web/src/styles.css'
import './mobile.css'
import { installVoiceKeepAlive } from './keep-alive.js'
import { mobileGatewayTransport, pairMobileGateway } from './mobile-profile.js'
import {
  loadMobileGatewayProfile,
  mobileDeviceId,
  mobileLaunchUrl,
  mobilePairingRequest,
  onMobileUrlOpen,
  removeMobileGatewayProfile,
  saveMobileGatewayProfile,
  scanGatewayPairingCode,
} from './native-runtime.js'

function MobileApp() {
  const [profile, setProfile] = useState(null)
  const [WebApp, setWebApp] = useState(null)
  const [pairingCode, setPairingCode] = useState('')
  const [status, setStatus] = useState('Loading connection settings…')
  const [busy, setBusy] = useState(false)
  const pairing = useRef(false)

  const activateProfile = useCallback(async next => {
    configureGatewayTransport(mobileGatewayTransport(next))
    const module = await import('../../web/src/App.jsx')
    setProfile(next)
    setWebApp(() => module.default)
    setStatus('')
  }, [])

  const pair = useCallback(async value => {
    if (!String(value || '').trim() || pairing.current) return
    pairing.current = true
    setBusy(true)
    setStatus('Pairing securely…')
    try {
      const next = await pairMobileGateway(String(value).trim(), {
        request: mobilePairingRequest,
        deviceId: await mobileDeviceId(),
        label: 'Qwen Audio Agent Mobile',
      })
      await saveMobileGatewayProfile(next)
      await activateProfile(next)
    } catch (error) {
      setStatus(
        error.code === 'gateway_pairing_code_invalid'
          ? 'Invalid connection code. Generate a new one on the Gateway host.'
          : error.code === 'gateway_pairing_code_expired'
            ? 'This connection code has expired. Generate a new one on the Gateway host.'
            : error.message || 'Could not connect to the Gateway',
      )
    } finally {
      pairing.current = false
      setBusy(false)
    }
  }, [activateProfile])

  useEffect(() => {
    let active = true
    loadMobileGatewayProfile()
      .then(next => {
        if (!active) return
        if (next) return activateProfile(next)
        return mobileLaunchUrl().then(url => {
          if (url) return pair(url)
          setStatus('Scan the connection code printed by the Gateway CLI')
        })
      })
      .catch(error => active && setStatus(error.message || 'Could not read the connection settings'))
    const removeListener = onMobileUrlOpen(url => void pair(url))
    return () => {
      active = false
      removeListener()
    }
  }, [activateProfile, pair])

  // Foreground service so voice keeps working with the screen off.
  useEffect(() => (profile ? installVoiceKeepAlive() : undefined), [profile])

  const scan = async () => {
    setBusy(true)
    try {
      const value = await scanGatewayPairingCode()
      if (value) await pair(value)
    } catch (error) {
      setStatus(error.message || 'No pairing code was read')
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async () => {
    if (!confirm('Disconnect from this Gateway? You will need to pair again.')) return
    await removeMobileGatewayProfile()
    configureGatewayTransport()
    setProfile(null)
    setWebApp(null)
    setStatus('Disconnected. Scan a new code to pair again.')
  }

  if (profile && WebApp) return <div className="mobile-runtime">
    <button className="mobile-disconnect" type="button" onClick={disconnect}>
      Disconnect
    </button>
    <WebApp />
  </div>

  return <main className="mobile-onboarding">
    <div className="mobile-mark">Q</div>
    <h1>Connect to your Agent</h1>
    <p>The Gateway and background Agent keep running on your computer; your phone talks to them over a secure connection.</p>
    <button className="mobile-primary" type="button" disabled={busy} onClick={scan}>
      {busy ? 'Connecting…' : 'Scan pairing code'}
    </button>
    <div className="mobile-divider"><span>or</span></div>
    <label>
      Gateway connection code
      <textarea
        value={pairingCode}
        onChange={event => setPairingCode(event.target.value)}
        placeholder="Paste the Gateway connection code"
        spellCheck={false}
      />
    </label>
    <button type="button" disabled={busy || !pairingCode.trim()} onClick={() => pair(pairingCode)}>
      Connect
    </button>
    <small role="status">{status}</small>
  </main>
}

// This build is English-only, whatever language the phone is set to.
setRuntimeLanguage('en')

createRoot(document.getElementById('root')).render(
  <StrictMode><MobileApp /></StrictMode>,
)
