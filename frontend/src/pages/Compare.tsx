import React, { useEffect, useState } from 'react'
import { fetchJobs } from '../api'
import type { PrintJob } from '../types'

const statusColors: Record<string, string> = {
  COMPLETE: 'bg-emerald-500/20 text-emerald-400',
  CANCELLED: 'bg-amber-500/20 text-amber-400',
  FAILED: 'bg-rose-500/20 text-rose-400',
  PRINTING: 'bg-sky-500/20 text-sky-400',
}

const fmt = (s: number | null | undefined) => {
  if (!s || s <= 0) return '—'
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

const Compare: React.FC = () => {
  const [jobs, setJobs] = useState<PrintJob[]>([])
  const [loading, setLoading] = useState(true)
  const [leftId, setLeftId] = useState<number | null>(null)
  const [rightId, setRightId] = useState<number | null>(null)
  const [searchL, setSearchL] = useState('')
  const [searchR, setSearchR] = useState('')

  useEffect(() => {
    fetchJobs().then(j => { setJobs(j.sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime())) }).finally(() => setLoading(false))
  }, [])

  const left = jobs.find(j => j.id === leftId)
  const right = jobs.find(j => j.id === rightId)

  const filteredL = jobs.filter(j => j.filename.toLowerCase().includes(searchL.toLowerCase()) || String(j.id).includes(searchL)).slice(0, 15)
  const filteredR = jobs.filter(j => j.filename.toLowerCase().includes(searchR.toLowerCase()) || String(j.id).includes(searchR.toLowerCase())).slice(0, 15)

  const Row = ({ label, vL, vR, unit = '', fmt: fn }: { label: string; vL: any; vR: any; unit?: string; fmt?: (v: any) => string }) => {
    const f = fn || ((v: any) => v != null ? `${v}${unit}` : '—')
    const l = vL != null ? parseFloat(String(vL)) : null
    const r = vR != null ? parseFloat(String(vR)) : null
    const pct = l != null && r != null && r !== 0 ? ((l! - r!) / Math.abs(r!)) * 100 : null
    return (
      <tr className="border-t border-surface-700/20">
        <td className="px-4 py-2.5 text-xs text-surface-500 font-medium">{label}</td>
        <td className="px-4 py-2.5 text-sm text-surface-200 text-right">{f(vL)}</td>
        <td className="px-4 py-2.5 text-xs text-center">
          {pct != null ? (
            <span className={Math.abs(pct) <= 5 ? 'text-emerald-400' : Math.abs(pct) <= 20 ? 'text-amber-400' : 'text-rose-400'}>
              {pct > 0 ? '+' : ''}{pct.toFixed(0)}%
            </span>
          ) : '—'}
        </td>
        <td className="px-4 py-2.5 text-sm text-surface-200 text-right">{f(vR)}</td>
      </tr>
    )
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64"><div className="w-6 h-6 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" /></div>
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Compare Prints</h1>
        <p className="text-sm text-surface-400 mt-1">Select two print jobs for side-by-side comparison</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <div className="card-header"><h2 className="text-sm font-semibold text-white">Print A</h2></div>
          <div className="card-body space-y-2">
            <input type="text" value={searchL} onChange={e => setSearchL(e.target.value)} placeholder="Search by filename or ID..." className="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm text-surface-200 placeholder-surface-500 focus:outline-none focus:border-accent-500" />
            <div className="max-h-48 overflow-y-auto space-y-1">
              {filteredL.map(j => (
                <button key={j.id} onClick={() => setLeftId(j.id)} className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors ${leftId === j.id ? 'bg-accent-600/30 text-accent-300 border border-accent-500/50' : 'hover:bg-surface-800/50 text-surface-300'}`}>
                  <span className="font-medium">#{j.id}</span> {j.filename.slice(0, 40)}
                  <span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] ${statusColors[j.status] || 'bg-surface-700 text-surface-400'}`}>{j.status}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><h2 className="text-sm font-semibold text-white">Print B</h2></div>
          <div className="card-body space-y-2">
            <input type="text" value={searchR} onChange={e => setSearchR(e.target.value)} placeholder="Search by filename or ID..." className="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm text-surface-200 placeholder-surface-500 focus:outline-none focus:border-accent-500" />
            <div className="max-h-48 overflow-y-auto space-y-1">
              {filteredR.map(j => (
                <button key={j.id} onClick={() => setRightId(j.id)} className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors ${rightId === j.id ? 'bg-accent-600/30 text-accent-300 border border-accent-500/50' : 'hover:bg-surface-800/50 text-surface-300'}`}>
                  <span className="font-medium">#{j.id}</span> {j.filename.slice(0, 40)}
                  <span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] ${statusColors[j.status] || 'bg-surface-700 text-surface-400'}`}>{j.status}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {left && right && (
        <div className="card">
          <div className="card-body p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-800/30 text-xs text-surface-400 uppercase tracking-wider">
                  <th className="text-left px-4 py-3 font-medium w-40">Metric</th>
                  <th className="text-right px-4 py-3 font-medium">Print A</th>
                  <th className="text-center px-4 py-3 font-medium w-20">Diff</th>
                  <th className="text-right px-4 py-3 font-medium">Print B</th>
                </tr>
              </thead>
              <tbody>
                <Row label="Filename" vL={left.filename} vR={right.filename} fmt={v => v ? v.replace(/\.gcode$/i, '') : '—'} />
                <Row label="Status" vL={left.status} vR={right.status} fmt={v => v || '—'} />
                <Row label="Material" vL={left.filament_type} vR={right.filament_type} />
                <Row label="Est. Duration" vL={left.estimated_duration_seconds} vR={right.estimated_duration_seconds} fmt={fmt} />
                <Row label="Actual Duration" vL={left.actual_duration_seconds} vR={right.actual_duration_seconds} fmt={fmt} />
                <Row label="Filament (est)" vL={left.estimated_filament_g} vR={right.estimated_filament_g} unit=" g" />
                <Row label="Filament (used)" vL={left.filament_used_g} vR={right.filament_used_g} unit=" g" />
                <Row label="Filament Length" vL={left.filament_length_mm} vR={right.filament_length_mm} fmt={v => v ? `${(v / 1000).toFixed(1)} m` : '—'} />
                <Row label="Power Used" vL={left.total_power_kwh} vR={right.total_power_kwh} unit=" kWh" />
                <Row label="Elec. Cost" vL={left.electricity_cost} vR={right.electricity_cost} fmt={v => v != null ? `$${v.toFixed(2)}` : '—'} />
                <Row label="Filament Cost" vL={left.filament_cost} vR={right.filament_cost} fmt={v => v != null ? `$${v.toFixed(2)}` : '—'} />
                <tr className="border-t-2 border-surface-700 bg-surface-800/20">
                  <td className="px-4 py-3 text-xs text-surface-400 font-bold">TOTAL COST</td>
                  <td className="px-4 py-3 text-right text-white font-bold">${((left.electricity_cost || 0) + (left.filament_cost || 0)).toFixed(2)}</td>
                  <td className="px-4 py-3 text-center text-xs text-surface-500">—</td>
                  <td className="px-4 py-3 text-right text-white font-bold">${((right.electricity_cost || 0) + (right.filament_cost || 0)).toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

export default Compare