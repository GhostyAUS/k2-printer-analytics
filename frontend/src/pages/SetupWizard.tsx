import React, { useEffect, useState } from 'react'
import { fetchSetupStatus, saveConnection } from '../api'

const SetupWizard: React.FC = () => {
  const [step, setStep] = useState(1)
  const [host, setHost] = useState('192.168.1.146')
  const [port, setPort] = useState('7125')
  const [merossEmail, setMerossEmail] = useState('')
  const [merossPassword, setMerossPassword] = useState('')
  const [merossName, setMerossName] = useState('Printer')
  const [testing, setTesting] = useState(false)
  const [connected, setConnected] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)
  const [skipMeross, setSkipMeross] = useState(false)

  useEffect(() => {
    fetchSetupStatus().then(s => {
      if (s.moonraker_connected) {
        setConnected(true)
      }
    }).catch(() => {})
  }, [])

  const testConnection = async () => {
    setTesting(true)
    setConnected(null)
    try {
      await saveConnection({ moonraker_host: host, moonraker_port: parseInt(port) })
      const status = await fetchSetupStatus()
      setConnected(status.moonraker_connected)
    } catch { setConnected(false) }
    setTesting(false)
  }

  const saveAndFinish = async () => {
    setSaving(true)
    try {
      await saveConnection({
        moonraker_host: host,
        moonraker_port: parseInt(port),
        ...(skipMeross ? {} : {
          meross_email: merossEmail,
          meross_password: merossPassword,
          meross_device_name: merossName,
        }),
      })
      setTimeout(() => window.location.reload(), 500)
    } catch (e) { console.error(e) }
    setSaving(false)
  }

  return (
    <div className="min-h-screen bg-surface-950 flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-accent-500 to-accent-700 flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-white">K2 Analytics</h1>
          <p className="text-surface-400 mt-2">Set up your printer connection to get started</p>
        </div>

        {step === 1 && (
          <div className="card">
            <div className="card-header"><h2 className="text-lg font-semibold text-white">Connect to Your Printer</h2></div>
            <div className="card-body space-y-4">
              <p className="text-sm text-surface-400">Enter your Moonraker IP address. This is the IP of your Creality K2 printer running Klipper.</p>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="text-xs text-surface-500 block mb-1">Moonraker IP Address</label>
                  <input type="text" value={host} onChange={e => setHost(e.target.value)} placeholder="192.168.1.146" className="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2.5 text-surface-200 placeholder-surface-500 focus:outline-none focus:border-accent-500" />
                </div>
                <div>
                  <label className="text-xs text-surface-500 block mb-1">Port</label>
                  <input type="text" value={port} onChange={e => setPort(e.target.value)} className="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2.5 text-surface-200 focus:outline-none focus:border-accent-500" />
                </div>
              </div>
              <button onClick={testConnection} disabled={testing || !host} className="w-full px-4 py-2.5 bg-surface-700 hover:bg-surface-600 text-surface-200 text-sm font-medium rounded-lg transition-colors disabled:opacity-50">
                {testing ? 'Testing...' : 'Test Connection'}
              </button>
              {connected === true && <p className="text-emerald-400 text-sm text-center">Connected to Moonraker successfully!</p>}
              {connected === false && <p className="text-rose-400 text-sm text-center">Could not reach Moonraker. Check the IP address and make sure the printer is on.</p>}
              <button onClick={() => { if (connected) setStep(2) }} disabled={!connected} className="w-full px-4 py-2.5 bg-accent-600 hover:bg-accent-500 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50">
                Next
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="card">
            <div className="card-header"><h2 className="text-lg font-semibold text-white">Power Monitoring (Optional)</h2></div>
            <div className="card-body space-y-4">
              <p className="text-sm text-surface-400">Connect your Meross smart plug to track power usage and electricity costs. You can skip this and configure it later in Settings.</p>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="skip_meross" checked={skipMeross} onChange={e => setSkipMeross(e.target.checked)} className="rounded" />
                <label htmlFor="skip_meross" className="text-sm text-surface-300">Skip Meross setup</label>
              </div>
              {!skipMeross && (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-surface-500 block mb-1">Meross Account Email</label>
                    <input type="email" value={merossEmail} onChange={e => setMerossEmail(e.target.value)} placeholder="your@email.com" className="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2.5 text-surface-200 placeholder-surface-500 focus:outline-none focus:border-accent-500" />
                  </div>
                  <div>
                    <label className="text-xs text-surface-500 block mb-1">Meross Account Password</label>
                    <input type="password" value={merossPassword} onChange={e => setMerossPassword(e.target.value)} placeholder="Your Meross password" className="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2.5 text-surface-200 placeholder-surface-500 focus:outline-none focus:border-accent-500" />
                  </div>
                  <div>
                    <label className="text-xs text-surface-500 block mb-1">Device Name</label>
                    <input type="text" value={merossName} onChange={e => setMerossName(e.target.value)} placeholder="Printer" className="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2.5 text-surface-200 placeholder-surface-500 focus:outline-none focus:border-accent-500" />
                  </div>
                </div>
              )}
              <div className="flex gap-3">
                <button onClick={() => setStep(1)} className="flex-1 px-4 py-2.5 bg-surface-700 hover:bg-surface-600 text-surface-300 text-sm font-medium rounded-lg transition-colors">Back</button>
                <button onClick={saveAndFinish} disabled={saving} className="flex-1 px-4 py-2.5 bg-accent-600 hover:bg-accent-500 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50">
                  {saving ? 'Saving...' : 'Finish Setup'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default SetupWizard