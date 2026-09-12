import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { computed, ref } from 'vue'
import { appendTimestamp, getInvidiousVideoUrl, getYoutubeVideoShareUrl } from '../../src/renderer/helpers/share.js'

const shareComponent = readFileSync(new URL('../../src/renderer/components/FtShareButton/FtShareButton.vue', import.meta.url), 'utf8')
const setup = shareComponent.match(/<script setup>([\s\S]*?)<\/script>/)[1]
  .replace(/^import[\s\S]*? from ['"][^'"]+['"]\n/gm, '')

function createShareActions(props = {}, userPlaylist = null) {
  const calls = []
  const bindings = {
    computed,
    ref,
    useTemplateRef: () => ({ value: { hideDropdown: () => calls.push('close') } }),
    useI18n: () => ({ t: key => key }),
    defineProps: () => ({ shareTargetType: 'Video', id: 'video123', playlistId: '', getTimestamp: () => 42, ...props }),
    store: { getters: {
      getCurrentInvidiousInstanceUrl: 'https://invidious.example',
      getPlaylist: () => userPlaylist,
    } },
    appendTimestamp,
    getInvidiousVideoUrl,
    getYoutubeVideoShareUrl,
    shareLink: url => { calls.push(url) },
    process: { env: { IS_CAPACITOR: true } },
  }
  const actions = new Function(...Object.keys(bindings), `${setup}\nreturn { shareYoutube, shareInvidious, updateIncludeTimestamp }`)(...Object.values(bindings))
  return { ...actions, calls }
}

test('share panel closes and sends the public URL with the selected timestamp and playlist', () => {
  const actions = createShareActions({ playlistId: 'PL123' })
  actions.shareYoutube()
  actions.updateIncludeTimestamp()
  actions.shareYoutube()
  actions.shareInvidious()
  assert.deepEqual(actions.calls, [
    'close', 'https://youtu.be/video123?list=PL123',
    'close', 'https://youtu.be/video123?list=PL123&t=42',
    'close', 'https://invidious.example/watch?v=video123&list=PL123&t=42',
  ])
})

test('native sharing excludes local playlist IDs', () => {
  const actions = createShareActions({ playlistId: 'private-playlist' }, { id: 'private-playlist' })
  actions.shareYoutube()
  actions.shareInvidious()
  assert.deepEqual(actions.calls, [
    'close', 'https://youtu.be/video123',
    'close', 'https://invidious.example/watch?v=video123',
  ])
})

for (const [type, youtubePath, invidiousPath] of [
  ['Channel', 'www.youtube.com/channel/id123', 'channel/id123'],
  ['Playlist', 'youtube.com/playlist?list=id123', 'playlist?list=id123'],
  ['Post', 'www.youtube.com/post/id123', 'post/id123'],
]) {
  test(`native sharing preserves ${type} URLs without a timestamp`, () => {
    const actions = createShareActions({ shareTargetType: type, id: 'id123', getTimestamp: null })
    actions.updateIncludeTimestamp()
    actions.shareYoutube()
    actions.shareInvidious()
    assert.deepEqual(actions.calls, [
      'close', `https://${youtubePath}`,
      'close', `https://invidious.example/${invidiousPath}`,
    ])
  })
}

test('long-press sharing captures the public URL before dismissing the menu', async () => {
  const app = readFileSync(new URL('../../src/renderer/App.vue', import.meta.url), 'utf8')
  const handler = app.match(/async function shareMobileContextLink\(\) \{[\s\S]*?\n\}/)[0]
  const calls = []
  const url = ref('https://youtu.be/video123?t=42')
  const run = new Function('mobileContextLinkCopyUrl', 'closeMobileLinkActions', 'shareLink', `${handler}\nreturn shareMobileContextLink`)(
    url,
    () => { calls.push('close'); url.value = null },
    async link => { calls.push(link) }
  )
  await run()
  await run()
  assert.deepEqual(calls, ['close', 'https://youtu.be/video123?t=42'])
})

const utils = readFileSync(new URL('../../src/renderer/helpers/utils.js', import.meta.url), 'utf8')
const shareHandler = utils.match(/export async function shareLink\(url\) \{[\s\S]*?\n\}/)[0].replace('export ', '')
function createShareLink(share, showError = assert.fail) {
  return new Function('process', 'Share', 'showApiErrorToast', 'i18n', `${shareHandler}\nreturn shareLink`)(
    { env: { IS_CAPACITOR: true } }, { share }, showError, { global: { t: key => key } }
  )
}

test('Capacitor Share receives the exact URL', async () => {
  const calls = []
  const run = createShareLink(async options => calls.push(options))
  await run('https://youtu.be/video123?list=PL123&t=42')
  assert.deepEqual(calls, [{ url: 'https://youtu.be/video123?list=PL123&t=42' }])
})

test('picker launch failures show a translated error', async () => {
  const failure = new Error('No activity')
  const errors = []
  const run = createShareLink(
    async () => { throw failure },
    (...args) => errors.push(args)
  )
  await run('https://youtu.be/video123')
  assert.deepEqual(errors, [['Share.Share failed', failure]])
})

test('dismissing the Android share picker does not show an error', async () => {
  const run = createShareLink(async () => { throw new Error('Share canceled') })
  await run('https://youtu.be/video123')
})
