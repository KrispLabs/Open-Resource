import type { Job } from '@open-resource/shared'

export const mockJobs: Job[] = [
  {
    id: 'mock-job-1',
    created_by: 'mock-hr-1',
    title: 'Senior Frontend Engineer (mock)',
    description: 'This is mock data — backend is unreachable.',
    location: 'Remote',
    job_type: 'remote',
    status: 'active',
    application_deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    shortlist_cutoff: null,
    scoring_weights: {
      technical_skills: 40,
      experience: 25,
      projects: 20,
      education: 8,
      communication: 7,
    },
    jd_parsed: null,
    created_at: new Date().toISOString(),
    closed_at: null,
    hired_at: null,
    hiring_summary: null,
  },
]
