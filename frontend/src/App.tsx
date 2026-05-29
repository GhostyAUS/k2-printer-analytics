import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
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
import SetupWizard from './pages/SetupWizard.tsx'

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/setup" element={<SetupWizard />} />
        <Route path="/" element={<Layout />}>
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
  )
}

export default App