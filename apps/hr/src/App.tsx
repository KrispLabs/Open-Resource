import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ProtectedRoute } from './components/ProtectedRoute'
import { Layout } from './components/Layout'
import { ToastProvider } from './components/Toast'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Jobs from './pages/Jobs'
import JobCreate from './pages/JobCreate'
import JobDetail from './pages/JobDetail'
import WeightEditor from './pages/WeightEditor'
import ScoringStream from './pages/ScoringStream'
import Rankings from './pages/Rankings'
import Shortlist from './pages/Shortlist'
import Outbound from './pages/Outbound'
import Campaign from './pages/Campaign'
import Campaigns from './pages/Campaigns'

const queryClient = new QueryClient()

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
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="jobs" element={<Jobs />} />
            <Route path="jobs/new" element={<JobCreate />} />
            <Route path="jobs/:id" element={<JobDetail />} />
            <Route path="jobs/:id/weights" element={<WeightEditor />} />
            <Route path="jobs/:id/scoring" element={<ScoringStream />} />
            <Route path="jobs/:id/rankings" element={<Rankings />} />
            <Route path="jobs/:id/shortlist" element={<Shortlist />} />
            <Route path="jobs/:id/outbound" element={<Outbound />} />
            <Route path="campaigns" element={<Campaigns />} />
            <Route path="campaigns/:id" element={<Campaign />} />
          </Route>
        </Routes>
      </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  )
}
