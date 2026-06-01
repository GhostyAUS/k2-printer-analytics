import React, { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { fetchPowerReading, fetchPrinterStats } from '../api'

const Header: React.FC<{ onMenuToggle?: () => void }> = ({ onMenuToggle }) => {
  const [power, setPower] = useState<number | null>(null)
  const [status, setStatus] = useState<string>('checking...')
  const location = useLocation()

  useEffect(() => {
    const load = async () => {
      try {
        const [p, s] = await Promise.all([
          fetchPowerReading().catch(() => ({ power_watts: null })),
          fetchPrinterStats().catch(() => null),
        ])
        setPower(p.power_watts)
        const ps = s?.result?.status?.print_stats
        setStatus(ps?.state === 'printing' ? 'Printing' : 'Standby')
      } catch { /* ignore */ }
    }
    load()
    const interval = setInterval(load, 10000)
    return () => clearInterval(interval)
  }, [])

  const pageNames: Record<string, string> = {
    '/': 'Dashboard',
    '/print-jobs': 'Print Jobs',
    '/filament': 'Filament Library',
    '/camera': 'Camera',
    '/files': 'Files',
    '/analytics': 'Analytics',
    '/compare': 'Compare',
    '/system': 'System Health',
    '/settings': 'Settings',
  }

  return (
    <header className="bg-surface-900/80 border-b border-surface-700/30 backdrop-blur-md sticky top-0 z-50">
      <div className="flex items-center justify-between px-6 py-3">
        <div className="flex items-center gap-4">
          {onMenuToggle && (
            <button onClick={onMenuToggle} className="lg:hidden text-surface-400 hover:text-white">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
              </svg>
            </button>
          )}
          <h2 className="text-lg font-semibold text-white">
            {pageNames[location.pathname] || 'K2 Analytics'}
          </h2>
          <div className="hidden md:flex items-center gap-1.5 text-xs text-surface-500">
            <div className={`w-1.5 h-1.5 rounded-full ${status === 'Printing' ? 'bg-emerald-500 animate-pulse' : 'bg-surface-500'}`} />
            {status}
          </div>
        </div>
        <div className="flex items-center gap-6">
          {power !== null && (
            <div className="flex items-center gap-2 text-sm">
              <svg className="w-4 h-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <span className="text-surface-300">{power.toFixed(0)} W</span>
            </div>
          )}
          <button
            onClick={() => { localStorage.removeItem('k2_token'); localStorage.removeItem('k2_user'); window.location.href = '/login' }}
            className="text-surface-500 hover:text-white transition-colors"
            title="Sign out"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
            </svg>
          </button>
        </div>
      </div>
    </header>
  )
}

export default Header
