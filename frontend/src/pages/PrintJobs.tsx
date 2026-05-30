import React, { useEffect, useState, useCallback } from 'react'
import { fetchJobsPaginated, fetchSlotUsage, getThumbnailUrl, type PaginatedJobs } from '../api'

type SlotUsage = {
  slot_id: string
  tray_id: string
  material_name: string | null
  color_hex: string | null
  filament_used_mm: number | null
  filament_used_g: number | null
  started_at: string | null
  ended_at: string | null
}

const statusConfig: Record<string, { badge: string; label: string }> = {
  PRINTING: { badge: 'badge-info', label: 'Printing' },
  COMPLETE: { badge: 'badge-success', label: 'Complete' },
  CANCELLED: { badge: 'badge-warning', label: 'Cancelled' },
  FAILED: { badge: 'badge-danger', label: 'Failed' },
}

const formatDuration = (seconds: number | null | undefined): string => {
  if (!seconds || seconds <= 0) return '—'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

const formatTime = (iso: string | null): string => {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' +
    d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

const durationVariance = (actual: number | null, estimated: number | null): { text: string; color: string } | null => {
  if (!actual || !estimated || estimated === 0) return null
  const pct = ((actual - estimated) / estimated) * 100
  const sign = pct > 0 ? '+' : ''
  const color = Math.abs(pct) <= 10 ? 'text-emerald-400' : Math.abs(pct) <= 25 ? 'text-amber-400' : 'text-rose-400'
  return { text: `${sign}${pct.toFixed(0)}%`, color }
}

type SortField = 'start_time' | 'filename' | 'status' | 'actual_duration_seconds' | 'estimated_duration_seconds' | 'electricity_cost' | 'filament_cost' | 'total_cost' | 'filament_used_g'

const PrintJobs: React.FC = () => {
  const [data, setData] = useState<PaginatedJobs | null>(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<SortField>('start_time')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [expandedJob, setExpandedJob] = useState<number | null>(null)
  const [slotUsages, setSlotUsages] = useState<Record<number, SlotUsage[]>>({})
  const perPage = 25

  const toggleExpand = async (jobId: number) => {
    if (expandedJob === jobId) {
      setExpandedJob(null)
    } else {
      setExpandedJob(jobId)
      if (!slotUsages[jobId]) {
        try {
          const data = await fetchSlotUsage(jobId)
          setSlotUsages(prev => ({ ...prev, [jobId]: data }))
        } catch { /* ignore */ }
      }
    }
  }

  const colorFromHex = (hex: string | null): string => {
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

  const loadData = useCallback(async () => {
    try {
      const result = await fetchJobsPaginated({
        page,
        per_page: perPage,
        status: statusFilter || undefined,
        search: search || undefined,
        sort_by: sortBy,
        sort_order: sortOrder,
      })
      setData(result)
    } catch (e) {
      console.error('Failed to load jobs:', e)
    } finally {
      setLoading(false)
    }
  }, [page, statusFilter, search, sortBy, sortOrder])

  useEffect(() => { loadData() }, [loadData])

  const handleSort = (field: SortField) => {
    if (sortBy === field) {
      setSortOrder(o => o === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(field)
      setSortOrder('desc')
    }
    setPage(1)
  }

  const sortIcon = (field: SortField) => {
    if (sortBy !== field) return 'text-surface-600'
    return sortOrder === 'asc' ? 'text-accent-400' : 'text-accent-400'
  }

  const totalCost = (data?.items || []).reduce((s, j) => s + (j.electricity_cost || 0) + (j.filament_cost || 0), 0)

  const tabs = [
    { key: '', label: 'All' },
    { key: 'PRINTING', label: 'Printing' },
    { key: 'COMPLETE', label: 'Complete' },
    { key: 'CANCELLED', label: 'Cancelled' },
    { key: 'FAILED', label: 'Failed' },
  ]

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-6 h-6 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Print Jobs</h1>
          <p className="text-sm text-surface-400 mt-1">
            {data?.total || 0} total · Page {page} of {data?.total_pages || 1}
            {totalCost > 0 && <span className="ml-2 text-amber-400">${totalCost.toFixed(2)} this page</span>}
          </p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex gap-1 bg-surface-800 rounded-lg p-1">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => { setStatusFilter(t.key); setPage(1) }}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                statusFilter === t.key ? 'bg-accent-600 text-white' : 'text-surface-400 hover:text-surface-200'
              }`}
            >{t.label}</button>
          ))}
        </div>
        <div className="relative">
          <svg className="w-4 h-4 text-surface-500 absolute left-3 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
            placeholder="Search filename or material..."
            className="pl-9 pr-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-sm text-surface-200 placeholder-surface-500 focus:outline-none focus:border-accent-500 w-64"
          />
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-800/30 text-xs text-surface-400 uppercase tracking-wider">
                <th className="px-4 py-3 font-medium w-12">Preview</th>
                <th className="text-left px-4 py-3 font-medium cursor-pointer hover:text-surface-200" onClick={() => handleSort('filename')}>
                  <span className="flex items-center gap-1">File <span className={sortIcon('filename')}>{sortBy === 'filename' ? (sortOrder === 'asc' ? '↑' : '↓') : '↕'}</span></span>
                </th>
                <th className="text-left px-4 py-3 font-medium cursor-pointer hover:text-surface-200" onClick={() => handleSort('status')}>
                  <span className="flex items-center gap-1">Status <span className={sortIcon('status')}>{sortBy === 'status' ? (sortOrder === 'asc' ? '↑' : '↓') : '↕'}</span></span>
                </th>
                <th className="text-left px-4 py-3 font-medium cursor-pointer hover:text-surface-200" onClick={() => handleSort('filament_used_g')}>
                  <span className="flex items-center gap-1">Material <span className={sortIcon('filament_used_g')}>{sortBy === 'filament_used_g' ? (sortOrder === 'asc' ? '↑' : '↓') : '↕'}</span></span>
                </th>
                <th className="text-left px-4 py-3 font-medium cursor-pointer hover:text-surface-200" onClick={() => handleSort('start_time')}>
                  <span className="flex items-center gap-1">Started <span className={sortIcon('start_time')}>{sortBy === 'start_time' ? (sortOrder === 'asc' ? '↑' : '↓') : '↕'}</span></span>
                </th>
                <th className="text-left px-4 py-3 font-medium cursor-pointer hover:text-surface-200" onClick={() => handleSort('estimated_duration_seconds')}>
                  <span className="flex items-center gap-1">Est. <span className={sortIcon('estimated_duration_seconds')}>{sortBy === 'estimated_duration_seconds' ? (sortOrder === 'asc' ? '↑' : '↓') : '↕'}</span></span>
                </th>
                <th className="text-left px-4 py-3 font-medium cursor-pointer hover:text-surface-200" onClick={() => handleSort('actual_duration_seconds')}>
                  <span className="flex items-center gap-1">Actual <span className={sortIcon('actual_duration_seconds')}>{sortBy === 'actual_duration_seconds' ? (sortOrder === 'asc' ? '↑' : '↓') : '↕'}</span></span>
                </th>
                <th className="text-left px-4 py-3 font-medium">Variance</th>
                <th className="text-right px-4 py-3 font-medium cursor-pointer hover:text-surface-200" onClick={() => handleSort('filament_used_g')}>
                  <span className="flex items-center justify-end gap-1">Filament <span className={sortIcon('filament_used_g')}>{sortBy === 'filament_used_g' ? (sortOrder === 'asc' ? '↑' : '↓') : '↕'}</span></span>
                </th>
                <th className="text-right px-4 py-3 font-medium cursor-pointer hover:text-surface-200" onClick={() => handleSort('electricity_cost')}>
                  <span className="flex items-center justify-end gap-1">Elec $ <span className={sortIcon('electricity_cost')}>{sortBy === 'electricity_cost' ? (sortOrder === 'asc' ? '↑' : '↓') : '↕'}</span></span>
                </th>
                <th className="text-right px-4 py-3 font-medium cursor-pointer hover:text-surface-200" onClick={() => handleSort('filament_cost')}>
                  <span className="flex items-center justify-end gap-1">Fil. $ <span className={sortIcon('filament_cost')}>{sortBy === 'filament_cost' ? (sortOrder === 'asc' ? '↑' : '↓') : '↕'}</span></span>
                </th>
                <th className="text-right px-4 py-3 font-medium cursor-pointer hover:text-surface-200" onClick={() => handleSort('total_cost')}>
                  <span className="flex items-center justify-end gap-1">Total <span className={sortIcon('total_cost')}>{sortBy === 'total_cost' ? (sortOrder === 'asc' ? '↑' : '↓') : '↕'}</span></span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data?.items.map(job => {
                const variance = durationVariance(job.actual_duration_seconds, job.estimated_duration_seconds)
                const isExpanded = expandedJob === job.id
                return (
                  <React.Fragment key={job.id}>
                    <tr
                      className={`border-t border-surface-700/20 hover:bg-surface-800/30 transition-colors cursor-pointer ${isExpanded ? 'bg-surface-800/20' : ''}`}
                      onClick={() => toggleExpand(job.id)}
                    >
                      <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
                        <img
                          src={job.thumbnail_path || getThumbnailUrl(job.filename)}
                          alt=""
                          className="w-10 h-10 object-contain rounded bg-surface-800 border border-surface-700"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                          loading="lazy"
                        />
                      </td>
                      <td className="px-4 py-3 text-surface-200 font-medium max-w-[200px] truncate" title={job.filename}>
                        {job.filename.replace(/\.gcode$/i, '')}
                      </td>
                      <td className="px-4 py-3">
                        <span className={statusConfig[job.status]?.badge || 'badge-neutral'}>
                          {statusConfig[job.status]?.label || job.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-surface-400 text-xs">
                        {job.filament_type || '—'}
                      </td>
                      <td className="px-4 py-3 text-surface-400 text-xs whitespace-nowrap">
                        {formatTime(job.start_time)}
                      </td>
                      <td className="px-4 py-3 text-surface-300 whitespace-nowrap">
                        {formatDuration(job.estimated_duration_seconds)}
                      </td>
                      <td className="px-4 py-3 text-surface-200 font-medium whitespace-nowrap">
                        {formatDuration(job.actual_duration_seconds)}
                      </td>
                      <td className="px-4 py-3 text-xs whitespace-nowrap">
                        {variance ? <span className={variance.color}>{variance.text}</span> : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-surface-300 whitespace-nowrap">
                        {job.filament_used_g ? `${job.filament_used_g.toFixed(0)} g` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-amber-400 whitespace-nowrap">
                        {job.electricity_cost ? `$${job.electricity_cost.toFixed(2)}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-violet-400 whitespace-nowrap">
                        {job.filament_cost ? `$${job.filament_cost.toFixed(2)}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-surface-200 font-medium whitespace-nowrap">
                        {(job.electricity_cost || job.filament_cost)
                          ? `$${((job.electricity_cost || 0) + (job.filament_cost || 0)).toFixed(2)}`
                          : '—'}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-surface-900/50">
                        <td colSpan={12} className="px-6 py-4">
                          <div className="flex gap-4 mb-4">
                            <img
                              src={job.thumbnail_path || getThumbnailUrl(job.filename)}
                              alt="Print preview"
                              className="w-28 h-28 object-contain rounded-lg bg-surface-800 border border-surface-700 shrink-0"
                              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                            />
                            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 text-xs flex-1">
                              <div>
                                <span className="text-surface-500 block">Est. Filament</span>
                                <span className="text-surface-200">{job.estimated_filament_g ? `${job.estimated_filament_g.toFixed(0)} g` : '—'}</span>
                              </div>
                              <div>
                                <span className="text-surface-500 block">Filament Length</span>
                                <span className="text-surface-200">{job.filament_length_mm ? `${(job.filament_length_mm / 1000).toFixed(1)} m` : '—'}</span>
                              </div>
                              <div>
                                <span className="text-surface-500 block">Power Used</span>
                                <span className="text-surface-200">{job.total_power_kwh ? `${job.total_power_kwh.toFixed(3)} kWh` : '—'}</span>
                              </div>
                              <div>
                                <span className="text-surface-500 block">Started</span>
                                <span className="text-surface-200">{job.start_time ? new Date(job.start_time).toLocaleString() : '—'}</span>
                              </div>
                              <div>
                                <span className="text-surface-500 block">Ended</span>
                                <span className="text-surface-200">{job.end_time ? new Date(job.end_time).toLocaleString() : '—'}</span>
                              </div>
                              <div>
                                <span className="text-surface-500 block">Job ID</span>
                                <span className="text-surface-200">#{job.id}</span>
                              </div>
                            </div>
                          </div>
                          {slotUsages[job.id] && slotUsages[job.id].length > 0 && (
                            <div className="border-t border-surface-700/30 pt-3">
                              <p className="text-xs text-surface-400 font-medium mb-2">CFS Slot Usage</p>
                              <div className="flex flex-wrap gap-3">
                                {slotUsages[job.id].map((slot, si) => (
                                  <div key={si} className="flex items-center gap-2 bg-surface-800/50 rounded-lg px-3 py-2">
                                    <div className="w-3 h-3 rounded-full border border-surface-600 shrink-0" style={{ backgroundColor: colorFromHex(slot.color_hex) }} />
                                    <div>
                                      <p className="text-xs text-surface-200 font-medium">{slot.slot_id}</p>
                                      <p className="text-[10px] text-surface-500">{slot.material_name || '—'}</p>
                                    </div>
                                    <div className="ml-3 text-right">
                                      <p className="text-xs text-surface-200">{slot.filament_used_g ? `${slot.filament_used_g.toFixed(1)}g` : '—'}</p>
                                      <p className="text-[10px] text-surface-500">{slot.filament_used_mm ? `${(slot.filament_used_mm / 1000).toFixed(2)}m` : '—'}</p>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
              {data?.items.length === 0 && (
                <tr>
                  <td colSpan={12} className="px-4 py-12 text-center text-surface-500">
                    {search ? `No jobs matching "${search}"` : 'No print jobs found'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {data && data.total_pages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-surface-500">
            Showing {((page - 1) * perPage) + 1}–{Math.min(page * perPage, data.total)} of {data.total}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1.5 bg-surface-800 border border-surface-700 rounded-lg text-sm text-surface-300 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-surface-700 transition-colors"
            >Prev</button>
            {Array.from({ length: Math.min(data.total_pages, 7) }, (_, i) => {
              let pageNum: number
              if (data.total_pages <= 7) {
                pageNum = i + 1
              } else if (page <= 4) {
                pageNum = i + 1
              } else if (page >= data.total_pages - 3) {
                pageNum = data.total_pages - 6 + i
              } else {
                pageNum = page - 3 + i
              }
              return (
                <button
                  key={pageNum}
                  onClick={() => setPage(pageNum)}
                  className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                    pageNum === page
                      ? 'bg-accent-600 text-white'
                      : 'bg-surface-800 border border-surface-700 text-surface-400 hover:text-surface-200'
                  }`}
                >{pageNum}</button>
              )
            })}
            <button
              onClick={() => setPage(p => Math.min(data.total_pages, p + 1))}
              disabled={page >= data.total_pages}
              className="px-3 py-1.5 bg-surface-800 border border-surface-700 rounded-lg text-sm text-surface-300 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-surface-700 transition-colors"
            >Next</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default PrintJobs