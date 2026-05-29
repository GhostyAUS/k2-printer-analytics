import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Header from './Header';
import Sidebar from './Sidebar';

const Layout: React.FC = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex flex-col min-h-screen bg-surface-950">
      <Header onMenuToggle={() => setSidebarOpen(!sidebarOpen)} />
      <div className="flex flex-1">
        {/* Mobile overlay */}
        {sidebarOpen && (
          <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
        )}
        {/* Sidebar: always visible on lg, toggleable on mobile */}
        <div className={`fixed lg:static inset-y-0 left-0 z-50 w-64 transform transition-transform duration-200 lg:transform-none ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
          <Sidebar onNavigate={() => setSidebarOpen(false)} />
        </div>
        <main className="flex-1 p-4 md:p-6 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default Layout;