import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initI18n } from '@/i18n'
import ko from '@/locales/ko.json'
import { AddSheet } from './AddSheet'

beforeEach(() => {
  initI18n('ko')
})

describe('AddSheet', () => {
  // 셸이 연결하는 항목 동작. 키/몸무게, 마일스톤 기록 시트가 이 콜백으로 연결.
  it('items_invoke_callbacks', async () => {
    const calls: string[] = []
    const onOpenChange = vi.fn<(open: boolean) => void>()
    const user = userEvent.setup()
    render(
      <AddSheet
        open
        onOpenChange={onOpenChange}
        onUpload={() => calls.push('upload')}
        onStory={() => calls.push('story')}
        onGrowth={() => calls.push('growth')}
        onMilestone={() => calls.push('milestone')}
      />,
    )
    const sheet = screen.getByRole('dialog', { name: ko.addSheet.title })
    for (const name of [
      ko.addSheet.growth,
      ko.addSheet.milestone,
      ko.addSheet.story,
      ko.addSheet.upload,
    ]) {
      await user.click(within(sheet).getByRole('button', { name }))
    }
    expect(calls).toEqual(['growth', 'milestone', 'story', 'upload'])
    // 누를 때마다 시트 닫기.
    expect(onOpenChange.mock.calls).toEqual([
      [false],
      [false],
      [false],
      [false],
    ])
  })
})
