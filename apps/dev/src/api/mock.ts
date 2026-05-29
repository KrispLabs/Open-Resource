// Minimal mock data for Dev portal — returned when USE_MOCK=true
export const mockStats = {
  total_jobs: 3,
  active_jobs: 2,
  closed_jobs: 1,
  total_applications: 12,
  total_scored: 8,
  claude_calls_today: 0,
  claude_tokens_today: 0,
  github_calls_today: 0,
  avg_latency_ms: 0,
  error_rate_today: 0,
  shortlisted_total: 3,
  not_shortlisted_total: 9,
}

export const mockLogs: { logs: unknown[]; total: number } = { logs: [], total: 0 }

export const mockScoringConfig = {
  id: 'mock-config-1',
  label: 'Default',
  weights: {
    technical_skills: 40,
    experience: 25,
    projects: 20,
    education: 8,
    communication: 7,
  },
  is_default: true,
  updated_at: new Date().toISOString(),
}
