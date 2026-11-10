import IconChildCareFill from '~icons/material-symbols/child-care-rounded'
import IconChildCare from '~icons/material-symbols/child-care-outline-rounded'
import IconGroupFill from '~icons/material-symbols/group-rounded'
import IconGroup from '~icons/material-symbols/group-outline-rounded'
import IconHomeFill from '~icons/material-symbols/home-rounded'
import IconHome from '~icons/material-symbols/home-outline-rounded'
import IconPersonFill from '~icons/material-symbols/person-rounded'
import IconPerson from '~icons/material-symbols/person-outline-rounded'
import type { ComponentType, SVGProps } from 'react'
import { useTranslation } from 'react-i18next'

type Icon = ComponentType<SVGProps<SVGSVGElement>>

export interface NavItem {
  to: '/' | '/babies' | '/family' | '/me'
  label: string
  // 선택 = 채움, 나머지 = 외곽선.
  icon: Icon
  activeIcon: Icon
  // 홈만 정확히 일치. 나머지는 하위 주소(/me/trash 등)도 선택.
  exact: boolean
}

// 하단 탭·사이드바 공용.
export function useNavItems(): NavItem[] {
  const { t } = useTranslation()
  return [
    {
      to: '/',
      label: t('nav.home'),
      icon: IconHome,
      activeIcon: IconHomeFill,
      exact: true,
    },
    {
      to: '/babies',
      label: t('nav.babies'),
      icon: IconChildCare,
      activeIcon: IconChildCareFill,
      exact: false,
    },
    {
      to: '/family',
      label: t('nav.family'),
      icon: IconGroup,
      activeIcon: IconGroupFill,
      exact: false,
    },
    {
      to: '/me',
      label: t('nav.me'),
      icon: IconPerson,
      activeIcon: IconPersonFill,
      exact: false,
    },
  ]
}
