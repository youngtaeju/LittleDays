import { useTranslation } from 'react-i18next'
import { MeSubPage } from '@/me/MeSubPage'
import { useSettings } from '@/settings/useSettings'
import { AssetGrid } from '@/timeline/AssetGrid'
import { useTimeline } from '@/timeline/useTimeline'

// 모든 영상. 촬영 최신순(자산 목록 순서).
export function VideosPage() {
  const { t } = useTranslation()
  const timezone = useSettings()?.timezone
  const videos = useTimeline(undefined, { kind: 'video' })
  return (
    <MeSubPage title={t('albums.videos')} backTo="/albums">
      <AssetGrid
        {...videos}
        timezone={timezone}
        linkSearch={{ from: 'videos' }}
        empty={t('albums.videosEmpty')}
      />
    </MeSubPage>
  )
}
