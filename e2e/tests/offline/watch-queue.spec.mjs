import { test, expect, goTo } from '../../helpers/app.mjs'

function historyEntry (videoId, title, timeWatched) {
  return {
    _id: videoId,
    videoId,
    title,
    author: 'Queue Test Channel',
    authorId: 'UC-queue-test-channel',
    published: Date.now() - 86400000,
    description: '',
    viewCount: 100,
    lengthSeconds: 60,
    watchProgress: 10,
    isWatched: false,
    timeWatched,
    isLive: false,
    type: 'video'
  }
}

const now = Date.now()

test.use({
  seed: {
    history: [
      historyEntry('queuevideo01', 'Queue video one', now - 1000),
      historyEntry('queuevideo02', 'Queue video two', now - 2000),
      historyEntry('queuevideo03', 'Queue video three', now - 3000),
      historyEntry('currentvid01', 'Current video', now - 4000)
    ]
  }
})

async function chooseVideoOption (page, title, option) {
  const video = page.locator('.ft-list-video').filter({ hasText: title })
  await video.hover()
  await video.locator('.title').click({ button: 'right' })
  await page.getByRole('menuitem', { name: option }).click()
}

test('manages a temporary queue from video menus and the watch sidebar', async ({ page }) => {
  await goTo(page, 'history')

  await chooseVideoOption(page, 'Queue video one', 'Add to Queue')
  await chooseVideoOption(page, 'Queue video two', 'Add to Queue')
  await chooseVideoOption(page, 'Queue video three', 'Play Next')

  await page.getByRole('link', { name: /Current video/ }).click()

  const queue = page.locator('.watchQueue')
  await expect(queue).toBeVisible()
  await expect(queue.locator('.queueDragHandle svg')).toHaveCount(3)
  await expect(queue.locator('.queueVideoTitle')).toHaveText([
    'Queue video three',
    'Queue video one',
    'Queue video two'
  ])

  const queueItems = queue.locator('.queueItem')
  const queueItem = title => queueItems.filter({ hasText: title })
  const reorderButton = title => queueItem(title).getByRole('button', { name: `Reorder ${title}` })
  const moveStatus = queue.locator('[role="status"]')

  await expect(moveStatus).toHaveCount(1)
  await expect(moveStatus).toHaveAttribute('aria-live', 'polite')
  await expect(moveStatus).toHaveAttribute('aria-atomic', 'true')
  await expect(queueItems.locator('[role="status"]')).toHaveCount(0)

  const middleReorderButton = reorderButton('Queue video one')
  await expect(middleReorderButton).toHaveAccessibleName('Reorder Queue video one')
  await expect(middleReorderButton).toHaveAccessibleDescription(
    'Use the Up and Down Arrow keys to move this video in the queue.'
  )
  await expect(middleReorderButton).toHaveAttribute('aria-keyshortcuts', 'ArrowUp ArrowDown')
  await expect(queueItem('Queue video one')).toHaveAttribute('aria-posinset', '2')
  await expect(queueItem('Queue video one')).toHaveAttribute('aria-setsize', '3')

  const draggedItem = reorderButton('Queue video three')
  await expect(draggedItem).toHaveAttribute('title', 'Drag Queue video three to reorder queue')
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer())
  await draggedItem.dispatchEvent('dragstart', { dataTransfer })
  await queueItem('Queue video two').dispatchEvent('drop', { dataTransfer })
  await draggedItem.dispatchEvent('dragend', { dataTransfer })
  await expect(queue.locator('.queueVideoTitle')).toHaveText([
    'Queue video one',
    'Queue video two',
    'Queue video three'
  ])

  const firstReorderButton = reorderButton('Queue video one')
  await firstReorderButton.press('ArrowUp')
  await expect(queue.locator('.queueVideoTitle')).toHaveText([
    'Queue video one',
    'Queue video two',
    'Queue video three'
  ])
  await expect(firstReorderButton).toBeFocused()
  await expect(moveStatus).toHaveText(
    'Cannot move Queue video one up. It is already at position 1 of 3.'
  )

  const thirdReorderButton = reorderButton('Queue video three')
  await thirdReorderButton.press('ArrowDown')
  await expect(queue.locator('.queueVideoTitle')).toHaveText([
    'Queue video one',
    'Queue video two',
    'Queue video three'
  ])
  await expect(thirdReorderButton).toBeFocused()
  await expect(moveStatus).toHaveText(
    'Cannot move Queue video three down. It is already at position 3 of 3.'
  )

  await thirdReorderButton.press('ArrowUp')
  await expect(queue.locator('.queueVideoTitle')).toHaveText([
    'Queue video one',
    'Queue video three',
    'Queue video two'
  ])
  await expect(queueItem('Queue video three')).toHaveAttribute('aria-posinset', '2')
  await expect(queueItem('Queue video three')).toHaveAttribute('aria-setsize', '3')
  await expect(thirdReorderButton).toBeFocused()
  await expect(moveStatus).toHaveText('Moved Queue video three to position 2 of 3.')

  await page.keyboard.press('ArrowDown')
  await expect(queue.locator('.queueVideoTitle')).toHaveText([
    'Queue video one',
    'Queue video two',
    'Queue video three'
  ])
  await expect(queueItem('Queue video three')).toHaveAttribute('aria-posinset', '3')
  await expect(thirdReorderButton).toBeFocused()
  await expect(moveStatus).toHaveText('Moved Queue video three to position 3 of 3.')

  await queue.getByRole('button', { name: 'Remove Queue video three from queue' }).click()
  await expect(queue.locator('.queueVideoTitle')).toHaveText([
    'Queue video one',
    'Queue video two'
  ])

  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    for (let index = 0; index < 20; index++) {
      store.commit('addVideoToWatchQueue', {
        video: {
          videoId: `overflow${index}`,
          title: `Overflow video ${index}`,
          author: 'Queue Test Channel'
        }
      })
    }
  })
  await expect(queueItems).toHaveCount(22)
  const queueScroller = queue.locator('.queueItems')
  await queueScroller.evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect.poll(() => queueScroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    const queueItemIds = store.getters.getWatchQueue.slice(4).map(item => item.queueItemId)
    for (const queueItemId of queueItemIds) {
      store.commit('removeVideoFromWatchQueue', queueItemId)
    }
  })
  await expect(queueItems).toHaveCount(4)
  await expect.poll(() => queueScroller.evaluate(element => element.scrollTop)).toBe(0)

  await queue.getByRole('button', { name: 'Clear Queue' }).click()
  await expect(queue).toBeHidden()
})
