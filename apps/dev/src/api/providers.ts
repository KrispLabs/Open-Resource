import { api } from './client'

export interface ProviderField {
  key: string
  label: string
  type: 'secret' | 'text'
  required: boolean
  default: string | null
}

export interface ProviderHealth {
  healthy: boolean
  last_checked: string
  message: string
}

export interface Provider {
  id: string
  name: string
  required: boolean
  description: string
  configured: boolean
  status: 'unconfigured' | 'configured' | 'healthy' | 'unhealthy'
  health: ProviderHealth | null
  fields: ProviderField[]
}

export interface SetupStatus {
  configured: boolean
  providers: { id: string; configured: boolean; required: boolean }[]
}

export async function getSetupStatus(): Promise<SetupStatus> {
  const r = await fetch('/api/setup/status')
  return r.json()
}

export async function listProviders(): Promise<Provider[]> {
  const r = await api.get<Provider[]>('/api/providers')
  return r.data
}

export async function configureProvider(
  provider: string,
  values: Record<string, string>
) {
  const r = await api.post<{ provider: string; health: ProviderHealth }>(
    '/api/providers/configure',
    { provider, values }
  )
  return r.data
}

export async function validateProvider(providerId: string): Promise<ProviderHealth> {
  const r = await api.post<ProviderHealth>(`/api/providers/${providerId}/validate`)
  return r.data
}

export async function rotateProvider(
  providerId: string,
  values: Record<string, string>
) {
  const r = await api.post<{ provider: string; health: ProviderHealth }>(
    `/api/providers/${providerId}/rotate`,
    { provider: providerId, values }
  )
  return r.data
}

export async function disableProvider(providerId: string) {
  const r = await api.delete<{ success: boolean }>(`/api/providers/${providerId}`)
  return r.data
}
