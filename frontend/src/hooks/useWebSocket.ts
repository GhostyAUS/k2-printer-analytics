import { useState, useEffect } from 'react'

export const useWebSocket = (url: string) => {
  const [socket, setSocket] = useState<WebSocket | null>(null)
  const [data, setData] = useState<any>(null)
  const [connected, setConnected] = useState<boolean>(false)

  useEffect(() => {
    const ws = new WebSocket(url)
    
    ws.onopen = () => {
      setConnected(true)
    }

    ws.onmessage = (event) => {
      setData(JSON.parse(event.data))
    }

    ws.onclose = () => {
      setConnected(false)
    }

    ws.onerror = (error) => {
      console.error('WebSocket error:', error)
    }

    setSocket(ws)

    return () => {
      ws.close()
    }
  }, [url])

  return { socket, data, connected }
}