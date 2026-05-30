import React, { useState } from 'react'
import { getExportLogsUrl } from '../api'

const GITHUB_URL = 'https://github.com/GhostyAUS/k2-printer-analytics'

type SectionId = 'dashboard' | 'print-jobs' | 'spools' | 'filament' | 'camera' | 'files' | 'analytics' | 'reports' | 'compare' | 'system' | 'settings' | 'diagnostics' | 'troubleshooting' | 'export'

const sections: { id: SectionId; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
  { id: 'print-jobs', label: 'Print Jobs', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4' },
  { id: 'spools', label: 'Spools & CFS', icon: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4' },
  { id: 'filament', label: 'Filament Library', icon: 'M21 7.5l-2.25-1.313M21 7.5v2.25m0-2.25l-2.25 1.313M3 7.5l2.25-1.313M3 7.5l2.25 1.313M3 7.5v2.25m9 3l2.25-1.313M12 12.75l-2.25-1.313M12 12.75V15m0 6.75l2.25-1.313M12 21.75V19.5m0 2.25l-2.25-1.313m0-16.875L12 2.25l2.25 1.313M21 14.25v2.25l-2.25 1.313m-13.5 0L3 14.25v2.25l2.25 1.313' },
  { id: 'camera', label: 'Camera', icon: 'M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z' },
  { id: 'files', label: 'Files', icon: 'M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z' },
  { id: 'analytics', label: 'Analytics', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
  { id: 'reports', label: 'Reports', icon: 'M10.5 6a7.5 7.5 0 107.5 7.5h-7.5V6z' },
  { id: 'compare', label: 'Compare', icon: 'M7.5 3.75L6 9l1.5 5.25M16.5 3.75L18 9l-1.5 5.25M3.75 9h16.5M6 14.25h12m-9 0v3.75m6-3.75v3.75' },
  { id: 'system', label: 'System', icon: 'M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25' },
  { id: 'settings', label: 'Settings', icon: 'M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.18.108.352.228.513.359l1.226-.166c.54-.073 1.076.217 1.31.68l1.297 2.247c.247.504.115 1.118-.314 1.475l-.986.773a5.86 5.86 0 010 1.4l.986.773c.429.357.561.97.314 1.475l-1.297 2.247a1.125 1.125 0 01-1.31.68l-1.226-.165a5.836 5.836 0 01-.513.358l-.213 1.281c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281a5.836 5.836 0 01-.513-.358l-1.226.165a1.125 1.125 0 01-1.31-.68L4.594 13.16a1.125 1.125 0 01.314-1.475l.986-.773a5.86 5.86 0 010-1.4l-.986-.773a1.125 1.125 0 01-.314-1.475l1.297-2.247a1.125 1.125 0 011.31-.68l1.226.165c.161-.13.331-.25.513-.358l.213-1.281z M15 12a3 3 0 11-6 0 3 3 0 016 0z' },
  { id: 'diagnostics', label: 'Diagnostics Reference', icon: 'M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-16.86z' },
  { id: 'troubleshooting', label: 'Troubleshooting', icon: 'M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z' },
  { id: 'export', label: 'Export & Logs', icon: 'M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3' },
]

const Help: React.FC = () => {
  const [activeSection, setActiveSection] = useState<SectionId>('dashboard')

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Help & Documentation</h1>
          <p className="text-sm text-surface-400 mt-1">User guide, diagnostics reference, and troubleshooting</p>
        </div>
        <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-4 py-2 bg-surface-800 border border-surface-700 hover:border-surface-600 text-surface-300 text-sm rounded-lg transition-colors">
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" /></svg>
          GitHub
        </a>
      </div>

      <div className="flex gap-6">
        <nav className="w-56 flex-shrink-0">
          <div className="card p-2 space-y-0.5 sticky top-6">
            {sections.map(s => (
              <button
                key={s.id}
                onClick={() => setActiveSection(s.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg transition-colors text-left ${
                  activeSection === s.id
                    ? 'bg-accent-600/20 text-accent-400 border-l-2 border-accent-500'
                    : 'text-surface-400 hover:text-surface-200 hover:bg-surface-800/50'
                }`}
              >
                <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={s.icon} />
                </svg>
                {s.label}
              </button>
            ))}
          </div>
        </nav>

        <div className="flex-1 min-w-0">
          {activeSection === 'dashboard' && <DashboardHelp />}
          {activeSection === 'print-jobs' && <PrintJobsHelp />}
          {activeSection === 'spools' && <SpoolsHelp />}
          {activeSection === 'filament' && <FilamentHelp />}
          {activeSection === 'camera' && <CameraHelp />}
          {activeSection === 'files' && <FilesHelp />}
          {activeSection === 'analytics' && <AnalyticsHelp />}
          {activeSection === 'reports' && <ReportsHelp />}
          {activeSection === 'compare' && <CompareHelp />}
          {activeSection === 'system' && <SystemHelp />}
          {activeSection === 'settings' && <SettingsHelp />}
          {activeSection === 'diagnostics' && <DiagnosticsHelp />}
          {activeSection === 'troubleshooting' && <TroubleshootingHelp />}
          {activeSection === 'export' && <ExportHelp />}
        </div>
      </div>
    </div>
  )
}

const H2: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h2 className="text-lg font-semibold text-white mb-3">{children}</h2>
)
const H3: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h3 className="text-sm font-semibold text-surface-200 mt-4 mb-2">{children}</h3>
)
const P: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="text-sm text-surface-400 leading-relaxed mb-3">{children}</p>
)
const Li: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <li className="text-sm text-surface-400 ml-4 list-disc leading-relaxed">{children}</li>
)

const DashboardHelp = () => (
  <div className="card p-6"><H2>Dashboard</H2>
    <P>The Dashboard is your home screen, giving you a real-time overview of your K2 printer and power usage.</P>
    <H3>Key Features</H3>
    <ul><Li><strong>Live Status</strong> — Shows current printer state (printing, standby, error), active filename, and print progress with estimated time remaining.</Li>
    <Li><strong>Print Thumbnail</strong> — When a print is active, a preview thumbnail is displayed from the printer's G-code metadata or 3MF project file. This helps identify prints at a glance.</Li>
    <Li><strong>Power Monitor</strong> — Real-time wattage graph from your Meross smart plug. Shows live power draw, average watts, and the history over the selected time range. Y-axis shows wattage, X-axis shows time markers.</Li>
    <Li><strong>Summary Cards</strong> — Quick stats for total prints, monthly cost, weekly activity, and filament usage.</Li>
    <Li><strong>CFS Sidebar</strong> — When printing, shows which CFS slot is currently active, its material, color, and remaining weight. Active slot is highlighted.</Li>
    <Li><strong>Recent Jobs</strong> — Shows last 8 jobs with thumbnail previews for quick identification.</Li>
    <Li><strong>Print Queue</strong> — Shows queued prints from Moonraker if any jobs are pending.</Li></ul>
    <H3>Tips</H3>
    <ul><Li>The power graph auto-downsamples to 120 points max for smooth rendering.</Li>
    <Li>Hover over the power graph to see exact wattage at a point in time.</Li>
    <Li>The dashboard auto-refreshes every 5 seconds during active prints.</Li>
    <Li>Thumbnails are proxied from Moonraker — they are only available for files still stored on the printer. Deleted files will not show previews.</Li></ul>
  </div>
)

const PrintJobsHelp = () => (
  <div className="card p-6"><H2>Print Jobs</H2>
    <P>The Print Jobs page shows a complete history of every print tracked by the system, with server-side pagination and filtering.</P>
    <H3>Key Features</H3>
    <ul><Li><strong>Thumbnail Preview</strong> — Each job row shows a small preview image from the printer's G-code metadata or 3MF project file. Expanded rows show a larger preview. Thumbnails are only available for files still on the printer.</Li>
    <Li><strong>Status Filter Tabs</strong> — Filter by All, Complete, Failed, Cancelled, or Printing.</Li>
    <Li><strong>Search</strong> — Search by filename.</Li>
    <Li><strong>Sortable Columns</strong> — Click column headers to sort by date, duration, filament, cost, etc.</Li>
    <Li><strong>Expandable Rows</strong> — Click a row to expand and see a larger thumbnail, per-slot CFS filament usage breakdown with color swatches and grams consumed per slot.</Li>
    <Li><strong>Pagination</strong> — 25 jobs per page with full server-side pagination.</Li></ul>
    <H3>Data Tracking</H3>
    <P>Each print job records: filename, status, start/end time, duration, estimated vs actual time, filament type, filament used (from Moonraker and per-CFS-slot), power cost, and slicer metadata. The thumbnail path is saved when the job is created so previews persist even after the file is deleted from the printer.</P>
    <H3>Cost Calculation</H3>
    <P>Power cost is calculated as <code className="text-accent-400">(kWh used) x (electricity rate)</code>. Filament cost is <code className="text-accent-400">(grams used / 1000) x (cost per kg)</code> using the slot-specific or default cost rate.</P>
  </div>
)

const SpoolsHelp = () => (
  <div className="card p-6"><H2>Spools & CFS</H2>
    <P>This page shows live data from your Creality K2's Colour Filament System (CFS), reflecting what the printer reports in real-time.</P>
    <H3>Key Features</H3>
    <ul><Li><strong>Slot Grid</strong> — All 16 slots (T1A-D, T2A-D, T3A-D, T4A-D) with material, color swatch, and remaining percentage.</Li>
    <Li><strong>Active Slot Indicator</strong> — The currently feeding slot is highlighted during prints.</Li>
    <Li><strong>Remaining Weight</strong> — Shows remaining weight in grams alongside percentage (e.g. "85% · 255g").</Li>
    <Li><strong>Sync CFS to Library</strong> — Pulls current CFS data from Moonraker and creates/updates entries in the Filament Library. This should be run after changing spools.</Li></ul>
    <H3>How CFS Tracking Works</H3>
    <P>The system polls Moonraker every 5 seconds for CFS state. When the active slot changes, it records the measuring_wheel delta to calculate filament consumed. The <code className="text-accent-400">measuring_wheel</code> is per-tray (T1, T2), so cross-tray slot changes are handled safely without computing invalid deltas.</P>
    <H3>Remaining Percentage</H3>
    <P>CFS <code className="text-accent-400">remaining_pct</code> is the authoritative source. When a print ends, the system decrements remaining percentage based on actual filament consumed per slot. If you weigh a spool manually, use the Filament Library weigh function to update it precisely.</P>
  </div>
)

const FilamentHelp = () => (
  <div className="card p-6"><H2>Filament Library</H2>
    <P>The Filament Library is your personal inventory of filament spools, tracking remaining weight, cost, and metadata.</P>
    <H3>Key Features</H3>
    <ul><Li><strong>Card Grid / Table View</strong> — Toggle between Spoolman-style card grid with SVG progress arcs and a detailed table.</Li>
    <Li><strong>Add Spool</strong> — Manually add a spool with brand, material, color, weight, and cost per kg.</Li>
    <Li><strong>SpoolmanDB Picker</strong> — Search the SpoolmanDB database of 1800+ filaments to auto-fill brand, material, density, spool weight, and color when adding a new spool.</Li>
    <Li><strong>Weigh Spool</strong> — Enter the total measured weight (spool + filament on a scale) to precisely calculate remaining filament by subtracting the empty spool weight.</Li>
    <Li><strong>CFS Synced Spools</strong> — Spools with IDs like "T1A", "T2D" were auto-created from CFS sync and track remaining weight from printer data.</Li></ul>
    <H3>Weighing a Spool</H3>
    <P>To weigh: place the spool on a scale, note the total weight, and enter it in the Weigh dialog. The system subtracts the <code className="text-accent-400">spool_weight_g</code> (empty spool tare) to calculate remaining filament. If spool weight is not set, only the total is recorded.</P>
  </div>
)

const CameraHelp = () => (
  <div className="card p-6"><H2>Camera</H2>
    <P>Live camera feed from your K2 printer's built-in camera module.</P>
    <H3>Requirements</H3>
    <ul><Li>The K2 camera module must be enabled on the printer touchscreen: <strong>Settings → Camera → Enable</strong>.</Li>
    <Li>The camera responds on port 8000 of the printer's IP address.</Li>
    <Li>If the feed doesn't load, the camera module may need to be restarted from the printer's interface.</Li></ul>
    <H3>Known Issues</H3>
    <P>Some K2 firmware versions return empty (0-byte) responses from the camera endpoint. Ensure your printer firmware is up to date.</P>
  </div>
)

const FilesHelp = () => (
  <div className="card p-6"><H2>Files</H2>
    <P>Browse G-code files stored on the printer's SD card via Moonraker.</P>
    <H3>Key Features</H3>
    <ul><Li><strong>File List</strong> — Shows all files with name, size, and modification date.</Li>
    <Li><strong>Metadata</strong> — Click a file to see slicer metadata including estimated print time, filament type, and estimated weight.</Li></ul>
  </div>
)

const AnalyticsHelp = () => (
  <div className="card p-6"><H2>Analytics</H2>
    <P>Detailed analytics and charts for understanding your printing costs and patterns over time.</P>
    <H3>Key Features</H3>
    <ul><Li><strong>Cost Breakdown</strong> — Pie chart showing power cost vs filament cost across all prints.</Li>
    <Li><strong>Monthly Trend</strong> — Bar chart of prints, cost, and hours per month.</Li>
    <Li><strong>Slicer Accuracy</strong> — Compares estimated vs actual print time for each job, showing the difference as +/- h:mm:ss (e.g. +43s, -2m 33s). Green indicates the print finished faster than estimated, red indicates it took longer. Helps you calibrate your slicer's time estimates.</Li>
    <Li><strong>CSV Export</strong> — Download all print job data as a CSV file for spreadsheet analysis.</Li></ul>
  </div>
)

const ReportsHelp = () => (
  <div className="card p-6"><H2>Reports</H2>
    <P>The Reports page provides period-based summaries with charts for daily, weekly, or monthly analysis of your printing activity.</P>
    <H3>Key Features</H3>
    <ul><Li><strong>Period Selector</strong> — Switch between Daily, Weekly, or Monthly views. Navigate forward and backward through time periods.</Li>
    <Li><strong>Summary Cards</strong> — Total jobs, success rate, filament used (total and by type), print hours, and total cost (power + filament).</Li>
    <Li><strong>Jobs Over Time</strong> — Stacked bar chart showing completed, failed, and cancelled jobs per period.</Li>
    <Li><strong>Filament & Cost</strong> — Dual bar chart showing filament consumed and cost per period.</Li>
    <Li><strong>Print Hours & Power Cost</strong> — Trend charts for print time and electricity cost over the selected period range.</Li>
    <Li><strong>Job Details Table</strong> — Tabular view of all jobs within the selected period with status badges.</Li></ul>
    <H3>Data Source</H3>
    <P>Reports use the same database as the Print Jobs page. All costs are calculated using the configured electricity rate and per-slot filament costs.</P>
  </div>
)

const CompareHelp = () => (
  <div className="card p-6"><H2>Compare</H2>
    <P>Side-by-side comparison of two print jobs to analyze differences in settings, time, and material usage.</P>
    <H3>Usage</H3>
    <P>Select two print jobs from the dropdowns to compare their parameters including duration, filament used, cost, and slicer estimates.</P>
  </div>
)

const SystemHelp = () => (
  <div className="card p-6"><H2>System</H2>
    <P>Shows real-time system health from the printer's Klipper host.</P>
    <H3>Key Features</H3>
    <ul><Li><strong>CPU Load</strong> — System load average from the K2's Klipper host.</Li>
    <Li><strong>Memory</strong> — Available memory on the printer's host.</Li>
    <Li><strong>Uptime</strong> — How long the Klipper host has been running.</Li></ul>
  </div>
)

const SettingsHelp = () => (
  <div className="card p-6"><H2>Settings</H2>
    <P>Configure all system parameters, connections, and overrides.</P>
    <H3>Sections</H3>
    <ul>
    <Li><strong>Printer Connection</strong> — Moonraker IP and port. Changes take effect immediately for the print tracker.</Li>
    <Li><strong>Meross Power Plug</strong> — Meross account credentials and device name. Required for power monitoring. Can be left blank if you don't use a smart plug.</Li>
    <Li><strong>Power & Currency</strong> — Electricity rate (default $0.49/kWh AUD), currency code, and default filament cost per kg.</Li>
    <Li><strong>Filament Density</strong> — Density values for PLA, ABS, PETG, TPU in g/cm³. Used for mm→grams conversion from measuring wheel data.</Li>
    <Li><strong>Notifications</strong> — Webhook URL for Slack/Discord/ntfy notifications on print events. Toggle individual event types.</Li>
    <Li><strong>Data Export</strong> — Download CSV of all print job data.</Li>
    <Li><strong>Diagnostics</strong> — Run 22 system health checks (see Diagnostics Reference section).</Li>
    <Li><strong>CFS Slot Overrides</strong> — Set cost per kg and spool weight per CFS slot to override defaults. This is critical for accurate per-slot cost tracking.</Li></ul>
  </div>
)

const DiagnosticsHelp = () => (
  <div className="card p-6"><H2>Diagnostics Reference</H2>
    <P>The diagnostic system runs 22 automated tests across 4 categories to verify system health. Tests can be run from <strong>Settings → Diagnostics</strong>.</P>

    <H3>Connectivity Tests (7)</H3>
    <div className="space-y-3 mt-2 mb-4">
      <DiagTest name="moonraker_reachable" desc="Verifies the Moonraker API is accessible at the configured IP:port by requesting /printer/info. Fails if the connection times out or returns a non-200 status." />
      <DiagTest name="moonraker_print_stats" desc="Queries Moonraker for print_stats object. Validates that the response contains both 'state' and 'filename' keys, confirming the printer is reporting print status correctly." />
      <DiagTest name="moonraker_cfs_data" desc="Queries the 'box' and 'filament_rack' Moonraker objects. Counts CFS slots with valid material and color data. Fails if no slots are detected (CFS may be disconnected or powered off)." />
      <DiagTest name="moonraker_vsd" desc="Queries the virtual_sdcard object. Verifies Moonraker's file system is responding, which is needed for file listing and print start detection." />
      <DiagTest name="db_healthy" desc="Runs SELECT 1 against PostgreSQL. Confirms the database connection is alive and responsive." />
      <DiagTest name="db_tables" desc="Checks that all 8 required tables exist (print_jobs, power_logs, filament_library, cfs_slot_overrides, cfs_slot_usage, app_config, users, spools). Fails if any are missing, indicating a migration issue." />
      <DiagTest name="meross_power" desc="Queries the Meross smart plug for current wattage. Fails if the Meross service is not configured or the device is unreachable. A reading of 0W when the printer is on may indicate a credential issue." />
    </div>

    <H3>Data & Logic Tests (10)</H3>
    <div className="space-y-3 mt-2 mb-4">
      <DiagTest name="cfs_sync" desc="Checks that CFS slot data has been synced to the filament_library. If no entries with spool_id exist, run 'Sync CFS → Library' from the Spools page." />
      <DiagTest name="color_normalization" desc="Validates all color_hex values in filament_library and cfs_slot_overrides start with '#'. CFS sends 7-char codes like '0ff614b' which must be normalized to '#ff614b'." />
      <DiagTest name="filament_cost_math" desc="Unit test: verifies 100g at $24/kg = $2.40. Catches floating point errors in cost calculation logic." />
      <DiagTest name="mw_delta" desc="Unit test: verifies |-500 - (-1000)| = 500mm. Validates the measuring_wheel delta calculation used for per-slot filament tracking." />
      <DiagTest name="cross_tray_guard" desc="Scans cfs_slot_usage records for measuring_wheel deltas exceeding 100,000mm, which would indicate a cross-tray slot change was incorrectly used to compute filament consumed." />
      <DiagTest name="filament_decrement" desc="Checks for any filament_library entries with negative remaining_weight_g, which would indicate an over-decrement bug after print completion." />
      <DiagTest name="cfs_override_decrement" desc="Checks for any cfs_slot_overrides with negative remaining_pct, indicating an over-decrement after print completion." />
      <DiagTest name="power_downsample" desc="Requests 60 minutes of power history and verifies the response contains at most 120 data points, confirming server-side downsampling is working." />
      <DiagTest name="auth_token" desc="Creates a JWT token and verifies it. Tests the full auth pipeline: create_access_token → verify_token. Fails if JWT secret is misconfigured." />
      <DiagTest name="settings_crud" desc="Performs a write→read→delete cycle on the app_config table. Verifies database write capability and that settings can be saved and retrieved." />
    </div>

    <H3>Tracker Tests (3)</H3>
    <div className="space-y-3 mt-2 mb-4">
      <DiagTest name="tracker_running" desc="Verifies the background print tracker task is running. If not running, new prints won't be detected. Requires a backend restart to fix." />
      <DiagTest name="active_job" desc="Cross-references the database (PRINTING status jobs) with the tracker's active_job_id. A mismatch indicates the tracker lost sync with the database." />
      <DiagTest name="filament_total" desc="Compares Moonraker's total filament_used_g against the sum of per-slot CFS usage for the latest completed job. A difference &gt;30% may indicate tracking errors." />
    </div>

    <H3>Frontend Tests (2)</H3>
    <div className="space-y-3 mt-2 mb-4">
      <DiagTest name="frontend_served" desc="Checks that the frontend container responds on the Docker network. Any non-5xx response passes, confirming the container is running." />
      <DiagTest name="api_proxy" desc="Verifies the frontend's /api/v1 proxy route is reachable, confirming the Vite proxy configuration is working for API calls." />
    </div>
  </div>
)

const DiagTest: React.FC<{ name: string; desc: string }> = ({ name, desc }) => (
  <div className="bg-surface-800/50 rounded-lg px-4 py-3 border border-surface-700/30">
    <p className="text-sm font-mono text-accent-400 mb-1">{name}</p>
    <p className="text-xs text-surface-400 leading-relaxed">{desc}</p>
  </div>
)

const TroubleshootingHelp = () => (
  <div className="card p-6"><H2>Troubleshooting</H2>

    <H3>Moonraker Connection Issues</H3>
    <div className="space-y-2 mb-4">
      <TroubleItem
        problem="Moonraker not reachable"
        checks={[
          'Verify the printer is powered on and connected to your network',
          'Ping the printer IP from the same machine running K2 Analytics: ping 192.168.1.146',
          'Ensure the Moonraker port (default 7125) is not blocked by firewall',
          'Check the IP in Settings → Printer Connection matches your printer',
          'If using a VLAN, ensure the analytics server and printer are on the same network',
        ]}
      />
      <TroubleItem
        problem="Moonraker connected but no CFS data"
        checks={[
          'Ensure the CFS unit is powered on and connected to the printer',
          'Verify the CFS trays are properly seated (T1, T2 slots)',
          'Run "Sync CFS → Library" from the Spools page after powering on the CFS',
          'Check the diagnostics test "moonraker_cfs_data" for slot count',
        ]}
      />
      <TroubleItem
        problem="Prints not being tracked"
        checks={[
          'Check diagnostics: "tracker_running" must show PASS',
          'Verify the tracker shows "Running" status — if not, restart the backend container',
          'Check that Moonraker is accessible and returning print_stats',
          'If you started a print before the tracker was running, it will only detect new prints',
          'Stale CFS records are auto-cleaned on tracker restart',
        ]}
      />
    </div>

    <H3>Meross Smart Plug Issues</H3>
    <div className="space-y-2 mb-4">
      <TroubleItem
        problem="Meross returning None / no power data"
        checks={[
          'Verify your Meross account email and password in Settings → Meross',
          'The Meross cloud API can be slow — retry after 30 seconds',
          'Ensure the smart plug is registered in the Meross app and online',
          'If using a device UUID, verify it matches the plug (check Meross app → Device Info)',
          'Meross may rate-limit; avoid running repeated power tests',
        ]}
      />
    </div>

    <H3>Database Issues</H3>
    <div className="space-y-2 mb-4">
      <TroubleItem
        problem="Database connection errors"
        checks={[
          'Check the PostgreSQL container is running: docker ps | grep db',
          'Verify the database credentials match in docker-compose.yml',
          'If the DB container was restarted, the backend may need a restart too',
          'Run diagnostics: "db_healthy" and "db_tables" to verify connectivity and schema',
        ]}
      />
      <TroubleItem
        problem="Missing tables or migration issues"
        checks={[
          'Run the "db_tables" diagnostic to see which tables are missing',
          'Tables should be auto-created by SQLAlchemy on first startup',
          'If tables are missing, try: docker compose restart backend',
          'For manual intervention, connect directly: docker exec -it k2-printer-analytics-db-1 psql -U k2user -d k2_analytics',
        ]}
      />
    </div>

    <H3>Authentication Issues</H3>
    <div className="space-y-2 mb-4">
      <TroubleItem
        problem="Redirected to setup page instead of login"
        checks={[
          'This happens when the backend is slow to start and the auth check times out',
          'Wait 10 seconds and refresh the page — the auth check retries with backoff',
          'Clear browser localStorage and try again',
          'If persistent, check that the backend container is fully started: docker logs k2-printer-analytics-backend-1',
        ]}
      />
      <TroubleItem
        problem="Token expired or invalid"
        checks={[
          'Tokens expire after 7 days — simply log in again',
          'Clear localStorage (k2_token, k2_user) and log in fresh',
          'If JWT secret changed (rare), all tokens become invalid — log in again',
        ]}
      />
    </div>

    <H3>CFS Filament Tracking</H3>
    <div className="space-y-2 mb-4">
      <TroubleItem
        problem="Remaining percentage seems wrong"
        checks={[
          'Run "Sync CFS → Library" to refresh from the printer',
          'CFS remaining_pct is the authoritative source — override it in CFS Slot Overrides if needed',
          'If you replaced a spool, sync again and manually update remaining_weight_g in the Filament Library',
          'Check "filament_decrement" and "cfs_override_decrement" diagnostics for negative values',
        ]}
      />
      <TroubleItem
        problem="Cross-tray slot changes show NULL filament_used"
        checks={[
          'This is by design — measuring_wheel is per-tray (T1, T2), so deltas between different trays are meaningless',
          'Cross-tray changes are recorded without mm/g calculation',
          'Only same-tray slot changes compute filament consumption from measuring_wheel deltas',
        ]}
      />
    </div>
  </div>
)

const TroubleItem: React.FC<{ problem: string; checks: string[] }> = ({ problem, checks }) => (
  <div className="bg-surface-800/50 rounded-lg px-4 py-3 border border-surface-700/30">
    <p className="text-sm font-medium text-rose-300 mb-2">{problem}</p>
    <ul className="space-y-1">
      {checks.map((c, i) => (
        <li key={i} className="text-xs text-surface-400 ml-4 list-disc">{c}</li>
      ))}
    </ul>
  </div>
)

const ExportHelp = () => (
  <div className="card p-6"><H2>Export & Logs</H2>
    <P>Export diagnostic data for troubleshooting or sharing with support.</P>

    <H3>Diagnostic Logs</H3>
    <P>Downloads a comprehensive text file containing system info, Docker container status, environment variables (passwords redacted), database configuration, all 22 diagnostic test results, tracker state, database statistics, recent jobs, and CFS slot overrides. This is the most useful file to share when reporting issues.</P>
    <div className="mt-3">
      <a
        href={`${getExportLogsUrl()}?token=${localStorage.getItem('k2_token') || ''}`}
        download="k2-diagnostics.txt"
        className="inline-flex items-center gap-2 px-4 py-2 bg-accent-600 hover:bg-accent-500 text-white text-sm font-medium rounded-lg transition-colors"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
        Export Diagnostic Logs
      </a>
    </div>

    <H3>Print Jobs CSV</H3>
    <P>Available from Analytics or Settings pages. Downloads all print job records as a CSV file suitable for spreadsheet analysis.</P>

    <H3>What's Included in Diagnostic Logs</H3>
    <ul>
      <Li>System hostname, platform, Python version</Li>
      <Li>Docker container status and ports</Li>
      <Li>Environment variables (secrets redacted)</Li>
      <Li>Database configuration from app_config</Li>
      <Li>All 22 diagnostic test results</Li>
      <Li>Print tracker state (running, active job)</Li>
      <Li>Database statistics (job counts by status, library size, CFS records)</Li>
      <Li>5 most recent print jobs</Li>
      <Li>All CFS slot override values</Li>
    </ul>
  </div>
)

export default Help
