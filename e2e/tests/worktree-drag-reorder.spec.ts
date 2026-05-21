import { test, expect } from '../fixtures/tauri-mock'
import { worktree1, worktree2 } from '../fixtures/invoke-handlers'

test.describe('Worktree drag reorder', () => {
  test('reorders sidebar worktrees with the Pragmatic DnD drop indicator', async ({
    mockPage,
  }) => {
    await expect(mockPage.getByText('Test Project')).toBeVisible({
      timeout: 5000,
    })

    const projectsHeader = mockPage.getByText('PROJECTS')
    if (!(await projectsHeader.isVisible().catch(() => false))) {
      await mockPage.keyboard.press('Meta+b')
      await mockPage.waitForTimeout(500)
    }
    await expect(projectsHeader).toBeVisible({ timeout: 3000 })

    const source = mockPage.locator(
      `[data-pdnd-worktree-scope="worktree-list"][data-pdnd-worktree-id="${worktree1.id}"]`
    )
    const target = mockPage.locator(
      `[data-pdnd-worktree-scope="worktree-list"][data-pdnd-worktree-id="${worktree2.id}"]`
    )

    await expect(source).toBeVisible()
    await expect(target).toBeVisible()

    const sourceBox = await source.boundingBox()
    const targetBox = await target.boundingBox()
    expect(sourceBox).not.toBeNull()
    expect(targetBox).not.toBeNull()
    if (!sourceBox || !targetBox) return

    await mockPage.mouse.move(
      sourceBox.x + sourceBox.width / 2,
      sourceBox.y + sourceBox.height / 2
    )
    await mockPage.mouse.down()
    await mockPage.mouse.move(
      sourceBox.x + sourceBox.width / 2,
      sourceBox.y + sourceBox.height / 2 + 12,
      { steps: 4 }
    )
    await mockPage.mouse.move(
      targetBox.x + targetBox.width / 2,
      targetBox.y + targetBox.height * 0.85,
      { steps: 12 }
    )

    await expect(mockPage.getByTestId('drop-indicator')).toBeVisible()

    await mockPage.mouse.up()

    await expect
      .poll(async () =>
        mockPage
          .locator('[data-pdnd-worktree-scope="worktree-list"]')
          .evaluateAll(rows =>
            rows.map(row => (row as HTMLElement).dataset.pdndWorktreeId)
          )
      )
      .toEqual([worktree2.id, worktree1.id])
  })
})
