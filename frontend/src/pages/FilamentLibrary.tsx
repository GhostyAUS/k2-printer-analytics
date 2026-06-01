import React, { useEffect, useState, useMemo } from 'react'
import { fetchFilamentRolls, createFilamentRolls, updateFilamentRoll, deleteFilamentRoll, weighFilamentRoll, fetchCfsState, fetchCfsSlotOverrides, upsertCfsOverride, resetCfsOverride, syncCfsToLibrary, fetchOFDBrands, fetchOFDMaterials, searchOFDFilaments } from '../api'
import type { FilamentRoll, CfsSlotOverride } from '../types'
import type { OFDFilamentResult } from '../api'

const MATERIALS = ['PLA', 'PLA+', 'PETG', 'ABS', 'ASA', 'TPU', 'NYLON', 'PC', 'HIPS', 'PVA', 'CUSTOM']
const MATERIAL_COLORS: Record<string, string> = {
  'PLA': '#4ade80', 'PLA+': '#22c55e', 'PETG': '#60a5fa', 'ABS': '#f97316',
  'ASA': '#fb923c', 'TPU': '#c084fc', 'NYLON': '#94a3b8', 'PC': '#e2e8f0',
  'HIPS': '#fbbf24', 'PVA': '#a3e635', 'CUSTOM': '#6b7280',
}

function formatGrams(g: number): string {
  if (g >= 1000) return Math.round(g).toString()
  if (g >= 100) return g.toFixed(1)
  if (g >= 10) return g.toFixed(2)
  return g.toFixed(3)
}

const MATERIAL_GRADIENTS: Record<string, string> = {
  PLA: 'from-emerald-500 to-emerald-700',
  'PLA+': 'from-emerald-400 to-emerald-600',
  PETG: 'from-blue-500 to-blue-700',
  ABS: 'from-orange-500 to-orange-700',
  ASA: 'from-orange-400 to-orange-600',
  TPU: 'from-purple-500 to-purple-700',
  NYLON: 'from-slate-400 to-slate-600',
  PC: 'from-slate-300 to-slate-400',
  HIPS: 'from-yellow-500 to-yellow-700',
  PVA: 'from-lime-400 to-lime-600',
  CUSTOM: 'from-surface-600 to-surface-800',
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

interface CfsSlotInfo {
  slot: string
  tray: string
  color_hex: string
  material: string
  remaining_pct: number
  remaining_weight_g: number
  total_weight_g: number
  cost_per_kg: number | null
  spool_weight_g: number | null
  rfid_vendor: string | null
  has_override: boolean
  roll_id: number | null
}

function pctRemaining(roll: FilamentRoll): number {
  if (!roll.total_weight_g) return 0
  return Math.min(Math.round((roll.remaining_weight_g / roll.total_weight_g) * 100), 100)
}

function pctColor(pct: number): string {
  if (pct > 50) return '#4ade80'
  if (pct > 20) return '#fbbf24'
  return '#ef4444'
}

function SlotStatusBadge({ state }: { state: string }) {
  if (state === 'feeding') return <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-sky-500/20 text-sky-400 uppercase tracking-wider animate-pulse" title="Currently feeding filament">Feeding</span>
  if (state === 'active') return <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-sky-500/10 text-sky-400 uppercase tracking-wider" title="Active slot, not currently extruding">Active</span>
  if (state === 'loading') return <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-400 uppercase tracking-wider animate-pulse" title="Loading filament">Loading</span>
  if (state === 'standby') return <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-surface-600/30 text-surface-400 uppercase tracking-wider" title="Standby — in CFS but not active">Standby</span>
  return null
}

function ProgressArc({ pct, size = 64, strokeWidth = 5 }: { pct: number; size?: number; strokeWidth?: number }) {
  const r = (size - strokeWidth) / 2
  const circ = 2 * Math.PI * r
  const offset = circ - (pct / 100) * circ
  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1e293b" strokeWidth={strokeWidth} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={pctColor(pct)} strokeWidth={strokeWidth}
        strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round" className="transition-all duration-500" />
    </svg>
  )
}

const FilamentLibrary: React.FC = () => {
  const [rolls, setRolls] = useState<FilamentRoll[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<FilamentRoll | null>(null)
  const [adding, setAdding] = useState(false)
  const [weighing, setWeighing] = useState<FilamentRoll | null>(null)
  const [materialFilter, setMaterialFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [view, setView] = useState<'grid' | 'table'>('grid')
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [cfsState, setCfsState] = useState<{ active_slot_id: string | null; feed_state: string; is_printing: boolean; slot_states: Record<string, string> }>({ active_slot_id: null, feed_state: 'idle', is_printing: false, slot_states: {} })
  const [overrides, setOverrides] = useState<CfsSlotOverride[]>([])
  const [syncing, setSyncing] = useState(false)
  const [editingSlot, setEditingSlot] = useState<CfsSlotInfo | null>(null)
  const [overrideForm, setOverrideForm] = useState<Record<string, string>>({})

  useEffect(() => {
    fetchFilamentRolls().then(setRolls).catch(console.error).finally(() => setLoading(false))
    fetchCfsState().then(setCfsState).catch(() => {})
    fetchCfsSlotOverrides().then(setOverrides).catch(() => {})
    const iv = setInterval(() => fetchCfsState().then(setCfsState).catch(() => {}), 15000)
    return () => clearInterval(iv)
  }, [])

  const activeSlots = useMemo(() => {
    return new Set(cfsState.active_slot_id ? [cfsState.active_slot_id] : [])
  }, [cfsState])

  const getSlotState = (spoolId: string | null): string | undefined => {
    if (!spoolId) return undefined
    const raw = cfsState.slot_states[spoolId]
    if (!raw || raw === 'idle' || raw === 'empty') return undefined
    if (raw === 'feeding') return 'feeding'
    if (raw === 'loading') return 'loading'
    if (cfsState.is_printing) return 'standby'
    return raw
  }

  const cfsSlots = useMemo((): CfsSlotInfo[] => {
    const overrideMap = new Map(overrides.map(o => [o.slot_id, o]))
    return rolls
      .filter(r => r.spool_id && /^T[1-4][A-D]$/.test(r.spool_id))
      .map(r => {
        const sid = r.spool_id!
        const ov = overrideMap.get(sid)
        const pctFromWeight = Math.min(100, Math.round((r.remaining_weight_g / (r.total_weight_g || 1000)) * 100))
        const rawPct = ov?.remaining_pct != null ? Math.round(ov.remaining_pct) : pctFromWeight
        return {
          slot: sid,
          tray: `T${sid[1]}`,
          color_hex: ov?.color_hex || r.color_hex || '',
          material: ov?.material_name || r.material,
          remaining_pct: Math.min(100, Math.max(0, rawPct)),
          remaining_weight_g: r.remaining_weight_g || 0,
          total_weight_g: r.total_weight_g || 0,
          cost_per_kg: ov?.cost_per_kg ?? r.cost_per_kg ?? null,
          spool_weight_g: ov?.spool_weight_g ?? r.spool_weight_g ?? null,
          rfid_vendor: r.rfid_vendor ?? null,
          has_override: !!ov,
          roll_id: r.id,
        } as CfsSlotInfo
      })
      .sort((a, b) => a.slot.localeCompare(b.slot))
  }, [rolls, overrides])

  const reload = async () => {
    const [r, o] = await Promise.all([fetchFilamentRolls(), fetchCfsSlotOverrides()])
    setRolls(r)
    setOverrides(o)
  }

  const handleSync = async () => {
    setSyncing(true)
    try {
      await syncCfsToLibrary()
      await reload()
    } catch { }
    setSyncing(false)
  }

  const openSlotEdit = (slot: CfsSlotInfo) => {
    setEditingSlot(slot)
    setOverrideForm({
      material_name: slot.material || '',
      color_hex: slot.color_hex || '',
      remaining_pct: String(slot.remaining_pct),
      cost_per_kg: slot.cost_per_kg ? String(slot.cost_per_kg) : '',
      spool_weight_g: slot.spool_weight_g ? String(slot.spool_weight_g) : '',
    })
  }

  const saveSlotOverride = async () => {
    if (!editingSlot) return
    const payload: Record<string, any> = {}
    if (overrideForm.material_name) payload.material_name = overrideForm.material_name
    if (overrideForm.color_hex) payload.color_hex = overrideForm.color_hex
    if (overrideForm.remaining_pct) payload.remaining_pct = parseFloat(overrideForm.remaining_pct)
    if (overrideForm.cost_per_kg) payload.cost_per_kg = parseFloat(overrideForm.cost_per_kg)
    if (overrideForm.spool_weight_g) payload.spool_weight_g = parseFloat(overrideForm.spool_weight_g)
    await upsertCfsOverride(editingSlot.slot, payload)
    setEditingSlot(null)
    reload()
  }

  const handleResetSlot = async (slotId: string) => {
    await resetCfsOverride(slotId)
    reload()
  }

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const selectAll = () => setSelectedIds(new Set(filtered.map(r => r.id)))
  const clearSelection = () => setSelectedIds(new Set())

  const handleDelete = async (id: number) => {
    try {
      await deleteFilamentRoll(id)
      setRolls(prev => prev.filter(r => r.id !== id))
      setSelectedIds(prev => { const n = new Set(prev); n.delete(id); return n })
    } catch (e) { console.error(e) }
  }

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return
    for (const id of selectedIds) {
      try { await deleteFilamentRoll(id) } catch (e) { console.error(e) }
    }
    setRolls(prev => prev.filter(r => !selectedIds.has(r.id)))
    setSelectedIds(new Set())
  }

  const filtered = useMemo(() => rolls
    .filter(r => {
      if (materialFilter !== 'all' && r.material !== materialFilter) return false
      if (search) {
        const s = search.toLowerCase()
        return (r.brand || '').toLowerCase().includes(s) ||
          r.material.toLowerCase().includes(s) ||
          (r.color_name || '').toLowerCase().includes(s) ||
          (r.location || '').toLowerCase().includes(s)
      }
      return true
    })
    .sort((a, b) => pctRemaining(b) - pctRemaining(a)), [rolls, materialFilter, search])

  const totalKg = rolls.reduce((s, r) => s + r.total_weight_g, 0) / 1000
  const remainingKg = rolls.reduce((s, r) => s + r.remaining_weight_g, 0) / 1000
  const totalSpent = rolls.reduce((s, r) => s + (r.cost_per_kg || 0) * r.total_weight_g / 1000, 0)
  const avgCostPerKg = totalKg > 0 ? totalSpent / totalKg : 0
  const uniqueMaterials = [...new Set(rolls.map(r => r.material))].sort()
  const lowStock = rolls.filter(r => pctRemaining(r) < 20).length

  const nonCfs = filtered.filter(r => !r.spool_id || !/^T\d[A-D]$/.test(r.spool_id))

  const cfsUnitSlots = useMemo(() => {
    const map = new Map<string, CfsSlotInfo[]>()
    for (const s of cfsSlots) {
      if (!map.has(s.tray)) map.set(s.tray, [])
      map.get(s.tray)!.push(s)
    }
    for (const slots of map.values()) slots.sort((a, b) => a.slot.localeCompare(b.slot))
    return map
  }, [cfsSlots])

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-6 h-6 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Filament Library</h1>
          <p className="text-sm text-surface-400 mt-1">{rolls.length} rolls &middot; {remainingKg.toFixed(1)} kg remaining</p>
        </div>
        <button onClick={() => { setAdding(true); setEditing(null) }}
          className="px-4 py-2 bg-accent-600 hover:bg-accent-500 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
          Add Spool
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="card"><div className="card-body py-3">
          <span className="text-[10px] uppercase tracking-wider text-surface-500">Total Rolls</span>
          <p className="text-xl font-bold text-white mt-1">{rolls.length}</p>
        </div></div>
        <div className="card"><div className="card-body py-3">
          <span className="text-[10px] uppercase tracking-wider text-surface-500">Total Stock</span>
          <p className="text-xl font-bold text-sky-400 mt-1">{totalKg.toFixed(1)} kg</p>
        </div></div>
        <div className="card"><div className="card-body py-3">
          <span className="text-[10px] uppercase tracking-wider text-surface-500">Remaining</span>
          <p className="text-xl font-bold text-emerald-400 mt-1">{remainingKg.toFixed(1)} kg</p>
        </div></div>
        <div className="card"><div className="card-body py-3">
          <span className="text-[10px] uppercase tracking-wider text-surface-500">Avg Cost</span>
          <p className="text-xl font-bold text-amber-400 mt-1">${avgCostPerKg.toFixed(2)}<span className="text-xs font-normal text-surface-500">/kg</span></p>
        </div></div>
        <div className="card"><div className="card-body py-3">
          <span className="text-[10px] uppercase tracking-wider text-surface-500">Low Stock</span>
          <p className={`text-xl font-bold mt-1 ${lowStock > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>{lowStock} <span className="text-xs font-normal text-surface-500">rolls</span></p>
        </div></div>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <select value={materialFilter} onChange={e => setMaterialFilter(e.target.value)}
            className="bg-surface-800 border border-surface-700 rounded-lg px-3 py-1.5 text-sm text-surface-300 focus:outline-none focus:border-accent-500">
            <option value="all">All Materials</option>
            {uniqueMaterials.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <div className="relative">
            <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-surface-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search spools..."
              className="bg-surface-800 border border-surface-700 rounded-lg pl-9 pr-3 py-1.5 text-sm text-surface-300 placeholder-surface-500 focus:outline-none focus:border-accent-500 w-48" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-1.5 bg-rose-900/30 border border-rose-700/40 rounded-lg px-2.5 py-1">
              <span className="text-xs text-rose-300 font-medium">{selectedIds.size} selected</span>
              <button onClick={handleBatchDelete}
                className="px-2 py-0.5 text-[11px] bg-rose-600 hover:bg-rose-500 text-white rounded transition-colors font-medium">Delete</button>
              <button onClick={clearSelection}
                className="px-2 py-0.5 text-[11px] text-surface-400 hover:text-surface-200 transition-colors">Clear</button>
            </div>
          )}
          <div className="flex items-center gap-1 bg-surface-800 rounded-lg p-0.5">
            <button onClick={() => setView('grid')}
              className={`p-1.5 rounded-md transition-colors ${view === 'grid' ? 'bg-surface-700 text-white' : 'text-surface-500 hover:text-surface-300'}`}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25a2.25 2.25 0 01-2.25-18v-2.25z" />
              </svg>
            </button>
            <button onClick={() => setView('table')}
              className={`p-1.5 rounded-md transition-colors ${view === 'table' ? 'bg-surface-700 text-white' : 'text-surface-500 hover:text-surface-300'}`}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h7.5c.621 0 1.125-.504 1.125-1.125m-9.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-7.5A1.125 1.125 0 0112 18.375m9.75-12.75c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125m17.25 0v1.5c0 .621-.504 1.125-1.125 1.125m0 0h-7.5m7.5 0h-7.5m0 0V7.5m0 0V5.625" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {weighing && (
        <WeighDialog
          roll={weighing}
          onWeigh={async (id, measuredG) => {
            const updated = await weighFilamentRoll(id, measuredG)
            setRolls(prev => prev.map(r => r.id === id ? updated : r))
            setWeighing(null)
          }}
          onClose={() => setWeighing(null)}
        />
      )}

      {(adding || editing) && (
        <SpoolForm
          roll={editing}
          onSave={async (data, quantity) => {
            if (editing) {
              const updated = await updateFilamentRoll(editing.id, data)
              setRolls(prev => prev.map(r => r.id === editing.id ? updated : r))
            } else {
              const { quantity: _, ...rollData } = data as any
              const rolls = await createFilamentRolls(rollData, quantity || 1)
              setRolls(prev => [...rolls, ...prev])
            }
            setAdding(false); setEditing(null)
          }}
          onCancel={() => { setAdding(false); setEditing(null) }}
          onDelete={editing ? async () => {
            await deleteFilamentRoll(editing.id)
            setRolls(prev => prev.filter(r => r.id !== editing.id))
            setEditing(null)
          } : undefined}
        />
      )}

      {cfsSlots.length > 0 && (
        <div className="card">
          <div className="card-header flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-white">CFS Units</h2>
              <span className="text-[10px] text-surface-500">{cfsSlots.length} slots</span>
              {cfsState.active_slot_id && (
                <div className="flex items-center gap-1.5 ml-2 px-2 py-0.5 bg-sky-900/30 border border-sky-500/20 rounded">
                  <div className={`w-1.5 h-1.5 rounded-full ${cfsState.feed_state === 'feeding' ? 'bg-emerald-400 animate-pulse' : 'bg-sky-400 animate-pulse'}`} />
                  <span className="text-[10px] text-sky-300 font-medium">{cfsState.active_slot_id}</span>
                  <span className="text-[10px] text-sky-400">{cfsState.feed_state}</span>
                </div>
              )}
            </div>
            <button onClick={handleSync} disabled={syncing}
              className="px-3 py-1.5 text-xs bg-surface-700 hover:bg-surface-600 text-surface-300 rounded-lg transition-colors disabled:opacity-50">
              {syncing ? 'Syncing...' : 'Sync CFS → Library'}
            </button>
          </div>
          <div className="card-body p-3 space-y-3">
            {[...cfsUnitSlots.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([unit, unitSlots]) => (
              <div key={unit}>
                <p className="text-[10px] text-surface-500 font-medium mb-1.5">CFS Unit {unit}</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {unitSlots.map(slot => {
                    const grad = MATERIAL_GRADIENTS[slot.material] || 'from-surface-600 to-surface-800'
                    const slotState = getSlotState(slot.slot)
                    const isActive = slotState === 'feeding' || slotState === 'active'
                    const isFeeding = slotState === 'feeding'
                    const isLoading = slotState === 'loading'
                    return (
                      <div key={slot.slot}
                        className={`card overflow-hidden group transition-all cursor-pointer ${
                          isActive ? 'border-sky-500/60 ring-1 ring-sky-500/30' :
                          isLoading ? 'border-amber-500/60 ring-1 ring-amber-500/30' :
                          'hover:border-accent-500/30'
                        }`}
                        onClick={() => openSlotEdit(slot)}>
                        <div className={`h-1.5 bg-gradient-to-r ${grad} ${isFeeding ? 'animate-pulse' : ''}`} />
                        <div className="p-2.5">
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center gap-1.5">
                              <div className={`w-4 h-4 rounded-full border-2 ${isActive ? 'border-sky-400 animate-pulse' : isLoading ? 'border-amber-400 animate-pulse' : 'border-surface-600'}`}
                                style={{ backgroundColor: colorFromHex(slot.color_hex) }} />
                              <span className="text-xs font-semibold text-white">{slot.slot}</span>
                            </div>
                            <div className="flex items-center gap-1">
                              {slot.has_override && (
                                <svg className="w-3 h-3 text-accent-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                              )}
                              {slot.rfid_vendor && (
                                <span className="px-1 py-0.5 rounded text-[8px] font-bold bg-emerald-900/60 text-emerald-300">RFID</span>
                              )}
                              {slotState && <SlotStatusBadge state={slotState} />}
                            </div>
                          </div>
                          <p className="text-[11px] text-surface-300 font-medium truncate">{slot.material}</p>
                          <div className="mt-1.5">
                            <div className="flex items-center justify-between text-[10px] text-surface-500 mb-0.5">
                              <span>Remaining</span>
                              <span>{slot.remaining_pct}%{slot.remaining_weight_g ? ` · ${formatGrams(slot.remaining_weight_g)}g` : ''}</span>
                            </div>
                            <div className="w-full bg-surface-700 rounded-full h-1">
                              <div className={`h-1 rounded-full transition-all bg-gradient-to-r ${grad} ${isFeeding ? 'animate-pulse' : ''}`}
                                style={{ width: `${slot.remaining_pct}%` }} />
                            </div>
                          </div>
                          {slot.cost_per_kg && (
                            <p className="text-[9px] text-accent-400 mt-1">${slot.cost_per_kg.toFixed(2)}/kg</p>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
            {cfsUnitSlots.size === 0 && (
              <p className="text-xs text-surface-500 py-2">No CFS slots synced — click Sync to pull data from the printer</p>
            )}
          </div>
        </div>
      )}

      {editingSlot && (
        <SlotOverrideModal
          slot={editingSlot}
          form={overrideForm}
          setForm={setOverrideForm}
          onSave={saveSlotOverride}
          onReset={() => { handleResetSlot(editingSlot.slot); setEditingSlot(null) }}
          onClose={() => setEditingSlot(null)}
        />
      )}

      {nonCfs.length > 0 && (
        <SectionHeader label="Spools in Stock" subtitle="Not in a CFS unit" count={nonCfs.length} />
      )}
      {nonCfs.length > 0 ? (
        view === 'grid' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {nonCfs.map(roll => (
              <SpoolCard key={roll.id} roll={roll} onEdit={() => { setEditing(roll); setAdding(false); setWeighing(null) }} onWeigh={() => { setWeighing(roll); setEditing(null); setAdding(false) }} onDelete={handleDelete} selected={selectedIds.has(roll.id)} onToggleSelect={toggleSelect} activeSlots={activeSlots} slotState={getSlotState(roll.spool_id)} />
            ))}
          </div>
        ) : (
          <SpoolTable rolls={nonCfs} onEdit={roll => { setEditing(roll); setAdding(false) }} onWeigh={roll => { setWeighing(roll); setEditing(null); setAdding(false) }} onDelete={handleDelete} selectedIds={selectedIds} onToggleSelect={toggleSelect} onSelectAll={selectAll} activeSlots={activeSlots} slotStates={cfsState.slot_states} />
        )
      ) : (
        nonCfs.length === 0 && cfsSlots.length === 0 && (
          <div className="text-center py-12 text-surface-500">
            <svg className="w-12 h-12 mx-auto mb-3 text-surface-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375" />
            </svg>
            No spools found
          </div>
        )
      )}
    </div>
  )
}

const SlotOverrideModal: React.FC<{
  slot: CfsSlotInfo
  form: Record<string, string>
  setForm: React.Dispatch<React.SetStateAction<Record<string, string>>>
  onSave: () => void
  onReset: () => void
  onClose: () => void
}> = ({ slot, form, setForm, onSave, onReset, onClose }) => (
  <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
    <div className="card w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
      <div className="card-header flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded-full border border-surface-600" style={{ backgroundColor: colorFromHex(slot.color_hex) }} />
          <h2 className="text-sm font-semibold text-white">Edit Slot {slot.slot}</h2>
        </div>
        <button onClick={onClose} className="text-surface-500 hover:text-white">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="card-body space-y-4">
        <div>
          <label className="block text-xs text-surface-400 mb-1">Material Name</label>
          <input className="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm text-white placeholder-surface-500 focus:outline-none focus:border-accent-500"
            value={form.material_name || ''} onChange={e => setForm(f => ({ ...f, material_name: e.target.value }))} placeholder={slot.material} />
        </div>
        <div>
          <label className="block text-xs text-surface-400 mb-1">Color</label>
          <div className="flex items-center gap-3">
            <input type="color" className="w-10 h-10 rounded-lg border border-surface-700 bg-transparent cursor-pointer"
              value={form.color_hex && form.color_hex.startsWith('#') ? form.color_hex : `#${(form.color_hex || slot.color_hex || '52525b').replace('#', '')}`}
              onChange={e => setForm(f => ({ ...f, color_hex: e.target.value }))} />
            <input className="flex-1 bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm text-white font-mono placeholder-surface-500 focus:outline-none focus:border-accent-500"
              value={form.color_hex || ''} onChange={e => setForm(f => ({ ...f, color_hex: e.target.value }))} placeholder={slot.color_hex} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-surface-400 mb-1">Remaining %</label>
            <input type="number" min="0" max="100"
              className="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent-500"
              value={form.remaining_pct || ''} onChange={e => setForm(f => ({ ...f, remaining_pct: e.target.value }))} />
          </div>
          <div>
            <label className="block text-xs text-surface-400 mb-1">Spool Weight (g)</label>
            <input type="number" min="0"
              className="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent-500"
              value={form.spool_weight_g || ''} onChange={e => setForm(f => ({ ...f, spool_weight_g: e.target.value }))} placeholder="e.g. 1000" />
          </div>
        </div>
        <div>
          <label className="block text-xs text-surface-400 mb-1">Cost per kg ($)</label>
          <input type="number" min="0" step="0.01"
            className="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent-500"
            value={form.cost_per_kg || ''} onChange={e => setForm(f => ({ ...f, cost_per_kg: e.target.value }))} placeholder="e.g. 25.00" />
        </div>
        <div className="flex gap-3 pt-2">
          <button onClick={onSave} className="flex-1 px-4 py-2 bg-accent-600 hover:bg-accent-500 text-white text-sm rounded-lg transition-colors">Save Override</button>
          <button onClick={onReset} className="flex-1 px-4 py-2 bg-surface-700 hover:bg-rose-600/20 text-surface-400 hover:text-rose-400 border border-surface-600 hover:border-rose-600/30 text-sm rounded-lg transition-colors">Reset to CFS</button>
        </div>
      </div>
    </div>
  </div>
)

const SpoolCard = React.memo<{ roll: FilamentRoll; onEdit: () => void; onWeigh: () => void; onDelete: (id: number) => void; selected?: boolean; onToggleSelect?: (id: number) => void; activeSlots?: Set<string>; slotState?: string }>(({ roll, onEdit, onWeigh, onDelete, selected, onToggleSelect, activeSlots, slotState }) => {
  const pct = pctRemaining(roll)
  const matColor = MATERIAL_COLORS[roll.material] || '#6b7280'
  const [confirmDelete, setConfirmDelete] = useState(false)
  const isActive = activeSlots && roll.spool_id ? activeSlots.has(roll.spool_id) : false

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirmDelete) { setConfirmDelete(true); return }
    onDelete(roll.id)
  }

  useEffect(() => {
    if (!confirmDelete) return
    const t = setTimeout(() => setConfirmDelete(false), 3000)
    return () => clearTimeout(t)
  }, [confirmDelete])

  return (
    <div className={`card group hover:border-surface-600 transition-all ${isActive ? 'ring-1 ring-sky-500/40 border-sky-500/30' : ''}`}>
      <div className="card-body p-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2 cursor-pointer" onClick={onEdit}>
            {onToggleSelect && (
              <input type="checkbox" checked={!!selected} onChange={e => { e.stopPropagation(); onToggleSelect(roll.id) }}
                onClick={e => e.stopPropagation()} className="shrink-0 accent-accent-500 opacity-0 group-hover:opacity-100 transition-opacity" />
            )}
            <div className="relative">
              <ProgressArc pct={pct} size={56} strokeWidth={4} />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-xs font-bold" style={{ color: pctColor(pct) }}>{pct}%</span>
              </div>
            </div>
            <div>
              <p className="text-sm font-medium text-white leading-tight">{roll.brand || 'Unknown'}</p>
              <p className="text-xs text-surface-400 mt-0.5">{roll.color_name || '—'}</p>
              <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ backgroundColor: matColor + '20', color: matColor }}>
                {roll.material}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={handleDelete}
              className={`p-1 rounded transition-colors ${confirmDelete ? 'bg-rose-600 text-white' : 'opacity-0 group-hover:opacity-100 text-surface-500 hover:text-rose-400'}`}
              title={confirmDelete ? 'Click again to confirm delete' : 'Delete spool'}>
              {confirmDelete ? (
                <span className="text-[10px] font-bold px-1">Delete?</span>
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                </svg>
              )}
            </button>
            <div className="w-8 h-8 rounded-lg border border-surface-700" style={{ backgroundColor: roll.color_hex || '#666' }} />
            {roll.runout_detected && (
              <span className="px-1 py-0.5 rounded text-[9px] font-bold bg-red-900/60 text-red-300 uppercase tracking-wider" title="Runout detected by filament sensor">R/O</span>
            )}
            {roll.rfid_vendor && (
              <span className="px-1 py-0.5 rounded text-[9px] font-bold bg-emerald-900/60 text-emerald-300" title="RFID tag detected">RFID</span>
            )}
            {slotState && <SlotStatusBadge state={slotState} />}
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <div className="flex justify-between">
            <span className="text-surface-500">Remaining</span>
            <span className="text-surface-200 font-medium">{formatGrams(roll.remaining_weight_g)}g</span>
          </div>
          <div className="flex justify-between">
            <span className="text-surface-500">Total</span>
            <span className="text-surface-300">{(roll.total_weight_g / 1000).toFixed(2)} kg</span>
          </div>
          {roll.cost_per_kg && (
            <div className="flex justify-between">
              <span className="text-surface-500">Cost</span>
              <span className="text-amber-400 font-medium">${roll.cost_per_kg.toFixed(2)}/kg</span>
            </div>
          )}
          {(roll.location || roll.spool_id) && (
            <div className="flex justify-between">
              <span className="text-surface-500">Location</span>
              <span className="text-surface-300">{roll.location || roll.spool_id || '—'}</span>
            </div>
          )}
        </div>

        <div className="mt-2 w-full bg-surface-800 rounded-full h-1.5">
          <div className="h-1.5 rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: pctColor(pct) }} />
        </div>

        <div className="mt-2 flex gap-1.5">
          <button onClick={onEdit} className="flex-1 px-2 py-1 text-xs bg-surface-700 hover:bg-surface-600 text-surface-300 rounded transition-colors">Edit</button>
          <button onClick={onWeigh} className="flex-1 px-2 py-1 text-xs bg-sky-900/40 hover:bg-sky-800/60 text-sky-300 rounded transition-colors flex items-center justify-center gap-1">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v17.25m0 0c-1.472 0-2.882.265-4.185.75M12 20.25c1.472 0 2.882.265 4.185.75M18.75 4.97A48.416 48.416 0 0012 4.5c-2.291 0-4.545.16-6.75.47m13.5 0c1.01.143 2.01.317 3 .52m-3-.52l2.62 10.726c.122.499-.106 1.028-.589 1.202a5.988 5.988 0 01-2.031.352 5.988 5.988 0 01-2.031-.352c-.483-.174-.711-.703-.59-1.202L18.75 4.971zm-16.5.52c.99-.203 1.99-.377 3-.52m0 0l2.62 10.726c.122.499-.106 1.028-.589 1.202a5.989 5.989 0 01-2.031.352 5.989 5.989 0 01-2.031-.352c-.483-.174-.711-.703-.59-1.202L5.25 4.971z" />
            </svg>
            Weigh
          </button>
        </div>
      </div>
    </div>
  )
})

const FilamentPicker: React.FC<{ onSelect: (f: OFDFilamentResult) => void }> = ({ onSelect }) => {
  const [results, setResults] = useState<OFDFilamentResult[]>([])
  const [brands, setBrands] = useState<{ id: string; name: string }[]>([])
  const [materials, setMaterials] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedBrand, setSelectedBrand] = useState('')
  const [selectedMaterial, setSelectedMaterial] = useState('')
  const [hasSearched, setHasSearched] = useState(false)

  useEffect(() => {
    fetchOFDBrands().then(setBrands).catch(() => {})
    fetchOFDMaterials().then(setMaterials).catch(() => {})
  }, [])

  useEffect(() => {
    if (!search && !selectedBrand && !selectedMaterial) {
      setResults([])
      setHasSearched(false)
      return
    }
    setHasSearched(true)
    const t = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await searchOFDFilaments({
          brand_id: selectedBrand || undefined,
          material: selectedMaterial || undefined,
          search: search || undefined,
          limit: 50,
        })
        setResults(res)
      } catch { setResults([]) }
      finally { setLoading(false) }
    }, 300)
    return () => clearTimeout(t)
  }, [search, selectedBrand, selectedMaterial])

  const clearFilters = () => {
    setSearch('')
    setSelectedBrand('')
    setSelectedMaterial('')
  }

  const activeFilters = [search, selectedBrand, selectedMaterial].filter(Boolean)

  return (
    <div className="mb-4 p-3 bg-surface-900/80 border border-surface-700 rounded-lg">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-accent-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <span className="text-xs font-medium text-surface-300">Open Filament Database</span>
          {loading && <div className="w-3 h-3 border border-accent-500 border-t-transparent rounded-full animate-spin" />}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-surface-500">{brands.length} brands · {materials.length} materials</span>
          {activeFilters.length > 0 && (
            <button onClick={clearFilters} className="text-[10px] text-surface-500 hover:text-surface-300 transition-colors">Clear all</button>
          )}
        </div>
      </div>
      <div className="flex gap-2 mb-2">
        <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder='e.g. "Silk", "Matte", "Galaxy"...'
          className="flex-1 bg-surface-800 border border-surface-700 rounded px-2 py-1.5 text-sm text-surface-200 placeholder-surface-500 focus:outline-none focus:border-accent-500" />
        <select value={selectedBrand} onChange={e => setSelectedBrand(e.target.value)}
          className="bg-surface-800 border border-surface-700 rounded px-2 py-1.5 text-sm text-surface-300 focus:outline-none focus:border-accent-500 max-w-[180px]">
          <option value="">All Brands</option>
          {brands.slice(0, 150).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <select value={selectedMaterial} onChange={e => setSelectedMaterial(e.target.value)}
          className="bg-surface-800 border border-surface-700 rounded px-2 py-1.5 text-sm text-surface-300 focus:outline-none focus:border-accent-500">
          <option value="">All Materials</option>
          {materials.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
        </select>
      </div>
      {results.length > 0 && (
        <div className="max-h-56 overflow-y-auto space-y-0.5">
          {results.map((f, i) => (
            <button key={`${f.variant_id}-${f.size_id}-${i}`} onClick={() => onSelect(f)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-surface-700 transition-colors text-left">
              {f.color_hex && <div className="w-4 h-4 rounded-sm shrink-0 border border-surface-600" style={{ backgroundColor: f.color_hex }} />}
              <span className="text-xs text-surface-200 font-medium truncate">{f.brand}</span>
              <span className="text-xs text-surface-400 truncate">{f.filament_name}</span>
              {f.variant_name && <span className="text-[10px] text-surface-400 truncate">{f.variant_name}</span>}
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-700 text-surface-400 shrink-0">{f.material}</span>
              {f.filament_weight && <span className="text-[10px] text-surface-500 shrink-0">{f.filament_weight}g</span>}
              {f.min_print_temperature && f.max_print_temperature && <span className="text-[10px] text-surface-500 shrink-0">{f.min_print_temperature}–{f.max_print_temperature}°C</span>}
            </button>
          ))}
        </div>
      )}
      {hasSearched && !loading && results.length === 0 && (
        <p className="text-xs text-surface-500 py-2">No filaments found — try adjusting filters</p>
      )}
      {!hasSearched && (
        <p className="text-xs text-surface-500 py-2">Select a brand, material, or type a keyword to search the OFD catalog</p>
      )}
    </div>
  )
}

const WeighDialog: React.FC<{
  roll: FilamentRoll
  onWeigh: (id: number, measuredG: number) => Promise<void>
  onClose: () => void
}> = ({ roll, onWeigh, onClose }) => {
  const [measuredG, setMeasuredG] = useState('')
  const [saving, setSaving] = useState(false)

  const tare = roll.spool_weight_g || 0
  const measured = parseFloat(measuredG) || 0
  const remaining = Math.max(0, measured - tare)
  const pct = roll.total_weight_g > 0 ? Math.min(100, Math.round((remaining / roll.total_weight_g) * 100)) : 0

  return (
    <div className="card border border-sky-600/30">
      <div className="card-header flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          <svg className="w-4 h-4 text-sky-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v17.25m0 0c-1.472 0-2.882.265-4.185.75M12 20.25c1.472 0 2.882.265 4.185.75M18.75 4.97A48.416 48.416 0 0012 4.5c-2.291 0-4.545.16-6.75.47m13.5 0c1.01.143 2.01.317 3 .52m-3-.52l2.62 10.726c.122.499-.106 1.028-.589 1.202a5.988 5.988 0 01-2.031.352 5.988 5.988 0 01-2.031-.352c-.483-.174-.711-.703-.59-1.202L18.75 4.971zm-16.5.52c.99-.203 1.99-.377 3-.52m0 0l2.62 10.726c.122.499-.106 1.028-.589 1.202a5.989 5.989 0 01-2.031.352 5.989 5.989 0 01-2.031-.352c-.483-.174-.711-.703-.59-1.202L5.25 4.971z" />
          </svg>
          Weigh Spool
        </h2>
        <button onClick={onClose} className="text-surface-500 hover:text-surface-300 text-xs">Close</button>
      </div>
      <div className="card-body space-y-3">
        <p className="text-xs text-surface-400">
          {roll.brand} {roll.color_name || ''} — {roll.material}
        </p>
        <div className="grid grid-cols-3 gap-3 text-xs">
          <div className="bg-surface-800 rounded-lg p-2 text-center">
            <div className="text-surface-500 mb-0.5">Tare (spool)</div>
            <div className="text-white font-medium">{tare > 0 ? `${tare}g` : 'Not set'}</div>
          </div>
          <div className="bg-surface-800 rounded-lg p-2 text-center">
            <div className="text-surface-500 mb-0.5">Measured</div>
            <div className="text-sky-300 font-medium">{measuredG ? `${measured}g` : '—'}</div>
          </div>
          <div className="bg-surface-800 rounded-lg p-2 text-center">
            <div className="text-surface-500 mb-0.5">Remaining</div>
            <div className={`font-medium`} style={{ color: pctColor(pct) }}>
              {measuredG ? `${remaining.toFixed(1)}g (${pct}%)` : '—'}
            </div>
          </div>
        </div>
        {tare === 0 && (
          <p className="text-[10px] text-amber-400">No tare weight set — edit the spool to set the empty spool weight for accurate readings</p>
        )}
        <div>
          <label className="text-xs text-surface-500 block mb-1">Scale reading (g) — filament + spool on scale</label>
          <input type="number" value={measuredG} onChange={e => setMeasuredG(e.target.value)} placeholder="e.g. 845"
            className="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm text-surface-200 placeholder-surface-500 focus:outline-none focus:border-sky-500" />
        </div>
        <div className="flex gap-2">
          <button onClick={async () => {
            if (!measuredG || measured <= 0) return
            setSaving(true)
            await onWeigh(roll.id, measured)
            setSaving(false)
          }} disabled={saving || !measuredG || measured <= 0}
            className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white text-sm rounded-lg transition-colors disabled:opacity-50">
            {saving ? 'Saving...' : 'Update Remaining'}
          </button>
          <button onClick={onClose} className="px-4 py-2 bg-surface-700 hover:bg-surface-600 text-surface-300 text-sm rounded-lg transition-colors">Cancel</button>
        </div>
      </div>
    </div>
  )
}

const LOCATION_OPTIONS = ['', 'CFS1', 'CFS2', 'CFS3', 'CFS4', 'Shelf A', 'Shelf B', 'Dehumidifier', 'Storage box'] as const
const CFS_SLOTS_1 = ['', 'T1A', 'T1B', 'T1C', 'T1D'] as const
const CFS_SLOTS_2 = ['', 'T2A', 'T2B', 'T2C', 'T2D'] as const
const CFS_SLOTS_3 = ['', 'T3A', 'T3B', 'T3C', 'T3D'] as const
const CFS_SLOTS_4 = ['', 'T4A', 'T4B', 'T4C', 'T4D'] as const

function cfsSlotsForUnit(unit: string) {
  if (unit === 'CFS1') return CFS_SLOTS_1
  if (unit === 'CFS2') return CFS_SLOTS_2
  if (unit === 'CFS3') return CFS_SLOTS_3
  if (unit === 'CFS4') return CFS_SLOTS_4
  return CFS_SLOTS_1
}

function cfsUnitForSlot(slot: string): string | null {
  const m = slot.match(/^T(\d)[A-D]$/)
  return m ? `CFS${m[1]}` : null
}

const SpoolForm: React.FC<{
  roll: FilamentRoll | null
  onSave: (data: Partial<FilamentRoll>, quantity?: number) => Promise<void>
  onCancel: () => void
  onDelete?: () => Promise<void>
}> = ({ roll, onSave, onCancel, onDelete }) => {
  const [form, setForm] = useState({
    brand: roll?.brand || '',
    material: roll?.material || 'PLA',
    color_name: roll?.color_name || '',
    color_hex: roll?.color_hex || '#ffffff',
    total_weight_g: roll?.total_weight_g || 1000,
    spool_weight_g: roll?.spool_weight_g || 0,
    remaining_weight_g: roll?.remaining_weight_g || 1000,
    cost_per_kg: roll?.cost_per_kg || 24.0,
    location: roll?.location || '',
    notes: roll?.notes || '',
    spool_id: roll?.spool_id || '',
    quantity: 1,
  })
  const [saving, setSaving] = useState(false)
  const [showPicker, setShowPicker] = useState(false)

  const slotUnit = form.spool_id ? cfsUnitForSlot(form.spool_id) : null
  const initLoc = slotUnit ?? (form.location || '')
  const [selectedLocation, setSelectedLocation] = useState(initLoc)
  const [selectedSlot, setSelectedSlot] = useState(
    slotUnit ? form.spool_id || '' : ''
  )

  useEffect(() => {
    if (selectedLocation === 'CFS1' || selectedLocation === 'CFS2' || selectedLocation === 'CFS3' || selectedLocation === 'CFS4') {
      setForm(p => ({
        ...p,
        location: selectedSlot ? `CFS ${selectedSlot}` : '',
        spool_id: selectedSlot,
      }))
    } else if (selectedLocation) {
      setForm(p => ({ ...p, location: selectedLocation, spool_id: '' }))
    } else {
      setForm(p => ({ ...p, location: '', spool_id: '' }))
    }
  }, [selectedLocation, selectedSlot])

  const applyFilament = (f: OFDFilamentResult) => {
    const hex = f.color_hex || undefined
    setForm(p => ({
      ...p,
      brand: f.brand,
      material: f.material.toUpperCase().replace(/[^A-Z0-9+]/g, '') || p.material,
      color_name: f.variant_name || f.filament_name || p.color_name,
      color_hex: hex || p.color_hex,
      total_weight_g: f.filament_weight || 1000,
      remaining_weight_g: f.filament_weight || 1000,
    }))
    setShowPicker(false)
  }

  return (
    <div className="card border border-accent-600/30">
      <div className="card-header flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">{roll ? 'Edit Spool' : 'Add New Spool'}</h2>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowPicker(!showPicker)}
            className={`px-2.5 py-1 text-xs rounded-md transition-colors flex items-center gap-1 ${showPicker ? 'bg-accent-600 text-white' : 'bg-surface-700 hover:bg-surface-600 text-surface-300'}`}>
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            OFD
          </button>
          <div className="w-6 h-6 rounded border border-surface-600" style={{ backgroundColor: form.color_hex }} />
          <input type="color" value={form.color_hex} onChange={e => setForm(p => ({ ...p, color_hex: e.target.value }))}
            className="w-6 h-6 bg-transparent border-0 cursor-pointer rounded" />
        </div>
      </div>
      <div className="card-body">
        {showPicker && <FilamentPicker onSelect={applyFilament} />}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Input label="Brand" value={form.brand} onChange={v => setForm(p => ({ ...p, brand: v }))} />
          <div>
            <label className="text-xs text-surface-500 block mb-1">Material</label>
            <select value={form.material} onChange={e => setForm(p => ({ ...p, material: e.target.value }))}
              className="w-full bg-surface-800 border border-surface-700 rounded px-2 py-1.5 text-sm text-surface-200 focus:outline-none focus:border-accent-500">
              {MATERIALS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <Input label="Color Name" value={form.color_name} onChange={v => setForm(p => ({ ...p, color_name: v }))} />
          <Input label="Total Weight (g)" type="number" value={String(form.total_weight_g)} onChange={v => setForm(p => ({ ...p, total_weight_g: Number(v) }))} />
          <Input label="Empty Spool / Tare (g)" type="number" value={String(form.spool_weight_g)} onChange={v => setForm(p => ({ ...p, spool_weight_g: Number(v) }))} />
          <Input label="Remaining (g)" type="number" value={String(form.remaining_weight_g)} onChange={v => setForm(p => ({ ...p, remaining_weight_g: Number(v) }))} />
          <Input label="Cost/kg ($)" type="number" value={String(form.cost_per_kg)} onChange={v => setForm(p => ({ ...p, cost_per_kg: Number(v) }))} />
          <div className="col-span-2">
            <label className="text-xs text-surface-500 block mb-1">Location</label>
            <select value={selectedLocation} onChange={e => { setSelectedLocation(e.target.value); setSelectedSlot('') }}
              className="w-full bg-surface-800 border border-surface-700 rounded px-2 py-1.5 text-sm text-surface-200 focus:outline-none focus:border-accent-500">
              <option value="">No Location</option>
              {LOCATION_OPTIONS.filter(o => o).map(o => <option key={o} value={o}>{o}</option>)}
            </select>
            {(selectedLocation.startsWith('CFS')) && (
              <select value={selectedSlot} onChange={e => setSelectedSlot(e.target.value)}
                className="w-full bg-surface-800 border border-surface-700 rounded px-2 py-1.5 text-sm text-surface-200 focus:outline-none focus:border-accent-500 mt-1.5">
                <option value="">Select slot…</option>
                {cfsSlotsForUnit(selectedLocation).filter(s => s).map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            )}
          </div>
          {!roll && (
            <Input label="Quantity" type="number" value={String(form.quantity)} onChange={v => setForm(p => ({ ...p, quantity: Math.max(1, parseInt(v) || 1) }))} />
          )}
        </div>
        <div className="mt-3">
          <Input label="Notes" value={form.notes || ''} onChange={v => setForm(p => ({ ...p, notes: v }))} />
        </div>
        <div className="flex gap-2 mt-4">
          <button onClick={async () => { setSaving(true); await onSave(form, roll ? undefined : form.quantity); }} disabled={saving}
            className="px-4 py-2 bg-accent-600 hover:bg-accent-500 text-white text-sm rounded-lg transition-colors disabled:opacity-50">
            {saving ? 'Saving...' : (roll ? 'Save' : (form.quantity > 1 ? `Add ${form.quantity} Spools` : 'Add Spool'))}
          </button>
          <button onClick={onCancel} className="px-4 py-2 bg-surface-700 hover:bg-surface-600 text-surface-300 text-sm rounded-lg transition-colors">Cancel</button>
          {onDelete && (
            <button onClick={onDelete} className="px-4 py-2 bg-rose-600/20 hover:bg-rose-600 text-rose-300 text-sm rounded-lg transition-colors ml-auto">Delete</button>
          )}
        </div>
      </div>
    </div>
  )
}



const Input: React.FC<{ label: string; value: string; onChange: (v: string) => void; type?: string }> = ({ label, value, onChange, type = 'text' }) => (
  <div>
    <label className="text-xs text-surface-500 block mb-1">{label}</label>
    <input type={type} value={value} onChange={e => onChange(e.target.value)}
      className="w-full bg-surface-800 border border-surface-700 rounded-lg px-2 py-1.5 text-sm text-surface-200 focus:outline-none focus:border-accent-500" />
  </div>
)

const SectionHeader: React.FC<{ label: string; subtitle: string; count: number }> = ({ label, subtitle, count }) => (
  <div className="flex items-center gap-3 pt-2">
    <div className="flex items-center gap-2">
      <h2 className="text-sm font-semibold text-white">{label}</h2>
      <span className="text-[10px] text-surface-500">{subtitle}</span>
    </div>
    <div className="flex-1 h-px bg-surface-700/50" />
    <span className="text-[10px] text-surface-500 bg-surface-800 px-2 py-0.5 rounded-full">{count}</span>
  </div>
)

const SpoolTable: React.FC<{
  rolls: FilamentRoll[]
  onEdit: (roll: FilamentRoll) => void
  onWeigh: (roll: FilamentRoll) => void
  onDelete: (id: number) => void
  selectedIds: Set<number>
  onToggleSelect: (id: number) => void
  onSelectAll: () => void
  activeSlots?: Set<string>
  slotStates?: Record<string, string>
}> = ({ rolls, onEdit, onWeigh, onDelete, selectedIds, onToggleSelect, onSelectAll, activeSlots, slotStates }) => {
  const [deleting, setDeleting] = useState<number | null>(null)
  const allSelected = rolls.length > 0 && rolls.every(r => selectedIds.has(r.id))

  useEffect(() => {
    if (deleting === null) return
    const t = setTimeout(() => setDeleting(null), 3000)
    return () => clearTimeout(t)
  }, [deleting])

  return (
    <div className="card">
      <div className="card-body p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-700/50 text-xs text-surface-400 uppercase tracking-wider">
                <th className="px-4 py-3 w-8">
                  <input type="checkbox" checked={allSelected} onChange={onSelectAll} className="accent-accent-500" />
                </th>
                <th className="text-left px-4 py-3 font-medium">Spool</th>
                <th className="text-left px-4 py-3 font-medium">Material</th>
                <th className="text-right px-4 py-3 font-medium">Remaining</th>
                <th className="text-right px-4 py-3 font-medium">Cost/kg</th>
                <th className="text-left px-4 py-3 font-medium">Location</th>
                <th className="text-right px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {rolls.map(roll => (
                <tr key={roll.id} className={`border-b border-surface-700/20 transition-colors cursor-pointer ${selectedIds.has(roll.id) ? 'bg-accent-900/20' : 'hover:bg-surface-800/30'} ${activeSlots && roll.spool_id && activeSlots.has(roll.spool_id) ? 'bg-sky-900/20' : ''}`} onClick={() => onEdit(roll)}>
                  <td className="px-4 py-3">
                    <input type="checkbox" checked={selectedIds.has(roll.id)} onChange={() => onToggleSelect(roll.id)}
                      onClick={e => e.stopPropagation()} className="accent-accent-500" />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 rounded-full border border-surface-600 shrink-0" style={{ backgroundColor: roll.color_hex || '#666' }} />
                      <span className="text-surface-200">{roll.brand || 'Unknown'} — {roll.color_name || '—'}</span>
                      {roll.runout_detected && <span className="px-1 py-0.5 rounded text-[9px] font-bold bg-red-900/60 text-red-300" title="Runout detected">R/O</span>}
                      {roll.rfid_vendor && <span className="px-1 py-0.5 rounded text-[9px] font-bold bg-emerald-900/60 text-emerald-300" title="RFID tag">RFID</span>}
                      {roll.spool_id && slotStates?.[roll.spool_id] && <SlotStatusBadge state={slotStates[roll.spool_id]} />}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-block px-2 py-0.5 rounded text-[10px] font-medium" style={{ backgroundColor: (MATERIAL_COLORS[roll.material] || '#6b7280') + '20', color: MATERIAL_COLORS[roll.material] || '#6b7280' }}>
                      {roll.material}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-surface-200">{formatGrams(roll.remaining_weight_g)}g</span>
                    <span className="text-surface-500 text-xs ml-1">({pctRemaining(roll)}%)</span>
                  </td>
                  <td className="px-4 py-3 text-right text-surface-300">{roll.cost_per_kg ? `$${roll.cost_per_kg.toFixed(2)}` : '—'}</td>
                  <td className="px-4 py-3 text-surface-400">{roll.location || '—'}{roll.spool_id ? ` / ${roll.spool_id}` : ''}</td>
                  <td className="px-4 py-3 text-right flex gap-1 justify-end">
                    <button onClick={e => { e.stopPropagation(); onWeigh(roll) }} className="px-2 py-1 text-xs bg-sky-900/40 hover:bg-sky-800/60 text-sky-300 rounded transition-colors">Weigh</button>
                    <button onClick={e => { e.stopPropagation(); onEdit(roll) }} className="px-2 py-1 text-xs bg-surface-700 hover:bg-surface-600 text-surface-300 rounded transition-colors">Edit</button>
                    <button onClick={e => {
                      e.stopPropagation()
                      if (deleting === roll.id) { onDelete(roll.id); setDeleting(null) }
                      else setDeleting(roll.id)
                    }}
                      className={`px-2 py-1 text-xs rounded transition-colors ${deleting === roll.id ? 'bg-rose-600 text-white' : 'bg-surface-700 hover:bg-surface-600 text-surface-300'}`}>
                      {deleting === roll.id ? 'Delete?' : 'Delete'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default FilamentLibrary