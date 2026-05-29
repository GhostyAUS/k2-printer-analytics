import React, { useState, useEffect } from 'react'

const CAMERA_URL_KEY = 'k2_camera_url'
const DEFAULT_URL = 'http://192.168.1.146:8000/stream'

const Camera: React.FC = () => {
  const [cameraUrl, setCameraUrl] = useState(() => localStorage.getItem(CAMERA_URL_KEY) || DEFAULT_URL)
  const [inputUrl, setInputUrl] = useState(cameraUrl)
  const [status, setStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle')

  useEffect(() => {
    setCameraUrl(localStorage.getItem(CAMERA_URL_KEY) || DEFAULT_URL)
    setInputUrl(localStorage.getItem(CAMERA_URL_KEY) || DEFAULT_URL)
  }, [])

  const saveUrl = () => {
    const url = inputUrl.trim() || DEFAULT_URL
    setCameraUrl(url)
    setInputUrl(url)
    localStorage.setItem(CAMERA_URL_KEY, url)
    setStatus('idle')
  }

  const testConnection = async () => {
    setStatus('loading')
    try {
      const res = await fetch(inputUrl.trim() || DEFAULT_URL, { method: 'GET', signal: AbortSignal.timeout(5000) })
      const ct = res.headers.get('content-type') || ''
      const size = parseInt(res.headers.get('content-length') || '0')
      if (ct.startsWith('image/') || ct.startsWith('multipart/') || size > 1000) {
        setStatus('ok')
      } else if (res.ok && size === 0) {
        setStatus('error')
      } else {
        setStatus('error')
      }
    } catch {
      setStatus('error')
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Camera</h1>
      <p className="text-sm text-surface-400 mt-1">Live printer camera feed</p>

      <div className="card">
        <div className="card-body space-y-4">
          <div>
            <label className="text-sm text-surface-400 mb-1 block">Camera Stream URL</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={inputUrl}
                onChange={e => setInputUrl(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && saveUrl()}
                placeholder={DEFAULT_URL}
                className="flex-1 bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm text-surface-200 placeholder-surface-500 focus:outline-none focus:border-accent-500"
              />
              <button
                onClick={saveUrl}
                className="px-4 py-2 bg-accent-600 hover:bg-accent-500 text-white text-sm font-medium rounded-lg transition-colors"
              >Save</button>
              <button
                onClick={testConnection}
                className="px-4 py-2 bg-surface-700 hover:bg-surface-600 text-surface-300 text-sm font-medium rounded-lg transition-colors"
              >Test</button>
            </div>
            <div className="flex items-center gap-3 mt-2">
              {status === 'loading' && <span className="text-xs text-surface-500">Testing connection...</span>}
              {status === 'ok' && <span className="text-xs text-emerald-400">Connection successful — stream is active</span>}
              {status === 'error' && <span className="text-xs text-amber-400">Camera port responded but returned no data. The Creality K2 camera may need to be enabled in Settings → Camera on the printer's touchscreen.</span>}
            </div>
            <p className="text-xs text-surface-500 mt-1">
              Default: <span className="text-surface-300 font-mono">{DEFAULT_URL}</span>
            </p>
            <p className="text-xs text-surface-500 mt-1">
              The K2 camera runs on port 8000. If the feed is blank, enable the camera in the printer's settings (Settings → Camera on the touchscreen) and ensure a microSD card is inserted for timelapse storage.
            </p>
          </div>

          {cameraUrl && (
            <div className="aspect-video bg-surface-900 rounded-lg overflow-hidden relative">
              <img
                src={cameraUrl}
                alt="Printer Camera"
                className="w-full h-full object-contain"
                onLoad={() => setStatus('ok')}
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none'
                  const parent = (e.target as HTMLImageElement).parentElement
                  if (parent && !parent.querySelector('.camera-error')) {
                    const div = document.createElement('div')
                    div.className = 'camera-error flex flex-col items-center justify-center h-full text-surface-500'
                    div.innerHTML = `
                      <svg class="w-12 h-12 mb-3 text-surface-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
                      </svg>
                      <p class="text-sm font-medium">No camera feed</p>
                      <p class="text-xs text-surface-600 mt-1">Enable the camera in Settings → Camera on the printer touchscreen</p>
                    `
                    parent.appendChild(div)
                  }
                }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default Camera