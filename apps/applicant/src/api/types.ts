/**
 * Applicant-portal-local types that mirror the FastAPI ApplicantApplicationResponse
 * and ApplicantScoreView schemas exactly.
 *
 * These differ from the shared Application / CandidateScore types in two ways:
 *   1. The scores field is named `scores` (not `candidate_scores`) and contains
 *      only the subset of fields the backend exposes to applicants.
 *   2. The response includes `job_title` (resolved server-side) and omits
 *      `applicant_id` / `applicant_name` (not returned to the applicant themselves).
 *
 * Do NOT use the shared `Application` type for applicant-side API calls — it
 * matches the HR response shape, not this one.
 */

import type { ApplicationStatus, Verdict } from '@open-resource/shared'

export interface ApplicantScoreView {
  weighted_total: number
  verdict: Verdict
  technical_score: number
  experience_score: number
  project_score: number
  education_score: number
  communication_score: number
  applicant_feedback: string
}

export interface ApplicantApplication {
  id: string
  job_id: string
  job_title: string
  resume_filename: string
  cover_note: string
  status: ApplicationStatus
  rank: number | null
  submitted_at: string
  scores: ApplicantScoreView | null
}
