import type { TFunction } from 'i18next'

// 하트 누른 사람 요약. names 는 최신순, 앞 두 이름만 표시.
export function likedByText(
  t: TFunction,
  names: string[],
  total: number,
): string {
  const [a = '', b = ''] = names
  if (total <= 1) return a
  if (total === 2) return t('reactions.pair', { a, b })
  return t('reactions.many', { a, b, count: total - 2 })
}
