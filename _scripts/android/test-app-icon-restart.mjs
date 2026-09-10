import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from '@playwright/test'

// Run outside instrumentation: restarting the app also kills its test runner.
// Acquire the Android lab device lock before invoking this test with its serial.
const serial = process.argv[2]
assert.ok(serial, 'Pass the locked emulator/device serial')
const app = 'org.opentubex.app.dev'
const adb = (...args) => execFileSync('adb', ['-s', serial, ...args], { encoding: 'utf8' }).trim()
const pid = () => {
  try { return adb('shell', 'pidof', app) } catch { return '' }
}
let browser
let port
async function connect(processId) {
  if (browser) await browser.close()
  if (port) adb('forward', '--remove', `tcp:${port}`)
  port = adb('forward', 'tcp:0', `localabstract:webview_devtools_remote_${processId}`)
  let lastError
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { noDefaults: true })
      const page = browser.contexts()[0].pages()[0]
      if (page) {
        await page.waitForFunction(() => !!document.querySelector('#app')?.__vue_app__)
        return page
      }
      await browser.close()
    } catch (error) { lastError = error }
    await delay(100)
  }
  throw new Error('Restarted WebView did not become ready', { cause: lastError })
}
async function picker(page) {
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('showSettingsWindow'))
  if (await page.locator('.appIconPresets').isVisible()) return
  if (!await page.locator('.appIconSettingsButton').isVisible()) {
    await page.locator('.settingsMenu [data-section=appearance]').click()
  }
  await page.locator('.appIconSettingsButton').click()
  await page.locator('.appIconPresets:not(:disabled) input:checked').waitFor()
}
try {
  const launcher = adb('shell', 'cmd', 'package', 'resolve-activity', '--brief', '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.LAUNCHER', app).split('\n').at(-1)
  adb('shell', 'am', 'start', '--user', '0', '-n', launcher)
  for (let attempt = 0; !pid() && attempt < 50; attempt++) await delay(100)
  const originalPid = pid()
  assert.ok(originalPid, 'App started')
  let page = await connect(originalPid)
  await picker(page)
  const original = await page.locator('.appIconPresets input:checked').inputValue()
  const chosen = original === 'dracula' ? 'default' : 'dracula'
  await page.locator(`.appIconPreset input[value=${chosen}]`).check()
  await page.locator('.appIconAppliedPrompt button:last-child').click()
  await delay(12000)
  assert.equal(pid(), originalPid, 'Dismiss must keep the existing process alive')
  assert.equal(await page.locator('.appIconPresets input:checked').inputValue(), chosen)
  await page.locator(`.appIconPreset input[value=${original}]`).check()
  await page.locator('.appIconAppliedPrompt button:first-child').click().catch(() => {})
  let restartedPid = ''
  for (let attempt = 0; attempt < 100; attempt++) {
    restartedPid = pid()
    if (restartedPid && restartedPid !== originalPid) break
    await delay(100)
  }
  assert.ok(restartedPid, 'Restart must reopen the app')
  assert.notEqual(restartedPid, originalPid, 'Restart must terminate the original app process')
  page = await connect(restartedPid)
  await picker(page)
  assert.equal(await page.locator('.appIconPresets input:checked').inputValue(), original, 'Icon selection survives process restart')
  console.log('PASS: Dismiss preserves the process; Restart replaces it, reopens the renderer, and preserves the selected icon')
} finally {
  if (browser) await browser.close()
  if (port) adb('forward', '--remove', `tcp:${port}`)
}
