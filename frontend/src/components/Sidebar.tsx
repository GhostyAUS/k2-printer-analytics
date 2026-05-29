import React from 'react';
import { NavLink } from 'react-router-dom';

const links = [
  { to: '/', label: 'Dashboard', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
  { to: '/print-jobs', label: 'Print Jobs', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4' },
  { to: '/spools', label: 'Spools & CFS', icon: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4' },
  { to: '/filament', label: 'Filament Library', icon: 'M21 7.5l-2.25-1.313M21 7.5v2.25m0-2.25l-2.25 1.313M3 7.5l2.25-1.313M3 7.5l2.25 1.313M3 7.5v2.25m9 3l2.25-1.313M12 12.75l-2.25-1.313M12 12.75V15m0 6.75l2.25-1.313M12 21.75V19.5m0 2.25l-2.25-1.313m0-16.875L12 2.25l2.25 1.313M21 14.25v2.25l-2.25 1.313m-13.5 0L3 14.25v2.25l2.25 1.313' },
  { to: '/camera', label: 'Camera', icon: 'M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z' },
  { to: '/files', label: 'Files', icon: 'M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z' },
  { to: '/analytics', label: 'Analytics', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
  { to: '/compare', label: 'Compare', icon: 'M7.5 3.75L6 9l1.5 5.25M16.5 3.75L18 9l-1.5 5.25M3.75 9h16.5M6 14.25h12m-9 0v3.75m6-3.75v3.75' },
  { to: '/system', label: 'System', icon: 'M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25' },
  { to: '/settings', label: 'Settings', icon: 'M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.18.108.352.228.513.359l1.226-.166c.54-.073 1.076.217 1.31.68l1.297 2.247c.247.504.115 1.118-.314 1.475l-.986.773a5.86 5.86 0 010 1.4l.986.773c.429.357.561.97.314 1.475l-1.297 2.247a1.125 1.125 0 01-1.31.68l-1.226-.165a5.836 5.836 0 01-.513.358l-.213 1.281c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281a5.836 5.836 0 01-.513-.358l-1.226.165a1.125 1.125 0 01-1.31-.68L4.594 13.16a1.125 1.125 0 01.314-1.475l.986-.773a5.86 5.86 0 010-1.4l-.986-.773a1.125 1.125 0 01-.314-1.475l1.297-2.247a1.125 1.125 0 011.31-.68l1.226.165c.161-.13.331-.25.513-.358l.213-1.281z M15 12a3 3 0 11-6 0 3 3 0 016 0z' },
]

const Sidebar: React.FC<{ onNavigate?: () => void }> = ({ onNavigate }) => {
  return (
    <aside className="w-64 bg-surface-800/30 border-r border-surface-700/30 flex flex-col">
      <div className="p-5 border-b border-surface-700/30">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent-500 to-accent-700 flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-white">K2 Analytics</p>
            <p className="text-xs text-surface-500">Printer Dashboard</p>
          </div>
        </div>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {links.map(({ to, label, icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `sidebar-link${isActive ? ' sidebar-link-active' : ''}`
            }
            onClick={onNavigate}
          >
            <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
            </svg>
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="p-4 border-t border-surface-700/30">
        <div className="flex items-center gap-2 text-xs text-surface-500">
          <div className="w-2 h-2 rounded-full bg-emerald-500" />
          System Online
        </div>
      </div>
    </aside>
  )
}

export default Sidebar
