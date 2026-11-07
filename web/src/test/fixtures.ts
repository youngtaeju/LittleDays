import type { Role, Settings, User } from '@/api/types'
import { json } from './fetch'

export function userFixture(role: Role): User {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    username: role,
    display_name: role,
    role,
    email: null,
    locale: 'ko',
    created_at: '2026-01-01T00:00:00Z',
    disabled_at: null,
  }
}

export const settingsFixture: Settings = {
  instance_name: '우리 가족',
  timezone: 'Asia/Seoul',
  default_locale: 'ko',
  derivatives_avif: false,
  trash_retention_days: 30,
}

export function apiError(status: number, key: string): Response {
  return json(status, { error: key, params: {} })
}
