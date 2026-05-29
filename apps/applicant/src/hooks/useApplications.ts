import { useQuery } from '@tanstack/react-query'
import type { Application } from '@open-resource/shared'
import api, { USE_MOCK } from '../api/client'
import { mockApplications } from '../api/mock'
import { useAuthStore } from '../store/auth'

export function useMyApplications() {
  const token = useAuthStore((s) => s.token)
  return useQuery<Application[]>({
    queryKey: ['applications'],
    enabled: USE_MOCK || !!token,
    queryFn: async () => {
      if (USE_MOCK) return mockApplications
      const { data } = await api.get<Application[]>('/applications')
      return data
    },
  })
}

export function useApplication(id: string | undefined) {
  return useQuery<Application>({
    queryKey: ['applications', id],
    enabled: !!id,
    queryFn: async () => {
      if (USE_MOCK) {
        const app = mockApplications.find((a) => a.id === id)
        if (!app) throw new Error('Application not found')
        return app
      }
      const { data } = await api.get<Application>(`/applications/${id}`)
      return data
    },
  })
}
