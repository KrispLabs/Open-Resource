export const JOB_TYPES = ['remote', 'hybrid', 'onsite'] as const
export const JOB_STATUSES = ['draft', 'active', 'closed', 'archived'] as const
export const USER_ROLES = ['hr', 'applicant', 'dev'] as const
export const VERDICTS = ['shortlisted', 'reviewing', 'rejected'] as const

export const SCORING_CATEGORIES = [
  'technical_skills',
  'experience',
  'projects',
  'education',
  'communication',
] as const

export const DEFAULT_WEIGHTS = {
  technical_skills: 40,
  experience: 25,
  projects: 20,
  education: 8,
  communication: 7,
} as const

export const MAX_RESUME_SIZE_MB = 5
export const MAX_COVER_NOTE_CHARS = 500
export const MAX_CONCURRENT_SCORING = 5
export const JWT_EXPIRE_DAYS = 7

export const VERDICT_LABELS: Record<string, string> = {
  shortlisted: 'Shortlisted',
  reviewing: 'Reviewing',
  rejected: 'Rejected',
}

export const VERDICT_COLORS: Record<string, string> = {
  shortlisted: '#057A55',
  reviewing: '#B45309',
  rejected: '#B91C1C',
}

export const SSE_EVENT_TYPES = [
  'session_start',
  'step',
  'candidate_start',
  'candidate_done',
  'session_done',
] as const
