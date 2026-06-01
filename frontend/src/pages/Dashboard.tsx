import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { fetchPrinterStats, fetchPrinterStatus, fetchJobsPaginated, fetchCfsState, fetchPowerReading, fetchPrintSessionPower, fetchFilamentRolls, fetchCfsSlotOverrides, fetchSummary, fetchPowerHistory, fetchPrintQueue, fetchMaintenance, getThumbnailUrl } from '../api'
import ThumbnailImg from '../components/ThumbnailImg'
import type { PrintJob, CfsSlot } from '../types'

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

const formatDuration = (seconds: number | null | undefined): string => {
  if (!seconds || seconds <= 0) return '—'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

const Skeleton = ({ className = '' }: { className?: string }) => (
  <div className={`animate-pulse bg-surface-800 rounded ${className}`} />
)

const PowerChart = React.memo(({ history }: { history: { timestamp: string; wattage: number }[] }) => {
  const { avgW, niceMax, yTicks, xTicks } = useMemo(() => {
    const maxW = history.length > 0 ? Math.max(...history.map(p => p.wattage), 1) : 1
    const avgW = history.length > 0 ? history.reduce((s, p) => s + p.wattage, 0) / history.length : 0
    const niceMax = Math.ceil(maxW / 50) * 50
    const yTicks = [0, Math.round(niceMax / 4), Math.round(niceMax / 2), Math.round(niceMax * 3 / 4), niceMax]
    const xTickCount = 7
    const xTicks = Array.from({ length: xTickCount }, (_, i) => {
      const minAgo = 60 - (i * 60 / (xTickCount - 1))
      if (minAgo === 0) return 'Now'
      if (minAgo < 1) return '<1m'
      return `${Math.round(minAgo)}m`
    })
    return { maxW, avgW, niceMax, yTicks, xTicks }
  }, [history])

  return (
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
              {history.map((p, i) => (
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
  )
})

const CfsSlotsCard = React.memo(({ slots, slotStates }: { slots: CfsSlot[]; slotStates?: Record<string, string> }) => {
  const activeSlot = slots.find(s => s.is_active)
  const activeSlotId = activeSlot?.slot
  const activeState = activeSlotId ? slotStates?.[activeSlotId] : undefined

  return (
    <a href="/filament" className="card block hover:border-accent-500/30 transition-colors">
      <div className="card-header flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">CFS</h2>
        {activeSlotId && (
          <div className="flex items-center gap-1.5 px-2 py-0.5 bg-sky-900/30 border border-sky-500/20 rounded">
            <div className={`w-1.5 h-1.5 rounded-full ${activeState === 'feeding' ? 'bg-emerald-400 animate-pulse' : 'bg-sky-400 animate-pulse'}`} />
            <span className="text-[10px] text-sky-300 font-medium">{activeSlotId}</span>
            <span className="text-[10px] text-sky-400">{activeState || 'active'}</span>
          </div>
        )}
      </div>
      <div className="card-body p-3">
        {activeSlot ? (
          <div className="flex items-center gap-3">
            <div className="w-5 h-5 rounded-full border-2 border-sky-400 animate-pulse" style={{ backgroundColor: colorFromHex(activeSlot.color_hex) }} />
            <div>
              <p className="text-xs font-medium text-white">{activeSlot.slot} — {activeSlot.material_name}</p>
              <p className="text-[10px] text-surface-400">{activeSlot.remaining_pct}% remaining</p>
            </div>
          </div>
        ) : (
          <p className="text-xs text-surface-500">No active slot</p>
        )}
        <div className="grid grid-cols-2 gap-1 mt-2">
          {slots.slice(0, 8).map(slot => {
            const sState = slotStates?.[slot.slot]
            const isFeeding = sState === 'feeding'
            const isLoading = sState === 'loading'
            return (
              <div key={slot.slot} className={`flex items-center gap-1.5 p-1 rounded ${isFeeding ? 'bg-sky-900/20' : isLoading ? 'bg-amber-900/20' : 'bg-surface-800/20'}`}>
                <div className={`w-2.5 h-2.5 rounded-full border ${isFeeding ? 'border-sky-400' : isLoading ? 'border-amber-400' : 'border-surface-600'}`} style={{ backgroundColor: colorFromHex(slot.color_hex) }} />
                <span className="text-[9px] text-surface-400">{slot.slot}</span>
                <span className={`text-[9px] ml-auto ${slot.remaining_pct <= 20 ? 'text-amber-400' : 'text-surface-500'}`}>{slot.remaining_pct}%</span>
              </div>
            )
          })}
        </div>
        <p className="text-[10px] text-accent-400 mt-2 text-center">View in Filament Library →</p>
      </div>
    </a>
  )
})

const RecentJobsTable = React.memo(({ jobs }: { jobs: PrintJob[] }) => (
  <div className="card">
    <div className="card-header"><h2 className="text-sm font-semibold text-white">Recent Jobs</h2></div>
    <div className="card-body p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-surface-700/50 text-xs text-surface-500"><th className="text-left px-4 py-3 font-medium">File</th><th className="text-left px-4 py-3 font-medium">Status</th><th className="text-left px-4 py-3 font-medium">Duration</th><th className="text-right px-4 py-3 font-medium">Cost</th></tr></thead>
          <tbody>
            {jobs.map(job => (
              <tr key={job.id} className="border-b border-surface-700/20 hover:bg-surface-800/30 transition-colors">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <ThumbnailImg
                      src={job.thumbnail_path || getThumbnailUrl(job.filename)}
                      size="sm"
                    />
                    <span className="text-surface-300 truncate max-w-[300px]" title={job.filename}>{job.filename}</span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className={`badge-${job.status === 'COMPLETE' ? 'success' : job.status === 'PRINTING' ? 'info' : job.status === 'CANCELLED' ? 'warning' : job.status === 'FAILED' ? 'danger' : 'neutral'}`}>{job.status}</span>
                </td>
                <td className="px-4 py-3 text-surface-400">{job.actual_duration_seconds ? `${Math.round(job.actual_duration_seconds / 60)} min` : '—'}</td>
                <td className="px-4 py-3 text-right text-surface-300 font-medium">{(job.filament_cost || job.electricity_cost) ? `$${((job.filament_cost || 0) + (job.electricity_cost || 0)).toFixed(2)}` : '—'}</td>
              </tr>
            ))}
            {jobs.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-surface-500 text-xs">Loading jobs...</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  </div>
))

const Dashboard: React.FC = () => {
  const [cfsState, setCfsState] = useState<{ active_slot_id: string | null; feed_state: string; is_printing: boolean; slot_states: Record<string, string> }>({ active_slot_id: null, feed_state: 'idle', is_printing: false, slot_states: {} })
  const [power, setPower] = useState<number | null>(null)
  const [sessionPower, setSessionPower] = useState<{ total_kwh: number } | null>(null)
  const [cfsSlots, setCfsSlots] = useState<CfsSlot[]>([])
  const [summary, setSummary] = useState<any>(null)
  const [powerHistory, setPowerHistory] = useState<{ timestamp: string; wattage: number }[]>([])
  const [queue, setQueue] = useState<any[]>([])
  const [maintenance, setMaintenance] = useState<any>(null)
  const [jobs, setJobs] = useState<PrintJob[]>([])
  const [isPrinting, setIsPrinting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [ps, setPs] = useState<any>(null)
  const [meta, setMeta] = useState<any>(null)
  const [printerStatus, setPrinterStatus] = useState<any>(null)
  const [overtime, setOvertime] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const overtimeRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const activeSlot = useMemo(() => {
    if (!cfsState.active_slot_id || !cfsSlots.length) return null
    const found = cfsSlots.find(s => s.slot === cfsState.active_slot_id)
    if (!found) return null
    return { ...found, is_active: true, feed_state: cfsState.feed_state as 'idle' | 'active' | 'feeding' }
  }, [cfsSlots, cfsState])

  const buildCfsSlots = useCallback((rolls: any[], overrides: any[]) => {
    const overrideMap = new Map(overrides.map((o: any) => [o.slot_id, o]))
    return rolls
      .filter((r: any) => r.spool_id && /^T[1-4][A-D]$/.test(r.spool_id))
      .map((r: any) => {
        const sid = r.spool_id!
        const ov = overrideMap.get(sid)
        const pctFromWeight = Math.min(100, Math.round((r.remaining_weight_g / (r.total_weight_g || 1000)) * 100))
        return {
          slot: sid,
          tray: `T${sid[1]}`,
          position: sid,
          color_hex: r.color_hex || '',
          material_code: r.material,
          material_name: r.material,
          remaining_pct: ov?.remaining_pct != null ? Math.round(ov.remaining_pct) : pctFromWeight,
          remaining_weight_g: r.remaining_weight_g,
          total_weight_g: r.total_weight_g,
          temperature: null,
          humidity: null,
          is_active: false,
          feed_state: 'idle',
          cost_per_kg: ov?.cost_per_kg ?? r.cost_per_kg,
          spool_weight_g: ov?.spool_weight_g ?? r.spool_weight_g,
          rfid_vendor: r.rfid_vendor,
        } as CfsSlot
      })
  }, [])

  const loadLive = useCallback(async () => {
    const results = await Promise.allSettled([
      fetchPrinterStats(),
      fetchCfsState(),
      fetchPowerReading(),
      fetchPrintSessionPower(),
      fetchCfsSlotOverrides(),
      fetchPrinterStatus(),
    ])
    if (results[0].status === 'fulfilled') {
      const statsData = results[0].value
      const p = statsData?.result?.status?.print_stats
      const m = statsData?.result?.meta
      const printing = p?.state === 'printing'
      setPs(p); setMeta(m); setIsPrinting(printing)
      setProgress(printing ? (m?.progress ?? 0) * 100 : 0)
    }
    if (results[1].status === 'fulfilled') setCfsState(results[1].value)
    if (results[2].status === 'fulfilled') setPower(results[2].value.power_watts)
    if (results[3].status === 'fulfilled') setSessionPower(results[3].value)
    if (results[4].status === 'fulfilled') {
      const overrides = results[4].value
      setCfsSlots(prev => prev.map(slot => {
        const ov = overrides.find((o: any) => o.slot_id === slot.slot)
        return ov?.remaining_pct != null ? { ...slot, remaining_pct: Math.round(ov.remaining_pct) } : slot
      }))
    }
    if (results[5].status === 'fulfilled') setPrinterStatus(results[5].value)
  }, [])

  const loadBackground = useCallback(async () => {
    const results = await Promise.allSettled([
      fetchJobsPaginated({ page: 1, per_page: 8, sort_by: 'start_time', sort_order: 'desc' }),
      fetchSummary(),
      fetchPowerHistory(60),
      fetchPrintQueue(),
      fetchMaintenance(),
      fetchFilamentRolls(),
      fetchCfsSlotOverrides(),
    ])
    if (results[0].status === 'fulfilled') setJobs(results[0].value.items)
    if (results[1].status === 'fulfilled') setSummary(results[1].value)
    if (results[2].status === 'fulfilled') setPowerHistory(results[2].value)
    if (results[3].status === 'fulfilled') setQueue(results[3].value.queue || [])
    if (results[4].status === 'fulfilled') setMaintenance(results[4].value)
    if (results[5].status === 'fulfilled' && results[6].status === 'fulfilled') {
      setCfsSlots(buildCfsSlots(results[5].value, results[6].value))
    } else if (results[5].status === 'fulfilled') {
      setCfsSlots(buildCfsSlots(results[5].value, []))
    }
  }, [buildCfsSlots])

  useEffect(() => {
    let cancelled = false
    const init = async () => {
      await Promise.all([loadLive(), loadBackground()])
      if (cancelled) return
      intervalRef.current = setInterval(async () => {
        await loadLive()
      }, 15000)
    }
    init()
    return () => {
      cancelled = true
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [loadLive, loadBackground])

  useEffect(() => {
    if (isPrinting && progress >= 100) {
      if (overtimeRef.current) return
      overtimeRef.current = setInterval(() => {
        setOvertime(prev => prev + 1)
      }, 1000)
    } else {
      if (overtimeRef.current) {
        clearInterval(overtimeRef.current)
        overtimeRef.current = null
      }
      setOvertime(0)
    }
    return () => {
      if (overtimeRef.current) {
        clearInterval(overtimeRef.current)
        overtimeRef.current = null
      }
    }
  }, [isPrinting, progress >= 100])

  const markDone = useCallback(async (key: string) => {
    await fetch(`/api/v1/analytics/maintenance/${key}/done`, { method: 'POST' })
    fetchMaintenance().then(setMaintenance)
  }, [])

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
                    <p className="text-xs text-rose-400 mt-1.5 font-medium font-mono">
                      +{Math.floor(overtime / 3600) > 0 ? `${Math.floor(overtime / 3600)}h ` : ''}{Math.floor((overtime % 3600) / 60)}m {overtime % 60}s over estimate
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
                <p className="text-surface-200 font-medium">{progress >= 100 ? <span className="text-rose-400">Over</span> : meta?.time_remaining_seconds ? formatDuration(meta.time_remaining_seconds) : '—'}</p>
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

      <div className="card">
        <div className="card-header">
          <h2 className="text-sm font-semibold text-white">Printer Status</h2>
        </div>
        <div className="card-body">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-800/50">
              <svg className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" /></svg>
              <div className="min-w-0">
                <p className="text-[10px] text-surface-500">State</p>
                <p className="text-surface-200 font-medium truncate">{printerStatus?.print_state?.idle_state || 'N/A'}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-800/50">
              <svg className="w-3.5 h-3.5 text-violet-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" /></svg>
              <div className="min-w-0">
                <p className="text-[10px] text-surface-500">Speed</p>
                <p className="text-surface-200 font-medium">{printerStatus?.print_state?.speed_factor != null ? `${(printerStatus.print_state.speed_factor * 100).toFixed(0)}%` : 'N/A'}</p>
                {printerStatus?.print_state?.speed_mm_s != null && <p className="text-[10px] text-surface-500">{(printerStatus.print_state.speed_mm_s / 60).toFixed(0)} mm/s</p>}
              </div>
            </div>
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-800/50">
              <svg className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636" /></svg>
              <div className="min-w-0">
                <p className="text-[10px] text-surface-500">Flow</p>
                <p className="text-surface-200 font-medium">{printerStatus?.print_state?.extrude_factor != null ? `${(printerStatus.print_state.extrude_factor * 100).toFixed(0)}%` : 'N/A'}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-800/50">
              <svg className="w-3.5 h-3.5 text-sky-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              <div className="min-w-0">
                <p className="text-[10px] text-surface-500">Print Time</p>
                <p className="text-surface-200 font-medium">{printerStatus?.print_state?.printing_time ? formatDuration(printerStatus.print_state.printing_time) : 'N/A'}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {powerHistory.length > 0 ? (
            <PowerChart history={powerHistory} />
          ) : (
            <div className="card"><div className="card-body h-52 flex items-center justify-center">
              <Skeleton className="h-full w-full" />
            </div></div>
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
                        <button onClick={() => markDone(item.key)} className="px-2 py-1 text-xs bg-surface-700 hover:bg-surface-600 text-surface-300 rounded transition-colors">Done</button>
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

          {cfsSlots.length > 0 ? (
            <CfsSlotsCard slots={cfsSlots} slotStates={cfsState.slot_states} />
          ) : (
            <div className="card"><div className="card-body h-48"><Skeleton className="h-full w-full" /></div></div>
          )}
        </div>
      </div>

      <RecentJobsTable jobs={jobs} />
    </div>
  )
}

export default Dashboard
