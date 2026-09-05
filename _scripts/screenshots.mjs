import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const args = [
  process.execPath,
  require.resolve('@playwright/test/cli'),
  'test',
  '-c', 'e2e/screenshots/playwright.config.mjs',
]
// Always use a private display on Linux, including inside a Wayland session.
const command = process.platform === 'linux' ? 'xvfb-run' : args.shift()
if (process.platform === 'linux') {
  args.unshift('-a', '-s', '-screen 0 1920x1080x24')
}
const result = spawnSync(command, args, {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  // Leave the app's locale preference at System Default.
  env: { ...process.env, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8', LANGUAGE: 'en_US' },
  stdio: 'inherit',
})
if (result.error) {
  console.error(result.error.message)
}
process.exitCode = result.status ?? 1
