// User & Auth
export type UserRole = 'hr' | 'applicant' | 'dev'

export interface User {
  id: string
  email: string
  name: string
  role: UserRole
  created_at: string
}

export interface AuthResponse {
  access_token: string
  token_type: 'bearer'
  role: UserRole
}

// Jobs
export type JobStatus = 'draft' | 'active' | 'closed' | 'sourcing' | 'interviewing' | 'hired' | 'archived'
export type JobType = 'remote' | 'hybrid' | 'onsite'

export interface ScoringWeights {
  technical_skills: number
  experience: number
  projects: number
  education: number
  communication: number
}

export interface JDParsed {
  role_title: string
  seniority: string
  must_have_skills: string[]
  nice_to_have_skills: string[]
  experience_years_min: number
  proposed_weights: ScoringWeights
  weight_reasoning: string
}

export interface HiringSummary {
  selected_count: number
  notes: string
}

export interface Job {
  id: string
  created_by: string
  title: string
  description: string
  location: string
  job_type: JobType
  status: JobStatus
  application_deadline: string
  shortlist_cutoff: number | null
  scoring_weights: ScoringWeights
  jd_parsed: JDParsed | null
  created_at: string
  closed_at: string | null
  hired_at: string | null
  hiring_summary: HiringSummary | null
  application_count?: number
}

// Applications
export type ApplicationStatus = 'pending' | 'shortlisted' | 'reviewing' | 'rejected' | 'not_shortlisted'

export interface Application {
  id: string
  job_id: string
  applicant_id: string
  applicant_name: string
  resume_filename: string
  cover_note: string
  status: ApplicationStatus
  rank: number | null
  submitted_at: string
  candidate_scores: CandidateScore | null
}

// Candidate Scores
export type Verdict = 'shortlisted' | 'reviewing' | 'rejected'

export interface CandidateScore {
  id: string
  application_id: string
  technical_score: number
  experience_score: number
  project_score: number
  education_score: number
  communication_score: number
  weighted_total: number
  verdict: Verdict
  reasoning: string
  strengths: string[]
  gaps: string[]
  matched_skills: string[]
  missing_skills: string[]
  interview_questions: string[]
  applicant_feedback: string
  scored_at: string
}

export interface ApplicantScoreView {
  weighted_total: number
  verdict: Verdict
  technical_score: number
  experience_score: number
  project_score: number
  education_score: number
  communication_score: number
  applicant_feedback: string
  rank: number | null
}

// SSE Events
export type SSEEventType = 'session_start' | 'step' | 'candidate_start' | 'candidate_done' | 'session_done'

export interface SSEEvent {
  type: SSEEventType
  payload:
    | { total: number }
    | { text: string }
    | { name: string; index: number }
    | { name: string; score: number; verdict: Verdict; index: number }
    | { shortlisted: number; not_shortlisted: number; reviewing: number }
}

// Outbound
export type CampaignStatus = 'running' | 'complete' | 'paused' | 'error'
export type OutreachStatus = 'draft' | 'sent' | 'opened' | 'replied'

export interface OutboundCampaign {
  id: string
  job_id: string
  created_by: string
  status: CampaignStatus
  github_search_signals: string[]
  total_found: number
  total_contacted: number
  run_number: number
  created_at: string
  completed_at: string | null
}

export interface OutboundCandidate {
  id: string
  campaign_id: string
  github_username: string
  github_url: string
  name: string | null
  bio: string | null
  location: string | null
  top_languages: string[]
  notable_repos: Array<{ name: string; stars: number; description: string }>
  followers: number
  public_repos: number
  profile_score: number
  matched_signals: string[]
  gap_signals: string[]
  outreach_email: string
  outreach_status: OutreachStatus
  sent_at: string | null
}

export interface ScoringConfig {
  id: string
  label: string
  weights: ScoringWeights
  is_default: boolean
  updated_at: string
}

export type LogEventType =
  | 'jd_analysis'
  | 'candidate_scoring'
  | 'outbound_signals'
  | 'outbound_profile_score'
  | 'github_search'
  | 'profile_scoring'
  | 'outreach_generation'
  | 'feedback_generation'

export type LogStatus = 'success' | 'error'
export type ApiProvider = 'featherless' | 'github'

export interface SystemLog {
  id: string
  event_type: LogEventType
  job_id: string | null
  application_id: string | null
  campaign_id: string | null
  triggered_by: string | null
  api_provider: ApiProvider
  tokens_used: number | null
  latency_ms: number
  status: LogStatus
  error_message: string | null
  created_at: string
}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  page_size: number
}
