import { useQuery } from '@tanstack/react-query'
import api, { USE_MOCK } from '../api/client'
import { mockApplications } from '../api/mock'
import { useAuthStore } from '../store/auth'
import type { ApplicantApplication } from '../api/types'

export function useMyApplications() {
  const token = useAuthStore((s) => s.token)
  return useQuery<ApplicantApplication[]>({
    queryKey: ['applications'],
    enabled: USE_MOCK || !!token,
    queryFn: async () => {
      if (USE_MOCK) return mockApplications
      const { data } = await api.get<ApplicantApplication[]>('/applications')
      return data
    },
  })
}

export function useApplication(id: string | undefined) {
  return useQuery<ApplicantApplication>({
    queryKey: ['applications', id],
    enabled: !!id,
    queryFn: async () => {
      if (USE_MOCK) {
        const app = mockApplications.find((a) => a.id === id)
        if (!app) throw new Error('Application not found')
        return app
      }
      const { data } = await api.get<ApplicantApplication>(`/applications/${id}`)
      return data
    },
  })
}
