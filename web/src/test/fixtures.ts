import type {
  AlbumSummary,
  Asset,
  AssetSummary,
  Baby,
  Comment,
  DaySummary,
  Milestone,
  Role,
  Settings,
  Story,
  StoryComment,
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
    album_ids: [],
    ...over,
  }
}

// 빈 앨범. 만든 사람은 userFixture 공용 id.
export function albumFixture(
  id: string,
  over: Partial<AlbumSummary> = {},
): AlbumSummary {
  return {
    id,
    name: '첫 제주 여행',
    cover: null,
    photo_count: 0,
    video_count: 0,
    from: null,
    to: null,
    created_by: '00000000-0000-4000-8000-000000000001',
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
    ...over,
  }
}

// 사진 a 의 댓글. 기본 작성자는 userFixture 공용 id.
export function commentFixture(
  id: string,
  over: Partial<Comment> = {},
): Comment {
  return {
    id,
    asset_id: 'a',
    author_id: userFixture('guardian').id,
    body: '예뻐요',
    created_at: '2024-05-10T03:00:00Z',
    edited_at: null,
    ...over,
  }
}

// 이야기 s 의 댓글. 기본 작성자는 userFixture 공용 id.
export function storyCommentFixture(
  id: string,
  over: Partial<StoryComment> = {},
): StoryComment {
  return {
    id,
    story_id: 's',
    author_id: userFixture('guardian').id,
    body: '좋아요',
    created_at: '2024-05-10T03:00:00Z',
    edited_at: null,
    ...over,
  }
}

// 사진 없는 글만 있는 이야기.
export function storyFixture(id: string, over: Partial<Story> = {}): Story {
  return {
    id,
    author_id: userFixture('guardian').id,
    entry_date: '2024-05-10',
    body: '오늘 처음 웃었어요',
    created_at: '2024-05-10T03:00:00Z',
    edited_at: null,
    baby_ids: [],
    previews: [],
    asset_count: 0,
    like_count: 0,
    comment_count: 0,
    assets: [],
    liked: false,
    ...over,
  }
}

// 사진 없는 미리 정한 마일스톤(첫 이). 기본 기록한 사람은 userFixture 공용 id.
export function milestoneFixture(
  id: string,
  over: Partial<Milestone> = {},
): Milestone {
  return {
    id,
    baby_id: '00000000-0000-4000-8000-0000000000b1',
    preset_key: 'first_tooth',
    custom_label: null,
    achieved_on: '2024-05-10',
    note: null,
    created_by: userFixture('guardian').id,
    created_at: '2024-05-10T03:00:00Z',
    updated_at: '2024-05-10T03:00:00Z',
    previews: [],
    asset_count: 0,
    assets: [],
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
    stories: [],
    milestones: [],
    ...over,
  }
}

// `/` 도착 시 피드 요청. 빈 목록.
export const emptyFeedRoutes = {
  'GET /api/babies': () => json(200, []),
  'GET /api/days': () => json(200, { items: [], next_cursor: null }),
  'GET /api/memories': () => json(200, null),
  'GET /api/users': () => json(200, { users: [] }),
}
