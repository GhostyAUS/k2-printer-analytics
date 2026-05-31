import { useRef, useEffect, useState, useCallback } from 'react'

interface CacheEntry<T> {
  data: T
  timestamp: number
}

const cache = new Map<string, CacheEntry<any>>()
const inflight = new Map<string, Promise<any>>()

const DEFAULT_TTL = 30_000

export function cachedFetch<T>(key: string, fetcher: () => Promise<T>, ttl: number = DEFAULT_TTL): Promise<T> {
  const cached = cache.get(key)
  if (cached && Date.now() - cached.timestamp < ttl) {
    return Promise.resolve(cached.data)
  }
  const existing = inflight.get(key)
  if (existing) return existing
  const p = fetcher().then(data => {
    cache.set(key, { data, timestamp: Date.now() })
    inflight.delete(key)
    return data
  }).catch(err => {
    inflight.delete(key)
    throw err
  })
  inflight.set(key, p)
  return p
}

export function invalidateCache(keys?: string[]) {
  if (keys) {
    keys.forEach(k => cache.delete(k))
  } else {
    cache.clear()
  }
}

export function useFetch<T>(key: string, fetcher: () => Promise<T>, ttl: number = DEFAULT_TTL) {
  const [data, setData] = useState<T | null>(() => {
    const c = cache.get(key)
    return c ? c.data : null
  })
  const [error, setError] = useState<Error | null>(null)
  const [loading, setLoading] = useState(() => !cache.has(key))
  const fetchRef = useRef(fetcher)
  fetchRef.current = fetcher

  const load = useCallback(async () => {
    try {
      const result = await cachedFetch(key, () => fetchRef.current(), ttl)
      setData(result)
      setError(null)
    } catch (e) {
      setError(e as Error)
    } finally {
      setLoading(false)
    }
  }, [key, ttl])

  useEffect(() => {
    load()
  }, [load])

  const refresh = useCallback(async () => {
    cache.delete(key)
    setLoading(true)
    await load()
  }, [key, load])

  return { data, error, loading, refresh }
}
