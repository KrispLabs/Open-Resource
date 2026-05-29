import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Loader2, Send } from 'lucide-react'
import type { OutboundCampaign } from '@open-resource/shared'
import { api } from '../api/client'

function campaignStatusConfig(status: string): { color: string; bg: string } {
  switch (status) {
    case 'complete':
      return { color: 'var(--color-success)', bg: 'var(--color-success-dim)' }
    case 'running':
      return { color: 'var(--color-primary)', bg: 'var(--color-primary-dim)' }
    default:
      return { color: 'var(--color-danger)', bg: 'var(--color-danger-dim)' }
  }
}

export default function Campaigns() {
  const navigate = useNavigate()

  const { data: campaigns = [], isLoading, error } = useQuery<OutboundCampaign[]>({
    queryKey: ['campaigns'],
    queryFn: () => api.get<OutboundCampaign[]>('/api/campaigns').then((r) => r.data),
  })

  if (isLoading) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          fontSize: '13px',
          color: 'var(--color-text-muted)',
        }}
      >
        <Loader2 size={14} className="animate-spin" /> Loading campaigns…
      </div>
    )
  }

  if (error) {
    return (
      <div
        style={{
          padding: '14px 16px',
          borderRadius: '8px',
          border: '1px solid var(--color-danger)',
          backgroundColor: 'var(--color-danger-dim)',
          fontSize: '13px',
          color: 'var(--color-danger)',
        }}
      >
        Failed to load campaigns. Please refresh or sign in again if your session has expired.
      </div>
    )
  }

  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <h1
          style={{
            fontSize: '20px',
            fontWeight: 700,
            color: 'var(--color-text-primary)',
            marginBottom: '4px',
          }}
        >
          Outbound Campaigns
        </h1>
        <p style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>
          GitHub sourcing campaigns across all jobs.
        </p>
      </div>

      {campaigns.length === 0 ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '80px 24px',
            borderRadius: '8px',
            border: '1px dashed var(--color-elevated)',
          }}
        >
          <Send
            size={36}
            style={{ color: 'var(--color-text-muted)', marginBottom: '12px' }}
          />
          <p
            style={{
              fontSize: '14px',
              fontWeight: 600,
              color: 'var(--color-text-secondary)',
              marginBottom: '4px',
            }}
          >
            No campaigns yet.
          </p>
          <p
            style={{
              fontSize: '13px',
              color: 'var(--color-text-muted)',
              textAlign: 'center',
              maxWidth: '360px',
            }}
          >
            Launch a GitHub sourcing campaign from a closed job to find matching developers.
          </p>
        </div>
      ) : (
        <div
          style={{
            borderRadius: '8px',
            border: '1px solid var(--color-elevated)',
            overflow: 'hidden',
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr
                style={{
                  backgroundColor: 'var(--color-surface)',
                  borderBottom: '1px solid var(--color-elevated)',
                }}
              >
                {['Campaign', 'Found', 'Contacted', 'Status', 'Created'].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: 'left',
                      padding: '10px 16px',
                      fontSize: '11px',
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      color: 'var(--color-text-muted)',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {campaigns.map((campaign, i) => {
                const statusCfg = campaignStatusConfig(campaign.status)
                return (
                  <tr
                    key={campaign.id}
                    onClick={() => navigate(`/campaigns/${campaign.id}`)}
                    style={{
                      borderBottom:
                        i < campaigns.length - 1 ? '1px solid var(--color-elevated)' : 'none',
                      backgroundColor: 'var(--color-surface)',
                      cursor: 'pointer',
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.backgroundColor = 'var(--color-bg-hover)')
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.backgroundColor = 'var(--color-surface)')
                    }
                  >
                    <td style={{ padding: '10px 16px' }}>
                      <div
                        style={{
                          fontSize: '13px',
                          fontWeight: 600,
                          color: 'var(--color-text-primary)',
                        }}
                      >
                        Campaign #{campaign.id.slice(0, 8)}
                      </div>
                      <div
                        style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '2px' }}
                      >
                        Job ID: {campaign.job_id.slice(0, 8)}
                      </div>
                    </td>
                    <td
                      style={{
                        padding: '10px 16px',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '13px',
                        color: 'var(--color-text-primary)',
                      }}
                    >
                      {campaign.total_found}
                    </td>
                    <td
                      style={{
                        padding: '10px 16px',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '13px',
                        color: 'var(--color-text-primary)',
                      }}
                    >
                      {campaign.total_contacted}
                    </td>
                    <td style={{ padding: '10px 16px' }}>
                      <span
                        style={{
                          padding: '2px 8px',
                          borderRadius: '4px',
                          fontSize: '11px',
                          fontWeight: 600,
                          color: statusCfg.color,
                          backgroundColor: statusCfg.bg,
                          textTransform: 'capitalize',
                        }}
                      >
                        {campaign.status}
                      </span>
                    </td>
                    <td
                      style={{
                        padding: '10px 16px',
                        fontSize: '12px',
                        color: 'var(--color-text-muted)',
                      }}
                    >
                      {new Date(campaign.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
