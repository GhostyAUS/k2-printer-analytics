import React, { useEffect, useState } from 'react'
import api from '../api'

interface PrinterStatus {
  extruder: { temperature: number | null; target: number | null; power: number | null; nozzle_diameter: number | null; pressure_advance: number | null }
  heater_bed: { temperature: number | null; target: number | null; power: number | null }
  heater_chamber: { temperature: number | null; target: number | null; power: number | null }
  sensors: { chamber: number | null; chamber_min: number | null; chamber_max: number | null; mcu: number | null; mcu_min: number | null; mcu_max: number | null }
  fans: { part_cooling_speed: number | null; part_cooling_rpm: number | null; chamber_fan_speed: number | null; chamber_fan_rpm: number | null; chamber_fan_temp: number | null; chamber_fan_target: number | null; hotend_fan_speed: number | null; hotend_fan_rpm: number | null; fan0_value: number | null; extruder_fan_value: number | null }
  mcu: { mcu_version: string | null; mcu_model: string | null; clock_freq: number | null; last_stats: Record<string, number> | null }
  system: { sysload: number | null; memavail_kb: number | null; uptime_s: number | null }
  print_state: { idle_state: string | null; printing_time: number | null; speed_factor: number | null; speed_mm_s: number | null; extrude_factor: number | null }
}

const TempBar: React.FC<{ current: number | null; target: number | null; max?: number; color?: string }> = ({ current, target, max = 300, color = 'bg-rose-500' }) => {
  if (current === null && target === null) return <span className="text-surface-500 text-xs">N/A</span>
  const pct = Math.min(((current || 0) / max) * 100, 100)
  const targetPct = target !== null ? Math.min((target / max) * 100, 100) : null
  return (
    <div className="w-full">
      <div className="relative h-3 bg-surface-800 rounded-full overflow-hidden">
        <div className={`absolute inset-y-0 left-0 ${color} rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
        {targetPct !== null && <div className="absolute inset-y-0 w-0.5 bg-white/60" style={{ left: `${targetPct}%` }} />}
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-xs text-surface-400">{current !== null ? `${current.toFixed(1)}°C` : '—'}</span>
        {target !== null && <span className="text-xs text-surface-500">target {target}°C</span>}
      </div>
    </div>
  )
}

const FanSpeedBar: React.FC<{ speed: number | null; rpm: number | null }> = ({ speed, rpm }) => {
  if (speed === null) return <span className="text-surface-500 text-xs">Off</span>
  const pct = Math.min(speed * 100, 100)
  return (
    <div className="w-full">
      <div className="h-2 bg-surface-800 rounded-full overflow-hidden">
        <div className="h-full bg-sky-500 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-surface-400">{(speed * 100).toFixed(0)}%{rpm !== null ? ` · ${rpm} RPM` : ''}</span>
    </div>
  )
}

const StatCard: React.FC<{ label: string; value: string; sub?: string; color: string; icon: string }> = ({ label, value, sub, color, icon }) => (
  <div className="card">
    <div className="card-body">
      <div className="flex items-center justify-between mb-3">
        <span className="stat-label">{label}</span>
        <div className={`w-8 h-8 rounded-lg ${color.replace('text-', 'bg-').replace('400', '600/10')} flex items-center justify-center`}>
          <svg className={`w-4 h-4 ${color}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
          </svg>
        </div>
      </div>
      <p className="stat-value text-white">{value}</p>
      {sub && <p className="mt-1 text-xs text-surface-500">{sub}</p>}
    </div>
  </div>
)

const SystemHealth: React.FC = () => {
  const [status, setStatus] = useState<PrinterStatus | null>(null)
  const [error, setError] = useState(false)

  const load = async () => {
    try {
      const res = await api.get('/api/v1/system/printer-status')
      if (res.status === 200) { setStatus(res.data); setError(false) }
    } catch { setError(true) }
  }

  useEffect(() => {
    load()
    const interval = setInterval(load, 3000)
    return () => clearInterval(interval)
  }, [])

  const fmtUptime = (s: number | null): string => {
    if (!s) return '—'
    const d = Math.floor(s / 86400)
    const h = Math.floor((s % 86400) / 3600)
    const m = Math.floor((s % 3600) / 60)
    return d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${m}m`
  }

  const fmtClock = (hz: number | null): string => {
    if (!hz) return '—'
    if (hz >= 1e9) return `${(hz / 1e9).toFixed(1)} GHz`
    if (hz >= 1e6) return `${(hz / 1e6).toFixed(0)} MHz`
    return `${(hz / 1e3).toFixed(0)} kHz`
  }

  if (error && !status) {
    return <div className="space-y-6"><h1 className="text-2xl font-bold text-white">System</h1><div className="card p-8 text-center"><p className="text-rose-400">Unable to connect to Moonraker</p><p className="text-sm text-surface-500 mt-1">Check your printer connection in Settings</p></div></div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">System</h1>
          <p className="text-sm text-surface-400 mt-1">Real-time printer sensors and system status</p>
        </div>
        {status && <div className="flex items-center gap-2 text-xs text-surface-500"><div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />Live · 3s</div>}
      </div>

      <div>
        <h2 className="text-sm font-semibold text-surface-300 uppercase tracking-wider mb-3">Temperatures</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="card">
            <div className="card-header">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15.362 5.214A8.252 8.252 0 0112 21 8.25 8.25 0 016.038 7.048 8.287 8.287 0 009 9.6a8.983 8.983 0 013.361-6.867 8.21 8.21 0 003 2.48z" /></svg>
                <span className="text-sm font-semibold text-white">Hotend</span>
              </div>
              {status?.extruder.power != null && <span className={`text-xs font-mono ${status.extruder.power > 0 ? 'text-amber-400' : 'text-surface-500'}`}>{(status.extruder.power * 100).toFixed(0)}%</span>}
            </div>
            <div className="card-body">
              <p className="text-3xl font-bold text-rose-400 mb-3">
                {status?.extruder.temperature != null ? `${status.extruder.temperature.toFixed(1)}°` : '—'}
                <span className="text-lg text-surface-500">/{status?.extruder.target ?? '—'}°</span>
              </p>
              <TempBar current={status?.extruder.temperature ?? null} target={status?.extruder.target ?? null} color="bg-rose-500" />
              <div className="mt-3 flex gap-4 text-xs text-surface-500">
                {status?.extruder.nozzle_diameter && <span>Nozzle {status.extruder.nozzle_diameter}mm</span>}
                {status?.extruder.pressure_advance != null && <span>PA {status.extruder.pressure_advance}</span>}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-sky-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 5.25h-.75m0 0v-.75A.75.75 0 013 3.75h.75m0 0h16.5m0 0v.75A.75.75 0 0021 4.5h-.75m0 0v-.75A.75.75 0 0121 3.75h-.75m-9.75 9h9.75" /></svg>
                <span className="text-sm font-semibold text-white">Heated Bed</span>
              </div>
              {status?.heater_bed.power != null && <span className={`text-xs font-mono ${status.heater_bed.power > 0 ? 'text-amber-400' : 'text-surface-500'}`}>{(status.heater_bed.power * 100).toFixed(0)}%</span>}
            </div>
            <div className="card-body">
              <p className="text-3xl font-bold text-sky-400 mb-3">
                {status?.heater_bed.temperature != null ? `${status.heater_bed.temperature.toFixed(1)}°` : '—'}
                <span className="text-lg text-surface-500">/{status?.heater_bed.target ?? '—'}°</span>
              </p>
              <TempBar current={status?.heater_bed.temperature ?? null} target={status?.heater_bed.target ?? null} max={120} color="bg-sky-500" />
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636" /></svg>
                <span className="text-sm font-semibold text-white">Chamber</span>
              </div>
              {status?.heater_chamber.power != null && status.heater_chamber.power > 0 && <span className="text-xs font-mono text-amber-400">{(status.heater_chamber.power * 100).toFixed(0)}%</span>}
            </div>
            <div className="card-body">
              <p className="text-3xl font-bold text-amber-400 mb-3">
                {status?.fans.chamber_fan_temp != null ? `${status.fans.chamber_fan_temp.toFixed(1)}°`
                  : status?.sensors.chamber != null ? `${status.sensors.chamber.toFixed(1)}°` : '—'}
                <span className="text-lg text-surface-500">{status?.fans.chamber_fan_target != null ? `/${status.fans.chamber_fan_target}°` : ''}</span>
              </p>
              <TempBar current={status?.fans.chamber_fan_temp ?? status?.sensors.chamber ?? null} target={status?.fans.chamber_fan_target ?? null} max={80} color="bg-amber-500" />
            </div>
          </div>
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-surface-300 uppercase tracking-wider mb-3">Fans</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="card">
            <div className="card-header">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-sky-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6z" /></svg>
                <span className="text-sm font-semibold text-white">Part Cooling</span>
              </div>
              {status?.fans.part_cooling_rpm != null && <span className="text-xs font-mono text-sky-400">{status.fans.part_cooling_rpm} RPM</span>}
            </div>
            <div className="card-body"><FanSpeedBar speed={status?.fans.part_cooling_speed ?? null} rpm={status?.fans.part_cooling_rpm ?? null} /></div>
          </div>

          <div className="card">
            <div className="card-header">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6z" /></svg>
                <span className="text-sm font-semibold text-white">Chamber Fan</span>
              </div>
              {status?.fans.chamber_fan_rpm != null && <span className="text-xs font-mono text-emerald-400">{status.fans.chamber_fan_rpm} RPM</span>}
            </div>
            <div className="card-body"><FanSpeedBar speed={status?.fans.chamber_fan_speed ?? null} rpm={status?.fans.chamber_fan_rpm ?? null} /></div>
          </div>

          <div className="card">
            <div className="card-header">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6z" /></svg>
                <span className="text-sm font-semibold text-white">Hotend Fan</span>
              </div>
              {status?.fans.hotend_fan_rpm != null && <span className="text-xs font-mono text-rose-300">{status.fans.hotend_fan_rpm} RPM</span>}
            </div>
            <div className="card-body"><FanSpeedBar speed={status?.fans.hotend_fan_speed ?? null} rpm={status?.fans.hotend_fan_rpm ?? null} /></div>
          </div>
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-surface-300 uppercase tracking-wider mb-3">Board Sensors</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="card">
            <div className="card-header"><div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 3v1.5M4.125 7.5h1.5m0 0V6m0 1.5v1.5m0-1.5h1.5m-1.5 0L3 12m3.75-1.5L8.25 12m-4.5 0h6" /></svg>
              <span className="text-sm font-semibold text-white">MCU Temperature</span>
            </div></div>
            <div className="card-body">
              <p className="text-2xl font-bold text-rose-400 mb-2">{status?.sensors.mcu != null ? `${status.sensors.mcu.toFixed(1)}°C` : 'N/A'}</p>
              {status?.sensors.mcu_min != null && status?.sensors.mcu_max != null && (
                <p className="text-xs text-surface-500">Range: {status.sensors.mcu_min.toFixed(1)}° – {status.sensors.mcu_max.toFixed(1)}°</p>
              )}
              <TempBar current={status?.sensors.mcu ?? null} target={null} max={100} color="bg-rose-500" />
            </div>
          </div>

          <div className="card">
            <div className="card-header"><div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 3v1.5M4.125 7.5h1.5m0 0V6m0 1.5v1.5m0-1.5h1.5m-1.5 0L3 12m3.75-1.5L8.25 12m-4.5 0h6" /></svg>
              <span className="text-sm font-semibold text-white">Chamber Sensor</span>
            </div></div>
            <div className="card-body">
              <p className="text-2xl font-bold text-amber-400 mb-2">{status?.sensors.chamber != null ? `${status.sensors.chamber.toFixed(1)}°C` : 'N/A'}</p>
              {status?.sensors.chamber_min != null && status?.sensors.chamber_max != null && (
                <p className="text-xs text-surface-500">Range: {status.sensors.chamber_min.toFixed(1)}° – {status.sensors.chamber_max.toFixed(1)}°</p>
              )}
              <TempBar current={status?.sensors.chamber ?? null} target={null} max={80} color="bg-amber-500" />
            </div>
          </div>
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-surface-300 uppercase tracking-wider mb-3">System Resources</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatCard label="CPU Load" value={status?.system.sysload != null ? status.system.sysload.toFixed(2) : '—'} sub="System load average" color="text-rose-400" icon="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25" />
          <StatCard label="Memory" value={status?.system.memavail_kb != null ? `${(status.system.memavail_kb / 1024).toFixed(0)} MB` : '—'} sub="Available RAM" color="text-sky-400" icon="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15a2.25 2.25 0 012.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
          <StatCard label="Uptime" value={fmtUptime(status?.system.uptime_s ?? null)} sub="Printer system uptime" color="text-amber-400" icon="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-surface-300 uppercase tracking-wider mb-3">MCU</h2>
        <div className="card">
          <div className="card-body">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              <div><p className="text-xs text-surface-500 mb-1">Model</p><p className="text-sm text-white font-mono">{status?.mcu.mcu_model || '—'}</p></div>
              <div><p className="text-xs text-surface-500 mb-1">Clock</p><p className="text-sm text-white font-mono">{fmtClock(status?.mcu.clock_freq ?? null)}</p></div>
              <div><p className="text-xs text-surface-500 mb-1">Version</p><p className="text-sm text-white font-mono truncate" title={status?.mcu.mcu_version || ''}>{status?.mcu.mcu_version ? status.mcu.mcu_version.split('-')[0] : '—'}</p></div>
              <div><p className="text-xs text-surface-500 mb-1">MCU Load</p><p className="text-sm text-white font-mono">{status?.mcu.last_stats ? `${(status.mcu.last_stats.mcu_awake * 100).toFixed(1)}%` : '—'}</p></div>
            </div>
            {status?.mcu.last_stats && (
              <div className="mt-4 pt-4 border-t border-surface-700/30 grid grid-cols-3 md:grid-cols-6 gap-4">
                {[
                  { label: 'Written', value: status.mcu.last_stats.bytes_write, fmt: (v: number) => v > 1e6 ? `${(v / 1e6).toFixed(1)}MB` : `${(v / 1e3).toFixed(0)}KB` },
                  { label: 'Read', value: status.mcu.last_stats.bytes_read, fmt: (v: number) => v > 1e6 ? `${(v / 1e6).toFixed(1)}MB` : `${(v / 1e3).toFixed(0)}KB` },
                  { label: 'Retransmits', value: status.mcu.last_stats.bytes_retransmit, fmt: (v: number) => v.toString() },
                  { label: 'Send Seq', value: status.mcu.last_stats.send_seq, fmt: (v: number) => v.toLocaleString() },
                  { label: 'Recv Seq', value: status.mcu.last_stats.receive_seq, fmt: (v: number) => v.toLocaleString() },
                  { label: 'SRTT', value: status.mcu.last_stats.srtt, fmt: (v: number) => `${(v * 1000).toFixed(1)}ms` },
                ].map(s => <div key={s.label}><p className="text-[10px] text-surface-500">{s.label}</p><p className="text-xs text-surface-300 font-mono">{s.fmt(s.value)}</p></div>)}
              </div>
            )}
          </div>
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-surface-300 uppercase tracking-wider mb-3">Print State</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="State" value={status?.print_state.idle_state || '—'} color="text-emerald-400" icon="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
          <StatCard label="Speed" value={status?.print_state.speed_factor != null ? `${(status.print_state.speed_factor * 100).toFixed(0)}%` : '—'} sub={status?.print_state.speed_mm_s ? `${(status.print_state.speed_mm_s / 60).toFixed(0)} mm/s` : undefined} color="text-violet-400" icon="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
          <StatCard label="Flow" value={status?.print_state.extrude_factor != null ? `${(status.print_state.extrude_factor * 100).toFixed(0)}%` : '—'} sub="Extrusion multiplier" color="text-amber-400" icon="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636" />
          <StatCard label="Print Time" value={status?.print_state.printing_time ? fmtUptime(status.print_state.printing_time) : '—'} sub="Current session" color="text-sky-400" icon="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
        </div>
      </div>
    </div>
  )
}

export default SystemHealth
