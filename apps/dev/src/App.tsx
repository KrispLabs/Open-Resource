import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
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

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 10000,
    },
  },
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
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
            </Route>
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  )
}
