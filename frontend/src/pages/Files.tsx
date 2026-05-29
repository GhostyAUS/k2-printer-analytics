import React, { useEffect, useState, useCallback } from 'react'
import { fetchPrinterFiles, fetchFileMetadata } from '../api'

interface PrinterFile {
  filename: string
  path: string
  size: number
  size_mb: number
  modified: number
}

const formatSize = (mb: number) => mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(1)} MB`
const formatDate = (ts: number) => new Date(ts * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
const formatTime = (ts: number) => new Date(ts * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

const Files: React.FC = () => {
  const [files, setFiles] = useState<PrinterFile[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<'name' | 'size' | 'modified'>('modified')
  const [sortAsc, setSortAsc] = useState(false)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [metadata, setMetadata] = useState<any>(null)

  const loadFiles = useCallback(async () => {
    try {
      const result = await fetchPrinterFiles()
      setFiles(result.files || [])
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { loadFiles() }, [loadFiles])

  const loadMetadata = async (filename: string) => {
    setSelectedFile(filename)
    setMetadata(null)
    try {
      const data = await fetchFileMetadata(filename)
      setMetadata(data)
    } catch (e) { console.error(e) }
  }

  const handleSort = (key: 'name' | 'size' | 'modified') => {
    if (sortBy === key) setSortAsc(a => !a)
    else { setSortBy(key); setSortAsc(false) }
  }

  const filtered = files
    .filter(f => f.filename.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      let cmp = 0
      if (sortBy === 'name') cmp = a.filename.localeCompare(b.filename)
      else if (sortBy === 'size') cmp = a.size - b.size
      else cmp = (a.modified || 0) - (b.modified || 0)
      return sortAsc ? cmp : -cmp
    })

  if (loading) return (
    <div className="flex items-center justify-center h-64"><div className="w-6 h-6 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" /></div>
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Files on Printer</h1>
        <p className="text-sm text-surface-400 mt-1">{files.length} gcode files stored on the K2</p>
      </div>

      <div className="flex gap-3 items-center">
        <div className="relative flex-1 max-w-md">
          <svg className="w-4 h-4 text-surface-500 absolute left-3 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search files..." className="w-full pl-9 pr-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-sm text-surface-200 placeholder-surface-500 focus:outline-none focus:border-accent-500" />
        </div>
        <button onClick={() => loadFiles()} className="px-3 py-2 bg-surface-700 hover:bg-surface-600 text-surface-300 text-sm rounded-lg transition-colors">Refresh</button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-800/30 text-xs text-surface-400 uppercase tracking-wider">
                  <th className="text-left px-4 py-3 font-medium cursor-pointer hover:text-surface-200" onClick={() => handleSort('name')}>
                    Filename {sortBy === 'name' ? (sortAsc ? '↑' : '↓') : '↕'}
                  </th>
                  <th className="text-right px-4 py-3 font-medium cursor-pointer hover:text-surface-200" onClick={() => handleSort('size')}>
                    Size {sortBy === 'size' ? (sortAsc ? '↑' : '↓') : '↕'}
                  </th>
                  <th className="text-right px-4 py-3 font-medium cursor-pointer hover:text-surface-200" onClick={() => handleSort('modified')}>
                    Modified {sortBy === 'modified' ? (sortAsc ? '↑' : '↓') : '↕'}
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 100).map(f => (
                  <tr
                    key={f.path}
                    onClick={() => loadMetadata(f.filename)}
                    className={`border-t border-surface-700/20 hover:bg-surface-800/30 transition-colors cursor-pointer ${selectedFile === f.filename ? 'bg-accent-600/10' : ''}`}
                  >
                    <td className="px-4 py-3 text-surface-200 max-w-[400px] truncate" title={f.filename}>
                      <div className="flex items-center gap-2">
                        <svg className="w-4 h-4 text-surface-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                        </svg>
                        <span className="truncate">{f.filename.replace(/\.gcode$/i, '')}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-surface-300">{formatSize(f.size_mb)}</td>
                    <td className="px-4 py-3 text-right text-surface-400 text-xs">{formatDate(f.modified)} {formatTime(f.modified)}</td>
                  </tr>
                ))}
                {filtered.length > 100 && (
                  <tr><td colSpan={3} className="px-4 py-3 text-center text-surface-500 text-xs">Showing 100 of {filtered.length} files</td></tr>
                )}
                {filtered.length === 0 && (
                  <tr><td colSpan={3} className="px-4 py-12 text-center text-surface-500">{search ? `No files matching "${search}"` : 'No files found'}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-6">
          {selectedFile && metadata ? (
            <div className="card">
              <div className="card-header">
                <h2 className="text-sm font-semibold text-white truncate" title={metadata.filename}>{metadata.filename?.replace(/\.gcode$/i, '')}</h2>
              </div>
              <div className="card-body space-y-3 text-sm">
                {metadata.estimated_time != null && (
                  <div className="flex justify-between">
                    <span className="text-surface-500">Est. Time</span>
                    <span className="text-surface-200 font-medium">
                      {Math.floor(metadata.estimated_time / 3600)}h {Math.floor((metadata.estimated_time % 3600) / 60)}m
                    </span>
                  </div>
                )}
                {metadata.filament_total != null && (
                  <div className="flex justify-between">
                    <span className="text-surface-500">Filament</span>
                    <span className="text-surface-200">{(metadata.filament_total / 1000).toFixed(1)}m ({(metadata.filament_total * 3.14159 * 0.875 * 1.24 / 1000000).toFixed(0)}g est.)</span>
                  </div>
                )}
                {metadata.object_height != null && (
                  <div className="flex justify-between">
                    <span className="text-surface-500">Object Height</span>
                    <span className="text-surface-200">{metadata.object_height}mm</span>
                  </div>
                )}
                {metadata.first_layer_height != null && (
                  <div className="flex justify-between">
                    <span className="text-surface-500">First Layer</span>
                    <span className="text-surface-200">{metadata.first_layer_height}mm</span>
                  </div>
                )}
                {metadata.slicer && (
                  <div className="flex justify-between">
                    <span className="text-surface-500">Slicer</span>
                    <span className="text-surface-200">{metadata.slicer}</span>
                  </div>
                )}
                {metadata.size != null && (
                  <div className="flex justify-between">
                    <span className="text-surface-500">File Size</span>
                    <span className="text-surface-200">{(metadata.size / (1024 * 1024)).toFixed(1)} MB</span>
                  </div>
                )}
                {metadata.modified && (
                  <div className="flex justify-between">
                    <span className="text-surface-500">Modified</span>
                    <span className="text-surface-200">{new Date(metadata.modified * 1000).toLocaleString()}</span>
                  </div>
                )}
                {metadata.estimated_time != null && metadata.filament_total != null && (() => {
                  const elecCost = (151 * metadata.estimated_time / 3600 / 1000) * 0.49
                  const filCost = (metadata.filamental_total || metadata.filament_total) * 3.14159 * 0.875 * 1.24 / 1000000 * 24 / 1000
                  return (
                    <div className="mt-3 pt-3 border-t border-surface-700/50 space-y-2">
                      <div className="flex justify-between">
                        <span className="text-surface-500">Est. Elec. Cost</span>
                        <span className="text-amber-400">${elecCost.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-surface-500">Est. Fil. Cost</span>
                        <span className="text-violet-400">${filCost.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between font-medium">
                        <span className="text-surface-300">Est. Total</span>
                        <span className="text-white">${(elecCost + filCost).toFixed(2)}</span>
                      </div>
                    </div>
                  )
                })()}
              </div>
            </div>
          ) : (
            <div className="card">
              <div className="card-body py-12 text-center text-surface-500">
                <svg className="w-12 h-12 mx-auto mb-3 text-surface-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                </svg>
                <p className="text-sm">Select a file to view metadata</p>
                <p className="text-xs text-surface-600 mt-1">Click any file to see estimated time, filament, and cost</p>
              </div>
            </div>
          )}

          <div className="card">
            <div className="card-header"><h2 className="text-sm font-semibold text-white">Storage Summary</h2></div>
            <div className="card-body space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-surface-500">Total Files</span>
                <span className="text-surface-200">{files.length}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-surface-500">Total Size</span>
                <span className="text-surface-200">{formatSize(files.reduce((s, f) => s + f.size_mb, 0))}</span>
              </div>
              {files.length > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-surface-500">Largest</span>
                  <span className="text-surface-200 truncate ml-2 max-w-[200px]" title={files.reduce((a, b) => a.size > b.size ? a : b).filename}>
                    {files.reduce((a, b) => a.size > b.size ? a : b).filename.replace(/\.gcode$/i, '').slice(0, 30)}
                  </span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-surface-500">Newest</span>
                <span className="text-surface-200">{formatDate(Math.max(...files.map(f => f.modified || 0)))}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Files