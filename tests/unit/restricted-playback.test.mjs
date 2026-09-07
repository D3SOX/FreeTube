import assert from 'node:assert/strict'
import test from 'node:test'

import {
  hasConfiguredRestrictedPlaybackAuthentication,
  shouldHideMembersOnlyContent
} from '../../src/renderer/helpers/restricted-playback.js'

function restrictedPlaybackSettings (overrides = {}) {
  return {
    getYtDlpPlaybackAuthMode: 'none',
    getYtDlpPlaybackCookiesPath: '',
    getYtDlpPlaybackCookiesBrowser: '',
    ...overrides
  }
}

test('recognises configured restricted playback authentication', () => {
  assert.equal(hasConfiguredRestrictedPlaybackAuthentication(
    restrictedPlaybackSettings({
      getYtDlpPlaybackAuthMode: 'file',
      getYtDlpPlaybackCookiesPath: '/tmp/cookies.txt'
    }),
    true
  ), true)

  assert.equal(hasConfiguredRestrictedPlaybackAuthentication(
    restrictedPlaybackSettings({
      getYtDlpPlaybackAuthMode: 'browser',
      getYtDlpPlaybackCookiesBrowser: 'firefox'
    }),
    true
  ), true)
})

test('does not treat incomplete or web authentication settings as configured', () => {
  assert.equal(hasConfiguredRestrictedPlaybackAuthentication(
    restrictedPlaybackSettings({ getYtDlpPlaybackAuthMode: 'file' }),
    true
  ), false)
  assert.equal(hasConfiguredRestrictedPlaybackAuthentication(
    restrictedPlaybackSettings({
      getYtDlpPlaybackAuthMode: 'browser',
      getYtDlpPlaybackCookiesBrowser: 'firefox'
    }),
    false
  ), false)
})

test('keeps members-only content when restricted playback authentication is configured', () => {
  const configuredSettings = restrictedPlaybackSettings({
    getYtDlpPlaybackAuthMode: 'browser',
    getYtDlpPlaybackCookiesBrowser: 'firefox'
  })

  assert.equal(shouldHideMembersOnlyContent(true, configuredSettings, true), false)
  assert.equal(shouldHideMembersOnlyContent(true, restrictedPlaybackSettings(), true), true)
  assert.equal(shouldHideMembersOnlyContent(false, restrictedPlaybackSettings(), true), false)
})

test('Android accepts cookie files but cannot use a desktop browser cookie store', () => {
  assert.equal(hasConfiguredRestrictedPlaybackAuthentication(restrictedPlaybackSettings({
    getYtDlpPlaybackAuthMode: 'browser', getYtDlpPlaybackCookiesBrowser: 'firefox'
  }), true, true), false)
  assert.equal(hasConfiguredRestrictedPlaybackAuthentication(restrictedPlaybackSettings({
    getYtDlpPlaybackAuthMode: 'file', getYtDlpPlaybackCookiesPath: '/private/cookies.txt'
  }), true, true), true)
})
