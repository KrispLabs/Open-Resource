import { useState, useRef, useCallback, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Upload, FileText, X, CheckCircle } from 'lucide-react'
import { useJob } from '../hooks/useJobs'
import { useMyApplications } from '../hooks/useApplications'
import { useToast } from '../components/Toast'
import { Skeleton } from '../components/Skeleton'
import api from '../api/client'
import { MAX_COVER_NOTE_CHARS, MAX_RESUME_SIZE_MB } from '@open-resource/shared'

const MAX_BYTES = MAX_RESUME_SIZE_MB * 1024 * 1024

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function Apply() {
  const { jobId } = useParams<{ jobId: string }>()
  const navigate = useNavigate()
  const { data: job, isLoading: jobLoading } = useJob(jobId)
  const { data: applications } = useMyApplications()
  const { showToast } = useToast()

  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState('')
  const [coverNote, setCoverNote] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Redirect if already applied
  useEffect(() => {
    if (applications && jobId) {
      const alreadyApplied = applications.some((a) => a.job_id === jobId)
      if (alreadyApplied) {
        navigate('/dashboard', { replace: true })
      }
    }
  }, [applications, jobId, navigate])

  const validateFile = (f: File): string => {
    if (f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) {
      return 'Only PDF files are accepted.'
    }
    if (f.size > MAX_BYTES) {
      return 'File must be under 5MB.'
    }
    return ''
  }

  const handleFile = useCallback(async (f: File) => {
    setFileError('')
    const err = validateFile(f)
    if (err) {
      setFileError(err)
      setFile(null)
      return
    }
    try {
      const buffer = await f.slice(0, 4).arrayBuffer()
      const header = new TextDecoder().decode(buffer)
      if (!header.startsWith('%PDF')) {
        setFileError('Only PDF files are accepted.')
        setFile(null)
        return
      }
    } catch {
      setFileError('Could not read the file. Please try again.')
      setFile(null)
      return
    }
    setFile(f)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      const dropped = e.dataTransfer.files[0]
      if (dropped) handleFile(dropped)
    },
    [handleFile]
  )

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = () => setIsDragging(false)

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0]
    if (picked) handleFile(picked)
    e.target.value = ''
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file) return
    if (coverNote.length > MAX_COVER_NOTE_CHARS) return

    setSubmitError('')
    setSubmitting(true)

    try {
      const form = new FormData()
      form.append('resume', file)
      form.append('cover_note', coverNote)

      await api.post(`/api/jobs/${jobId}/apply`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })

      sessionStorage.setItem('or_apply_success', '1')
      navigate('/dashboard')
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      if (status === 409) {
        const msg = "You've already applied to this role."
        setSubmitError(msg)
        showToast(msg, 'error')
      } else if (status === 422) {
        const msg = detail ?? 'Could not extract text from this PDF. Try a text-based PDF.'
        setSubmitError(msg)
        showToast(msg, 'error')
      } else {
        const msg = 'Submission failed. Please try again.'
        setSubmitError(msg)
        showToast(msg, 'error')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const charCount = coverNote.length
  const charOverLimit = charCount > MAX_COVER_NOTE_CHARS
  const charNearLimit = charCount > 450

  if (jobLoading) {
    return (
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <Skeleton height="28px" width="50%" style={{ marginBottom: 12 }} />
        <Skeleton height="14px" width="35%" style={{ marginBottom: 20 }} />
        <div className="card">
          <Skeleton height="120px" />
        </div>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Apply</h1>
          {job && (
            <p className="page-subtitle">{job.title} — {job.location}</p>
          )}
        </div>
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* PDF Dropzone */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-default)' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Resume</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>PDF only, max 5MB</div>
          </div>

          <div style={{ padding: 16 }}>
            {!file ? (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '32px 24px',
                  borderRadius: 'var(--radius-lg)',
                  border: `2px dashed ${isDragging ? 'var(--color-primary)' : 'var(--border-default)'}`,
                  backgroundColor: isDragging ? 'var(--color-primary-dim)' : 'transparent',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload
                  size={32}
                  style={{ color: isDragging ? 'var(--color-primary)' : 'var(--text-muted)', marginBottom: 10 }}
                />
                <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)' }}>
                  Drag and drop your resume here
                </p>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>or click to browse</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,application/pdf"
                  onChange={handleInputChange}
                  style={{ display: 'none' }}
                />
              </div>
            ) : (
              <div
                className="card"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  backgroundColor: 'var(--color-success-dim)',
                  borderColor: 'var(--color-success)',
                }}
              >
                <CheckCircle size={20} style={{ color: 'var(--color-success)', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {file.name}
                  </p>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {formatBytes(file.size)} — Resume ready
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => { setFile(null); setFileError('') }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', flexShrink: 0, padding: 4 }}
                >
                  <X size={16} />
                </button>
              </div>
            )}

            {fileError && (
              <p className="form-error-msg" style={{ marginTop: 8 }}>{fileError}</p>
            )}

            {!file && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--color-primary)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
              >
                <FileText size={13} />
                Browse files
              </button>
            )}
          </div>
        </div>

        {/* Cover Note */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-default)' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
              Cover Note{' '}
              <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span>
            </div>
          </div>
          <div style={{ padding: 16 }}>
            <textarea
              value={coverNote}
              onChange={(e) => setCoverNote(e.target.value)}
              rows={5}
              placeholder="Tell us why you're excited about this role..."
              className={`form-textarea${charOverLimit ? ' form-input--error' : ''}`}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  color: charOverLimit
                    ? 'var(--color-danger)'
                    : charNearLimit
                    ? 'var(--color-warning)'
                    : 'var(--text-muted)',
                }}
              >
                {charCount} / {MAX_COVER_NOTE_CHARS}
              </span>
            </div>
          </div>
        </div>

        {/* Submit error */}
        {submitError && (
          <div
            className="card"
            style={{ borderColor: 'var(--color-danger)', backgroundColor: 'var(--color-danger-dim)', color: 'var(--color-danger)', fontSize: 13 }}
          >
            {submitError}
          </div>
        )}

        {/* Submit button */}
        <button
          type="submit"
          disabled={!file || charOverLimit || submitting}
          className="btn btn-primary btn-lg"
          style={{ width: '100%' }}
        >
          {submitting ? 'Uploading your application...' : 'Submit Application'}
        </button>
      </form>
    </div>
  )
}
