import { useQuery } from '@tanstack/react-query'
import type { Job } from '@open-resource/shared'
import api, { USE_MOCK } from '../api/client'
import { mockJobs } from '../api/mock'

export function useJobs() {
  return useQuery<Job[]>({
    queryKey: ['jobs'],
    queryFn: async () => {
      if (USE_MOCK) return mockJobs
      const { data } = await api.get<Job[]>('/jobs')
      return data
    },
  })
}

export function useJob(id: string | undefined) {
  return useQuery<Job>({
    queryKey: ['jobs', id],
    enabled: !!id,
    queryFn: async () => {
      if (USE_MOCK) {
        const job = mockJobs.find((j) => j.id === id)
        if (!job) throw new Error('Job not found')
        return job
      }
      const { data } = await api.get<Job>(`/jobs/${id}`)
      return data
    },
  })
}
