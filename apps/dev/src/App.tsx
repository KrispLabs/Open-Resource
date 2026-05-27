import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from './components/Toast'
import { ProtectedRoute } from './components/ProtectedRoute'
import { Layout } from './components/Layout'
import Login from './pages/Login'
import DevDashboard from './pages/DevDashboard'
import AllJobs from './pages/AllJobs'
import Logs from './pages/Logs'
import ScoringConfig from './pages/ScoringConfig'
import ApiUsage from './pages/ApiUsage'
import Setup from './pages/Setup'
import AdminProviders from './pages/AdminProviders'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 10000,
    },
  },
})

// Must be inside BrowserRouter to use useLocation
function SetupGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState<'loading' | 'setup' | 'ok'>('loading')
  const location = useLocation()

  useEffect(() => {
    fetch('/api/setup/status')
      .then(r => r.json())
      .then(data => setReady(data.configured ? 'ok' : 'setup'))
      .catch(() => setReady('ok')) // don't block app if backend unreachable
  }, [])

  if (ready === 'loading') {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center',
        justifyContent: 'center', backgroundColor: 'var(--bg-base)',
      }}>
        <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Checking configuration…</div>
      </div>
    )
  }
  if (ready === 'setup' && location.pathname !== '/setup') {
    return <Navigate to="/setup" replace />
  }
  return <>{children}</>
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter>
          <SetupGate>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/setup" element={<Setup />} />
              <Route
                path="/"
                element={
                  <ProtectedRoute>
                    <Layout />
                  </ProtectedRoute>
                }
              >
                <Route index element={<Navigate to="/dashboard" replace />} />
                <Route path="dashboard" element={<DevDashboard />} />
                <Route path="jobs" element={<AllJobs />} />
                <Route path="logs" element={<Logs />} />
                <Route path="scoring-config" element={<ScoringConfig />} />
                <Route path="api-usage" element={<ApiUsage />} />
                <Route path="admin/providers" element={<AdminProviders />} />
              </Route>
            </Routes>
          </SetupGate>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  )
}
