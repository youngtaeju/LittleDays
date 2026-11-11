import type {
  Asset,
  AssetSummary,
  Baby,
  DaySummary,
  Role,
  Settings,
  User,
} from '@/api/types'
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

export function babyFixture(over: Partial<Baby> = {}): Baby {
  return {
    id: '00000000-0000-4000-8000-0000000000b1',
    name: '하늘',
    birth_date: '2024-01-31',
    sex: null,
    avatar_asset_id: null,
    avatar_crop: null,
    sort_order: 0,
    ...over,
  }
}

// ready 사진. 요약·상세 공용 필드.
const photoFields = {
  kind: 'photo',
  status: 'ready',
  taken_at: '2024-05-10T03:00:00Z',
  width: 4032,
  height: 3024,
  duration_ms: null,
  blurhash: null,
  dominant_color: '#8899aa',
  uploaded_by: '00000000-0000-4000-8000-000000000001',
  baby_ids: [],
  derivatives: {
    thumb: { formats: ['webp'], width: 400, height: 400 },
    preview: { formats: ['webp'], width: 1600, height: 1200 },
  },
} satisfies Omit<AssetSummary, 'id' | 'local_date'>

export function assetSummaryFixture(
  id: string,
  over: Partial<AssetSummary> = {},
): AssetSummary {
  return { ...photoFields, id, local_date: '2024-05-10', ...over }
}

export function assetFixture(id: string, over: Partial<Asset> = {}): Asset {
  return {
    ...photoFields,
    id,
    camera_make: null,
    camera_model: null,
    caption: null,
    created_at: '2024-05-10T03:00:00Z',
    deleted_at: null,
    file_modified_at: null,
    gps_lat: null,
    gps_lon: null,
    mime: 'image/jpeg',
    original_filename: 'IMG_0001.JPG',
    processing_error: null,
    size_bytes: 1_000_000,
    taken_at_source: 'exif',
    like_count: 0,
    comment_count: 0,
    liked: false,
    favorited: false,
    ...over,
  }
}

// 사진 1장인 하루. preview 항목 id 는 `${date}-a`.
export function dayFixture(
  date: string,
  over: Partial<DaySummary> = {},
): DaySummary {
  return {
    date,
    photo_count: 1,
    video_count: 0,
    uploader_ids: [userFixture('guardian').id],
    baby_ids: [],
    like_count: 0,
    comment_count: 0,
    preview: [assetSummaryFixture(`${date}-a`, { local_date: date })],
    ...over,
  }
}

// `/` 도착 시 피드 요청. 빈 목록.
export const emptyFeedRoutes = {
  'GET /api/babies': () => json(200, []),
  'GET /api/days': () => json(200, { items: [], next_cursor: null }),
  'GET /api/users': () => json(200, { users: [] }),
}
