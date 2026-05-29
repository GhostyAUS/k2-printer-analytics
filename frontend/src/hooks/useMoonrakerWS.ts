import { useState, useEffect, useCallback, useRef } from 'react'

export interface PrinterState {
  state: string
  filename: string | null
  progress: number
  printDuration: number
  filamentUsed: number
  timeRemaining: number | null
  estimatedTime: number | null
  layer: number | null
  layerCount: number | null
  filamentType: string | null
  estimatedFilamentG: number | null
}

export interface LivePower {
  wattage: number | null
  sessionKwh: number
  jobId: number | null
}

export function useMoonrakerWS(url: string) {
  const [printerState, setPrinterState] = useState<PrinterState | null>(null)
  const [connected, setConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectDelay = useRef(1000)

  const connect = useCallback(() => {
    try {
      const ws = new WebSocket(url)
      wsRef.current = ws

      ws.onopen = () => {
        setConnected(true)
        reconnectDelay.current = 1000
      }

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          const method = data.method

          if (method === 'notify_status_update') {
            const params = data.params?.[0] || {}
            const ps = params.print_stats
            const ds = params.display_status
            const vsd = params.virtual_sdcard

            if (ps) {
              setPrinterState(prev => ({
                ...prev,
                state: ps.state || prev?.state || '',
                filename: ps.filename ?? prev?.filename ?? null,
                printDuration: ps.print_duration ?? prev?.printDuration ?? 0,
                filamentUsed: ps.filament_used ?? prev?.filamentUsed ?? 0,
              }) as PrinterState)
            }

            if (ds) {
              setPrinterState(prev => ({
                ...prev,
                progress: ds.progress ?? prev?.progress ?? 0,
              }) as PrinterState)
            }

            if (vsd) {
              const meta = vsd.cur_print_data?.metadata
              setPrinterState(prev => ({
                ...prev,
                layer: vsd.layer ?? prev?.layer ?? null,
                layerCount: vsd.layer_count ?? prev?.layerCount ?? null,
                estimatedTime: meta?.estimated_time ?? prev?.estimatedTime ?? null,
                filamentType: meta?.filament_type ?? prev?.filamentType ?? null,
                estimatedFilamentG: meta?.filament_used_g?.[0] ? parseFloat(meta.filament_used_g[0]) : prev?.estimatedFilamentG ?? null,
              }) as PrinterState)
            }
          }
        } catch (e) {
          // ignore parse errors for non-JSON messages
        }
      }

      ws.onclose = () => {
        setConnected(false)
        reconnectRef.current = setTimeout(() => {
          reconnectDelay.current = Math.min(reconnectDelay.current * 1.5, 30000)
          connect()
        }, reconnectDelay.current)
      }

      ws.onerror = () => {
        ws.close()
      }
    } catch (e) {
      setTimeout(connect, 5000)
    }
  }, [url])

  useEffect(() => {
    connect()
    return () => {
      if (reconnectRef.current) clearTimeout(reconnectRef.current)
      wsRef.current?.close()
    }
  }, [connect])

  return { printerState, connected }
}