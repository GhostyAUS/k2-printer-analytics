import React, { useState } from 'react'
import { login } from '../api'

const Login: React.FC = () => {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const result = await login(username, password)
      localStorage.setItem('k2_token', result.access_token)
      localStorage.setItem('k2_user', JSON.stringify({ username: result.username, is_admin: result.is_admin }))
      window.location.href = '/'
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Login failed')
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-surface-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-accent-500 to-accent-700 flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white">K2 Analytics</h1>
          <p className="text-surface-400 mt-1">Sign in to continue</p>
        </div>

        <form onSubmit={handleSubmit} className="card">
          <div className="card-body space-y-4">
            {error && (
              <div className="bg-rose-900/30 border border-rose-700/50 rounded-lg px-3 py-2 text-sm text-rose-300">
                {error}
              </div>
            )}
            <div>
              <label className="text-xs text-surface-500 block mb-1">Username</label>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                className="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2.5 text-surface-200 placeholder-surface-500 focus:outline-none focus:border-accent-500"
                placeholder="admin"
                autoFocus
              />
            </div>
            <div>
              <label className="text-xs text-surface-500 block mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2.5 text-surface-200 placeholder-surface-500 focus:outline-none focus:border-accent-500"
                placeholder="••••••••"
              />
            </div>
            <button
              type="submit"
              disabled={loading || !username || !password}
              className="w-full px-4 py-2.5 bg-accent-600 hover:bg-accent-500 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default Login