import React, { useEffect, useState } from 'react'
import api from '../api'

type Period = 'daily' | 'weekly' | 'monthly'

interface ReportData {
  period: string
  label: string
  start: string
  end: string
  summary: { total_jobs: number; completed: number; failed: number; cancelled: number; printing: number; success_rate: number }
  filament: { total_g: number; total_kg: number; avg_per_print_g: number; by_type: Record<string, number>; total_cost: number }
  power: { total_kwh: number; total_cost: number; avg_per_print_kwh: number }
  time: { total_hours: number; avg_per_print_hours: number; avg_per_print_minutes: number }
  cost: { total: number; electricity: number; filament: number; avg_per_print: number }
  jobs: { id: number; filename: string; status: string; duration_hours: number; filament_g: number; filament_type: string | null; total_cost: number }[]
}

interface SeriesPoint {
  label: string
  start: string
  total_jobs: number
  completed: number
  failed: number
  cancelled: number
  filament_g: number
  filament_kg: number
  hours: number
  cost: number
  electricity_cost: number
  filament_cost: number
}

const Reports: React.FC = () => {
  const [period, setPeriod] = useState<Period>('weekly')
  const [offset, setOffset] = useState(0)
  const [report, setReport] = useState<ReportData | null>(null)
  const [series, setSeries] = useState<SeriesPoint[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      api.get('/api/v1/analytics/report', { params: { period, offset } }),
      api.get('/api/v1/analytics/report/series', { params: { period, count: period === 'daily' ? 14 : period === 'weekly' ? 8 : 6 } }),
    ]).then(([r, s]) => {
      setReport(r.data)
      setSeries(s.data)
    }).catch(console.error)
    .finally(() => setLoading(false))
  }, [period, offset])

  const maxBar = (key: keyof SeriesPoint) => Math.max(...series.map(s => s[key] as number), 1)

  const statusBg = (s: string) => {
    switch (s) {
      case 'COMPLETE': return 'bg-emerald-600/20 text-emerald-400'
      case 'FAILED': return 'bg-rose-600/20 text-rose-400'
      case 'CANCELLED': return 'bg-amber-600/20 text-amber-400'
      case 'PRINTING': return 'bg-sky-600/20 text-sky-400'
      default: return 'bg-surface-700/50 text-surface-400'
    }
  }

  if (loading && !report) {
    return <div className="space-y-6"><h1 className="text-2xl font-bold text-white">Reports</h1><p className="text-surface-400">Loading...</p></div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Reports</h1>
          <p className="text-sm text-surface-400 mt-1">Daily, weekly, and monthly print analytics</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-surface-800 rounded-lg p-0.5 border border-surface-700">
            {(['daily', 'weekly', 'monthly'] as Period[]).map(p => (
              <button key={p} onClick={() => { setPeriod(p); setOffset(0) }}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${period === p ? 'bg-accent-600 text-white' : 'text-surface-400 hover:text-surface-200'}`}>
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            ))}
          </div>
          <button onClick={() => setOffset(Math.max(0, offset - 1))} disabled={offset === 0}
            className="px-2 py-1.5 bg-surface-800 border border-surface-700 rounded-lg text-surface-400 hover:text-white disabled:opacity-30 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
          </button>
          <span className="text-sm text-white font-medium min-w-[140px] text-center">{report?.label || '—'}</span>
          <button onClick={() => setOffset(offset + 1)}
            className="px-2 py-1.5 bg-surface-800 border border-surface-700 rounded-lg text-surface-400 hover:text-white transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
          </button>
        </div>
      </div>

      {report && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
            <StatBox label="Total Jobs" value={String(report.summary.total_jobs)} sub={`${report.summary.completed} completed, ${report.summary.failed} failed, ${report.summary.cancelled} cancelled`} color="text-white" />
            <StatBox label="Success Rate" value={`${report.summary.success_rate}%`} sub={`${report.summary.completed} of ${report.summary.total_jobs}`} color="text-emerald-400" />
            <StatBox label="Filament Used" value={`${report.filament.total_kg} kg`} sub={`${report.filament.total_g.toFixed(0)}g · avg ${report.filament.avg_per_print_g.toFixed(0)}g/print`} color="text-violet-400" />
            <StatBox label="Print Time" value={`${report.time.total_hours}h`} sub={`avg ${report.time.avg_per_print_minutes.toFixed(0)}min/print`} color="text-sky-400" />
            <StatBox label="Total Cost" value={`$${report.cost.total.toFixed(2)}`} sub={`$${report.cost.electricity.toFixed(2)} power + $${report.cost.filament.toFixed(2)} filament`} color="text-amber-400" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="card">
              <div className="card-header"><h3 className="text-sm font-semibold text-white">Jobs Over Time</h3></div>
              <div className="card-body">
                <div className="space-y-2">
                  {series.map((s, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <span className="text-xs text-surface-500 w-12 text-right flex-shrink-0">{s.label}</span>
                      <div className="flex-1 flex gap-0.5 h-6">
                        <div className="bg-emerald-600 rounded-l-sm" style={{ width: `${(s.completed / maxBar('completed')) * 100}%`, minWidth: s.completed > 0 ? '2px' : '0' }} title={`${s.completed} completed`} />
                        <div className="bg-rose-600" style={{ width: `${(s.failed / maxBar('total_jobs')) * 100}%`, minWidth: s.failed > 0 ? '2px' : '0' }} title={`${s.failed} failed`} />
                        <div className="bg-amber-600 rounded-r-sm" style={{ width: `${(s.cancelled / maxBar('total_jobs')) * 100}%`, minWidth: s.cancelled > 0 ? '2px' : '0' }} title={`${s.cancelled} cancelled`} />
                      </div>
                      <span className="text-xs text-surface-400 w-8 flex-shrink-0">{s.total_jobs}</span>
                    </div>
                  ))}
                </div>
                <div className="flex gap-4 mt-3">
                  <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-sm bg-emerald-600" /><span className="text-[10px] text-surface-500">Completed</span></div>
                  <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-sm bg-rose-600" /><span className="text-[10px] text-surface-500">Failed</span></div>
                  <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-sm bg-amber-600" /><span className="text-[10px] text-surface-500">Cancelled</span></div>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-header"><h3 className="text-sm font-semibold text-white">Filament & Cost Over Time</h3></div>
              <div className="card-body">
                <div className="space-y-2">
                  {series.map((s, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <span className="text-xs text-surface-500 w-12 text-right flex-shrink-0">{s.label}</span>
                      <div className="flex-1 h-6 flex flex-col justify-center">
                        <div className="h-3 bg-surface-800 rounded-full overflow-hidden mb-0.5">
                          <div className="h-full bg-violet-600 rounded-full" style={{ width: `${(s.filament_g / maxBar('filament_g')) * 100}%`, minWidth: s.filament_g > 0 ? '2px' : '0' }} />
                        </div>
                        <div className="h-3 bg-surface-800 rounded-full overflow-hidden">
                          <div className="h-full bg-amber-600 rounded-full" style={{ width: `${(s.cost / maxBar('cost')) * 100}%`, minWidth: s.cost > 0 ? '2px' : '0' }} />
                        </div>
                      </div>
                      <span className="text-[10px] text-surface-500 w-20 flex-shrink-0 text-right">{s.filament_kg}kg · ${s.cost.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
                <div className="flex gap-4 mt-3">
                  <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-sm bg-violet-600" /><span className="text-[10px] text-surface-500">Filament (kg)</span></div>
                  <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-sm bg-amber-600" /><span className="text-[10px] text-surface-500">Cost ($)</span></div>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-header"><h3 className="text-sm font-semibold text-white">Print Hours Over Time</h3></div>
              <div className="card-body">
                <div className="space-y-2">
                  {series.map((s, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <span className="text-xs text-surface-500 w-12 text-right flex-shrink-0">{s.label}</span>
                      <div className="flex-1 h-6 bg-surface-800 rounded-full overflow-hidden flex items-center">
                        <div className="h-full bg-sky-600 rounded-full" style={{ width: `${(s.hours / maxBar('hours')) * 100}%`, minWidth: s.hours > 0 ? '2px' : '0' }} />
                      </div>
                      <span className="text-xs text-surface-400 w-10 flex-shrink-0 text-right">{s.hours}h</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-header"><h3 className="text-sm font-semibold text-white">Power Cost Over Time</h3></div>
              <div className="card-body">
                <div className="space-y-2">
                  {series.map((s, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <span className="text-xs text-surface-500 w-12 text-right flex-shrink-0">{s.label}</span>
                      <div className="flex-1 h-6 bg-surface-800 rounded-full overflow-hidden flex items-center">
                        <div className="h-full bg-emerald-600 rounded-full" style={{ width: `${(s.electricity_cost / maxBar('electricity_cost')) * 100}%`, minWidth: s.electricity_cost > 0 ? '2px' : '0' }} />
                      </div>
                      <span className="text-xs text-surface-400 w-12 flex-shrink-0 text-right">${s.electricity_cost.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {Object.keys(report.filament.by_type).length > 0 && (
            <div className="card">
              <div className="card-header"><h3 className="text-sm font-semibold text-white">Filament by Type</h3></div>
              <div className="card-body">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {Object.entries(report.filament.by_type).map(([type, grams]) => (
                    <div key={type} className="bg-surface-800/50 rounded-lg px-4 py-3 border border-surface-700/30">
                      <p className="text-sm font-medium text-white">{type}</p>
                      <p className="text-lg font-bold text-violet-400">{(grams / 1000).toFixed(2)} kg</p>
                      <p className="text-xs text-surface-500">{grams.toFixed(0)}g</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="card">
            <div className="card-header"><h3 className="text-sm font-semibold text-white">Job Details</h3><span className="text-xs text-surface-500">{report.summary.total_jobs} jobs</span></div>
            <div className="card-body p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-surface-700/50 text-xs text-surface-400">
                      <th className="text-left px-4 py-3 font-medium">#</th>
                      <th className="text-left px-4 py-3 font-medium">Filename</th>
                      <th className="text-center px-4 py-3 font-medium">Status</th>
                      <th className="text-right px-4 py-3 font-medium">Duration</th>
                      <th className="text-right px-4 py-3 font-medium">Filament</th>
                      <th className="text-right px-4 py-3 font-medium">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.jobs.map(j => (
                      <tr key={j.id} className="border-b border-surface-700/20 hover:bg-surface-800/30 transition-colors">
                        <td className="px-4 py-2.5 text-surface-400 font-mono text-xs">{j.id}</td>
                        <td className="px-4 py-2.5 text-surface-200 max-w-[200px] truncate" title={j.filename}>{j.filename}</td>
                        <td className="px-4 py-2.5 text-center"><span className={`inline-flex px-2 py-0.5 text-[10px] font-medium rounded-full ${statusBg(j.status)}`}>{j.status}</span></td>
                        <td className="px-4 py-2.5 text-right text-surface-400">{j.duration_hours > 0 ? `${j.duration_hours.toFixed(1)}h` : '—'}</td>
                        <td className="px-4 py-2.5 text-right text-surface-400">{j.filament_g > 0 ? `${j.filament_g.toFixed(0)}g` : '—'}</td>
                        <td className="px-4 py-2.5 text-right text-surface-400">{j.total_cost > 0 ? `$${j.total_cost.toFixed(2)}` : '—'}</td>
                      </tr>
                    ))}
                    {report.jobs.length === 0 && (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-surface-500">No jobs in this period</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

const StatBox: React.FC<{ label: string; value: string; sub: string; color: string }> = ({ label, value, sub, color }) => (
  <div className="card">
    <div className="card-body">
      <p className="stat-label mb-2">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p className="text-[10px] text-surface-500 mt-1 leading-relaxed">{sub}</p>
    </div>
  </div>
)

export default Reports
