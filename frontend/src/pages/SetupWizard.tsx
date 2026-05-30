import React, { useEffect, useState } from 'react'
import { fetchSetupStatus, saveConnection, register, testConnection as apiTestConnection } from '../api'

const TIMEZONES = [
  'Australia/Perth', 'Australia/Adelaide', 'Australia/Brisbane', 'Australia/Sydney', 'Australia/Melbourne', 'Australia/Hobart', 'Australia/Darwin',
  'Pacific/Auckland', 'Pacific/Honolulu',
  'America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York', 'America/Toronto', 'America/Vancouver',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Amsterdam', 'Europe/Madrid', 'Europe/Rome',
  'Asia/Singapore', 'Asia/Hong_Kong', 'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Kolkata', 'Asia/Dubai',
  'UTC',
]

const CURRENCIES = [
  { code: 'AUD', label: 'AUD ($)', symbol: '$' },
  { code: 'USD', label: 'USD ($)', symbol: '$' },
  { code: 'EUR', label: 'EUR (\u20ac)', symbol: '\u20ac' },
  { code: 'GBP', label: 'GBP (\u00a3)', symbol: '\u00a3' },
  { code: 'CAD', label: 'CAD ($)', symbol: '$' },
  { code: 'NZD', label: 'NZD ($)', symbol: '$' },
  { code: 'JPY', label: 'JPY (\u00a5)', symbol: '\u00a5' },
  { code: 'SGD', label: 'SGD ($)', symbol: '$' },
]

const SetupWizard: React.FC = () => {
  const [step, setStep] = useState(0)
  const [hasUser, setHasUser] = useState(true)
  const [host, setHost] = useState('192.168.1.146')
  const [port, setPort] = useState('7125')
  const [timezone, setTimezone] = useState('Australia/Perth')
  const [currency, setCurrency] = useState('AUD')
  const [electricityRate, setElectricityRate] = useState('0.49')
  const [merossEmail, setMerossEmail] = useState('')
  const [merossPassword, setMerossPassword] = useState('')
  const [merossName, setMerossName] = useState('Printer')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [testing, setTesting] = useState(false)
  const [connected, setConnected] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [skipMeross, setSkipMeross] = useState(false)

  useEffect(() => {
    fetchSetupStatus().then(s => {
      if (s.moonraker_connected) setConnected(true)
      setHasUser(s.has_user)
      if (s.has_user) setStep(1)
    }).catch(() => {})
  }, [])

  const handleTestConnection = async () => {
    setTesting(true)
    setConnected(null)
    try {
      const result = await apiTestConnection(host, parseInt(port))
      setConnected(result.connected)
    } catch { setConnected(false) }
    setTesting(false)
  }

  const saveAndFinish = async () => {
    setSaving(true)
    setError('')
    if (password !== confirmPassword) {
      setError('Passwords do not match')
      setSaving(false)
      return
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters')
      setSaving(false)
      return
    }
    try {
      const authResult = await register(username, password)
      localStorage.setItem('k2_token', authResult.access_token)
      localStorage.setItem('k2_user', JSON.stringify({ username: authResult.username, is_admin: authResult.is_admin }))
      await saveConnection({
        moonraker_host: host,
        moonraker_port: parseInt(port),
        timezone,
        currency,
        electricity_rate_kwh: parseFloat(electricityRate) || 0.49,
        ...(skipMeross ? {} : {
          meross_email: merossEmail,
          meross_password: merossPassword,
          meross_device_name: merossName,
        }),
      })
      setTimeout(() => { window.location.href = '/' }, 500)
    } catch (e: any) {
      setError(e.response?.data?.detail || 'Failed to save configuration')
    }
    setSaving(false)
  }

  const selectedCurrency = CURRENCIES.find(c => c.code === currency)

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
          <div className="flex items-center justify-center gap-2 mt-4">
            {(hasUser ? [1, 2, 3] : [0, 1, 2, 3]).map(s => (
              <div key={s} className={`h-2 rounded-full transition-all ${s === step ? 'w-8 bg-accent-500' : s < step ? 'w-8 bg-accent-700' : 'w-4 bg-surface-700'}`} />
            ))}
          </div>
        </div>

        {step === 0 && (
          <div className="card">
            <div className="card-header"><h2 className="text-lg font-semibold text-white">Create Admin Account</h2></div>
            <div className="card-body space-y-4">
              <p className="text-sm text-surface-400">Create an admin account to secure your K2 Analytics dashboard.</p>
              <div>
                <label className="text-xs text-surface-500 block mb-1">Username</label>
                <input type="text" value={username} onChange={e => setUsername(e.target.value)} placeholder="admin" minLength={3} className="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2.5 text-surface-200 placeholder-surface-500 focus:outline-none focus:border-accent-500" />
              </div>
              <div>
                <label className="text-xs text-surface-500 block mb-1">Password</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 6 characters" className="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2.5 text-surface-200 placeholder-surface-500 focus:outline-none focus:border-accent-500" />
              </div>
              <div>
                <label className="text-xs text-surface-500 block mb-1">Confirm Password</label>
                <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Re-enter password" className="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2.5 text-surface-200 placeholder-surface-500 focus:outline-none focus:border-accent-500" />
              </div>
              {password && confirmPassword && password !== confirmPassword && (
                <p className="text-rose-400 text-xs">Passwords do not match</p>
              )}
              <button onClick={() => { if (username.length >= 3 && password.length >= 6 && password === confirmPassword) setStep(1) }} disabled={username.length < 3 || password.length < 6 || password !== confirmPassword} className="w-full px-4 py-2.5 bg-accent-600 hover:bg-accent-500 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50">
                Next
              </button>
            </div>
          </div>
        )}

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
              <button onClick={handleTestConnection} disabled={testing || !host} className="w-full px-4 py-2.5 bg-surface-700 hover:bg-surface-600 text-surface-200 text-sm font-medium rounded-lg transition-colors disabled:opacity-50">
                {testing ? 'Testing...' : 'Test Connection'}
              </button>
              {connected === true && <p className="text-emerald-400 text-sm text-center">Connected to Moonraker successfully!</p>}
              {connected === false && <p className="text-rose-400 text-sm text-center">Could not reach Moonraker. Check the IP address and make sure the printer is on.</p>}
              <div className="flex gap-3">
                <button onClick={() => setStep(0)} className="flex-1 px-4 py-2.5 bg-surface-700 hover:bg-surface-600 text-surface-300 text-sm font-medium rounded-lg transition-colors">Back</button>
                <button onClick={() => setStep(2)} className="flex-1 px-4 py-2.5 bg-accent-600 hover:bg-accent-500 text-white text-sm font-medium rounded-lg transition-colors">Next</button>
              </div>
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
                <button onClick={() => setStep(3)} className="flex-1 px-4 py-2.5 bg-accent-600 hover:bg-accent-500 text-white text-sm font-medium rounded-lg transition-colors">Next</button>
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="card">
            <div className="card-header"><h2 className="text-lg font-semibold text-white">Regional Settings</h2></div>
            <div className="card-body space-y-4">
              <p className="text-sm text-surface-400">Configure your timezone, currency, and electricity rate for accurate cost tracking.</p>
              <div>
                <label className="text-xs text-surface-500 block mb-1">Timezone</label>
                <select value={timezone} onChange={e => setTimezone(e.target.value)} className="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2.5 text-surface-200 focus:outline-none focus:border-accent-500">
                  {TIMEZONES.map(tz => (
                    <option key={tz} value={tz}>{tz.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-surface-500 block mb-1">Currency</label>
                  <select value={currency} onChange={e => setCurrency(e.target.value)} className="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2.5 text-surface-200 focus:outline-none focus:border-accent-500">
                    {CURRENCIES.map(c => (
                      <option key={c.code} value={c.code}>{c.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-surface-500 block mb-1">Electricity Rate ({selectedCurrency?.symbol || '$'}/kWh)</label>
                  <input type="number" step="0.01" value={electricityRate} onChange={e => setElectricityRate(e.target.value)} className="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2.5 text-surface-200 focus:outline-none focus:border-accent-500" />
                </div>
              </div>
              {error && <p className="text-rose-400 text-sm">{error}</p>}
              <div className="flex gap-3 pt-2">
                <button onClick={() => setStep(2)} className="flex-1 px-4 py-2.5 bg-surface-700 hover:bg-surface-600 text-surface-300 text-sm font-medium rounded-lg transition-colors">Back</button>
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