import { useQuery } from '@tanstack/react-query'
import type { Application } from '@open-resource/shared'
import api, { USE_MOCK } from '../api/client'
import { mockApplications } from '../api/mock'

export function useMyApplications() {
  return useQuery<Application[]>({
    queryKey: ['applications'],
    queryFn: async () => {
      if (USE_MOCK) return mockApplications
      const { data } = await api.get<Application[]>('/api/applicant/applications')
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
      const { data } = await api.get<Application>(`/api/applications/${id}`)
      return data
    },
  })
}
