// 첫 페인트 전 다크 적용. 규칙은 src/theme/theme.ts 와 동일. CSP 때문에 인라인 불가.
try {
  const p = localStorage.getItem('ld.theme')
  if (
    p === 'dark' ||
    (p !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches)
  ) {
    document.documentElement.classList.add('dark')
  }
} catch {
  // 저장소 접근 불가. 앱 시작 시 initTheme 이 다시 적용.
}
