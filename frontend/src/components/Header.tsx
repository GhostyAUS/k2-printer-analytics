import React, { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
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
    '/spools': 'Spools & CFS',
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
          <NavLink to="/" className="text-surface-500 hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </NavLink>
        </div>
      </div>
    </header>
  )
}

export default Header
