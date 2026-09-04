<template>
  <component
    :is="embedded ? 'div' : FtPrompt"
    class="keyboardShortcutPrompt"
    :class="{ keyboardShortcutPromptEmbedded: embedded }"
    :label="embedded ? undefined : $t('KeyboardShortcutPrompt.Keyboard Shortcuts')"
    :inert="embedded && pendingShortcutConflict === null ? undefined : pendingShortcutConflict !== null"
    @click="handleContainerClick"
  >
    <template
      v-if="!embedded"
      #label="{ labelId }"
    >
      <div class="titleAndCloseButton">
        <h2 :id="labelId">
          {{ $t('KeyboardShortcutPrompt.Keyboard Shortcuts') }}
        </h2>
        <FtIconButton
          :title="$t('Close')"
          :icon="['fas', 'xmark']"
          theme="destructive"
          @click="hideKeyboardShortcutPrompt"
        />
      </div>
    </template>

    <div class="shortcutToolbar">
      <p class="editHint">
        {{ $t('KeyboardShortcutPrompt.Edit Hint') }}
      </p>
      <FtButton
        :label="$t('KeyboardShortcutPrompt.Reset to Defaults')"
        :icon="['fas', 'undo']"
        :text-color="null"
        :background-color="null"
        :disabled="!hasModifiedKeyboardShortcuts"
        @click="resetKeyboardShortcuts"
      />
    </div>

    <div
      v-overlay-scrollbars="embedded"
      class="shortcutColumns"
    >
      <div
        v-for="(shortcutColumn, index) of shortcutColumns"
        :key="index"
        class="shortcutColumn"
      >
        <div
          v-for="shortcutSection in shortcutColumn"
          :key="shortcutSection.title"
          class="shortcutSection"
          :style="{ order: shortcutSection.order }"
        >
          <h3 class="center">
            {{ shortcutSection.title }}
          </h3>
          <div class="labelsAndShortcuts">
            <div
              v-for="shortcut in shortcutSection.shortcutDictionary"
              :key="shortcut.label"
              class="labelAndShortcut"
            >
              <p
                class="label"
              >
                {{ shortcut.label }}
              </p>
              <div class="shortcut">
                <template
                  v-for="binding in shortcut.bindings"
                  :key="binding.path"
                >
                  <span class="shortcutBinding">
                    <button
                      v-if="binding.editable"
                      type="button"
                      class="shortcutButton"
                      :class="{
                        modified: binding.modified,
                        recording: recordingShortcutPath === binding.path
                      }"
                      :data-shortcut-path="binding.path"
                      :aria-label="$t('KeyboardShortcutPrompt.Change Shortcut', { action: shortcut.label })"
                      @click.stop="beginShortcutRecording(binding)"
                      @keydown="handleShortcutKeydown($event, binding)"
                      @blur="stopShortcutRecording(binding)"
                    >
                      {{ getShortcutButtonLabel(binding) }}
                    </button>
                    <span
                      v-else
                      class="shortcutValue"
                    >
                      {{ getShortcutButtonLabel(binding) }}
                    </span>
                    <FtIconButton
                      v-if="binding.modified"
                      class="resetShortcutButton"
                      :title="$t('KeyboardShortcutPrompt.Reset Shortcut', { action: shortcut.label })"
                      :icon="['fas', 'undo']"
                      :padding="6"
                      :size="14"
                      :use-shadow="false"
                      theme="base-no-default"
                      @click="resetKeyboardShortcut(binding)"
                    />
                  </span>
                </template>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </component>

  <FtPrompt
    v-if="pendingShortcutConflict"
    autosize
    :label="$t('KeyboardShortcutPrompt.Shortcut Already Assigned')"
    :extra-labels="[shortcutConflictMessage]"
    :option-names="shortcutConflictOptionNames"
    :option-values="shortcutConflictOptionValues"
    :is-first-option-destructive="shortcutConflictCanBeReassigned"
    @click="resolveShortcutConflict"
  />
</template>

<script setup>

import { computed, nextTick, ref } from 'vue'
import {
  DefaultKeyboardShortcuts,
  getConfiguredKeyboardShortcuts,
  isKeyboardShortcutEditable,
} from '../../../constants'
import { getLocalizedShortcut } from '../../helpers/utils'
import {
  keyboardShortcutFromEvent,
  keyboardShortcutsOverlap,
} from '../../helpers/keyboardShortcuts'
import FtPrompt from '../FtPrompt/FtPrompt.vue'
import store from '../../store/index'
import { useI18n } from 'vue-i18n'
import FtButton from '../FtButton/FtButton.vue'
import FtIconButton from '../FtIconButton/FtIconButton.vue'

const { t } = useI18n()
const { embedded } = defineProps({
  embedded: {
    type: Boolean,
    default: false
  }
})
const isMac = process.platform === 'darwin'
const recordingShortcutPath = ref('')
const pendingShortcutConflict = ref(null)

const configuredKeyboardShortcuts = computed(() => getConfiguredKeyboardShortcuts(
  store.getters.getKeyboardShortcuts
))

const shortcutConflictMessage = computed(() => {
  if (!pendingShortcutConflict.value) {
    return ''
  }

  const actionLabels = [...new Set(
    pendingShortcutConflict.value.conflicts.map(conflict => conflict.label)
  )].join(', ')

  const messageParams = {
    shortcut: getLocalizedShortcut(pendingShortcutConflict.value.shortcut),
    actions: actionLabels,
  }

  return shortcutConflictCanBeReassigned.value
    ? t('KeyboardShortcutPrompt.Shortcut Conflict', messageParams)
    : t('KeyboardShortcutPrompt.Reserved Shortcut Conflict', messageParams)
})

const shortcutConflictCanBeReassigned = computed(() =>
  pendingShortcutConflict.value?.conflicts.every(conflict => conflict.editable) ?? false
)

const shortcutConflictOptionNames = computed(() => shortcutConflictCanBeReassigned.value
  ? [t('KeyboardShortcutPrompt.Reassign'), t('Undo')]
  : [t('Undo')]
)

const shortcutConflictOptionValues = computed(() => shortcutConflictCanBeReassigned.value
  ? [true, false]
  : [false]
)

const generalPlayerShortcuts = computed(() =>
  getLocalizedShortcutNamesAndValues(
    configuredKeyboardShortcuts.value.VIDEO_PLAYER.GENERAL,
    ['VIDEO_PLAYER', 'GENERAL']
  )
)

const playbackPlayerShortcuts = computed(() =>
  getLocalizedShortcutNamesAndValues(
    configuredKeyboardShortcuts.value.VIDEO_PLAYER.PLAYBACK,
    ['VIDEO_PLAYER', 'PLAYBACK']
  )
)

const generalAppShortcuts = computed(() => getLocalizedShortcutNamesAndValues(
  configuredKeyboardShortcuts.value.APP.GENERAL,
  ['APP', 'GENERAL'],
  [
    'OPEN_COMMAND_PALETTE',
    'SHOW_SHORTCUTS',
    'HISTORY_BACKWARD',
    'HISTORY_FORWARD',
    ...isMac ? ['HISTORY_BACKWARD_ALT_MAC', 'HISTORY_FORWARD_ALT_MAC'] : [],
    'NAVIGATE_TO_SETTINGS',
    'NAVIGATE_TO_DOWNLOADS',
    isMac ? 'NAVIGATE_TO_HISTORY_MAC' : 'NAVIGATE_TO_HISTORY',
  ]
))

const tabAppShortcuts = computed(() => getLocalizedShortcutNamesAndValues(
  configuredKeyboardShortcuts.value.APP.GENERAL,
  ['APP', 'GENERAL'],
  [
    'NEW_TAB',
    'CLOSE_TAB',
    'RELOAD_TAB',
    'RELOAD_TAB_ALT',
    'RESTORE_CLOSED_TAB',
    'NEXT_TAB',
    'PREV_TAB',
    'SWITCH_TO_TAB',
    'OPEN_TAB_ORGANIZER',
    'TOGGLE_TAB_ORIENTATION',
  ]
))

const searchAndPageAppShortcuts = computed(() => [
  ...getLocalizedShortcutNamesAndValues(
    configuredKeyboardShortcuts.value.APP.GENERAL,
    ['APP', 'GENERAL'],
    [
      'FOCUS_SEARCH',
      'FOCUS_SEARCH_ALT',
      'FOCUS_SEARCH_ALT_SLASH',
      'SEARCH_IN_NEW_WINDOW',
      'FIND_IN_PAGE',
      'FIND_NEXT',
      'FIND_NEXT_ALT',
      'FIND_NEXT_ALT_ENTER',
      'FIND_PREVIOUS',
      'FIND_PREVIOUS_ALT',
      'FIND_PREVIOUS_ALT_ENTER',
    ]
  ),
  ...getLocalizedShortcutNamesAndValues(
    configuredKeyboardShortcuts.value.APP.SITUATIONAL,
    ['APP', 'SITUATIONAL']
  )
])

const windowAndViewAppShortcuts = computed(() => getLocalizedShortcutNamesAndValues(
  configuredKeyboardShortcuts.value.APP.GENERAL,
  ['APP', 'GENERAL'],
  [
    'NEW_WINDOW',
    'MINIMIZE_WINDOW',
    'CLOSE_WINDOW',
    'TOGGLE_DEVTOOLS',
    'RESET_ZOOM',
    'ZOOM_IN',
    'ZOOM_OUT',
    'FULLSCREEN',
  ]
))

const shortcutColumns = computed(() => [
  [
    {
      title: t('KeyboardShortcutPrompt.Sections.Video.Playback'),
      shortcutDictionary: playbackPlayerShortcuts.value,
      order: 1
    },
    {
      title: t('KeyboardShortcutPrompt.Sections.App.General'),
      shortcutDictionary: generalAppShortcuts.value,
      order: 3
    },
    {
      title: t('KeyboardShortcutPrompt.Sections.App.Search and Page'),
      shortcutDictionary: searchAndPageAppShortcuts.value,
      order: 5
    }
  ],
  [
    {
      title: t('KeyboardShortcutPrompt.Sections.Video.General'),
      shortcutDictionary: generalPlayerShortcuts.value,
      order: 2
    },
    {
      title: t('KeyboardShortcutPrompt.Sections.App.Tabs'),
      shortcutDictionary: tabAppShortcuts.value,
      order: 4
    },
    {
      title: t('KeyboardShortcutPrompt.Sections.App.Window and View'),
      shortcutDictionary: windowAndViewAppShortcuts.value,
      order: 6
    }
  ]
])
const hasModifiedKeyboardShortcuts = computed(() => shortcutColumns.value.some(column =>
  column.some(section => section.shortcutDictionary.some(shortcut =>
    shortcut.bindings.some(binding => binding.modified)
  ))
))

const localizedShortcutNameToShortcutsMappings = computed(() => {
  return [
    [t('CommandPalette.Open'), ['OPEN_COMMAND_PALETTE']],
    [t('KeyboardShortcutPrompt.Show Keyboard Shortcuts'), ['SHOW_SHORTCUTS']],
    [t('KeyboardShortcutPrompt.History Backward'), [
      'HISTORY_BACKWARD',
      'HISTORY_BACKWARD_ALT_MAC',
    ]],
    [t('KeyboardShortcutPrompt.History Forward'), [
      'HISTORY_FORWARD',
      'HISTORY_FORWARD_ALT_MAC',
    ]],
    [t('KeyboardShortcutPrompt.Navigate to Settings'), ['NAVIGATE_TO_SETTINGS']],
    [t('Downloads.Open Downloads'), ['NAVIGATE_TO_DOWNLOADS']],
    [t('KeyboardShortcutPrompt.Navigate to History'), ['NAVIGATE_TO_HISTORY', 'NAVIGATE_TO_HISTORY_MAC']],
    [t('KeyboardShortcutPrompt.New Window'), ['NEW_WINDOW']],
    [t('KeyboardShortcutPrompt.New Tab'), ['NEW_TAB']],
    [t('KeyboardShortcutPrompt.Close Tab'), ['CLOSE_TAB']],
    [t('KeyboardShortcutPrompt.Reload Tab'), ['RELOAD_TAB', 'RELOAD_TAB_ALT']],
    [t('KeyboardShortcutPrompt.Reopen Closed Tab'), ['RESTORE_CLOSED_TAB']],
    [t('KeyboardShortcutPrompt.Next Tab'), ['NEXT_TAB']],
    [t('KeyboardShortcutPrompt.Previous Tab'), ['PREV_TAB']],
    [t('KeyboardShortcutPrompt.Switch to Tab'), ['SWITCH_TO_TAB']],
    [t('Tab Organizer.Title'), ['OPEN_TAB_ORGANIZER']],
    [t('KeyboardShortcutPrompt.Toggle Tab Orientation'), ['TOGGLE_TAB_ORIENTATION']],
    [t('KeyboardShortcutPrompt.Minimize Window'), ['MINIMIZE_WINDOW']],
    [t('KeyboardShortcutPrompt.Close Window'), ['CLOSE_WINDOW']],
    [t('KeyboardShortcutPrompt.Toggle Developer Tools'), ['TOGGLE_DEVTOOLS']],
    [t('KeyboardShortcutPrompt.Reset Zoom'), ['RESET_ZOOM']],
    [t('KeyboardShortcutPrompt.Zoom In'), ['ZOOM_IN']],
    [t('KeyboardShortcutPrompt.Zoom Out'), ['ZOOM_OUT']],
    [t('KeyboardShortcutPrompt.Focus Search'), [
      'FOCUS_SEARCH',
      'FOCUS_SEARCH_ALT',
      'FOCUS_SEARCH_ALT_MAC',
      'FOCUS_SEARCH_ALT_SLASH',
    ]],
    [t('KeyboardShortcutPrompt.Search in New Window'), ['SEARCH_IN_NEW_WINDOW']],
    [t('KeyboardShortcutPrompt.Find in Page'), ['FIND_IN_PAGE']],
    [t('KeyboardShortcutPrompt.Find Next Match'), ['FIND_NEXT', 'FIND_NEXT_ALT', 'FIND_NEXT_ALT_ENTER']],
    [t('KeyboardShortcutPrompt.Find Previous Match'), ['FIND_PREVIOUS', 'FIND_PREVIOUS_ALT', 'FIND_PREVIOUS_ALT_ENTER']],

    [t('KeyboardShortcutPrompt.Refresh'), ['REFRESH']],

    [t('KeyboardShortcutPrompt.Captions'), ['CAPTIONS']],
    [t('KeyboardShortcutPrompt.Theatre Mode'), ['THEATRE_MODE']],
    [t('KeyboardShortcutPrompt.Fullscreen'), ['FULLSCREEN']],
    [t('KeyboardShortcutPrompt.Full Window'), ['FULLWINDOW']],
    [t('KeyboardShortcutPrompt.Picture in Picture'), ['PICTURE_IN_PICTURE']],
    [t('KeyboardShortcutPrompt.Mute'), ['MUTE']],
    [t('KeyboardShortcutPrompt.Volume Up'), ['VOLUME_UP']],
    [t('KeyboardShortcutPrompt.Volume Down'), ['VOLUME_DOWN']],
    [t('KeyboardShortcutPrompt.Take Screenshot'), ['TAKE_SCREENSHOT']],
    [t('KeyboardShortcutPrompt.Video Zoom In'), ['VIDEO_ZOOM_IN']],
    [t('KeyboardShortcutPrompt.Video Zoom Out'), ['VIDEO_ZOOM_OUT']],
    [t('KeyboardShortcutPrompt.Stats'), ['STATS']],

    [t('KeyboardShortcutPrompt.Play'), ['PLAY']],
    [t('KeyboardShortcutPrompt.Large Rewind'), ['LARGE_REWIND']],
    [t('KeyboardShortcutPrompt.Large Fast Forward'), ['LARGE_FAST_FORWARD']],
    [t('KeyboardShortcutPrompt.Small Rewind'), ['SMALL_REWIND']],
    [t('KeyboardShortcutPrompt.Small Fast Forward'), ['SMALL_FAST_FORWARD']],
    [t('KeyboardShortcutPrompt.Decrease Video Speed'), ['DECREASE_VIDEO_SPEED', 'DECREASE_VIDEO_SPEED_ALT']],
    [t('KeyboardShortcutPrompt.Increase Video Speed'), ['INCREASE_VIDEO_SPEED', 'INCREASE_VIDEO_SPEED_ALT']],
    [t('KeyboardShortcutPrompt.Toggle Normal Playback Speed'), ['TOGGLE_NORMAL_PLAYBACK_SPEED']],
    [t('KeyboardShortcutPrompt.Toggle Skip Silence'), ['TOGGLE_SKIP_SILENCE']],
    [t('KeyboardShortcutPrompt.Set A-B Repeat Point A'), ['SET_AB_REPEAT_START']],
    [t('KeyboardShortcutPrompt.Set A-B Repeat Point B'), ['SET_AB_REPEAT_END']],
    [t('KeyboardShortcutPrompt.Clear A-B Repeat'), ['CLEAR_AB_REPEAT']],
    [t('KeyboardShortcutPrompt.Home'), ['HOME']],
    [t('KeyboardShortcutPrompt.End'), ['END']],
    [t('KeyboardShortcutPrompt.Skip by Tenths'), ['SKIP_N_TENTHS']],
    [t('KeyboardShortcutPrompt.Last Chapter'), ['LAST_CHAPTER']],
    [t('KeyboardShortcutPrompt.Next Chapter'), ['NEXT_CHAPTER']],
    [t('KeyboardShortcutPrompt.Last Frame'), ['LAST_FRAME']],
    [t('KeyboardShortcutPrompt.Next Frame'), ['NEXT_FRAME']],
    [t('KeyboardShortcutPrompt.Skip to Next Video'), ['SKIP_TO_NEXT']],
    [t('KeyboardShortcutPrompt.Skip to Previous Video'), ['SKIP_TO_PREV']],
  ]
})

function hideKeyboardShortcutPrompt() {
  store.dispatch('hideKeyboardShortcutPrompt')
}

function handleContainerClick() {
  if (!embedded) {
    hideKeyboardShortcutPrompt()
  }
}

function getLocalizedShortcutNamesAndValues(dictionary, dictionaryPath, includedShortcutCodes = Object.keys(dictionary)) {
  const shortcutNameToShortcutsMappings = localizedShortcutNameToShortcutsMappings.value
  const includedShortcutCodeSet = new Set(includedShortcutCodes)

  return shortcutNameToShortcutsMappings
    .filter(([_localizedShortcutName, shortcutCodes]) =>
      shortcutCodes.some(shortcutCode =>
        includedShortcutCodeSet.has(shortcutCode) && Object.hasOwn(dictionary, shortcutCode)
      )
    )
    .map(([localizedShortcutName, shortcutCodes]) => ({
      label: localizedShortcutName,
      bindings: shortcutCodes
        .filter(code => includedShortcutCodeSet.has(code) && Object.hasOwn(dictionary, code))
        .map((code) => {
          const defaultShortcut = getNestedValue(
            DefaultKeyboardShortcuts,
            [...dictionaryPath, code]
          )

          return {
            code,
            path: [...dictionaryPath, code].join('.'),
            shortcut: dictionary[code],
            dictionaryPath,
            editable: isKeyboardShortcutEditable([...dictionaryPath, code], defaultShortcut),
            modified: dictionary[code] !== defaultShortcut,
          }
        })
    }))
}

function getShortcutButtonLabel(binding) {
  if (recordingShortcutPath.value === binding.path) {
    return t('KeyboardShortcutPrompt.Press Shortcut')
  }

  return binding.shortcut
    ? getLocalizedShortcut(binding.shortcut)
    : t('KeyboardShortcutPrompt.Unassigned')
}

function beginShortcutRecording(binding) {
  recordingShortcutPath.value = binding.path
}

function stopShortcutRecording(binding) {
  if (recordingShortcutPath.value === binding.path) {
    recordingShortcutPath.value = ''
  }
}

function handleShortcutKeydown(event, binding) {
  if (recordingShortcutPath.value !== binding.path) {
    return
  }

  event.preventDefault()
  event.stopPropagation()

  if (event.key === 'Escape') {
    recordingShortcutPath.value = ''
    event.currentTarget.blur()
    return
  }

  if (event.key === 'Backspace' || event.key === 'Delete') {
    saveKeyboardShortcut(binding, '')
    event.currentTarget.blur()
    return
  }

  const shortcut = keyboardShortcutFromEvent(event)
  if (shortcut !== null) {
    saveKeyboardShortcut(binding, shortcut)
    event.currentTarget.blur()
  }
}

function saveKeyboardShortcut(binding, shortcut) {
  const defaultShortcut = getNestedValue(
    DefaultKeyboardShortcuts,
    [...binding.dictionaryPath, binding.code]
  )
  const normalizedShortcut = keyboardShortcutsOverlap(shortcut, defaultShortcut)
    ? defaultShortcut
    : shortcut

  if (normalizedShortcut === binding.shortcut) {
    recordingShortcutPath.value = ''
    return
  }

  const conflicts = findShortcutConflicts(binding, normalizedShortcut)
  if (conflicts.length > 0) {
    recordingShortcutPath.value = ''
    pendingShortcutConflict.value = { binding, shortcut: normalizedShortcut, conflicts }
    return
  }

  applyKeyboardShortcut(binding, normalizedShortcut)
}

function resolveShortcutConflict(reassign) {
  const pendingConflict = pendingShortcutConflict.value
  pendingShortcutConflict.value = null

  if (reassign && pendingConflict) {
    applyKeyboardShortcut(
      pendingConflict.binding,
      pendingConflict.shortcut,
      pendingConflict.conflicts
    )
  }

  if (pendingConflict) {
    nextTick(() => {
      const shortcutButton = Array.from(document.querySelectorAll('.shortcutButton'))
        .find(button => button.dataset.shortcutPath === pendingConflict.binding.path)
      shortcutButton?.focus()
    })
  }
}

function applyKeyboardShortcut(binding, shortcut, conflicts = []) {
  const overrides = getKeyboardShortcutOverrides()

  for (const conflict of conflicts) {
    setNestedValue(overrides, conflict.path.split('.'), '')
  }

  const defaultValue = getNestedValue(DefaultKeyboardShortcuts, [...binding.dictionaryPath, binding.code])

  if (shortcut === defaultValue) {
    deleteNestedValue(overrides, [...binding.dictionaryPath, binding.code])
  } else {
    setNestedValue(overrides, [...binding.dictionaryPath, binding.code], shortcut)
  }

  recordingShortcutPath.value = ''
  store.dispatch('updateKeyboardShortcuts', JSON.stringify(overrides))
}

function findShortcutConflicts(binding, shortcut, ignoreDefaultBindings = false) {
  if (!shortcut) {
    return []
  }

  return getAllKeyboardShortcutBindings(configuredKeyboardShortcuts.value)
    .filter(candidate =>
      candidate.path !== binding.path &&
      keyboardShortcutsOverlap(candidate.shortcut, shortcut) &&
      (!ignoreDefaultBindings || !keyboardShortcutsOverlap(
        getNestedValue(DefaultKeyboardShortcuts, candidate.path.split('.')),
        shortcut
      ))
    )
    .map(candidate => ({
      ...candidate,
      label: getShortcutActionLabel(candidate.code),
    }))
}

function getAllKeyboardShortcutBindings(dictionary, dictionaryPath = []) {
  return Object.entries(dictionary).flatMap(([code, value]) => {
    const path = [...dictionaryPath, code]
    if (typeof value === 'string') {
      return [{
        code,
        path: path.join('.'),
        shortcut: value,
        editable: isKeyboardShortcutEditable(
          path,
          getNestedValue(DefaultKeyboardShortcuts, path)
        ),
      }]
    }
    return getAllKeyboardShortcutBindings(value, path)
  })
}

function getShortcutActionLabel(code) {
  return localizedShortcutNameToShortcutsMappings.value
    .find(([_label, shortcutCodes]) => shortcutCodes.includes(code))?.[0] ?? code
}

function resetKeyboardShortcuts() {
  recordingShortcutPath.value = ''
  pendingShortcutConflict.value = null
  store.dispatch('updateKeyboardShortcuts', '{}')
}

function resetKeyboardShortcut(binding) {
  const defaultShortcut = getNestedValue(
    DefaultKeyboardShortcuts,
    [...binding.dictionaryPath, binding.code]
  )
  const conflicts = findShortcutConflicts(binding, defaultShortcut, true)

  recordingShortcutPath.value = ''
  if (conflicts.length > 0) {
    pendingShortcutConflict.value = { binding, shortcut: defaultShortcut, conflicts }
    return
  }

  applyKeyboardShortcut(binding, defaultShortcut)
}

function getKeyboardShortcutOverrides() {
  try {
    const overrides = JSON.parse(store.getters.getKeyboardShortcuts)
    return overrides && typeof overrides === 'object' ? overrides : {}
  } catch {
    return {}
  }
}

function getNestedValue(dictionary, path) {
  return path.reduce((value, key) => value[key], dictionary)
}

function setNestedValue(dictionary, path, value) {
  const lastKey = path.at(-1)
  const parent = path.slice(0, -1).reduce((current, key) => {
    current[key] ??= {}
    return current[key]
  }, dictionary)
  parent[lastKey] = value
}

function deleteNestedValue(dictionary, path) {
  const parents = [dictionary]
  let current = dictionary

  for (const key of path.slice(0, -1)) {
    if (!current[key]) {
      return
    }
    current = current[key]
    parents.push(current)
  }

  delete current[path.at(-1)]

  for (let index = parents.length - 1; index > 0; index--) {
    if (Object.keys(parents[index]).length === 0) {
      delete parents[index - 1][path[index - 1]]
    }
  }
}

</script>

<style scoped src="./FtKeyboardShortcutPrompt.css" />
