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

  useEffect(() => {
    const token = localStorage.getItem('k2_token')
    if (!token) {
      fetchAuthStatus().then(s => {
        setAuth({ initialized: s.initialized, authenticated: false, username: null, is_admin: false, loading: false })
      }).catch(() => {
        setAuth({ initialized: false, authenticated: false, username: null, is_admin: false, loading: false })
      })
      return
    }
    fetchAuthStatus().then(s => {
      if (s.authenticated) {
        const stored = localStorage.getItem('k2_user')
        const user = stored ? JSON.parse(stored) : null
        setAuth({ initialized: true, authenticated: true, username: s.username || user?.username, is_admin: s.is_admin, loading: false })
      } else {
        localStorage.removeItem('k2_token')
        localStorage.removeItem('k2_user')
        setAuth({ initialized: s.initialized, authenticated: false, username: null, is_admin: false, loading: false })
      }
    }).catch(() => {
      localStorage.removeItem('k2_token')
      localStorage.removeItem('k2_user')
      setAuth({ initialized: false, authenticated: false, username: null, is_admin: false, loading: false })
    })
  }, [])

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

function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/setup" element={<SetupWizard />} />
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
          </Route>
        </Routes>
      </Router>
    </AuthProvider>
  )
}

export default App