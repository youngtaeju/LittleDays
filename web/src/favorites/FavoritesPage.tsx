import { useTranslation } from 'react-i18next'
import { MeSubPage } from '@/me/MeSubPage'
import { useSettings } from '@/settings/useSettings'
import { AssetGrid } from '@/timeline/AssetGrid'
import { useFavorites } from './useFavorites'

export function FavoritesPage() {
  const { t } = useTranslation()
  const timezone = useSettings()?.timezone
  const favorites = useFavorites()
  return (
    <MeSubPage title={t('albums.favorites')} backTo="/albums">
      <AssetGrid
        {...favorites}
        timezone={timezone}
        linkSearch={{ from: 'favorites' }}
        empty={t('favorites.empty')}
      />
    </MeSubPage>
  )
}
