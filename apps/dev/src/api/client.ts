import { createApiClient } from '@open-resource/shared'

export const USE_MOCK = false

export const api = createApiClient(import.meta.env.VITE_API_URL ?? 'http://localhost:8000')
