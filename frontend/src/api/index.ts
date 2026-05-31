import axios from 'axios'
import type { PrintJob, Spool, CfsSlot, CfsSlotOverride, FilamentRoll } from '../types'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8000',
  timeout: 10000,
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('k2_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('k2_token')
      localStorage.removeItem('k2_user')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

export async function fetchJobs(): Promise<PrintJob[]> {
  const { data } = await api.get('/api/v1/jobs/')
  return data
}

export interface PaginatedJobs {
  items: PrintJob[]
  total: number
  page: number
  per_page: number
  total_pages: number
}

export async function fetchJobsPaginated(params: {
  page?: number
  per_page?: number
  status?: string
  search?: string
  sort_by?: string
  sort_order?: string
}): Promise<PaginatedJobs> {
  const { data } = await api.get('/api/v1/jobs/paginated', { params })
  return data
}

export async function fetchJob(id: number): Promise<PrintJob> {
  const { data } = await api.get(`/api/v1/jobs/${id}`)
  return data
}

export async function fetchSpools(): Promise<Spool[]> {
  const { data } = await api.get('/api/v1/spools/')
  return data
}

export async function fetchCfsSlots(): Promise<{ slots: CfsSlot[]; is_printing: boolean }> {
  const { data } = await api.get('/api/v1/cfs/slots')
  return data
}

export async function fetchActiveSlot(): Promise<{
  active_slot: CfsSlot | null
  slots: CfsSlot[]
  is_printing: boolean
}> {
  const { data } = await api.get('/api/v1/cfs/active')
  return data
}

export async function fetchPrinterStats(): Promise<any> {
  const { data } = await api.get('/api/v1/printer/stats')
  return data
}

export async function fetchPrinterStatus(): Promise<any> {
  const { data } = await api.get('/api/v1/printer/status')
  return data
}

export async function fetchPowerReading(): Promise<{ power_watts: number | null }> {
  const { data } = await api.get('/api/v1/power/current')
  return { power_watts: data.wattage }
}

export async function fetchPrintSessionPower(): Promise<{
  active: boolean
  job_id?: number
  current_wattage: number | null
  total_kwh: number
}> {
  const { data } = await api.get('/api/v1/power/print-session')
  return data
}

export async function fetchCfsOverrides(): Promise<CfsSlotOverride[]> {
  const { data } = await api.get('/api/v1/cfs/overrides')
  return data
}

export async function upsertCfsOverride(slotId: string, override: Partial<CfsSlotOverride>): Promise<CfsSlotOverride> {
  const { data } = await api.put(`/api/v1/cfs/overrides/${slotId}`, override)
  return data
}

export async function resetCfsOverride(slotId: string): Promise<void> {
  await api.delete(`/api/v1/cfs/overrides/${slotId}`)
}

export async function fetchSettings(): Promise<Record<string, string>> {
  const { data } = await api.get('/api/v1/settings/')
  return data
}

export async function setSetting(key: string, value: string): Promise<{ key: string; value: string }> {
  const { data } = await api.put(`/api/v1/settings/${key}`, { value })
  return data
}

export async function resetSetting(key: string): Promise<{ key: string; value: string | null; default: boolean }> {
  const { data } = await api.delete(`/api/v1/settings/${key}`)
  return data
}

export async function fetchFilamentRolls(): Promise<FilamentRoll[]> {
  const { data } = await api.get('/api/v1/filament/')
  return data
}

export async function createFilamentRoll(roll: Partial<FilamentRoll>): Promise<FilamentRoll> {
  const { data } = await api.post('/api/v1/filament/', roll)
  return data
}

export async function createFilamentRolls(roll: Partial<FilamentRoll>, quantity: number): Promise<FilamentRoll[]> {
  const { data } = await api.post('/api/v1/filament/bulk', { roll, quantity })
  return data
}

export async function updateFilamentRoll(id: number, roll: Partial<FilamentRoll>): Promise<FilamentRoll> {
  const { data } = await api.put(`/api/v1/filament/${id}`, roll)
  return data
}

export async function deleteFilamentRoll(id: number): Promise<void> {
  await api.delete(`/api/v1/filament/${id}`)
}

export async function weighFilamentRoll(id: number, measured_weight_g: number): Promise<FilamentRoll> {
  const { data } = await api.post(`/api/v1/filament/${id}/weigh`, { measured_weight_g })
  return data
}

export interface SummaryData {
  total_prints: number
  total_cost: number
  total_filament_kg: number
  total_print_hours: number
  avg_cost_per_print: number
  success_rate: number
  month: { prints: number; cost: number; hours: number; projected_monthly_cost: number }
  week: { prints: number; cost: number; hours: number }
  low_stock_rolls: number
  total_rolls: number
}

export async function fetchSummary(): Promise<SummaryData> {
  const { data } = await api.get('/api/v1/analytics/summary')
  return data
}

export async function fetchPowerHistory(minutes: number = 60): Promise<{ timestamp: string; wattage: number; job_id: number | null }[]> {
  const { data } = await api.get('/api/v1/analytics/power-history', { params: { minutes } })
  return data
}

export interface SlicerAccuracyJob {
  id: number; filename: string; estimated_hours: number; actual_hours: number; variance_pct: number; filament_type: string | null
}
export async function fetchSlicerAccuracy(): Promise<{ jobs: SlicerAccuracyJob[]; summary: { count: number; avg_variance_pct: number; median_variance_pct: number } }> {
  const { data } = await api.get('/api/v1/analytics/slicer-accuracy')
  return data
}

export async function fetchMonthlyTrend(months: number = 6): Promise<any[]> {
  const { data } = await api.get('/api/v1/analytics/monthly-trend', { params: { months } })
  return data
}

export async function fetchPrintQueue(): Promise<{ queue: any[]; count: number }> {
  const { data } = await api.get('/api/v1/analytics/queue').catch(() => ({ data: { queue: [], count: 0 } }))
  return data
}

export async function fetchMaintenance(): Promise<{ total_print_hours: number; items: any[] }> {
  const { data } = await api.get('/api/v1/analytics/maintenance')
  return data
}

export async function markMaintenanceDone(key: string): Promise<any> {
  const { data } = await api.post(`/api/v1/analytics/maintenance/${key}/done`)
  return data
}

export async function fetchSlotUsage(jobId: number): Promise<any[]> {
  const { data } = await api.get(`/api/v1/analytics/slot-usage/${jobId}`)
  return data
}

export async function syncCfsToLibrary(): Promise<{ synced: any[]; count: number }> {
  const { data } = await api.post('/api/v1/cfs/sync-library')
  return data
}

export async function fetchNotificationConfig(): Promise<Record<string, string>> {
  const { data } = await api.get('/api/v1/analytics/notifications/config')
  return data
}

export async function updateNotificationConfig(config: Record<string, string>): Promise<any> {
  const { data } = await api.put('/api/v1/analytics/notifications/config', config)
  return data
}

export function getExportCsvUrl(): string {
  return (import.meta.env.VITE_API_URL || 'http://localhost:8000') + '/api/v1/analytics/export/csv'
}

export interface PrinterFile {
  filename: string
  path: string
  size: number
  size_mb: number
  modified: number
}

export async function fetchPrinterFiles(): Promise<{ files: PrinterFile[]; total: number }> {
  const { data } = await api.get('/api/v1/files/list')
  return data
}

export async function fetchFileMetadata(filename: string): Promise<any> {
  const { data } = await api.get('/api/v1/files/metadata', { params: { filename } })
  return data
}

export async function fetchSetupStatus(): Promise<{
  configured: boolean
  moonraker_host: string
  moonraker_port: number
  moonraker_connected: boolean
  meross_configured: boolean
  has_user: boolean
}> {
  const { data } = await api.get('/api/v1/settings/setup/status')
  return data
}

export async function testConnection(host: string, port: number): Promise<{ connected: boolean; host: string; port: number }> {
  const { data } = await api.get('/api/v1/settings/setup/test-connection', { params: { host, port } })
  return data
}

export async function saveConnection(data: {
  moonraker_host?: string
  moonraker_port?: number
  meross_email?: string
  meross_password?: string
  meross_device_name?: string
  meross_device_uuid?: string
  timezone?: string
  currency?: string
  electricity_rate_kwh?: number
}): Promise<any> {
  const { data: result } = await api.put('/api/v1/settings/connection', data)
  return result
}

export async function login(username: string, password: string): Promise<{ access_token: string; username: string; is_admin: boolean }> {
  const { data } = await api.post('/api/v1/auth/login', { username, password })
  return data
}

export async function register(username: string, password: string): Promise<{ access_token: string; username: string; is_admin: boolean }> {
  const { data } = await api.post('/api/v1/auth/register', { username, password })
  return data
}

export async function fetchAuthStatus(): Promise<{ initialized: boolean; authenticated: boolean; username: string | null; is_admin: boolean }> {
  const { data } = await api.get('/api/v1/auth/status')
  return data
}

export interface SpoolmanDBFilament {
  id: string
  manufacturer: string
  name: string
  material: string
  density: number
  weight: number
  spool_weight: number
  diameter: number
  color_hex: string | null
  extruder_temp: number | null
  bed_temp: number | null
}

export interface SpoolmanDBMaterial {
  name: string
  density: number
  extruder_temp: number | null
  bed_temp: number | null
}

export async function fetchSpoolmanDBMaterials(): Promise<SpoolmanDBMaterial[]> {
  const { data } = await api.get('/api/v1/spoolmandb/materials')
  return data
}

export async function fetchSpoolmanDBBrands(search?: string): Promise<string[]> {
  const { data } = await api.get('/api/v1/spoolmandb/brands', { params: search ? { search } : {} })
  return data
}

export async function fetchSpoolmanDBMaterialNames(): Promise<string[]> {
  const { data } = await api.get('/api/v1/spoolmandb/material-names')
  return data
}

export async function searchSpoolmanDBFilaments(params: {
  brand?: string
  material?: string
  search?: string
  limit?: number
}): Promise<SpoolmanDBFilament[]> {
  const { data } = await api.get('/api/v1/spoolmandb/filaments', { params })
  return data
}

export interface DebugTestResult {
  name: string
  passed: boolean
  detail: string
  duration_ms: number
}

export async function fetchDebugTests(): Promise<Record<string, string[]>> {
  const { data } = await api.get('/api/v1/debug/tests')
  return data.categories
}

export async function runDebugTest(name: string): Promise<DebugTestResult> {
  const { data } = await api.post('/api/v1/debug/run-test', { name })
  return data
}

export async function runAllDebugTests(): Promise<{
  results: DebugTestResult[]
  total: number
  passed: number
  failed: number
}> {
  const { data } = await api.post('/api/v1/debug/run-all')
  return data
}

export function getExportLogsUrl(): string {
  const base = import.meta.env.VITE_API_URL || 'http://localhost:8000'
  return `${base}/api/v1/debug/export-logs`
}

export function getThumbnailUrl(filename: string): string {
  const base = import.meta.env.VITE_API_URL || 'http://localhost:8000'
  const token = localStorage.getItem('k2_token') || ''
  return `${base}/api/v1/files/thumbnail-image?filename=${encodeURIComponent(filename)}&token=${encodeURIComponent(token)}`
}

export async function thumbnailBackfill(limit: number = 100): Promise<{ updated: number; failed: number; checked: number }> {
  const { data } = await api.post('/api/v1/files/thumbnail-backfill', null, { params: { limit } })
  return data
}

export default api
