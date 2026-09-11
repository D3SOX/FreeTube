import { createServer } from 'node:http'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'

import { test, expect } from '../../helpers/app.mjs'

const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6l8AAAAASUVORK5CYII=', 'base64')
const server = createServer()
let origin
let otherOrigin
let accountRequests = 0

test.use({
  launchArgs: ['--host-resolver-rules=MAP *.otx-test.invalid 127.0.0.1', '--no-proxy-server']
})

test.beforeAll(async () => {
  server.on('request', async (request, response) => {
    // Model services that support API requests but do not implement browser CORS.
    if (request.method === 'OPTIONS') {
      response.writeHead(405).end()
      return
    }
    if (request.url === '/frame') {
      response.setHeader('Content-Type', 'text/html')
      response.end('<!doctype html><title>Foreign frame</title><body>foreign content</body>')
      return
    }
    if (request.url === '/redirect') {
      response.writeHead(302, { Location: `${otherOrigin}/api` }).end()
      return
    }
    if (request.url === '/image') {
      response.writeHead(200, { 'Content-Type': 'image/png' }).end(pixel)
      return
    }
    if (request.url === '/media') {
      response.writeHead(206, {
        'Content-Type': 'application/octet-stream',
        'Content-Range': 'bytes 2-5/8',
        'Accept-Ranges': 'bytes'
      }).end('2345')
      return
    }
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    response.writeHead(request.url === '/unauthorized' ? 401 : 200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
      'X-Response-Fixture': 'visible'
    }).end(JSON.stringify({
      ...(request.url === '/account' ? { requestNumber: ++accountRequests } : {}),
      method: request.method,
      body: Buffer.concat(chunks).toString(),
      authorization: request.headers.authorization,
      range: request.headers.range
    }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  origin = `http://server.otx-test.invalid:${port}`
  otherOrigin = `http://other.otx-test.invalid:${port}`
})

test.afterAll(async () => {
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
})

test('isolates foreign frames and keeps their cross-origin requests restricted', async ({ app, page }) => {
  await page.evaluate(async url => {
    const frame = document.createElement('iframe')
    frame.id = 'foreign-frame'
    frame.hidden = true
    await new Promise(resolve => {
      frame.onload = resolve
      frame.src = url
      document.body.append(frame)
    })
  }, `${origin}/frame`)
  const appCanReadForeignFrame = await page.evaluate(() => {
    try {
      return !!document.getElementById('foreign-frame').contentWindow.document.body
    } catch {
      return false
    }
  })
  expect(appCanReadForeignFrame).toBe(false)

  const foreignFrame = page.frames().find(frame => frame.url() === `${origin}/frame`)
  const access = await foreignFrame.evaluate(async url => {
    let parentAccessible = false
    try { parentAccessible = !!parent.document.body } catch {}
    const read = target => fetch(target, { signal: AbortSignal.timeout(5000) })
      .then(response => response.text()).then(() => true, () => false)
    return {
      parentAccessible,
      remoteReadable: await read(url),
      bundleReadable: await read('app://bundle/index.html')
    }
  }, `${otherOrigin}/api`)
  expect(access).toEqual({ parentAccessible: false, remoteReadable: false, bundleReadable: false })
  expect(await app.electronApp.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences().webSecurity
  )).toBe(true)
})

test('preserves app API requests, redirects, HTTP errors, ranges and image pixels', async ({ page }) => {
  const result = await page.evaluate(async url => {
    const response = await fetch(`${url}/api`, {
      method: 'PUT',
      headers: { Authorization: 'synthetic-test-token', 'Content-Type': 'application/json' },
      body: '{"fixture":true}',
      credentials: 'include'
    })
    const media = await fetch(`${url}/media`, { headers: { Range: 'bytes=2-5' } })
    const redirected = await fetch(`${url}/redirect`)
    const unauthorized = await fetch(`${url}/unauthorized`)
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.src = `${url}/image`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const context = canvas.getContext('2d')
    context.drawImage(image, 0, 0)
    return {
      api: await response.json(),
      responseHeader: response.headers.get('X-Response-Fixture'),
      media: { status: media.status, range: media.headers.get('Content-Range'), body: await media.text() },
      redirected: { status: redirected.status, url: redirected.url },
      unauthorized: unauthorized.status,
      pixelReadable: context.getImageData(0, 0, 1, 1).data.length === 4
    }
  }, origin)
  expect(result).toEqual({
    api: { method: 'PUT', body: '{"fixture":true}', authorization: 'synthetic-test-token' },
    responseHeader: 'visible',
    media: { status: 206, range: 'bytes 2-5/8', body: '2345' },
    redirected: { status: 200, url: `${otherOrigin}/api` },
    unauthorized: 401,
    pixelReadable: true
  })

  // A redirect can produce an Origin:null grant. It must not become a cached
  // permission for an unrelated sandbox with an opaque origin.
  await page.evaluate(() => {
    const frame = document.createElement('iframe')
    frame.id = 'opaque-frame'
    frame.sandbox = 'allow-scripts'
    frame.hidden = true
    frame.srcdoc = '<!doctype html><body data-opaque-fixture></body>'
    document.body.append(frame)
  })
  const opaqueFrame = page.frameLocator('#opaque-frame')
  await expect(opaqueFrame.locator('[data-opaque-fixture]')).toBeAttached()
  expect(await opaqueFrame.locator('body').evaluate(
    async (_body, url) => ({
      origin: window.origin,
      readable: await fetch(url).then(() => true, () => false)
    }), `${otherOrigin}/api`
  )).toEqual({ origin: 'null', readable: false })
})

test('preserves images when the in-memory cache replaces the disk cache', async ({ app }) => {
  await writeFile(path.join(app.userDataDir, 'experiment-replace-http-cache'), '')
  const { page } = await app.relaunch()
  const pixels = await page.evaluate(async url => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.src = url
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const context = canvas.getContext('2d')
    context.drawImage(image, 0, 0)
    return context.getImageData(0, 0, 1, 1).data.length
  }, `${origin}/image`)
  expect(pixels).toBe(4)
})

test('does not reuse cached responses across Invidious credentials', async ({ app, page }) => {
  const responses = []
  for (const token of ['first-test-account', 'first-test-account', 'second-test-account', null]) {
    // Deliver the real IPC event synchronously so the next fetch sees the new account.
    await app.electronApp.evaluate(({ ipcMain, BrowserWindow }, { token, origin }) => {
      const sender = BrowserWindow.getAllWindows()[0].webContents
      ipcMain.emit('set-invidious-authorization', { sender, senderFrame: sender.mainFrame }, token, origin)
    }, { token, origin })
    responses.push(await page.evaluate(async ({ url, token }) => {
      // Match invidiousFetch: credentials and cache mode must reach Chromium before lookup.
      const response = await fetch(url, {
        headers: token ? { Authorization: token } : {},
        cache: token ? 'no-store' : 'default'
      })
      return { body: await response.json(), cache: response.headers.get('cache-control') }
    }, { url: `${origin}/account`, token }))
  }
  expect(responses.map(response => response.body.authorization ?? null)).toEqual([
    'first-test-account', 'first-test-account', 'second-test-account', null
  ])
  expect(responses.slice(0, 3).map(response => response.cache)).toEqual(['no-store', 'no-store', 'no-store'])
  expect(responses.map(response => response.body.requestNumber)).toEqual([1, 2, 3, 4])
  expect(responses[3].cache).toBe('public, max-age=3600')
})

test.describe('session proxy', () => {
  test.use({ launchArgs: [] })

  test('sends authenticated renderer requests through the configured proxy', async ({ app, page }) => {
    const proxy = `http://127.0.0.1:${server.address().port}`
    await app.electronApp.evaluate(async ({ session }, proxyRules) => {
      await session.defaultSession.setProxy({ proxyRules })
      await session.defaultSession.closeAllConnections()
    }, proxy)
    const result = await page.evaluate(async () => {
      const response = await fetch('http://proxy-only.otx-test.invalid/api', {
        headers: { Authorization: 'synthetic-proxy-token' },
        signal: AbortSignal.timeout(5000)
      })
      return response.json()
    })
    expect(result).toEqual({ method: 'GET', body: '', authorization: 'synthetic-proxy-token' })
  })
})
