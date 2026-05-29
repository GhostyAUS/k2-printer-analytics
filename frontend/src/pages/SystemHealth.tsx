import React, { useEffect, useState } from 'react'
import api from '../api'

interface HealthData {
  cpu_load: number
  memory_available_mb: number
  uptime_seconds: number
  uptime_hours: number
}

const SystemHealth: React.FC = () => {
  const [health, setHealth] = useState<HealthData | null>(null)

  useEffect(() => {
    const load = async () => {
      try {
        const res = await api.get('/api/v1/system/health')
        if (res.status === 200) setHealth(res.data)
      } catch { /* ignore */ }
    }
    load()
    const interval = setInterval(load, 15000)
    return () => clearInterval(interval)
  }, [])

  const fmtUptime = (s: number): string => {
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    return `${h}h ${m}m`
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">System Health</h1>
      <p className="text-sm text-surface-400 mt-1">Printer system resource usage</p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card">
          <div className="card-body">
            <div className="flex items-center justify-between mb-3">
              <span className="stat-label">CPU Load</span>
              <div className="w-8 h-8 rounded-lg bg-rose-600/10 flex items-center justify-center">
                <svg className="w-4 h-4 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25" />
                </svg>
              </div>
            </div>
            <p className={`stat-value ${health && health.cpu_load > 5 ? 'text-rose-400' : 'text-emerald-400'}`}>
              {health ? `${health.cpu_load.toFixed(1)}` : '—'}
            </p>
            <p className="mt-1 text-xs text-surface-500">System load average</p>
          </div>
        </div>

        <div className="card">
          <div className="card-body">
            <div className="flex items-center justify-between mb-3">
              <span className="stat-label">Memory Available</span>
              <div className="w-8 h-8 rounded-lg bg-sky-600/10 flex items-center justify-center">
                <svg className="w-4 h-4 text-sky-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15a2.25 2.25 0 012.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
                </svg>
              </div>
            </div>
            <p className="stat-value text-sky-400">
              {health ? `${health.memory_available_mb.toFixed(0)} MB` : '—'}
            </p>
            <p className="mt-1 text-xs text-surface-500">Available RAM</p>
          </div>
        </div>

        <div className="card">
          <div className="card-body">
            <div className="flex items-center justify-between mb-3">
              <span className="stat-label">Uptime</span>
              <div className="w-8 h-8 rounded-lg bg-amber-600/10 flex items-center justify-center">
                <svg className="w-4 h-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            </div>
            <p className="stat-value text-amber-400">
              {health ? fmtUptime(health.uptime_seconds) : '—'}
            </p>
            <p className="mt-1 text-xs text-surface-500">Printer system uptime</p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default SystemHealth
