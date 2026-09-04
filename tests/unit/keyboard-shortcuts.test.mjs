import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getConfiguredKeyboardShortcuts,
  sanitizeKeyboardShortcutOverrides,
} from '../../src/constants.js'

test('keeps contextual app shortcuts fixed', () => {
  const overrides = {
    APP: {
      GENERAL: {
        FOCUS_SEARCH: 'ctrl+k',
        FOCUS_SEARCH_ALT_SLASH: 'ctrl+shift+f',
        SEARCH_IN_NEW_WINDOW: 'ctrl+enter',
        FIND_NEXT_ALT_ENTER: 'ctrl+down',
        FIND_PREVIOUS_ALT_ENTER: 'ctrl+up',
        NEXT_TAB: 'alt+arrowright',
        PREV_TAB: 'alt+arrowleft',
      }
    }
  }

  const shortcuts = getConfiguredKeyboardShortcuts(overrides)
  const persistedShortcuts = getConfiguredKeyboardShortcuts(JSON.stringify(overrides))
  assert.equal(shortcuts.APP.GENERAL.FOCUS_SEARCH, 'ctrl+k')
  assert.equal(shortcuts.APP.GENERAL.FOCUS_SEARCH_ALT_SLASH, '/')
  assert.equal(shortcuts.APP.GENERAL.SEARCH_IN_NEW_WINDOW, 'shift+enter')
  assert.equal(shortcuts.APP.GENERAL.FIND_NEXT_ALT_ENTER, 'enter')
  assert.equal(shortcuts.APP.GENERAL.FIND_PREVIOUS_ALT_ENTER, 'shift+enter')
  assert.equal(shortcuts.APP.GENERAL.NEXT_TAB, 'control+tab')
  assert.equal(shortcuts.APP.GENERAL.PREV_TAB, 'control+shift+tab')
  assert.deepEqual(persistedShortcuts, shortcuts)

  const sanitizedOverrides = {
    APP: {
      GENERAL: {
        FOCUS_SEARCH: 'ctrl+k',
      }
    }
  }
  assert.deepEqual(JSON.parse(sanitizeKeyboardShortcutOverrides(overrides)), sanitizedOverrides)
  assert.deepEqual(
    JSON.parse(sanitizeKeyboardShortcutOverrides(JSON.stringify(overrides))),
    sanitizedOverrides
  )
})

test('opens downloads with Ctrl or Command+J by default', () => {
  assert.equal(getConfiguredKeyboardShortcuts().APP.GENERAL.NAVIGATE_TO_DOWNLOADS, 'ctrl+J')
})

test('reloads tabs with Ctrl or Command+R and F5 by default', () => {
  const shortcuts = getConfiguredKeyboardShortcuts().APP.GENERAL

  assert.equal(shortcuts.RELOAD_TAB, 'ctrl+R')
  assert.equal(shortcuts.RELOAD_TAB_ALT, 'f5')
})

test('allows the tab organizer shortcut to be configured', () => {
  assert.equal(getConfiguredKeyboardShortcuts().APP.GENERAL.OPEN_TAB_ORGANIZER, '')
  assert.equal(getConfiguredKeyboardShortcuts({
    APP: {
      GENERAL: {
        OPEN_TAB_ORGANIZER: 'ctrl+shift+o',
      }
    }
  }).APP.GENERAL.OPEN_TAB_ORGANIZER, 'ctrl+shift+o')
})

test('allows A-B repeat shortcuts to be configured', () => {
  const shortcuts = getConfiguredKeyboardShortcuts({
    VIDEO_PLAYER: {
      PLAYBACK: {
        SET_AB_REPEAT_START: 'alt+a',
        SET_AB_REPEAT_END: 'alt+b',
        CLEAR_AB_REPEAT: '',
      }
    }
  })

  assert.equal(shortcuts.VIDEO_PLAYER.PLAYBACK.SET_AB_REPEAT_START, 'alt+a')
  assert.equal(shortcuts.VIDEO_PLAYER.PLAYBACK.SET_AB_REPEAT_END, 'alt+b')
  assert.equal(shortcuts.VIDEO_PLAYER.PLAYBACK.CLEAR_AB_REPEAT, '')
})
