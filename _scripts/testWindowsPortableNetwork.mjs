import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { chromium } from '@playwright/test'

// Attach to the actual portable application so requests use its Chromium network
// service, Windows registry view, proxy settings, and certificate verification.
const [dataDirectory] = process.argv.slice(2)
assert.ok(dataDirectory, 'Pass the portable application data directory')
const [debugPort] = (await readFile(
  path.join(dataDirectory, 'DevToolsActivePort'), 'utf8'
)).split(/\r?\n/)
assert.match(debugPort, /^\d+$/)

const responseBody = randomUUID()
const server = createServer((_request, response) => {
  response.writeHead(200, { 'Access-Control-Allow-Origin': '*' })
  response.end(responseBody)
})
await new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', resolve)
})

let browser
try {
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`)
  const page = browser.contexts().flatMap(context => context.pages())
    .find(page => page.url().startsWith('app://bundle/'))
  assert.ok(page, 'The packaged OpenTubeX page must be open')

  const localUrl = `http://localhost:${server.address().port}/`
  const localResponse = await page.evaluate(async (url) => {
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) })
    return { status: response.status, body: await response.text() }
  }, localUrl)
  assert.deepEqual(localResponse, { status: 200, body: responseBody },
    'The portable application must resolve localhost and receive an HTTP response')

  const secureResponse = await page.evaluate(async () => {
    const response = await fetch('https://www.youtube.com/robots.txt', {
      signal: AbortSignal.timeout(15000)
    })
    return { status: response.status, body: await response.text() }
  })
  assert.equal(secureResponse.status, 200, 'YouTube HTTPS must return HTTP 200')
  assert.match(secureResponse.body, /User-agent:/i,
    'YouTube HTTPS must return the expected body with certificate verification enabled')
  console.log('Windows portable HTTP and HTTPS checks passed.')
} finally {
  await browser?.close()
  server.closeAllConnections()
  await new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve())
  })
}
