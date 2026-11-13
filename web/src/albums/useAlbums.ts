import { useQuery } from '@tanstack/react-query'
import { api, call } from '@/api/client'

// 앨범 쿼리 키 공통 접두. ['assets'] 아래라 사진 변경(휴지통, 복원, 촬영 시각, 처리 완료, 업로드)의 기존 무효화가 앨범 개수, 표지, 목록에도 적용.
export const albumsKeyRoot = ['assets', 'albums'] as const

// 우리 앨범 목록. 순서는 서버 응답대로.
export function useAlbums() {
  return useQuery({
    queryKey: [...albumsKeyRoot],
    queryFn: () => call(api.GET('/api/albums')),
  })
}
