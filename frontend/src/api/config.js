const PRODUCTION_API_BASE_URL = 'https://api.mlops.kro.kr'
const DEVELOPMENT_API_BASE_URL = 'http://127.0.0.1:8000'

// The backend origin is configured in one place for every API consumer.
// Development may override the local default with VITE_API_BASE_URL.
const viteEnv = import.meta.env || {}
export const DEFAULT_API_BASE_URL = viteEnv.MODE === 'production'
  ? PRODUCTION_API_BASE_URL
  : (viteEnv.VITE_API_BASE_URL || DEVELOPMENT_API_BASE_URL)

export function baseUrl(value) {
  return (value || DEFAULT_API_BASE_URL).replace(/\/$/, '')
}
