import React, { useEffect, useState } from 'react'
import { fetchSettings, setSetting, resetSetting, fetchCfsOverrides, upsertCfsOverride, resetCfsOverride, fetchNotificationConfig, updateNotificationConfig, saveConnection, fetchSetupStatus } from '../api'
import type { CfsSlotOverride } from '../types'

const Settings: React.FC = () => {
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [overrides, setOverrides] = useState<CfsSlotOverride[]>([])
  const [saving, setSaving] = useState<string | null>(null)
  const [notifyConfig, setNotifyConfig] = useState<Record<string, string>>({})
  const [connection, setConnection] = useState({ moonraker_host: '', moonraker_port: 7125, meross_email: '', meross_password: '', meross_device_name: 'Printer', meross_device_uuid: '' })
  const [connected, setConnected] = useState<boolean | null>(null)
  const [connSaving, setConnSaving] = useState(false)
  const [connTesting, setConnTesting] = useState(false)

  useEffect(() => {
    Promise.all([fetchSettings(), fetchCfsOverrides(), fetchNotificationConfig()])
      .then(([s, o, n]) => {
        setSettings(s); setOverrides(o); setNotifyConfig(n)
        setConnection({
          moonraker_host: s.moonraker_host || '',
          moonraker_port: parseInt(s.moonraker_port) || 7125,
          meross_email: s.meross_email || '',
          meross_password: s.meross_password || '',
          meross_device_name: s.meross_device_name || 'Printer',
          meross_device_uuid: s.meross_device_uuid || '',
        })
      })
      .catch(console.error)
  }, [])

  const handleSave = async (key: string, value: string) => {
    setSaving(key)
    try {
      await setSetting(key, value)
      setSettings(prev => ({ ...prev, [key]: value }))
    } catch (e) { console.error(e) }
    setSaving(null)
  }

  const handleReset = async (key: string) => {
    setSaving(key)
    try {
      const res = await resetSetting(key)
      setSettings(prev => ({ ...prev, [key]: res.value || '' }))
    } catch (e) { console.error(e) }
    setSaving(null)
  }

  const handleOverrideSave = async (slotId: string, field: string, value: string) => {
    setSaving(`${slotId}-${field}`)
    try {
      const numVal = parseFloat(value)
      const update: Record<string, number | null> = { [field]: isNaN(numVal) ? null : numVal }
      await upsertCfsOverride(slotId, update as Partial<CfsSlotOverride>)
      setOverrides(prev => {
        const idx = prev.findIndex(o => o.slot_id === slotId)
        if (idx >= 0) {
          const updated = [...prev]
          updated[idx] = { ...updated[idx], [field]: isNaN(numVal) ? null : numVal }
          return updated
        }
        return [...prev, { id: 0, slot_id: slotId, material_name: null, color_hex: null, remaining_pct: null, cost_per_kg: field === 'cost_per_kg' ? (isNaN(numVal) ? null : numVal) : null, spool_weight_g: field === 'spool_weight_g' ? (isNaN(numVal) ? null : numVal) : null }]
      })
    } catch (e) { console.error(e) }
    setSaving(null)
  }

  const handleOverrideReset = async (slotId: string) => {
    setSaving(slotId)
    try {
      await resetCfsOverride(slotId)
      setOverrides(prev => prev.filter(o => o.slot_id !== slotId))
    } catch (e) { console.error(e) }
    setSaving(null)
  }

  const slots = Array.from({ length: 4 }, (_, t) =>
    Array.from({ length: 4 }, (_, s) => `T${t + 1}${'ABCD'[s]}`)
  ).flat()

  const SettingRow = ({ label, keyName, unit, type = 'number' }: { label: string; keyName: string; unit?: string; type?: string }) => (
    <div className="flex items-center gap-3 py-3 border-b border-surface-700/30 last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-surface-200">{label}</p>
        <p className="text-[10px] text-surface-500 font-mono">{keyName}</p>
      </div>
      <div className="flex items-center gap-2">
        <input
          type={type}
          step={type === 'number' ? '0.01' : undefined}
          value={settings[keyName] ?? ''}
          onChange={e => setSettings(prev => ({ ...prev, [keyName]: e.target.value }))}
          className="w-24 bg-surface-800 border border-surface-700 rounded px-2 py-1 text-sm text-surface-200 focus:outline-none focus:border-accent-500"
        />
        {unit && <span className="text-xs text-surface-500 w-8">{unit}</span>}
        <button
          onClick={() => handleSave(keyName, settings[keyName] ?? '')}
          disabled={saving === keyName}
          className="px-2 py-1 text-xs bg-accent-600 hover:bg-accent-500 text-white rounded transition-colors disabled:opacity-50"
        >Save</button>
        <button
          onClick={() => handleReset(keyName)}
          disabled={saving === keyName}
          className="px-2 py-1 text-xs bg-surface-700 hover:bg-surface-600 text-surface-300 rounded transition-colors disabled:opacity-50"
        >Reset</button>
      </div>
    </div>
  )

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Settings</h1>
      <p className="text-sm text-surface-400 mt-1">Configure power rates, filament costs, and system preferences</p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <div className="card-header flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Printer Connection</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={async () => {
                  setConnTesting(true)
                  try {
                    const status = await fetchSetupStatus()
                    setConnected(status.moonraker_connected)
                  } catch { setConnected(false) }
                  setConnTesting(false)
                }}
                disabled={connTesting}
                className="px-3 py-1.5 text-xs bg-surface-700 hover:bg-surface-600 text-surface-300 rounded transition-colors disabled:opacity-50"
              >Test</button>
              {connected !== null && (
                <span className={`text-xs font-medium ${connected ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {connected ? 'Connected' : 'Not reachable'}
                </span>
              )}
            </div>
          </div>
          <div className="card-body space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <InputField label="Moonraker IP" value={connection.moonraker_host} onChange={v => setConnection(p => ({ ...p, moonraker_host: v }))} placeholder="192.168.1.146" />
              <InputField label="Moonraker Port" value={String(connection.moonraker_port)} onChange={v => setConnection(p => ({ ...p, moonraker_port: parseInt(v) || 7125 }))} type="number" />
            </div>
            <button
              onClick={async () => {
                setConnSaving(true)
                try {
                  await saveConnection({ moonraker_host: connection.moonraker_host, moonraker_port: connection.moonraker_port })
                  setSettings(s => ({ ...s, moonraker_host: connection.moonraker_host, moonraker_port: String(connection.moonraker_port) }))
                } catch (e) { console.error(e) }
                setConnSaving(false)
              }}
              disabled={connSaving}
              className="px-4 py-2 bg-accent-600 hover:bg-accent-500 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
            >Save Printer</button>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h2 className="text-sm font-semibold text-white">Meross Power Plug</h2>
          </div>
          <div className="card-body space-y-4">
            <InputField label="Email" value={connection.meross_email} onChange={v => setConnection(p => ({ ...p, meross_email: v }))} placeholder="your@email.com" />
            <InputField label="Password" value={connection.meross_password} onChange={v => setConnection(p => ({ ...p, meross_password: v }))} type="password" />
            <div className="grid grid-cols-2 gap-4">
              <InputField label="Device Name" value={connection.meross_device_name} onChange={v => setConnection(p => ({ ...p, meross_device_name: v }))} placeholder="Printer" />
              <InputField label="Device UUID" value={connection.meross_device_uuid} onChange={v => setConnection(p => ({ ...p, meross_device_uuid: v }))} placeholder="(optional)" />
            </div>
            <button
              onClick={async () => {
                setConnSaving(true)
                try {
                  await saveConnection({
                    meross_email: connection.meross_email,
                    meross_password: connection.meross_password,
                    meross_device_name: connection.meross_device_name,
                    meross_device_uuid: connection.meross_device_uuid,
                  })
                  setSettings(s => ({ ...s, meross_email: connection.meross_email, meross_device_name: connection.meross_device_name }))
                } catch (e) { console.error(e) }
                setConnSaving(false)
              }}
              disabled={connSaving}
              className="px-4 py-2 bg-accent-600 hover:bg-accent-500 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
            >Save Meross</button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <div className="card-header">
            <h2 className="text-sm font-semibold text-white">Power & Currency</h2>
          </div>
          <div className="card-body">
            <SettingRow label="Electricity Rate" keyName="electricity_rate_kwh" unit="$/kWh" />
            <SettingRow label="Currency" keyName="currency" type="text" />
            <SettingRow label="Default Filament Cost" keyName="default_filament_cost_per_kg" unit="$/kg" />
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h2 className="text-sm font-semibold text-white">Filament Density (g/cm³)</h2>
          </div>
          <div className="card-body">
            <SettingRow label="PLA Density" keyName="filament_density_pla" unit="g/cm³" />
            <SettingRow label="ABS Density" keyName="filament_density_abs" unit="g/cm³" />
            <SettingRow label="PETG Density" keyName="filament_density_petg" unit="g/cm³" />
            <SettingRow label="TPU Density" keyName="filament_density_tpu" unit="g/cm³" />
            <SettingRow label="Filament Diameter" keyName="filament_diameter_mm" unit="mm" />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="text-sm font-semibold text-white">Notifications</h2>
          <p className="text-xs text-surface-500">Webhook notifications on print events</p>
        </div>
        <div className="card-body">
          <div className="flex items-center gap-3 py-3 border-b border-surface-700/30">
            <div className="flex-1">
              <p className="text-sm text-surface-200">Webhook URL</p>
              <p className="text-[10px] text-surface-500 font-mono">notify_webhook_url</p>
            </div>
            <div className="flex items-center gap-2 flex-1">
              <input
                type="text"
                value={notifyConfig.notify_webhook_url || ''}
                onChange={e => setNotifyConfig(p => ({ ...p, notify_webhook_url: e.target.value }))}
                placeholder="https://hooks.slack.com/... or ntfy.sh/..."
                className="flex-1 bg-surface-800 border border-surface-700 rounded px-2 py-1 text-sm text-surface-200 placeholder-surface-500 focus:outline-none focus:border-accent-500"
              />
              <button onClick={async () => { await updateNotificationConfig(notifyConfig) }} className="px-2 py-1 text-xs bg-accent-600 hover:bg-accent-500 text-white rounded">Save</button>
            </div>
          </div>
          {[
            { key: 'notify_on_complete', label: 'On Print Complete' },
            { key: 'notify_on_failed', label: 'On Print Failed' },
            { key: 'notify_on_cancelled', label: 'On Print Cancelled' },
          ].map(({ key, label }) => (
            <div key={key} className="flex items-center justify-between py-3 border-b border-surface-700/30 last:border-0">
              <span className="text-sm text-surface-200">{label}</span>
              <button
                onClick={() => setNotifyConfig(p => ({ ...p, [key]: p[key] === 'true' ? 'false' : 'true' }))}
                className={`px-3 py-1 text-xs rounded transition-colors ${notifyConfig[key] === 'true' ? 'bg-accent-600 text-white' : 'bg-surface-700 text-surface-400'}`}
              >{notifyConfig[key] === 'true' ? 'Enabled' : 'Disabled'}</button>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="text-sm font-semibold text-white">Data Export</h2>
        </div>
        <div className="card-body">
          <a href={`${import.meta.env.VITE_API_URL || 'http://localhost:8000'}/api/v1/analytics/export/csv`} download="k2_print_jobs.csv"
            className="inline-flex items-center gap-2 px-4 py-2 bg-surface-700 hover:bg-surface-600 text-surface-300 text-sm rounded-lg transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
            Download CSV (All Print Jobs)
          </a>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="text-sm font-semibold text-white">CFS Slot Overrides</h2>
          <p className="text-xs text-surface-500">Set cost and weight per slot to override defaults</p>
        </div>
        <div className="card-body p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-700/50 text-xs text-surface-400">
                  <th className="text-left px-4 py-3 font-medium">Slot</th>
                  <th className="text-right px-4 py-3 font-medium">Cost/kg ($)</th>
                  <th className="text-right px-4 py-3 font-medium">Spool Weight (g)</th>
                  <th className="text-right px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {slots.map(slotId => {
                  const ov = overrides.find(o => o.slot_id === slotId)
                  return (
                    <CfsSlotRow
                      key={slotId}
                      slotId={slotId}
                      override={ov}
                      onSave={handleOverrideSave}
                      onReset={handleOverrideReset}
                      saving={saving}
                    />
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

const CfsSlotRow: React.FC<{
  slotId: string
  override?: CfsSlotOverride
  onSave: (slotId: string, field: string, value: string) => void
  onReset: (slotId: string) => void
  saving: string | null
}> = ({ slotId, override, onSave, onReset, saving }) => {
  const [costPerKg, setCostPerKg] = useState(override?.cost_per_kg?.toString() ?? '')
  const [weight, setWeight] = useState(override?.spool_weight_g?.toString() ?? '')

  useEffect(() => {
    setCostPerKg(override?.cost_per_kg?.toString() ?? '')
    setWeight(override?.spool_weight_g?.toString() ?? '')
  }, [override])

  return (
    <tr className="border-b border-surface-700/20 hover:bg-surface-800/30 transition-colors">
      <td className="px-4 py-3 text-surface-200 font-medium">{slotId}</td>
      <td className="px-4 py-3">
        <input
          type="number" step="0.01"
          value={costPerKg}
          onChange={e => setCostPerKg(e.target.value)}
          placeholder="—"
          className="w-20 bg-surface-800 border border-surface-700 rounded px-2 py-1 text-sm text-surface-200 text-right focus:outline-none focus:border-accent-500"
        />
      </td>
      <td className="px-4 py-3">
        <input
          type="number" step="1"
          value={weight}
          onChange={e => setWeight(e.target.value)}
          placeholder="—"
          className="w-20 bg-surface-800 border border-surface-700 rounded px-2 py-1 text-sm text-surface-200 text-right focus:outline-none focus:border-accent-500"
        />
      </td>
      <td className="px-4 py-3 text-right space-x-1">
        <button
          onClick={() => { onSave(slotId, 'cost_per_kg', costPerKg); onSave(slotId, 'spool_weight_g', weight) }}
          disabled={saving?.startsWith(slotId)}
          className="px-2 py-1 text-xs bg-accent-600 hover:bg-accent-500 text-white rounded transition-colors disabled:opacity-50"
        >Save</button>
        {override && (
          <button
            onClick={() => onReset(slotId)}
            disabled={saving === slotId}
            className="px-2 py-1 text-xs bg-surface-700 hover:bg-surface-600 text-surface-300 rounded transition-colors disabled:opacity-50"
          >Reset</button>
        )}
      </td>
    </tr>
  )
}

const InputField: React.FC<{ label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string }> = ({ label, value, onChange, type = 'text', placeholder }) => (
  <div>
    <label className="text-xs text-surface-500 block mb-1">{label}</label>
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full bg-surface-800 border border-surface-700 rounded px-2 py-1.5 text-sm text-surface-200 placeholder-surface-500 focus:outline-none focus:border-accent-500"
    />
  </div>
)

export default Settings
