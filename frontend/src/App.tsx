import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import Layout from './components/Layout.tsx'
import Dashboard from './pages/Dashboard.tsx'
import PrintJobs from './pages/PrintJobs.tsx'
import Spools from './pages/Spools.tsx'
import Camera from './pages/Camera.tsx'
import Analytics from './pages/Analytics.tsx'
import SystemHealth from './pages/SystemHealth.tsx'
import Settings from './pages/Settings.tsx'
import Help from './pages/Help.tsx'
import FilamentLibrary from './pages/FilamentLibrary.tsx'
import Compare from './pages/Compare.tsx'
import Files from './pages/Files.tsx'
import Login from './pages/Login.tsx'
import SetupWizard from './pages/SetupWizard.tsx'
import { fetchAuthStatus } from './api'

interface AuthState {
  initialized: boolean
  authenticated: boolean
  username: string | null
  is_admin: boolean
  loading: boolean
}

const AuthContext = createContext<AuthState>({ initialized: false, authenticated: false, username: null, is_admin: false, loading: true })

export const useAuth = () => useContext(AuthContext)

function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthState>({ initialized: false, authenticated: false, username: null, is_admin: false, loading: true })

  const checkAuth = async (retries = 5) => {
    const token = localStorage.getItem('k2_token')
    for (let i = 0; i < retries; i++) {
      try {
        const s = await fetchAuthStatus()
        if (!token) {
          setAuth({ initialized: s.initialized, authenticated: false, username: null, is_admin: false, loading: false })
          return
        }
        if (s.authenticated) {
          const stored = localStorage.getItem('k2_user')
          const user = stored ? JSON.parse(stored) : null
          setAuth({ initialized: true, authenticated: true, username: s.username || user?.username, is_admin: s.is_admin ?? user?.is_admin, loading: false })
          return
        }
        localStorage.removeItem('k2_token')
        localStorage.removeItem('k2_user')
        setAuth({ initialized: s.initialized, authenticated: false, username: null, is_admin: false, loading: false })
        return
      } catch {
        if (i < retries - 1) await new Promise(r => setTimeout(r, 1000 * (i + 1)))
      }
    }
    setAuth({ initialized: false, authenticated: false, username: null, is_admin: false, loading: false })
  }

  useEffect(() => { checkAuth() }, [])

  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>
}

function ProtectedRoute({ children }: { children: ReactNode }) {
  const auth = useAuth()
  if (auth.loading) {
    return <div className="min-h-screen bg-surface-950 flex items-center justify-center">
      <div className="text-surface-400 text-lg">Loading...</div>
    </div>
  }
  if (!auth.initialized) {
    return <Navigate to="/setup" replace />
  }
  if (!auth.authenticated) {
    return <Navigate to="/login" replace />
  }
  return <>{children}</>
}

function PublicOnlyRoute({ children }: { children: ReactNode }) {
  const auth = useAuth()
  if (auth.loading) {
    return <div className="min-h-screen bg-surface-950 flex items-center justify-center">
      <div className="text-surface-400 text-lg">Loading...</div>
    </div>
  }
  if (auth.authenticated) {
    return <Navigate to="/" replace />
  }
  if (auth.initialized) {
    return <>{children}</>
  }
  return <>{children}</>
}

function SetupRoute({ children }: { children: ReactNode }) {
  const auth = useAuth()
  if (auth.loading) {
    return <>{children}</>
  }
  if (auth.authenticated) {
    return <Navigate to="/" replace />
  }
  return <>{children}</>
}

function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/login" element={<PublicOnlyRoute><Login /></PublicOnlyRoute>} />
          <Route path="/setup" element={<SetupRoute><SetupWizard /></SetupRoute>} />
          <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
            <Route index element={<Dashboard />} />
            <Route path="print-jobs" element={<PrintJobs />} />
            <Route path="spools" element={<Spools />} />
            <Route path="filament" element={<FilamentLibrary />} />
            <Route path="camera" element={<Camera />} />
            <Route path="files" element={<Files />} />
            <Route path="analytics" element={<Analytics />} />
            <Route path="compare" element={<Compare />} />
            <Route path="system" element={<SystemHealth />} />
            <Route path="settings" element={<Settings />} />
            <Route path="help" element={<Help />} />
          </Route>
        </Routes>
      </Router>
    </AuthProvider>
  )
}

export default App