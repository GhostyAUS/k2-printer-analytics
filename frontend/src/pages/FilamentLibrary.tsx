import React, { useEffect, useState } from 'react'
import { fetchFilamentRolls, createFilamentRoll, updateFilamentRoll, deleteFilamentRoll } from '../api'
import type { FilamentRoll } from '../types'

const MATERIALS = ['PLA', 'PETG', 'ABS', 'TPU', 'ASA', 'NYLON', 'PC', 'HIPS']

type SortKey = 'brand' | 'material' | 'remaining_weight_g' | 'cost_per_kg' | 'total_weight_g' | 'pct_remaining'

function compareRolls(a: FilamentRoll, b: FilamentRoll, key: SortKey, asc: boolean): number {
  let cmp = 0
  switch (key) {
    case 'brand': cmp = (a.brand || '').localeCompare(b.brand || ''); break
    case 'material': cmp = a.material.localeCompare(b.material); break
    case 'remaining_weight_g': cmp = a.remaining_weight_g - b.remaining_weight_g; break
    case 'cost_per_kg': cmp = (a.cost_per_kg || 0) - (b.cost_per_kg || 0); break
    case 'total_weight_g': cmp = a.total_weight_g - b.total_weight_g; break
    case 'pct_remaining': cmp = (a.remaining_weight_g / (a.total_weight_g || 1)) - (b.remaining_weight_g / (b.total_weight_g || 1)); break
  }
  return asc ? cmp : -cmp
}

const FilamentLibrary: React.FC = () => {
  const [rolls, setRolls] = useState<FilamentRoll[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('pct_remaining')
  const [sortAsc, setSortAsc] = useState(false)
  const [materialFilter, setMaterialFilter] = useState<string>('all')
  const [search, setSearch] = useState('')

  useEffect(() => {
    fetchFilamentRolls()
      .then(setRolls)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const sorted = rolls
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
    .sort((a, b) => compareRolls(a, b, sortKey, sortAsc))

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(a => !a)
    else { setSortKey(key); setSortAsc(false) }
  }

  const sortIcon = (key: SortKey) => sortKey === key ? (sortAsc ? '↑' : '↓') : '↕'

  const totalKg = rolls.reduce((s, r) => s + r.total_weight_g, 0) / 1000
  const remainingKg = rolls.reduce((s, r) => s + r.remaining_weight_g, 0) / 1000
  const totalSpent = rolls.reduce((s, r) => s + (r.cost_per_kg || 0) * r.total_weight_g / 1000, 0)
  const avgCostPerKg = totalKg > 0 ? totalSpent / totalKg : 0
  const uniqueMaterials = [...new Set(rolls.map(r => r.material))].sort()

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
          <p className="text-sm text-surface-400 mt-1">{rolls.length} rolls in stock</p>
        </div>
        <button
          onClick={() => setAdding(true)}
          className="px-4 py-2 bg-accent-600 hover:bg-accent-500 text-white text-sm font-medium rounded-lg transition-colors"
        >+ Add Roll</button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="card"><div className="card-body">
          <span className="stat-label">Total Rolls</span>
          <p className="stat-value">{rolls.length}</p>
        </div></div>
        <div className="card"><div className="card-body">
          <span className="stat-label">Total Stock</span>
          <p className="stat-value text-sky-400">{totalKg.toFixed(1)} kg</p>
        </div></div>
        <div className="card"><div className="card-body">
          <span className="stat-label">Remaining</span>
          <p className="stat-value text-emerald-400">{remainingKg.toFixed(1)} kg</p>
        </div></div>
        <div className="card"><div className="card-body">
          <span className="stat-label">Avg Cost</span>
          <p className="stat-value text-amber-400">${avgCostPerKg.toFixed(2)}/kg</p>
        </div></div>
      </div>

      {adding && (
        <RollForm
          onSave={async (data) => {
            const roll = await createFilamentRoll(data)
            setRolls(prev => [roll, ...prev])
            setAdding(false)
          }}
          onCancel={() => setAdding(false)}
        />
      )}

      <div className="card">
        <div className="card-header flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Inventory</h2>
          <div className="flex items-center gap-3">
            <select
              value={materialFilter}
              onChange={e => setMaterialFilter(e.target.value)}
              className="bg-surface-800 border border-surface-700 rounded px-2 py-1 text-xs text-surface-300 focus:outline-none focus:border-accent-500"
            >
              <option value="all">All Materials</option>
              {uniqueMaterials.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search..."
              className="bg-surface-800 border border-surface-700 rounded px-2 py-1 text-xs text-surface-300 placeholder-surface-500 focus:outline-none focus:border-accent-500 w-36"
            />
            <span className="text-xs text-surface-500">{sorted.length} rolls</span>
          </div>
        </div>
        <div className="card-body p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-700/50 text-xs text-surface-400 uppercase tracking-wider">
                  <th className="text-left px-4 py-3 font-medium cursor-pointer hover:text-surface-200" onClick={() => handleSort('brand')}>Color/Name {sortIcon('brand')}</th>
                  <th className="text-left px-4 py-3 font-medium cursor-pointer hover:text-surface-200" onClick={() => handleSort('material')}>Brand / Material {sortIcon('material')}</th>
                  <th className="text-right px-4 py-3 font-medium cursor-pointer hover:text-surface-200" onClick={() => handleSort('total_weight_g')}>Total {sortIcon('total_weight_g')}</th>
                  <th className="text-right px-4 py-3 font-medium cursor-pointer hover:text-surface-200" onClick={() => handleSort('pct_remaining')}>Remaining {sortIcon('pct_remaining')}</th>
                  <th className="text-right px-4 py-3 font-medium cursor-pointer hover:text-surface-200" onClick={() => handleSort('cost_per_kg')}>Cost/kg {sortIcon('cost_per_kg')}</th>
                  <th className="text-left px-4 py-3 font-medium">Location</th>
                  <th className="text-left px-4 py-3 font-medium">Slot</th>
                  <th className="text-right px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(roll => (
                  editing === roll.id ? (
                    <RollFormInline
                      key={roll.id}
                      roll={roll}
                      onSave={async (data) => {
                        const updated = await updateFilamentRoll(roll.id, data)
                        setRolls(prev => prev.map(r => r.id === roll.id ? updated : r))
                        setEditing(null)
                      }}
                      onCancel={() => setEditing(null)}
                      onDelete={async () => {
                        await deleteFilamentRoll(roll.id)
                        setRolls(prev => prev.filter(r => r.id !== roll.id))
                        setEditing(null)
                      }}
                    />
                  ) : (
                    <tr key={roll.id} className="border-b border-surface-700/20 hover:bg-surface-800/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {roll.color_hex && (
                            <div
                              className="w-5 h-5 rounded-full border border-surface-600 shrink-0"
                              style={{ backgroundColor: roll.color_hex }}
                            />
                          )}
                          <span className="text-surface-200">{roll.color_name || '—'}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-surface-200">{roll.brand || 'Unknown'}</p>
                        <p className="text-[10px] text-surface-500">{roll.material}</p>
                      </td>
                      <td className="px-4 py-3 text-right text-surface-300">
                        {(roll.total_weight_g / 1000).toFixed(2)} kg
                      </td>
                      <td className="px-4 py-3 text-right">
                        <p className="text-surface-200">{(roll.remaining_weight_g / 1000).toFixed(2)} kg</p>
                        <div className="mt-1 w-full bg-surface-700 rounded-full h-1">
                          <div
                            className={`h-1 rounded-full ${roll.remaining_weight_g / roll.total_weight_g > 0.2 ? 'bg-emerald-500' : 'bg-rose-500'}`}
                            style={{ width: `${Math.min((roll.remaining_weight_g / roll.total_weight_g) * 100, 100)}%` }}
                          />
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-surface-300">
                        {roll.cost_per_kg ? `$${roll.cost_per_kg.toFixed(2)}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-surface-400">{roll.location || '—'}</td>
                      <td className="px-4 py-3 text-surface-400">{roll.spool_id || '—'}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => setEditing(roll.id)}
                          className="px-2 py-1 text-xs bg-surface-700 hover:bg-surface-600 text-surface-300 rounded transition-colors"
                        >Edit</button>
                      </td>
                    </tr>
                  )
                ))}
                {sorted.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-12 text-center text-surface-500">No filament rolls found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

const RollForm: React.FC<{
  onSave: (data: Partial<FilamentRoll>) => Promise<void>
  onCancel: () => void
}> = ({ onSave, onCancel }) => {
  const [form, setForm] = useState({
    brand: '', material: 'PLA', color_name: '', color_hex: '#ffffff',
    total_weight_g: 1000, remaining_weight_g: 1000, cost_per_kg: 24.0,
    location: '', notes: '', spool_id: '',
  })
  const [saving, setSaving] = useState(false)

  return (
    <div className="card border border-accent-600/30">
      <div className="card-header"><h2 className="text-sm font-semibold text-white">Add New Roll</h2></div>
      <div className="card-body">
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
          <div>
            <label className="text-xs text-surface-500 block mb-1">Color</label>
            <input type="color" value={form.color_hex} onChange={e => setForm(p => ({ ...p, color_hex: e.target.value }))}
              className="w-full h-8 bg-surface-800 border border-surface-700 rounded cursor-pointer" />
          </div>
          <Input label="Total (g)" type="number" value={String(form.total_weight_g)} onChange={v => setForm(p => ({ ...p, total_weight_g: Number(v) }))} />
          <Input label="Remaining (g)" type="number" value={String(form.remaining_weight_g)} onChange={v => setForm(p => ({ ...p, remaining_weight_g: Number(v) }))} />
          <Input label="Cost/kg ($)" type="number" value={String(form.cost_per_kg)} onChange={v => setForm(p => ({ ...p, cost_per_kg: Number(v) }))} />
          <Input label="Location" value={form.location} onChange={v => setForm(p => ({ ...p, location: v }))} />
          <Input label="CFS Slot (e.g. T2D)" value={form.spool_id} onChange={v => setForm(p => ({ ...p, spool_id: v }))} />
          <Input label="Notes" value={form.notes} onChange={v => setForm(p => ({ ...p, notes: v }))} />
        </div>
        <div className="flex gap-2 mt-4">
          <button onClick={async () => { setSaving(true); await onSave(form); }} disabled={saving}
            className="px-4 py-2 bg-accent-600 hover:bg-accent-500 text-white text-sm rounded transition-colors disabled:opacity-50">Save</button>
          <button onClick={onCancel} className="px-4 py-2 bg-surface-700 hover:bg-surface-600 text-surface-300 text-sm rounded transition-colors">Cancel</button>
        </div>
      </div>
    </div>
  )
}

const RollFormInline: React.FC<{
  roll: FilamentRoll
  onSave: (data: Partial<FilamentRoll>) => Promise<void>
  onCancel: () => void
  onDelete: () => Promise<void>
}> = ({ roll, onSave, onCancel, onDelete }) => {
  const [form, setForm] = useState({
    brand: roll.brand, material: roll.material, color_name: roll.color_name || '',
    color_hex: roll.color_hex || '#ffffff', remaining_weight_g: roll.remaining_weight_g,
    cost_per_kg: roll.cost_per_kg || 24.0, location: roll.location || '', spool_id: roll.spool_id || '',
    notes: roll.notes || '',
  })

  return (
    <tr className="bg-surface-800/50">
      <td className="px-4 py-2">
        <input type="color" value={form.color_hex} onChange={e => setForm(p => ({ ...p, color_hex: e.target.value }))}
          className="w-6 h-6 bg-transparent border-0 cursor-pointer" />
        <input value={form.color_name} onChange={e => setForm(p => ({ ...p, color_name: e.target.value }))}
          className="ml-1 w-20 bg-surface-800 border border-surface-700 rounded px-1 py-0.5 text-xs text-surface-200" placeholder="Color" />
      </td>
      <td className="px-4 py-2">
        <input value={form.brand} onChange={e => setForm(p => ({ ...p, brand: e.target.value }))}
          className="w-20 bg-surface-800 border border-surface-700 rounded px-1 py-0.5 text-xs text-surface-200" />
        <select value={form.material} onChange={e => setForm(p => ({ ...p, material: e.target.value }))}
          className="ml-1 bg-surface-800 border border-surface-700 rounded px-1 py-0.5 text-xs text-surface-200">
          {MATERIALS.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </td>
      <td className="px-4 py-2 text-right">
        <span className="text-xs text-surface-400">{(roll.total_weight_g / 1000).toFixed(2)} kg</span>
      </td>
      <td className="px-4 py-2 text-right">
        <input type="number" value={form.remaining_weight_g} onChange={e => setForm(p => ({ ...p, remaining_weight_g: Number(e.target.value) }))}
          className="w-16 bg-surface-800 border border-surface-700 rounded px-1 py-0.5 text-xs text-surface-200 text-right" />
        <span className="text-[10px] text-surface-500 ml-0.5">g</span>
      </td>
      <td className="px-4 py-2 text-right">
        <input type="number" step="0.01" value={form.cost_per_kg} onChange={e => setForm(p => ({ ...p, cost_per_kg: Number(e.target.value) }))}
          className="w-16 bg-surface-800 border border-surface-700 rounded px-1 py-0.5 text-xs text-surface-200 text-right" />
      </td>
      <td className="px-4 py-2">
        <input value={form.location} onChange={e => setForm(p => ({ ...p, location: e.target.value }))}
          className="w-20 bg-surface-800 border border-surface-700 rounded px-1 py-0.5 text-xs text-surface-200" />
      </td>
      <td className="px-4 py-2">
        <input value={form.spool_id} onChange={e => setForm(p => ({ ...p, spool_id: e.target.value }))}
          className="w-12 bg-surface-800 border border-surface-700 rounded px-1 py-0.5 text-xs text-surface-200" />
      </td>
      <td className="px-4 py-2 text-right space-x-1">
        <button onClick={() => onSave(form)} className="px-2 py-0.5 text-xs bg-accent-600 hover:bg-accent-500 text-white rounded">Save</button>
        <button onClick={onCancel} className="px-2 py-0.5 text-xs bg-surface-700 hover:bg-surface-600 text-surface-300 rounded">Cancel</button>
        <button onClick={onDelete} className="px-2 py-0.5 text-xs bg-rose-600/50 hover:bg-rose-600 text-rose-200 rounded">Del</button>
      </td>
    </tr>
  )
}

const Input: React.FC<{
  label: string; value: string; onChange: (v: string) => void; type?: string
}> = ({ label, value, onChange, type = 'text' }) => (
  <div>
    <label className="text-xs text-surface-500 block mb-1">{label}</label>
    <input type={type} value={value} onChange={e => onChange(e.target.value)}
      className="w-full bg-surface-800 border border-surface-700 rounded px-2 py-1.5 text-sm text-surface-200 focus:outline-none focus:border-accent-500" />
  </div>
)

export default FilamentLibrary