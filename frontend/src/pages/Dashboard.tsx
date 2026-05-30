import React, { useEffect, useState } from 'react'
import { fetchPrinterStats, fetchJobs, fetchActiveSlot, fetchPowerReading, fetchPrintSessionPower, fetchCfsSlots, fetchSettings, fetchSummary, fetchPowerHistory, fetchPrintQueue, fetchMaintenance, getThumbnailUrl } from '../api'
import ThumbnailImg from '../components/ThumbnailImg'
import type { PrintJob, CfsSlot, PrinterStats } from '../types'

const Dashboard: React.FC = () => {
  const [stats, setStats] = useState<PrinterStats | null>(null)
  const [jobs, setJobs] = useState<PrintJob[]>([])
  const [activeSlot, setActiveSlot] = useState<CfsSlot | null>(null)
  const [power, setPower] = useState<number | null>(null)
  const [sessionPower, setSessionPower] = useState<{ total_kwh: number } | null>(null)
  const [cfsSlots, setCfsSlots] = useState<CfsSlot[]>([])
  const [_elecRate, _setElecRate] = useState(0.49)
  const [summary, setSummary] = useState<any>(null)
  const [powerHistory, setPowerHistory] = useState<{ timestamp: string; wattage: number }[]>([])
  const [queue, setQueue] = useState<any[]>([])
  const [maintenance, setMaintenance] = useState<any>(null)

  useEffect(() => {
    const load = async () => {
      try {
        const [statsData, jobsData, slotData, powerData, sessionData, cfsData, settingsData] = await Promise.all([
          fetchPrinterStats(),
          fetchJobs(),
          fetchActiveSlot(),
          fetchPowerReading(),
          fetchPrintSessionPower(),
          fetchCfsSlots(),
          fetchSettings().catch(() => ({} as Record<string, string>)),
        ])
        setStats(statsData)
        setJobs(jobsData)
        setActiveSlot(slotData.active_slot)
        setPower(powerData.power_watts)
        setSessionPower(sessionData)
        setCfsSlots(cfsData.slots)
        if (settingsData.electricity_rate_kwh) _setElecRate(parseFloat(settingsData.electricity_rate_kwh))

        fetchSummary().then(setSummary).catch(() => {})
        fetchPowerHistory(60).then(setPowerHistory).catch(() => {})
        fetchPrintQueue().then(d => setQueue(d.queue || [])).catch(() => {})
        fetchMaintenance().then(setMaintenance).catch(() => {})
      } catch (e) {
        console.error('Dashboard load error:', e)
      }
    }
    load()
    const interval = setInterval(load, 10000)
    return () => clearInterval(interval)
  }, [])

  const ps = stats?.result?.status?.print_stats
  const meta = stats?.result?.meta
  const isPrinting = ps?.state === 'printing'
  const progress = isPrinting ? (meta?.progress ?? 0) * 100 : 0

  const formatDuration = (seconds: number | null | undefined): string => {
    if (!seconds || seconds <= 0) return '—'
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    if (h > 0) return `${h}h ${m}m`
    return `${m}m`
  }

  const colorFromHex = (hex: string): string => {
    if (!hex || hex === '-1') return '#52525b'
    let h = hex.replace('#', '')
    if (h.length === 7 && h.startsWith('0')) h = h.substring(1)
    if (h.length !== 6) return '#52525b'
    const r = parseInt(h.substring(0, 2), 16)
    const g = parseInt(h.substring(2, 4), 16)
    const b = parseInt(h.substring(4, 6), 16)
    if (isNaN(r) || isNaN(g) || isNaN(b)) return '#52525b'
    return `rgb(${r}, ${g}, ${b})`
  }

  const maxW = powerHistory.length > 0 ? Math.max(...powerHistory.map(p => p.wattage), 1) : 1
  const avgW = powerHistory.length > 0 ? powerHistory.reduce((s, p) => s + p.wattage, 0) / powerHistory.length : 0
  const niceMax = Math.ceil(maxW / 50) * 50
  const yTicks = [0, Math.round(niceMax / 4), Math.round(niceMax / 2), Math.round(niceMax * 3 / 4), niceMax]

  const xTickCount = 7
  const xTicks = Array.from({ length: xTickCount }, (_, i) => {
    const minAgo = 60 - (i * 60 / (xTickCount - 1))
    if (minAgo === 0) return 'Now'
    if (minAgo < 1) return '<1m'
    return `${Math.round(minAgo)}m`
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-sm text-surface-400 mt-1">Printer status and overview</p>
        </div>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${isPrinting ? 'bg-emerald-500 animate-pulse' : 'bg-surface-500'}`} />
          <span className="text-sm text-surface-400">{isPrinting ? 'Printing' : 'Idle'}</span>
        </div>
      </div>

      {isPrinting && (
        <div className="card border border-accent-500/30">
          <div className="card-header">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <h2 className="text-sm font-semibold text-white">Active Print: {ps?.filename}</h2>
            </div>
            <span className="text-sm font-bold text-accent-400">{progress.toFixed(1)}%</span>
          </div>
          <div className="card-body">
            <div className="flex gap-4 mb-4">
              <div className="shrink-0">
                <ThumbnailImg
                  src={getThumbnailUrl(ps?.filename || '')}
                  alt="Print preview"
                  size="lg"
                />
              </div>
              <div className="flex-1 min-w-0">
                {progress >= 100 ? (
                  <div>
                    <div className="w-full bg-surface-700 rounded-full h-2.5">
                      <div className="bg-rose-500 h-2.5 rounded-full transition-all" style={{ width: '100%' }} />
                    </div>
                    <p className="text-xs text-rose-400 mt-1.5 font-medium">
                      Exceeds estimation by {meta?.time_remaining_seconds ? formatDuration(Math.abs(meta.time_remaining_seconds)) : '—'}
                    </p>
                  </div>
                ) : (
                  <div className="w-full bg-surface-700 rounded-full h-2.5">
                    <div className="bg-accent-500 h-2.5 rounded-full transition-all" style={{ width: `${Math.min(progress, 100)}%` }} />
                  </div>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-4 text-sm">
              <div>
                <p className="text-xs text-surface-500 mb-1">Remaining</p>
                <p className="text-surface-200 font-medium">{meta?.time_remaining_seconds ? formatDuration(meta.time_remaining_seconds) : '—'}</p>
              </div>
              <div>
                <p className="text-xs text-surface-500 mb-1">Layer</p>
                <p className="text-surface-200 font-medium">{meta?.layer != null ? `${meta.layer}/${meta.layer_count}` : '—'}</p>
              </div>
              <div>
                <p className="text-xs text-surface-500 mb-1">Active CFS Slot</p>
                {activeSlot ? (
                  <div className="flex items-center gap-2">
                    <div className={`w-3 h-3 rounded-full border ${activeSlot.is_active ? 'border-sky-400 animate-pulse' : 'border-surface-600'}`} style={{ backgroundColor: colorFromHex(activeSlot.color_hex) }} />
                    <span className="text-surface-200 font-medium">{activeSlot.slot}</span>
                    {activeSlot.feed_state && activeSlot.feed_state !== 'idle' && (
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                        activeSlot.feed_state === 'feeding'
                          ? 'bg-emerald-500/20 text-emerald-400 animate-pulse'
                          : 'bg-sky-500/20 text-sky-400'
                      }`}>
                        {activeSlot.feed_state}
                      </span>
                    )}
                  </div>
                ) : (
                  <p className="text-surface-200 font-medium">{meta?.filament_type || '—'}</p>
                )}
              </div>
              <div>
                <p className="text-xs text-surface-500 mb-1">Material</p>
                <p className="text-surface-200 font-medium">{activeSlot?.material_name || meta?.filament_type || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-surface-500 mb-1">Power</p>
                <p className="text-surface-200 font-medium">{power !== null ? `${power.toFixed(0)} W` : '—'}</p>
                {sessionPower && sessionPower.total_kwh > 0 && <p className="text-[10px] text-amber-400">{sessionPower.total_kwh.toFixed(3)} kWh</p>}
              </div>
              <div>
                <p className="text-xs text-surface-500 mb-1">Est. Filament</p>
                <p className="text-surface-200 font-medium">{meta?.estimated_filament_g ? `${meta.estimated_filament_g.toFixed(0)}g` : '—'}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        <div className="card"><div className="card-body">
          <span className="stat-label">Total Prints</span>
          <p className="stat-value">{summary?.total_prints ?? '—'}</p>
        </div></div>
        <div className="card"><div className="card-body">
          <span className="stat-label">Total Cost</span>
          <p className="stat-value text-amber-400">${summary?.total_cost?.toFixed(2) ?? '—'}</p>
        </div></div>
        <div className="card"><div className="card-body">
          <span className="stat-label">Filament Used</span>
          <p className="stat-value text-emerald-400">{summary?.total_filament_kg ?? '—'} kg</p>
        </div></div>
        <div className="card"><div className="card-body">
          <span className="stat-label">Print Hours</span>
          <p className="stat-value text-sky-400">{summary?.total_print_hours ?? '—'}h</p>
        </div></div>
        <div className="card"><div className="card-body">
          <span className="stat-label">This Month</span>
          <p className="stat-value text-violet-400">{summary?.month?.prints ?? '—'} prints · ${summary?.month?.cost ?? '—'}</p>
          {summary?.month?.projected_monthly_cost > 0 && <p className="text-[10px] text-surface-500 mt-0.5">Projected: ${summary.month.projected_monthly_cost}/mo</p>}
        </div></div>
        <div className="card"><div className="card-body">
          <span className="stat-label">Success Rate</span>
          <p className="stat-value">{summary?.success_rate ?? '—'}%</p>
        </div></div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {powerHistory.length > 0 && (
            <div className="card">
              <div className="card-header flex items-center justify-between">
                <h2 className="text-sm font-semibold text-white">Power Draw (Last Hour)</h2>
                <span className="text-xs text-amber-400">Avg: {avgW.toFixed(0)} W</span>
              </div>
              <div className="card-body">
                <div className="relative h-36">
                  <div className="absolute inset-0 flex items-end">
                    <div className="absolute left-0 top-0 bottom-0 w-10 flex flex-col justify-between text-[10px] text-surface-500 text-right pr-1">
                      {yTicks.slice().reverse().map((t, i) => (
                        <span key={i}>{t}W</span>
                      ))}
                    </div>
                    <div className="ml-10 flex-1 flex items-end gap-px h-full">
                      {powerHistory.map((p, i) => (
                        <div key={i} className="flex-1 bg-accent-500/60 rounded-t-sm min-w-px" style={{ height: `${(p.wattage / niceMax) * 100}%` }} title={`${p.wattage.toFixed(0)}W`} />
                      ))}
                    </div>
                  </div>
                </div>
                <div className="ml-10 flex justify-between mt-1 text-[10px] text-surface-500">
                  {xTicks.map((label, i) => (
                    <span key={i}>{label}</span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {maintenance && maintenance.items?.length > 0 && (
            <div className="card">
              <div className="card-header flex items-center justify-between">
                <h2 className="text-sm font-semibold text-white">Maintenance</h2>
                <span className="text-xs text-surface-500">{maintenance.total_print_hours?.toFixed(1)}h total</span>
              </div>
              <div className="card-body p-0">
                <div className="divide-y divide-surface-700/30">
                  {maintenance.items.map((item: any) => (
                    <div key={item.key} className="flex items-center justify-between px-4 py-3">
                      <div>
                        <p className="text-sm text-surface-200">{item.label}</p>
                        <p className="text-xs text-surface-500">Every {item.interval_hours}h</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          {item.overdue ? (
                            <span className="text-xs text-rose-400 font-medium">Overdue!</span>
                          ) : (
                            <span className="text-xs text-surface-400">{item.hours_until_due.toFixed(0)}h left</span>
                          )}
                          <div className="w-24 bg-surface-700 rounded-full h-1.5 mt-1">
                            <div className={`h-1.5 rounded-full ${item.overdue ? 'bg-rose-500' : item.hours_until_due < item.interval_hours * 0.2 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                              style={{ width: `${Math.min(100, ((item.interval_hours - item.hours_until_due) / item.interval_hours) * 100)}%` }} />
                          </div>
                        </div>
                        <button onClick={async () => {
                          await fetch(`/api/v1/analytics/maintenance/${item.key}/done`, { method: 'POST' })
                          fetchMaintenance().then(setMaintenance)
                        }} className="px-2 py-1 text-xs bg-surface-700 hover:bg-surface-600 text-surface-300 rounded transition-colors">Done</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-6">
          {(summary?.low_stock_rolls > 0) && (
            <div className="card border border-amber-500/30">
              <div className="card-header">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" /></svg>
                  <h2 className="text-sm font-semibold text-white">Low Stock Warning</h2>
                </div>
              </div>
              <div className="card-body">
                <p className="text-amber-400 text-sm">{summary.low_stock_rolls} roll{summary.low_stock_rolls !== 1 ? 's' : ''} below 20%</p>
                <a href="/filament" className="text-xs text-accent-400 hover:underline mt-1 block">View Filament Library →</a>
              </div>
            </div>
          )}

          {queue.length > 0 && (
            <div className="card">
              <div className="card-header"><h2 className="text-sm font-semibold text-white">Print Queue ({queue.length})</h2></div>
              <div className="card-body p-0">
                <div className="divide-y divide-surface-700/30">
                  {queue.slice(0, 5).map((item: any, i: number) => (
                    <div key={i} className="px-4 py-2">
                      <p className="text-xs text-surface-300 truncate">{item.filename || `Job ${i + 1}`}</p>
                    </div>
                  ))}
                  {queue.length > 5 && <div className="px-4 py-2 text-xs text-surface-500">+{queue.length - 5} more</div>}
                </div>
              </div>
            </div>
          )}

          <div className="card">
            <div className="card-header flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">CFS Slots</h2>
              {cfsSlots.some(s => s.is_active) && (
                <div className="flex items-center gap-1.5 px-2 py-0.5 bg-sky-900/30 border border-sky-500/20 rounded">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-[10px] text-sky-300 font-medium">
                    {cfsSlots.find(s => s.is_active)?.slot} {cfsSlots.find(s => s.is_active)?.feed_state}
                  </span>
                </div>
              )}
            </div>
            <div className="card-body p-3">
              <div className="grid grid-cols-2 gap-2">
                {cfsSlots.slice(0, 8).map(slot => (
                  <div key={slot.slot} className={`flex items-center gap-2 p-2 rounded-lg transition-all ${
                    slot.is_active
                      ? 'bg-sky-900/30 ring-1 ring-sky-500/40'
                      : 'bg-surface-800/30'
                  }`}>
                    <div className={`w-4 h-4 rounded-full border shrink-0 ${
                      slot.is_active ? 'border-sky-400 animate-pulse' : 'border-surface-600'
                    }`} style={{ backgroundColor: colorFromHex(slot.color_hex) }} />
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-surface-200">{slot.slot}</p>
                      <p className="text-[10px] text-surface-500 truncate">{slot.material_name}</p>
                    </div>
                    <div className="ml-auto text-right">
                      <span className={`text-[10px] ${slot.remaining_pct <= 20 ? 'text-amber-400' : slot.is_active ? 'text-sky-300 font-medium' : 'text-surface-500'}`}>{slot.remaining_pct}%</span>
                      {slot.remaining_weight_g != null && <p className="text-[9px] text-surface-600">{slot.remaining_weight_g}g</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header"><h2 className="text-sm font-semibold text-white">Recent Jobs</h2></div>
            <div className="card-body p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-surface-700/50 text-xs text-surface-500"><th className="text-left px-4 py-3 font-medium">File</th><th className="text-left px-4 py-3 font-medium">Status</th><th className="text-left px-4 py-3 font-medium">Duration</th><th className="text-right px-4 py-3 font-medium">Cost</th></tr></thead>
                  <tbody>
                    {jobs.slice(0, 8).map(job => (
                      <tr key={job.id} className="border-b border-surface-700/20 hover:bg-surface-800/30 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2 max-w-[180px]">
                            <ThumbnailImg
                              src={job.thumbnail_path || getThumbnailUrl(job.filename)}
                              size="xs"
                            />
                            <span className="text-surface-300 truncate">{job.filename}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`badge-${job.status === 'COMPLETE' ? 'success' : job.status === 'PRINTING' ? 'info' : job.status === 'CANCELLED' ? 'warning' : job.status === 'FAILED' ? 'danger' : 'neutral'}`}>{job.status}</span>
                        </td>
                        <td className="px-4 py-3 text-surface-400">{job.actual_duration_seconds ? `${Math.round(job.actual_duration_seconds / 60)} min` : '—'}</td>
                        <td className="px-4 py-3 text-right text-surface-300 font-medium">{(job.filament_cost || job.electricity_cost) ? `$${((job.filament_cost || 0) + (job.electricity_cost || 0)).toFixed(2)}` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Dashboard