import { createApiClient } from '@open-resource/shared'

export const USE_MOCK = false

const api = createApiClient(import.meta.env.VITE_API_URL || 'http://localhost:8000')

export default api
