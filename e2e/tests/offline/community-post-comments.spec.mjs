import { test, expect } from '../../helpers/app.mjs'

test.use({ seed: { settings: { backendPreference: 'invidious', hideComments: true } } })

test('Hide Comments controls post comments without hiding the post', async ({ page }) => {
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  let commentRequests = 0
  await page.route('**/api/v1/post/**', async route => {
    const isComments = new URL(route.request().url()).pathname.endsWith('/comments')
    if (isComments) commentRequests++
    await route.fulfill({
      json: isComments
        ? { comments: [], commentCount: 0 }
        : {
            comments: [{
              commentId: 'e2e-post',
              contentHtml: 'Post with optional comments',
              author: 'Test Channel',
              authorId: 'UC-test-channel-id',
              authorThumbnails: [{ url: 'https://example.com/avatar.png', width: 48, height: 48 }],
              publishedText: '1 day ago',
              likeCount: 3,
              replyCount: 0
            }]
          }
    })
  })
  await page.evaluate(() => {
    return window.ftElectron.tabs.create({ route: '/post/e2e-post', query: { authorId: 'UC-test-channel-id' } })
  })
  await expect(page.getByText('Post with optional comments', { exact: true })).toBeVisible()
  await expect(page.locator('.noComments')).toHaveCount(0)
  expect(commentRequests).toBe(0)

  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateHideComments', false)
  })
  await expect.poll(() => commentRequests).toBeGreaterThan(0)
  expect(pageErrors).toEqual([])
  await expect(page.locator('.noComments')).toBeVisible()

  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateHideComments', true)
  })
  await expect(page.locator('.noComments')).toHaveCount(0)
  await expect(page.getByText('Post with optional comments', { exact: true })).toBeVisible()
})
