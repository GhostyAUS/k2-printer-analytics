import React, { useEffect, useState, useCallback } from 'react'
import { fetchCfsSlots, fetchSpools, upsertCfsOverride, resetCfsOverride } from '../api'
import type { CfsSlot, Spool } from '../types'

const colorFromHex = (hex: string): string => {
  if (!hex || hex === '-1' || hex.length < 6) return '#52525b'
  const rgb = hex.replace('0x', '').replace('#', '')
  const r = parseInt(rgb.substring(0, 2), 16)
  const g = parseInt(rgb.substring(2, 4), 16)
  const b = parseInt(rgb.substring(4, 6), 16)
  if (isNaN(r) || isNaN(g) || isNaN(b)) return '#52525b'
  return `rgb(${r}, ${g}, ${b})`
}

const materialGradients: Record<string, string> = {
  PLA: 'from-emerald-500 to-emerald-700',
  'PLA+': 'from-emerald-400 to-emerald-600',
  'PLA Matte': 'from-teal-500 to-teal-700',
  'PLA Silk': 'from-cyan-500 to-cyan-700',
  'PLA White': 'from-slate-300 to-slate-400',
  'PLA Blue': 'from-blue-500 to-blue-700',
  'PLA+ Green': 'from-green-500 to-green-700',
  'PLA Black': 'from-zinc-600 to-zinc-800',
  'PLA Orange': 'from-orange-500 to-orange-700',
  PETG: 'from-purple-500 to-purple-700',
  ABS: 'from-red-500 to-red-700',
}

const defaultColors = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899',
  '#78716c', '#a8a29e', '#64748b', '#475569',
]

const Spools: React.FC = () => {
  const [slots, setSlots] = useState<CfsSlot[]>([])
  const [spools, setSpools] = useState<Spool[]>([])
  const [loading, setLoading] = useState(true)
  const [editingSlot, setEditingSlot] = useState<CfsSlot | null>(null)
  const [form, setForm] = useState<Record<string, string>>({})

  const load = useCallback(() => {
    Promise.all([fetchCfsSlots(), fetchSpools()])
      .then(([cfs, spoolData]) => {
        setSlots(cfs.slots)
        setSpools(spoolData)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const openEdit = (slot: CfsSlot) => {
    setEditingSlot(slot)
    setForm({
      material_name: slot.material_name || '',
      color_hex: slot.color_hex || '',
      remaining_pct: String(slot.remaining_pct),
      cost_per_kg: slot.cost_per_kg ? String(slot.cost_per_kg) : '',
      spool_weight_g: slot.spool_weight_g ? String(slot.spool_weight_g) : '',
    })
  }

  const saveOverride = async () => {
    if (!editingSlot) return
    const payload: Record<string, any> = {}
    if (form.material_name) payload.material_name = form.material_name
    if (form.color_hex) payload.color_hex = form.color_hex
    if (form.remaining_pct) payload.remaining_pct = parseFloat(form.remaining_pct)
    if (form.cost_per_kg) payload.cost_per_kg = parseFloat(form.cost_per_kg)
    if (form.spool_weight_g) payload.spool_weight_g = parseFloat(form.spool_weight_g)
    await upsertCfsOverride(editingSlot.slot, payload)
    setEditingSlot(null)
    load()
  }

  const handleReset = async (slotId: string) => {
    await resetCfsOverride(slotId)
    load()
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-6 h-6 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Spools & CFS</h1>
        <p className="text-sm text-surface-400 mt-1">{slots.length} slots detected</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {slots.map(slot => {
          const color = colorFromHex(slot.color_hex)
          const grad = materialGradients[slot.material_name] || 'from-surface-600 to-surface-800'
          const cost = slot.cost_per_kg ? `$${slot.cost_per_kg.toFixed(2)}/kg` : null
          return (
            <div key={slot.slot} className="card overflow-hidden group hover:border-accent-500/30 transition-all">
              <div className={`h-2 bg-gradient-to-r ${grad}`} />
              <div className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-5 h-5 rounded-full border-2 border-surface-600"
                      style={{ backgroundColor: color }}
                    />
                    <h3 className="font-semibold text-white text-sm">{slot.slot}</h3>
                    {slot.has_override && (
                      <svg className="w-3.5 h-3.5 text-accent-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => openEdit(slot)}
                      className="p-1.5 rounded hover:bg-surface-700/50 text-surface-500 hover:text-white transition-colors"
                      title="Edit slot"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                      </svg>
                    </button>
                  </div>
                </div>
                <p className="text-sm text-surface-300 font-medium">{slot.material_name}</p>
                <p className="text-xs text-surface-500 mt-0.5">{slot.slot} · {slot.position}</p>
                {slot.temperature && (
                  <p className="text-xs text-surface-500 mt-1">{slot.temperature}°C · {slot.humidity}%RH</p>
                )}
                {cost && (
                  <p className="text-xs text-accent-400 mt-1">{cost}</p>
                )}
                <div className="mt-3">
                  <div className="flex items-center justify-between text-xs text-surface-500 mb-1">
                    <span>Remaining</span>
                    <span>{slot.remaining_pct}%</span>
                  </div>
                  <div className="w-full bg-surface-700 rounded-full h-1.5">
                    <div
                      className={`h-1.5 rounded-full transition-all bg-gradient-to-r ${grad}`}
                      style={{ width: `${slot.remaining_pct}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          )
        })}
        {slots.length === 0 && (
          <div className="col-span-full py-12 text-center text-surface-500">No CFS slots available</div>
        )}
      </div>

      {spools.length > 0 && (
        <div className="card">
          <div className="card-header">
            <h2 className="text-sm font-semibold text-white">Spool Database</h2>
          </div>
          <div className="card-body p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-surface-800/30 text-xs text-surface-400 uppercase tracking-wider">
                    <th className="text-left px-4 py-3 font-medium">Brand</th>
                    <th className="text-left px-4 py-3 font-medium">Material</th>
                    <th className="text-left px-4 py-3 font-medium">Color</th>
                    <th className="text-right px-4 py-3 font-medium">Initial</th>
                    <th className="text-right px-4 py-3 font-medium">Remaining</th>
                    <th className="text-right px-4 py-3 font-medium">Cost/kg</th>
                  </tr>
                </thead>
                <tbody>
                  {spools.map(s => (
                    <tr key={s.id} className="border-t border-surface-700/20 hover:bg-surface-800/30 transition-colors">
                      <td className="px-4 py-3 text-surface-200">{s.brand}</td>
                      <td className="px-4 py-3 text-surface-300">{s.material}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full border border-surface-600" style={{ backgroundColor: s.color.toLowerCase() }} />
                          <span className="text-surface-300">{s.color}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-surface-300">{s.initial_weight_g}g</td>
                      <td className="px-4 py-3 text-right text-surface-300">{s.remaining_weight_g}g</td>
                      <td className="px-4 py-3 text-right text-surface-300 font-medium">
                        {s.cost_per_kg ? `$${s.cost_per_kg.toFixed(2)}` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {editingSlot && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setEditingSlot(null)}>
          <div className="card w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
            <div className="card-header flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">Edit {editingSlot.slot}</h2>
              <button onClick={() => setEditingSlot(null)} className="text-surface-500 hover:text-white">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="card-body space-y-4">
              <div>
                <label className="block text-xs text-surface-400 mb-1">Material Name</label>
                <input
                  className="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm text-white placeholder-surface-500 focus:outline-none focus:border-accent-500"
                  value={form.material_name || ''}
                  onChange={e => setForm(f => ({ ...f, material_name: e.target.value }))}
                  placeholder={editingSlot.material_name}
                />
              </div>
              <div>
                <label className="block text-xs text-surface-400 mb-1">Color</label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    className="w-10 h-10 rounded-lg border border-surface-700 bg-transparent cursor-pointer"
                    value={colorFromHex(form.color_hex || editingSlot.color_hex)}
                    onChange={e => setForm(f => ({ ...f, color_hex: e.target.value.replace('#', '') }))}
                  />
                  <input
                    className="flex-1 bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm text-white font-mono placeholder-surface-500 focus:outline-none focus:border-accent-500"
                    value={form.color_hex || ''}
                    onChange={e => setForm(f => ({ ...f, color_hex: e.target.value }))}
                    placeholder={editingSlot.color_hex}
                  />
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {defaultColors.map(c => (
                    <button
                      key={c}
                      className="w-6 h-6 rounded-full border border-surface-600 hover:scale-110 transition-transform"
                      style={{ backgroundColor: c }}
                      onClick={() => setForm(f => ({ ...f, color_hex: c.replace('#', '') }))}
                    />
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-surface-400 mb-1">Remaining %</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    className="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent-500"
                    value={form.remaining_pct || ''}
                    onChange={e => setForm(f => ({ ...f, remaining_pct: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-xs text-surface-400 mb-1">Spool Weight (g)</label>
                  <input
                    type="number"
                    min="0"
                    className="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent-500"
                    value={form.spool_weight_g || ''}
                    onChange={e => setForm(f => ({ ...f, spool_weight_g: e.target.value }))}
                    placeholder="e.g. 1000"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs text-surface-400 mb-1">Cost per kg ($)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent-500"
                  value={form.cost_per_kg || ''}
                  onChange={e => setForm(f => ({ ...f, cost_per_kg: e.target.value }))}
                  placeholder="e.g. 25.00"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={saveOverride} className="btn-primary flex-1">
                  Save
                </button>
                <button
                  onClick={() => { handleReset(editingSlot.slot); setEditingSlot(null) }}
                  className="btn bg-surface-700 hover:bg-red-600/20 text-surface-400 hover:text-red-400 border border-surface-600 hover:border-red-600/30 flex-1"
                >
                  Reset to CFS
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Spools
