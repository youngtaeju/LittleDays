import IconCalendarFill from '~icons/material-symbols/calendar-month-rounded'
import IconCalendar from '~icons/material-symbols/calendar-month-outline-rounded'
import IconHomeFill from '~icons/material-symbols/home-rounded'
import IconHome from '~icons/material-symbols/home-outline-rounded'
import IconPersonFill from '~icons/material-symbols/person-rounded'
import IconPerson from '~icons/material-symbols/person-outline-rounded'
import IconAlbumsFill from '~icons/material-symbols/photo-library-rounded'
import IconAlbums from '~icons/material-symbols/photo-library-outline-rounded'
import type { ComponentType, SVGProps } from 'react'
import { useTranslation } from 'react-i18next'

type Icon = ComponentType<SVGProps<SVGSVGElement>>

export interface NavItem {
  to: '/' | '/calendar' | '/albums' | '/me'
  label: string
  // 선택 = 채움, 나머지 = 외곽선.
  icon: Icon
  activeIcon: Icon
  // 선택 기준 주소. 홈은 정확히 일치, 나머지는 하위 주소 포함.
  paths: readonly string[]
}

// 하단 탭, 사이드바 공용.
export function useNavItems(): NavItem[] {
  const { t } = useTranslation()
  return [
    {
      to: '/',
      label: t('nav.home'),
      icon: IconHome,
      activeIcon: IconHomeFill,
      paths: [],
    },
    {
      to: '/calendar',
      label: t('nav.calendar'),
      icon: IconCalendar,
      activeIcon: IconCalendarFill,
      paths: ['/calendar'],
    },
    {
      to: '/albums',
      label: t('nav.albums'),
      icon: IconAlbums,
      activeIcon: IconAlbumsFill,
      paths: ['/albums'],
    },
    {
      to: '/me',
      label: t('nav.me'),
      icon: IconPerson,
      activeIcon: IconPersonFill,
      // 탭이 없는 아기, 가족 화면은 나 탭 우리 집 소속.
      paths: ['/me', '/babies', '/family'],
    },
  ]
}

export function isNavActive(item: NavItem, pathname: string): boolean {
  if (item.to === '/') return pathname === '/'
  return item.paths.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}
