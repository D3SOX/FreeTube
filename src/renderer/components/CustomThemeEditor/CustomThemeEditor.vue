<template>
  <FtSettingsSubpage
    :open="open"
    :title="t('Settings.Theme Settings.Custom Theme.Custom Theme Creator')"
    :icon="['fas', 'palette']"
    persist-on-deactivate
    flush
    @close="closeEditor"
  >
    <div class="customThemeEditor">
      <div class="editorHeader">
        <label class="themeNameField">
          <span>{{ t('Settings.Theme Settings.Custom Theme.Theme Name') }}</span>
          <input
            v-model="draft.name"
            type="text"
            maxlength="80"
          >
        </label>
        <div class="fileActions">
          <FtIconButton
            :title="t('Settings.Theme Settings.Custom Theme.Import Theme')"
            :icon="['fas', 'folder-open']"
            @click="importTheme"
          />
          <FtIconButton
            :title="t('Settings.Theme Settings.Custom Theme.Import from Clipboard')"
            :icon="['fas', 'paste']"
            @click="importThemeFromClipboard"
          />
          <FtIconButton
            :title="t('Settings.Theme Settings.Custom Theme.Export Theme')"
            :icon="['fas', 'download']"
            @click="exportTheme"
          />
          <FtIconButton
            :title="t('Settings.Theme Settings.Custom Theme.Share Theme')"
            :icon="['fas', 'share-alt']"
            @click="shareTheme"
          />
        </div>
      </div>
      <div class="themeSources">
        <FtSelect
          :placeholder="t('Settings.Theme Settings.Custom Theme.Based On')"
          :value="basedOnTheme"
          :select-names="baseThemeNames"
          :select-values="BASE_THEME_VALUES"
          :icon="['fas', 'palette']"
          @change="copyBaseTheme"
        />
        <FtSelect
          :placeholder="t('Settings.Theme Settings.Main Color Theme.Main Color Theme')"
          :value="draft.mainColor"
          :select-names="themeColorNames"
          :select-values="COLOR_VALUES"
          :option-colors="COLOR_SWATCHES"
          :icon="['fas', 'palette']"
          icon-color="var(--primary-color)"
          @change="copyMainColor"
        />
        <FtSelect
          :placeholder="t('Settings.Theme Settings.Secondary Color Theme')"
          :value="draft.secondaryColor"
          :select-names="themeColorNames"
          :select-values="COLOR_VALUES"
          :option-colors="COLOR_SWATCHES"
          :icon="['fas', 'palette']"
          icon-color="var(--accent-color)"
          @change="copySecondaryColor"
        />
        <div class="darkThemeControl">
          <FtToggleSwitch
            :label="t('Settings.Theme Settings.Dark Theme')"
            :default-value="draft.isDark"
            compact
            @change="updateDarkTheme"
          />
        </div>
      </div>

      <div
        v-overlay-scrollbars
        class="colorGrid"
      >
        <FtColorPicker
          v-for="([key, property, label]) in CUSTOM_THEME_EDITABLE_COLORS"
          :key="key"
          :model-value="draft.colors[key]"
          :blur-value="getBlurValue(key)"
          :label="colorNames[label] ?? label"
          :other-colors="getOtherColors(key)"
          @update:model-value="updateColor(key, property, $event)"
          @update:blur-value="updateBlur(key, $event)"
          @change="commitThemeChanges"
        />
      </div>

      <div class="editorFooter">
        <FtButton
          v-if="isSavedTheme"
          class="deleteThemeButton"
          :label="t('Settings.Theme Settings.Custom Theme.Delete Theme')"
          :icon="['fas', 'trash']"
          theme="destructive"
          @click="showDeletePrompt = true"
        />
        <FtButton
          :label="t('Settings.Theme Settings.Custom Theme.Reset Colors')"
          :icon="['fas', 'undo']"
          :disabled="isUsingThemeSourceColors"
          @click="resetTheme"
        />
        <FtButton
          v-if="savedTheme"
          :label="t('Settings.Theme Settings.Custom Theme.Discard Changes')"
          :icon="['fas', 'undo']"
          :disabled="!hasChanges"
          @click="discardChanges"
        />
        <FtButton
          :label="t('Settings.Theme Settings.Custom Theme.Save and Apply')"
          :icon="['fas', 'floppy-disk']"
          :disabled="savedTheme !== null && !hasChanges"
          @click="saveAndApply"
        />
      </div>
      <FtPrompt
        v-if="showDeletePrompt"
        :label="t('Settings.Theme Settings.Custom Theme.Delete Theme Confirmation', { name: draft.name })"
        :option-names="[t('Settings.Theme Settings.Custom Theme.Delete Theme'), t('Cancel')]"
        :option-values="['delete', 'cancel']"
        autosize
        is-first-option-destructive
        @click="handleDeletePrompt"
      />
    </div>
  </FtSettingsSubpage>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, shallowReactive, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import FtButton from '../FtButton/FtButton.vue'
import FtIconButton from '../FtIconButton/FtIconButton.vue'
import FtPrompt from '../FtPrompt/FtPrompt.vue'
import FtSettingsSubpage from '../FtSettingsSubpage/FtSettingsSubpage.vue'
import FtSelect from '../FtSelect/FtSelect.vue'
import FtToggleSwitch from '../FtToggleSwitch/FtToggleSwitch.vue'
import FtColorPicker from '../FtColorPicker/FtColorPicker.vue'

import store from '../../store/index'
import { useColorTranslations } from '../../composables/colors'
import { useBaseThemeNames } from '../../composables/baseThemes'
import {
  cloneDefaultCustomTheme,
  CUSTOM_THEME_BLURS,
  CUSTOM_THEME_COLORS,
  CUSTOM_THEME_EDITABLE_COLORS,
  customThemeBackdropBlur,
  customThemeIdFromValue,
  customThemeValue,
  hexColorToRgbComponents,
  normalizeCustomTheme,
} from '../../../customTheme'
import { getThemeClassification } from '../../../appearanceSettings'
import { BUILTIN_BASE_THEME_VALUES } from '../../../constants'
import {
  applyThemeToDocument,
  deleteCustomTheme,
  loadCustomThemes,
  saveCustomTheme,
} from '../../helpers/customTheme'
import { colors } from '../../helpers/colors'
import { openExternalLink, readClipboard, readFileWithPicker, showToast, writeFileWithPicker } from '../../helpers/utils'

const CUSTOM_THEME_DISCUSSION_URL = 'https://github.com/OpenTubeX/OpenTubeX/discussions/new'

const props = defineProps({
  open: {
    type: Boolean,
    required: true
  },
  themeId: {
    type: String,
    default: null
  }
})
const emit = defineEmits(['close'])
const { t, tm } = useI18n()
const draft = shallowReactive(cloneDefaultCustomTheme())
const savedTheme = ref(null)
const themeSourceColors = ref(null)
const showDeletePrompt = ref(false)
let previewing = false
let editorLoadId = 0
let keepSystemThemeOnSave = false
const basedOnTheme = ref('dark')
const pendingColorPreviews = new Map()
let colorPreviewTimer = null

const BASE_THEME_VALUES = BUILTIN_BASE_THEME_VALUES.slice(1)
const MAIN_COLOR_KEYS = [
  'primary', 'primaryHover', 'primaryActive', 'textWithPrimary',
  'selectionBackground', 'selectionText',
  'coloredHeaderHover', 'coloredHeaderHoverText',
  'coloredHeaderPressed', 'coloredHeaderPressedText'
]
const SECONDARY_COLOR_KEYS = [
  'accent', 'accentHover', 'accentActive', 'accentLight', 'accentVisited',
  'textWithAccent', 'link', 'linkVisited'
]
const blurProperties = new Map(CUSTOM_THEME_BLURS.map(([key, property]) => [key, property]))
const baseThemeNames = useBaseThemeNames(false)
const COLOR_VALUES = colors.map(color => color.name)
const COLOR_SWATCHES = colors.map(color => color.value)
const themeColorNames = useColorTranslations()
const colorNames = computed(() => tm('Settings.Theme Settings.Custom Theme.Colors'))
const isSavedTheme = computed(() => store.getters.getCustomThemes.some(({ id }) => id === draft.id))
const hasChanges = computed(() => savedTheme.value === null || !themesMatch(draft, savedTheme.value))
const isUsingThemeSourceColors = computed(() => themeSourceColors.value !== null &&
  CUSTOM_THEME_EDITABLE_COLORS.every(([key]) => draft.colors[key] === themeSourceColors.value[key]) &&
  CUSTOM_THEME_BLURS.every(([key]) => draft.blurs[key] === 0))

function getBlurValue(key) {
  return blurProperties.has(key) ? draft.blurs[key] : null
}

function getOtherColors(currentKey) {
  return CUSTOM_THEME_EDITABLE_COLORS
    .filter(([key]) => key !== currentKey)
    .map(([key, , label]) => ({
      key,
      label: colorNames.value[label] ?? label,
      value: draft.colors[key]
    }))
}

watch(() => props.open, async (open) => {
  const loadId = ++editorLoadId
  store.commit('setCustomThemeEditorOpen', open)
  if (!open) return
  savedTheme.value = null
  themeSourceColors.value = null
  keepSystemThemeOnSave = props.themeId !== null && store.getters.getBaseTheme === 'system' &&
    customThemeIdFromValue(resolveSelectedTheme('system')) === props.themeId
  try {
    const themes = await loadCustomThemes()
    if (!props.open || loadId !== editorLoadId) return
    store.commit('setCustomThemes', themes)
    const theme = themes.find(({ id }) => id === props.themeId)
    if (theme) {
      setDraft(theme)
      savedTheme.value = normalizeCustomTheme(theme)
      themeSourceColors.value = readThemeSourceColors()
      previewing = true
      previewTheme()
    } else {
      const newTheme = cloneDefaultCustomTheme()
      newTheme.id = crypto.randomUUID()
      const selectedTheme = resolveSelectedTheme(store.getters.getBaseTheme)
      const selectedCustomTheme = themes.find(({ id }) => id === customThemeIdFromValue(selectedTheme))
      if (selectedCustomTheme) {
        setDraft(normalizeCustomTheme({
          ...selectedCustomTheme,
          id: newTheme.id,
          name: newTheme.name,
          colors: { ...selectedCustomTheme.colors }
        }))
        themeSourceColors.value = readThemeSourceColors()
        previewing = true
        previewTheme()
      } else {
        setDraft(normalizeCustomTheme(newTheme))
        draft.mainColor = store.getters.getMainColor
        draft.secondaryColor = store.getters.getSecColor
        copyBaseTheme(BASE_THEME_VALUES.includes(selectedTheme) ? selectedTheme : 'dark')
      }
    }
  } catch (error) {
    showError(t('Settings.Theme Settings.Custom Theme.Unable to Load'), error)
  }
}, { immediate: true })

function resolveSelectedTheme(theme) {
  if (theme !== 'system') return theme
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? store.getters.getSystemDarkTheme
    : store.getters.getSystemLightTheme
}

watch(() => store.getters.getIsKeyboardShortcutPromptShown, (open) => {
  if (open && props.open) closeEditor()
}, { flush: 'sync' })

function setDraft(theme) {
  draft.discussionThemeHash = theme.discussionThemeHash
  draft.version = theme.version
  draft.id = theme.id
  draft.name = theme.name
  draft.basedOn = theme.basedOn
  basedOnTheme.value = theme.basedOn
  draft.mainColor = theme.mainColor
  draft.secondaryColor = theme.secondaryColor
  draft.isDark = theme.isDark
  draft.blurs = { ...theme.blurs }
  draft.colors = { ...theme.colors }
}

function themesMatch(first, second) {
  return first.version === second.version &&
    first.id === second.id &&
    first.name === second.name &&
    first.basedOn === second.basedOn &&
    first.mainColor === second.mainColor &&
    first.secondaryColor === second.secondaryColor &&
    first.isDark === second.isDark &&
    blursMatch(first.blurs, second.blurs) &&
    colorsMatch(first.colors, second.colors)
}

function blursMatch(first, second) {
  return CUSTOM_THEME_BLURS.every(([key]) => first[key] === second[key])
}

function colorsMatch(first, second) {
  return CUSTOM_THEME_COLORS.every(([key]) => first[key] === second[key])
}

function previewTheme() {
  applyThemeToDocument(customThemeValue(draft.id), store.getters.getMainColor, store.getters.getSecColor, draft)
}

function closeEditor() {
  editorLoadId++
  previewing = false
  showDeletePrompt.value = false
  store.commit('setCustomThemeEditorOpen', false)
  cancelPendingColorPreviews()
  const selectedTheme = resolveSelectedTheme(store.getters.getBaseTheme)
  applyThemeToDocument(
    selectedTheme,
    store.getters.getMainColor,
    store.getters.getSecColor,
    store.getters.getCustomThemes.find(({ id }) => id === customThemeIdFromValue(selectedTheme)) ?? null
  )
  emit('close')
}

function resetTheme() {
  cancelPendingColorPreviews()
  copyThemeSources()
}

function discardChanges() {
  if (savedTheme.value === null) return
  cancelPendingColorPreviews()
  setDraft(savedTheme.value)
  themeSourceColors.value = readThemeSourceColors()
  previewing = true
  previewTheme()
}

function updateColor(key, property, value) {
  draft.colors[key] = value
  if (!previewing) return

  pendingColorPreviews.set(key, { property, value })
  if (colorPreviewTimer === null) {
    colorPreviewTimer = setTimeout(flushColorPreviews, 32)
  }
}

function updateBlur(key, value) {
  const property = blurProperties.get(key)
  if (property === undefined) return
  draft.blurs[key] = value
  if (previewing) {
    document.body.style.setProperty(
      property,
      customThemeBackdropBlur(draft.colors[key], value)
    )
  }
}

function commitThemeChanges() {
  flushColorPreviews()
  // Keep drag-time changes outside Vue's render cycle. Replacing the object
  // once the native picker commits updates the displayed hex value without
  // writing back into an open color picker on every pointer movement.
  draft.colors = { ...draft.colors }
  draft.blurs = { ...draft.blurs }
}

function flushColorPreviews() {
  if (colorPreviewTimer !== null) {
    clearTimeout(colorPreviewTimer)
    colorPreviewTimer = null
  }
  for (const [key, { property, value }] of pendingColorPreviews) {
    document.body.style.setProperty(property, value)
    const blurProperty = blurProperties.get(key)
    if (blurProperty !== undefined) {
      document.body.style.setProperty(
        blurProperty,
        customThemeBackdropBlur(value, draft.blurs[key])
      )
    }
    if (key === 'accent') {
      document.body.style.setProperty(
        '--accent-color-rgb',
        hexColorToRgbComponents(value)
      )
    }
  }
  pendingColorPreviews.clear()
}

function cancelPendingColorPreviews() {
  if (colorPreviewTimer !== null) {
    clearTimeout(colorPreviewTimer)
    colorPreviewTimer = null
  }
  pendingColorPreviews.clear()
}

function updateDarkTheme(value) {
  draft.isDark = value
  if (previewing) {
    document.body.dataset.customTheme = value ? 'dark' : 'light'
  }
}

function copyBaseTheme(baseTheme) {
  cancelPendingColorPreviews()
  basedOnTheme.value = baseTheme
  draft.basedOn = baseTheme
  copyThemeSources()
}

function copyMainColor(mainColor) {
  draft.mainColor = mainColor
  copyThemeColors(MAIN_COLOR_KEYS)
}

function copySecondaryColor(secondaryColor) {
  draft.secondaryColor = secondaryColor
  copyThemeColors(SECONDARY_COLOR_KEYS)
}

function copyThemeSources() {
  cancelPendingColorPreviews()
  const sourceColors = readThemeSourceColors()
  themeSourceColors.value = sourceColors
  draft.colors = { ...sourceColors }
  draft.blurs = Object.fromEntries(CUSTOM_THEME_BLURS.map(([key]) => [key, 0]))
  draft.isDark = getThemeClassification(draft.basedOn) !== 'light'
  previewing = true
  previewTheme()
}

function copyThemeColors(keys) {
  cancelPendingColorPreviews()
  const sourceColors = readThemeSourceColors()
  themeSourceColors.value = sourceColors
  draft.colors = {
    ...draft.colors,
    ...Object.fromEntries(keys.map(key => [key, sourceColors[key]]))
  }
  previewing = true
  previewTheme()
}

function readThemeSourceColors() {
  previewing = false
  applyThemeToDocument(draft.basedOn, draft.mainColor, draft.secondaryColor, null)

  const probe = document.createElement('span')
  probe.hidden = true
  document.body.append(probe)
  const colors = Object.fromEntries(CUSTOM_THEME_COLORS.map(([key, property]) =>
    [key, readColor(probe, property)]))
  probe.remove()
  return colors
}

function readColor(probe, property) {
  probe.style.color = `var(${property})`
  const color = getComputedStyle(probe).color
  const match = color.match(/rgba?\(\s*(\d+)[, ]+\s*(\d+)[, ]+\s*(\d+)(?:\s*[,/]\s*([\d.]+))?\s*\)/)
  if (!match) return '#000000'

  const rgb = match.slice(1, 4)
    .map(value => Number.parseInt(value, 10).toString(16).padStart(2, '0'))
    .join('')
  const alpha = match[4] === undefined ? 255 : Math.round(Number.parseFloat(match[4]) * 255)
  return `#${rgb}${alpha < 255 ? alpha.toString(16).padStart(2, '0') : ''}`
}

async function saveAndApply() {
  try {
    flushColorPreviews()
    const themes = await saveCustomTheme(draft)
    await store.dispatch('updateCustomThemes', themes)
    const savedTheme = themes.find(({ id }) => id === draft.id)
    setDraft(savedTheme)
    if (!keepSystemThemeOnSave) {
      await store.dispatch('updateBaseTheme', customThemeValue(savedTheme.id))
    }
    showToast({
      message: t('Settings.Theme Settings.Custom Theme.Theme Saved'),
      icon: ['fas', 'check']
    })
    closeEditor()
  } catch (error) {
    showError(t('Settings.Theme Settings.Custom Theme.Unable to Save'), error)
  }
}

async function handleDeletePrompt(value) {
  showDeletePrompt.value = false
  if (value !== 'delete') return

  try {
    const themes = await deleteCustomTheme(draft.id)
    await store.dispatch('updateCustomThemes', themes)
    showToast({
      message: t('Settings.Theme Settings.Custom Theme.Theme Deleted'),
      icon: ['fas', 'trash']
    })
    closeEditor()
  } catch (error) {
    showError(t('Settings.Theme Settings.Custom Theme.Unable to Delete'), error)
  }
}

async function importTheme() {
  const loadId = editorLoadId
  try {
    const file = await readFileWithPicker(
      t('Settings.Theme Settings.Custom Theme.Theme File'),
      { 'application/json': '.json' },
      'custom-theme-import',
      'documents'
    )
    if (file === null || !props.open || loadId !== editorLoadId) return
    importThemeContent(file.content)
  } catch (error) {
    if (!props.open || loadId !== editorLoadId) return
    showError(t('Settings.Theme Settings.Custom Theme.Invalid Theme File'), error)
  }
}

async function importThemeFromClipboard() {
  const loadId = editorLoadId
  let content
  try {
    content = await readClipboard()
  } catch (error) {
    if (!props.open || loadId !== editorLoadId) return
    showError(t('Color Picker.Clipboard Unavailable'), error)
    return
  }
  if (!props.open || loadId !== editorLoadId) return
  try {
    importThemeContent(content)
  } catch (error) {
    showError(t('Settings.Theme Settings.Custom Theme.Invalid Clipboard Theme'), error)
  }
}

function importThemeContent(content) {
  const importedTheme = normalizeCustomTheme(JSON.parse(content))
  importedTheme.id = crypto.randomUUID()
  keepSystemThemeOnSave = false
  cancelPendingColorPreviews()
  setDraft(importedTheme)
  themeSourceColors.value = readThemeSourceColors()
  previewing = true
  previewTheme()
  showToast({
    message: t('Settings.Theme Settings.Custom Theme.Theme Imported'),
    icon: ['fas', 'check']
  })
}

async function exportTheme() {
  try {
    const theme = normalizeCustomTheme(draft)
    const filename = `${theme.name.replaceAll(/[^\p{L}\p{N}._-]+/gu, '-').replaceAll(/^-|-$/g, '') || 'custom-theme'}.json`
    const saved = await writeFileWithPicker(
      filename,
      `${JSON.stringify(theme, null, 2)}\n`,
      t('Settings.Theme Settings.Custom Theme.Theme File'),
      'application/json',
      '.json',
      'custom-theme-export',
      'documents'
    )
    if (saved) {
      showToast({
        message: t('Settings.Theme Settings.Custom Theme.Theme Exported'),
        icon: ['fas', 'check']
      })
    }
  } catch (error) {
    showError(t('Settings.Theme Settings.Custom Theme.Unable to Export'), error)
  }
}

async function shareTheme() {
  try {
    const theme = normalizeCustomTheme(draft)
    const themeJson = JSON.stringify(theme, null, 2)
    const longestBacktickRun = Math.max(
      2,
      ...Array.from(themeJson.matchAll(/`+/g), match => match[0].length)
    )
    const codeFence = '`'.repeat(longestBacktickRun + 1)
    const body = [
      `## ${t('Settings.Theme Settings.Custom Theme.Share Description Heading')}`,
      '',
      `<!-- ${t('Settings.Theme Settings.Custom Theme.Share Description Prompt')} -->`,
      '',
      `## ${t('Settings.Theme Settings.Custom Theme.Share Screenshots Heading')}`,
      '',
      '<!-- theme-screenshots:start -->',
      `<!-- ${t('Settings.Theme Settings.Custom Theme.Share Screenshots Prompt')} -->`,
      '<!-- theme-screenshots:end -->',
      '',
      '<details>',
      `<summary>${t('Settings.Theme Settings.Custom Theme.Share Code Summary')}</summary>`,
      '',
      `${codeFence}json`,
      themeJson,
      codeFence,
      '',
      '</details>'
    ].join('\n')
    const url = new URL(CUSTOM_THEME_DISCUSSION_URL)
    url.searchParams.set('category', 'themes')
    url.searchParams.set('title', theme.name)
    url.searchParams.set('body', body)
    await openExternalLink(url.toString())
  } catch (error) {
    showError(t('Settings.Theme Settings.Custom Theme.Unable to Share'), error)
  }
}

function showError(message, error) {
  console.error(message, error)
  const detail = error instanceof Error ? error.message : String(error)
  showToast({ message: `${message}: ${detail}`, icon: ['fas', 'circle-exclamation'] })
}

onBeforeUnmount(() => {
  editorLoadId++
  cancelPendingColorPreviews()
  store.commit('setCustomThemeEditorOpen', false)
})
</script>

<style scoped>
.customThemeEditor {
  min-block-size: 0;
  block-size: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow: hidden;
  padding-block: 12px;
  padding-inline: 24px;
}

.editorFooter,
.fileActions {
  display: flex;
  align-items: end;
  gap: 12px;
}

.editorHeader {
  flex: none;
  display: flex;
  align-items: end;
  gap: 12px;
}

.editorFooter {
  flex: none;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.deleteThemeButton {
  margin-inline-end: auto;
}

.themeNameField {
  flex: 1;
  min-inline-size: 0;
  display: grid;
  gap: 8px;
  color: var(--secondary-text-color);
}

.themeSources {
  flex: none;
  display: flex;
  align-items: flex-start;
  justify-content: flex-start;
  gap: 12px;
  min-block-size: 75px;
}

.themeSources :deep(.select) {
  flex: 1 1 200px;
  min-inline-size: 0;
  max-inline-size: 260px;
}

.darkThemeControl {
  flex: 0 0 auto;
  padding-block-start: 31px;
}

.themeNameField input {
  box-sizing: border-box;
  inline-size: 100%;
  min-block-size: 42px;
  border: 1px solid var(--divider-color);
  border-radius: calc(8px * var(--ui-roundness));
  padding-inline: 12px;
  color: var(--primary-text-color);
  background: var(--search-bar-color);
  backdrop-filter: var(--search-bar-blur, none);
}

.editorFooter :deep(.btn) {
  margin-block: 0;
}

.colorGrid {
  min-block-size: 0;
  flex: 1 1 auto;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  align-content: start;
  gap: 10px;
  overflow: auto;
  overscroll-behavior: contain;
}

@container (width < 560px) {
  .customThemeEditor {
    padding: 16px;
  }

  .editorHeader {
    align-items: end;
  }

  .themeSources {
    flex-direction: column;
    gap: 0;
  }

  .darkThemeControl {
    padding-block-start: 0;
  }

  .themeSources :deep(.select) {
    flex-basis: auto;
    inline-size: 100%;
    max-inline-size: none;
  }
}
</style>
