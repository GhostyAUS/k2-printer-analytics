import React, { useEffect, useState } from 'react'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js'
import { Line, Bar, Doughnut, Scatter } from 'react-chartjs-2'
import { fetchJobs, fetchSummary, fetchSlicerAccuracy, fetchMonthlyTrend, getExportCsvUrl } from '../api'
import type { PrintJob } from '../types'

ChartJS.register(
  CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement,
  Title, Tooltip, Legend, Filler,
)

const COLORS = [
  '#60a5fa', '#34d399', '#f472b6', '#fbbf24', '#a78bfa',
  '#fb923c', '#2dd4bf', '#f87171', '#c084fc', '#4ade80',
]

const formatDuration = (s: number | null | undefined): string => {
  if (!s || s <= 0) return '—'
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

const fmtDiff = (seconds: number | null | undefined): string => {
  if (seconds === null || seconds === undefined) return '—'
  const sign = seconds >= 0 ? '+' : '-'
  const abs = Math.abs(seconds)
  const h = Math.floor(abs / 3600)
  const m = Math.floor((abs % 3600) / 60)
  const s = Math.floor(abs % 60)
  if (h > 0) return `${sign}${h}h ${m}m`
  if (m > 0) return `${sign}${m}m ${s}s`
  return `${sign}${s}s`
}

type SortKey = 'filename' | 'actual_duration_seconds' | 'filament_used_g' | 'electricity_cost' | 'filament_cost' | 'total_cost'

const Analytics: React.FC = () => {
  const [jobs, setJobs] = useState<PrintJob[]>([])
  const [loading, setLoading] = useState(true)
  const [sortKey, setSortKey] = useState<SortKey>('total_cost')
  const [sortAsc, setSortAsc] = useState(false)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [materialFilter, setMaterialFilter] = useState<string>('all')
  const [_summary, setSummary] = useState<any>(null)
  const [slicerAccuracy, setSlicerAccuracy] = useState<{ jobs: any[]; summary: any } | null>(null)
  const [monthlyTrend, setMonthlyTrend] = useState<any[]>([])

  useEffect(() => {
    fetchJobs()
      .then(setJobs)
      .catch(console.error)
      .finally(() => setLoading(false))
    fetchSummary().then(setSummary).catch(() => {})
    fetchSlicerAccuracy().then(setSlicerAccuracy).catch(() => {})
    fetchMonthlyTrend(6).then(setMonthlyTrend).catch(() => {})
  }, [])

  const completed = jobs.filter(j => j.status === 'COMPLETE')
  const cancelled = jobs.filter(j => j.status === 'CANCELLED')
  const failed = jobs.filter(j => j.status === 'FAILED')

  const totalElectricity = completed.reduce((s, j) => s + (j.electricity_cost || 0), 0)
  const totalFilamentCost = completed.reduce((s, j) => s + (j.filament_cost || 0), 0)
  const totalCost = totalElectricity + totalFilamentCost
  const totalFilamentG = completed.reduce((s, j) => s + (j.filament_used_g || 0), 0)
  const avgCost = completed.length > 0 ? totalCost / completed.length : 0
  const totalPrintHours = completed.reduce((s, j) => s + ((j.actual_duration_seconds || 0) / 3600), 0)
  const successRate = jobs.length > 0 ? ((completed.length / jobs.length) * 100).toFixed(1) : '—'

  const materials = [...new Set(jobs.map(j => j.filament_type || 'Unknown'))].sort()

  const filtered = jobs.filter(j => {
    if (statusFilter === 'complete' && j.status !== 'COMPLETE') return false
    if (statusFilter === 'cancelled' && j.status !== 'CANCELLED') return false
    if (statusFilter === 'failed' && j.status !== 'FAILED') return false
    if (materialFilter !== 'all' && (j.filament_type || 'Unknown') !== materialFilter) return false
    return true
  })

  const sorted = [...filtered].sort((a, b) => {
    const getVal = (j: PrintJob): number => {
      switch (sortKey) {
        case 'filename': return 0
        case 'actual_duration_seconds': return j.actual_duration_seconds || 0
        case 'filament_used_g': return j.filament_used_g || 0
        case 'electricity_cost': return j.electricity_cost || 0
        case 'filament_cost': return j.filament_cost || 0
        case 'total_cost': return (j.electricity_cost || 0) + (j.filament_cost || 0)
      }
    }
    const diff = getVal(a) - getVal(b)
    return sortAsc ? diff : -diff
  })

  if (sortKey === 'filename') {
    sorted.sort((a, b) => {
      const cmp = a.filename.localeCompare(b.filename)
      return sortAsc ? cmp : -cmp
    })
  }

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(a => !a)
    } else {
      setSortKey(key)
      setSortAsc(false)
    }
  }

  const sortIcon = (key: SortKey) => {
    if (sortKey !== key) return '↕'
    return sortAsc ? '↑' : '↓'
  }

  const dailyMap = new Map<string, { cost: number; filament: number; hours: number; count: number }>()
  const now = new Date()
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    dailyMap.set(key, { cost: 0, filament: 0, hours: 0, count: 0 })
  }
  completed.forEach(j => {
    if (j.end_time) {
      const key = new Date(j.end_time).toISOString().slice(0, 10)
      if (dailyMap.has(key)) {
        const e = dailyMap.get(key)!
        e.cost += (j.electricity_cost || 0) + (j.filament_cost || 0)
        e.filament += j.filament_used_g || 0
        e.hours += (j.actual_duration_seconds || 0) / 3600
        e.count += 1
      }
    }
  })
  const dailyLabels = [...dailyMap.keys()]
  const dailyCostData = dailyLabels.map(d => dailyMap.get(d)!.cost)

  const materialMap = new Map<string, number>()
  completed.forEach(j => {
    const mat = j.filament_type || 'Unknown'
    materialMap.set(mat, (materialMap.get(mat) || 0) + (j.filament_used_g || 0))
  })
  const materialLabels = [...materialMap.keys()]
  const materialData = materialLabels.map(m => Number(materialMap.get(m)!.toFixed(1)))

  const recentJobs = [...completed].sort((a, b) => new Date(b.end_time || 0).getTime() - new Date(a.end_time || 0).getTime()).slice(0, 20)
  const durationLabels = recentJobs.map(j => j.filename.length > 15 ? j.filename.slice(0, 15) + '…' : j.filename.replace(/\.gcode$/i, ''))
  const actualDurationData = recentJobs.map(j => (j.actual_duration_seconds || 0) / 3600)
  const estimatedDurationData = recentJobs.map(j => (j.estimated_duration_seconds || 0) / 3600)

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-6 h-6 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Analytics</h1>
        <div className="flex items-center justify-between mt-1">
          <p className="text-sm text-surface-400">{completed.length} completed · {cancelled.length} cancelled · {failed.length} failed</p>
          <a href={getExportCsvUrl()} download="k2_print_jobs.csv" className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-surface-700 hover:bg-surface-600 text-surface-300 text-xs rounded-lg transition-colors">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
            Export CSV
          </a>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
        <div className="card"><div className="card-body">
          <span className="stat-label">Total Prints</span>
          <p className="stat-value">{completed.length}</p>
        </div></div>
        <div className="card"><div className="card-body">
          <span className="stat-label">Total Cost</span>
          <p className="stat-value text-amber-400">${totalCost.toFixed(2)}</p>
        </div></div>
        <div className="card"><div className="card-body">
          <span className="stat-label">Filament Used</span>
          <p className="stat-value text-emerald-400">{(totalFilamentG / 1000).toFixed(2)} kg</p>
        </div></div>
        <div className="card"><div className="card-body">
          <span className="stat-label">Print Time</span>
          <p className="stat-value text-sky-400">{totalPrintHours.toFixed(0)} hrs</p>
        </div></div>
        <div className="card"><div className="card-body">
          <span className="stat-label">Avg Cost</span>
          <p className="stat-value text-violet-400">${avgCost.toFixed(2)}</p>
        </div></div>
        <div className="card"><div className="card-body">
          <span className="stat-label">Success Rate</span>
          <p className={`stat-value ${Number(successRate) >= 80 ? 'text-emerald-400' : 'text-rose-400'}`}>{successRate}%</p>
        </div></div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <div className="card-header">
            <h2 className="text-sm font-semibold text-white">Daily Cost (30 days)</h2>
          </div>
          <div className="card-body">
            <Line data={{
              labels: dailyLabels.map(d => d.slice(5)),
              datasets: [{
                label: 'Cost ($)',
                data: dailyCostData,
                borderColor: '#60a5fa',
                backgroundColor: 'rgba(96, 165, 250, 0.1)',
                fill: true,
                tension: 0.3,
                pointRadius: 2,
              }]
            }} options={{
              responsive: true,
              plugins: { legend: { display: false } },
              scales: {
                x: { ticks: { color: '#71717a', maxTicksLimit: 10 }, grid: { color: 'rgba(113, 113, 122, 0.1)' } },
                y: { ticks: { color: '#71717a', callback: v => '$' + v }, grid: { color: 'rgba(113, 113, 122, 0.1)' } },
              },
            }} />
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h2 className="text-sm font-semibold text-white">Material Usage (g)</h2>
          </div>
          <div className="card-body flex justify-center">
            <div className="w-64">
              <Doughnut data={{
                labels: materialLabels,
                datasets: [{
                  data: materialData,
                  backgroundColor: COLORS.slice(0, materialLabels.length),
                  borderWidth: 0,
                }]
              }} options={{
                responsive: true,
                plugins: {
                  legend: {
                    position: 'bottom',
                    labels: { color: '#a1a1aa', padding: 12, font: { size: 11 } },
                  },
                },
              }} />
            </div>
          </div>
        </div>

        <div className="card lg:col-span-2">
          <div className="card-header">
            <h2 className="text-sm font-semibold text-white">Duration: Actual vs Estimated (last 20)</h2>
          </div>
          <div className="card-body">
            <Bar data={{
              labels: durationLabels,
              datasets: [
                { label: 'Actual (hrs)', data: actualDurationData, backgroundColor: '#60a5fa', borderRadius: 3 },
                { label: 'Estimated (hrs)', data: estimatedDurationData, backgroundColor: '#34d399', borderRadius: 3 },
              ],
            }} options={{
              responsive: true,
              plugins: { legend: { labels: { color: '#a1a1aa', boxWidth: 12, padding: 12, font: { size: 11 } } } },
              scales: {
                x: { ticks: { color: '#71717a', font: { size: 9 } }, grid: { display: false } },
                y: { ticks: { color: '#71717a', callback: v => v + 'h' }, grid: { color: 'rgba(113, 113, 122, 0.1)' } },
              },
            }} />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Cost Breakdown</h2>
          <div className="flex items-center gap-3">
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="bg-surface-800 border border-surface-700 rounded px-2 py-1 text-xs text-surface-300 focus:outline-none focus:border-accent-500"
            >
              <option value="all">All Status</option>
              <option value="complete">Complete</option>
              <option value="cancelled">Cancelled</option>
              <option value="failed">Failed</option>
            </select>
            <select
              value={materialFilter}
              onChange={e => setMaterialFilter(e.target.value)}
              className="bg-surface-800 border border-surface-700 rounded px-2 py-1 text-xs text-surface-300 focus:outline-none focus:border-accent-500"
            >
              <option value="all">All Materials</option>
              {materials.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <span className="text-xs text-surface-500">{sorted.length} jobs</span>
          </div>
        </div>
        <div className="card-body p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-800/30 text-xs text-surface-400 uppercase tracking-wider">
                  <th className="text-left px-4 py-3 font-medium cursor-pointer hover:text-surface-200" onClick={() => handleSort('filename')}>
                    File {sortIcon('filename')}
                  </th>
                  <th className="text-left px-4 py-3 font-medium cursor-pointer hover:text-surface-200" onClick={() => handleSort('actual_duration_seconds')}>
                    Duration {sortIcon('actual_duration_seconds')}
                  </th>
                  <th className="text-right px-4 py-3 font-medium cursor-pointer hover:text-surface-200" onClick={() => handleSort('filament_used_g')}>
                    Filament {sortIcon('filament_used_g')}
                  </th>
                  <th className="text-right px-4 py-3 font-medium cursor-pointer hover:text-surface-200" onClick={() => handleSort('electricity_cost')}>
                    Elec. {sortIcon('electricity_cost')}
                  </th>
                  <th className="text-right px-4 py-3 font-medium cursor-pointer hover:text-surface-200" onClick={() => handleSort('filament_cost')}>
                    Filament $ {sortIcon('filament_cost')}
                  </th>
                  <th className="text-right px-4 py-3 font-medium cursor-pointer hover:text-surface-200" onClick={() => handleSort('total_cost')}>
                    Total {sortIcon('total_cost')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.slice(0, 50).map(job => (
                  <tr key={job.id} className="border-t border-surface-700/20 hover:bg-surface-800/30 transition-colors">
                    <td className="px-4 py-3 text-surface-200 max-w-[200px] truncate" title={job.filename}>{job.filename.replace(/\.gcode$/i, '')}</td>
                    <td className="px-4 py-3 text-surface-400">{formatDuration(job.actual_duration_seconds)}</td>
                    <td className="px-4 py-3 text-right text-surface-300">
                      {job.filament_used_g ? `${job.filament_used_g.toFixed(0)} g` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-amber-400">${(job.electricity_cost || 0).toFixed(2)}</td>
                    <td className="px-4 py-3 text-right text-violet-400">${(job.filament_cost || 0).toFixed(2)}</td>
                    <td className="px-4 py-3 text-right text-surface-200 font-medium">
                      ${((job.electricity_cost || 0) + (job.filament_cost || 0)).toFixed(2)}
                    </td>
                  </tr>
                ))}
                {sorted.length > 50 && (
                  <tr><td colSpan={6} className="px-4 py-3 text-center text-surface-500 text-xs">Showing top 50 of {sorted.length} results</td></tr>
                )}
                {sorted.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-12 text-center text-surface-500">No jobs match filters</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {monthlyTrend.length > 0 && (
        <div className="card">
          <div className="card-header"><h2 className="text-sm font-semibold text-white">Monthly Cost Trend</h2></div>
          <div className="card-body">
            <Bar data={{
              labels: monthlyTrend.map(m => m.month.slice(2)),
              datasets: [
                { label: 'Electricity', data: monthlyTrend.map(m => m.electricity_cost), backgroundColor: '#fbbf24', borderRadius: 3 },
                { label: 'Filament', data: monthlyTrend.map(m => m.filament_cost), backgroundColor: '#a78bfa', borderRadius: 3 },
              ],
            }} options={{
              responsive: true,
              plugins: { legend: { labels: { color: '#a1a1aa', boxWidth: 12, padding: 12, font: { size: 11 } } } },
              scales: {
                x: { stacked: true, ticks: { color: '#71717a' }, grid: { display: false } },
                y: { stacked: true, ticks: { color: '#71717a', callback: (v: any) => '$' + v }, grid: { color: 'rgba(113,113,122,0.1)' } },
              },
            }} />
          </div>
        </div>
      )}

      {slicerAccuracy && slicerAccuracy.jobs.length > 0 && (
        <div className="card">
          <div className="card-header flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Slicer Accuracy</h2>
            <div className="flex items-center gap-4 text-xs text-surface-400">
              <span>{slicerAccuracy.summary.count} jobs</span>
              <span>Avg diff: <span className="text-surface-200">{fmtDiff(slicerAccuracy.summary.avg_diff_seconds)}</span></span>
              <span>Median diff: <span className="text-surface-200">{fmtDiff(slicerAccuracy.summary.median_diff_seconds)}</span></span>
            </div>
          </div>
          <div className="card-body">
            <div className="h-64 relative">
              <Scatter data={{
                datasets: [{
                  label: 'Actual vs Estimated',
                  data: slicerAccuracy.jobs.map(j => ({ x: j.estimated_hours, y: j.actual_hours })),
                  backgroundColor: '#60a5fa',
                  pointRadius: 4,
                  pointHoverRadius: 6,
                }],
              }} options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx: any) => { const j = slicerAccuracy.jobs[ctx.dataIndex]; return `${j.filename.slice(0, 30)}: ${j.actual_hours}h actual / ${j.estimated_hours}h est (${j.diff_hms})` } } } },
                scales: {
                  x: { title: { display: true, text: 'Estimated (hrs)', color: '#71717a' }, ticks: { color: '#71717a' }, grid: { color: 'rgba(113,113,122,0.1)' } },
                  y: { title: { display: true, text: 'Actual (hrs)', color: '#71717a' }, ticks: { color: '#71717a' }, grid: { color: 'rgba(113,113,122,0.1)' } },
                },
              }} />
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-surface-700/50 text-xs text-surface-400">
                    <th className="text-left px-3 py-2 font-medium">#</th>
                    <th className="text-left px-3 py-2 font-medium">File</th>
                    <th className="text-right px-3 py-2 font-medium">Estimated</th>
                    <th className="text-right px-3 py-2 font-medium">Actual</th>
                    <th className="text-right px-3 py-2 font-medium">Difference</th>
                    <th className="text-left px-3 py-2 font-medium">Material</th>
                  </tr>
                </thead>
                <tbody>
                  {slicerAccuracy.jobs.slice(0, 20).map((j: any) => (
                    <tr key={j.id} className="border-b border-surface-700/20 hover:bg-surface-800/30 transition-colors">
                      <td className="px-3 py-2 text-surface-500 font-mono text-xs">{j.id}</td>
                      <td className="px-3 py-2 text-surface-200 max-w-[180px] truncate" title={j.filename}>{j.filename.replace(/\.gcode$/i, '')}</td>
                      <td className="px-3 py-2 text-right text-surface-400">{formatDuration(j.estimated_seconds)}</td>
                      <td className="px-3 py-2 text-right text-surface-400">{formatDuration(j.actual_seconds)}</td>
                      <td className={`px-3 py-2 text-right font-mono text-xs ${(j.diff_seconds || 0) >= 0 ? 'text-rose-400' : 'text-emerald-400'}`}>{j.diff_hms}</td>
                      <td className="px-3 py-2 text-surface-500 text-xs">{j.filament_type || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Analytics