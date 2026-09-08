import assert from 'node:assert/strict'
import { test } from 'node:test'
import { themeScreenshotUrl } from '../../src/renderer/helpers/themeDiscovery.js'

test('uses permanent public attachments instead of expiring screenshot signatures', () => {
  const id = '5724b7e8-f82e-4107-835b-a16d12afd0b5'
  const permanent = `https://github.com/user-attachments/assets/${id}`
  assert.equal(themeScreenshotUrl(`https://private-user-images.githubusercontent.com/24937357/647695754-${id}.png?jwt=expired`), permanent)
  assert.equal(themeScreenshotUrl(permanent), permanent)
  assert.equal(themeScreenshotUrl('https://user-images.githubusercontent.com/1/example.png'), 'https://user-images.githubusercontent.com/1/example.png')
  assert.equal(themeScreenshotUrl('https://camo.githubusercontent.com/hash/image'), 'https://camo.githubusercontent.com/hash/image')
})

test('does not load screenshot URLs from third-party servers or local resources', () => {
  for (const url of [
    'file:///etc/passwd', 'data:image/svg+xml,test', 'javascript:alert(1)',
    'http://github.com/user-attachments/assets/id',
    'https://github.com.evil.test/user-attachments/assets/id',
    'https://tracker.test/image.png', 'https://127.0.0.1/image.png',
    'https://user:pass@github.com/user-attachments/assets/id',
    'https://github.com:444/user-attachments/assets/id',
    'https://github.com/OpenTubeX/OpenTubeX',
    'https://private-user-images.githubusercontent.com/not-an-attachment',
    null,
  ]) assert.equal(themeScreenshotUrl(url), null, String(url))
})
