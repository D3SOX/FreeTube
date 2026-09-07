<template>
  <FtSettingsSection
    :title="`${t('Settings.General Settings.Navigation.Navigation')} / ${t('Settings.Quick Settings.Quick Settings')}`"
  >
    <div class="customizerLaunchers">
      <div class="settingButtonWithSync">
        <FtButton
          :label="t('Settings.Quick Settings.Customize Quick Settings')"
          :icon="['fas', 'sliders-h']"
          @click="open = true"
        />
        <FtSyncedSettingIndicator setting-key="quickSettings" />
      </div>
      <NavigationCustomizer />
    </div>
  </FtSettingsSection>

  <FtSettingsSubpage
    :open="open"
    :title="t('Settings.Quick Settings.Customize Quick Settings')"
    :icon="['fas', 'sliders-h']"
    @close="close"
  >
    <div class="quickSettingsActions">
      <div
        ref="settingPickerAnchorRef"
        class="settingPickerAnchor"
      >
        <FtButton
          :label="t('Settings.Quick Settings.Add Setting')"
          :icon="['fas', 'plus']"
          aria-haspopup="dialog"
          :aria-expanded="settingPickerOpen"
          :aria-controls="settingPickerId"
          @click="toggleSettingPicker"
        />
        <div
          v-if="settingPickerOpen"
          :id="settingPickerId"
          class="settingPickerPopover"
          data-settings-escape-scope
          role="dialog"
          :aria-label="t('Settings.Quick Settings.Add Setting')"
          @keydown.esc.stop="closeSettingPicker(true)"
        >
          <FtInput
            ref="settingPickerRef"
            class="settingPicker"
            input-type="search"
            :placeholder="t('Settings.Search Settings')"
            :label="t('Settings.Search Settings')"
            :show-label="false"
            :show-action-button="false"
            :show-data-when-empty="true"
            :is-search="true"
            :value="settingSearchQuery"
            :data-list="availableSettingLabels"
            :data-list-properties="availableSettingProperties"
            @input="settingSearchQuery = $event"
            @click="addQuickSetting"
          />
        </div>
      </div>
      <FtButton
        :label="t('KeyboardShortcutPrompt.Reset to Defaults')"
        :icon="['fas', 'undo']"
        :disabled="isDefaultQuickSettings"
        theme="secondary"
        @click="resetQuickSettings"
      />
    </div>

    <ul
      v-if="selectedSettings.length > 0"
      class="selectedSettings"
    >
      <li
        v-for="(setting, index) in selectedSettings"
        :key="setting.id"
        class="selectedSetting"
        :data-setting-id="setting.id"
        :class="{
          dragging: draggedSettingId === setting.id,
          dropBefore: dropTarget?.id === setting.id && !dropTarget.after,
          dropAfter: dropTarget?.id === setting.id && dropTarget.after,
        }"
        @dragover.prevent="handleDragOver($event, setting.id)"
        @drop.prevent="dropQuickSetting($event, setting.id)"
      >
        <span
          class="dragHandle"
          draggable="true"
          aria-hidden="true"
          @dragstart="startDragging($event, setting.id)"
          @dragend="stopDragging"
          @pointerdown="startPointerDrag($event, setting.id)"
          @pointermove="movePointerDrag"
          @pointerup="endPointerDrag"
          @pointercancel="cancelPointerDrag"
          @lostpointercapture="cancelPointerDrag"
        >
          <FtIcon :icon="['fas', 'grip']" />
        </span>
        <FtIcon
          class="selectedSettingIcon"
          :icon="setting.icon"
          aria-hidden="true"
        />
        <span>{{ setting.label }}</span>
        <div class="settingActions">
          <button
            type="button"
            class="settingAction"
            :aria-label="t('Home Page.Move section up', { section: setting.label })"
            :title="t('Home Page.Move section up', { section: setting.label })"
            :disabled="index === 0"
            @click="moveQuickSetting(setting.id, -1)"
          >
            <FtIcon
              :icon="['fas', 'arrow-up']"
              aria-hidden="true"
            />
          </button>
          <button
            type="button"
            class="settingAction"
            :aria-label="t('Home Page.Move section down', { section: setting.label })"
            :title="t('Home Page.Move section down', { section: setting.label })"
            :disabled="index === selectedSettings.length - 1"
            @click="moveQuickSetting(setting.id, 1)"
          >
            <FtIcon
              :icon="['fas', 'arrow-down']"
              aria-hidden="true"
            />
          </button>
          <button
            type="button"
            class="settingAction"
            :aria-label="`${t('Search Bar.Remove')} ${setting.label}`"
            :title="`${t('Search Bar.Remove')} ${setting.label}`"
            @click="removeQuickSetting(setting.id)"
          >
            <FtIcon
              :icon="['fas', 'xmark']"
              aria-hidden="true"
            />
          </button>
        </div>
      </li>
    </ul>
    <p
      v-else
      class="emptyState"
    >
      {{ t('Settings.No Settings Found') }}
    </p>
    <p
      class="reorderStatus"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {{ reorderStatus }}
    </p>
  </FtSettingsSubpage>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

import FtButton from '../FtButton/FtButton.vue'
import FtInput from '../FtInput/FtInput.vue'
import FtSettingsSection from '../FtSettingsSection/FtSettingsSection.vue'
import FtSettingsSubpage from '../FtSettingsSubpage/FtSettingsSubpage.vue'
import FtSyncedSettingIndicator from '../FtSyncedSettingIndicator/FtSyncedSettingIndicator.vue'
import NavigationCustomizer from '../NavigationCustomizer/NavigationCustomizer.vue'

import store from '../../store/index'
import { moveItemByVisibleOffset } from '../../../orderedItems'
import { useOrderedItemDrag } from '../../composables/useOrderedItemDrag'
import {
  createQuickSettingCatalog,
  DEFAULT_QUICK_SETTINGS,
} from '../../helpers/quickSettings'

const { locale, t } = useI18n()
const open = ref(false)
const settingPickerOpen = ref(false)
const settingSearchQuery = ref('')
const reorderStatus = ref('')
const settingPickerId = `quick-setting-picker-${useId().replaceAll(':', '')}`
const settingPickerAnchorRef = useTemplateRef('settingPickerAnchorRef')
const settingPickerRef = useTemplateRef('settingPickerRef')

const catalog = computed(() => createQuickSettingCatalog(t, process.env.IS_ELECTRON))
const catalogById = computed(() => new Map(catalog.value.map(setting => [setting.id, setting])))
const quickSettings = computed(() => store.getters.getQuickSettings)
const isDefaultQuickSettings = computed(() => (
  quickSettings.value.length === DEFAULT_QUICK_SETTINGS.length &&
  quickSettings.value.every((id, index) => id === DEFAULT_QUICK_SETTINGS[index])
))
const selectedSettings = computed(() => quickSettings.value
  .map(id => catalogById.value.get(id))
  .filter(setting => setting != null))
const availableSettings = computed(() => catalog.value
  .filter(setting => !quickSettings.value.includes(setting.id))
  .toSorted((left, right) => left.label.localeCompare(right.label, locale.value)))
const availableSettingLabels = computed(() => availableSettings.value.map(setting => setting.label))
const availableSettingProperties = computed(() => availableSettings.value.map(setting => ({
  ariaLabel: setting.label,
  displayText: setting.label,
  iconName: setting.icon[1],
})))

function close() {
  open.value = false
  closeSettingPicker()
  stopDragging()
}

async function toggleSettingPicker() {
  if (settingPickerOpen.value) {
    closeSettingPicker()
    return
  }

  settingPickerOpen.value = true
  settingSearchQuery.value = ''
  await nextTick()
  settingPickerRef.value?.focus()
}

function closeSettingPicker(restoreFocus = false) {
  settingPickerOpen.value = false
  settingSearchQuery.value = ''
  if (restoreFocus) {
    nextTick(() => settingPickerAnchorRef.value?.querySelector('button')?.focus())
  }
}

function closeSettingPickerFromOutside(event) {
  if (!settingPickerOpen.value || settingPickerAnchorRef.value?.contains(event.target)) return
  closeSettingPicker()
}

onMounted(() => document.addEventListener('pointerdown', closeSettingPickerFromOutside))
onBeforeUnmount(() => document.removeEventListener('pointerdown', closeSettingPickerFromOutside))

async function addQuickSetting(_, { dataListIndex }) {
  const setting = availableSettings.value[dataListIndex]
  if (!setting) return

  await store.dispatch('updateQuickSettings', [...quickSettings.value, setting.id])
  settingSearchQuery.value = ''
  await nextTick()
  settingPickerRef.value?.setText('')
  settingPickerRef.value?.focus()
}

function removeQuickSetting(settingId) {
  return store.dispatch(
    'updateQuickSettings',
    quickSettings.value.filter(id => id !== settingId)
  )
}

function announceQuickSettingMoved(settingId, position) {
  const setting = catalogById.value.get(settingId)
  reorderStatus.value = t('Home Page.Section moved', {
    section: setting?.label ?? settingId,
    position: position + 1,
    total: quickSettings.value.length,
  })
}

function moveQuickSetting(settingId, offset) {
  const visibleSettings = selectedSettings.value.map(setting => setting.id)
  const currentIndex = visibleSettings.indexOf(settingId)
  const targetIndex = currentIndex + offset
  const reordered = moveItemByVisibleOffset(
    quickSettings.value,
    visibleSettings,
    settingId,
    offset
  )
  if (reordered === quickSettings.value) return

  store.dispatch('updateQuickSettings', reordered)
  announceQuickSettingMoved(settingId, targetIndex)
}

const {
  draggedItemId: draggedSettingId,
  dropTarget,
  dropItem: dropQuickSetting,
  handleDragOver,
  startDragging,
  stopDragging,
  startPointerDrag,
  movePointerDrag,
  endPointerDrag,
  cancelPointerDrag,
} = useOrderedItemDrag({
  items: quickSettings,
  rowSelector: '.selectedSetting',
  itemIdAttribute: 'data-setting-id',
  updateItems: items => store.dispatch('updateQuickSettings', items),
  announceMoved: announceQuickSettingMoved,
})

function resetQuickSettings() {
  return store.dispatch('updateQuickSettings', [...DEFAULT_QUICK_SETTINGS])
}
</script>

<style scoped>
.customizerLaunchers {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
}

.settingButtonWithSync {
  align-items: center;
  display: inline-flex;
}

.quickSettingsActions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  inline-size: 100%;
  justify-content: center;
  margin-block-end: 20px;
  margin-inline: auto;
  max-inline-size: 720px;
  position: relative;
}

.settingPickerPopover {
  background: var(--card-bg-color);
  border: 1px solid var(--divider-color);
  border-radius: calc(6px * var(--ui-roundness));
  box-shadow: 0 8px 24px rgb(0 0 0 / 35%);
  box-sizing: border-box;
  inline-size: min(520px, 100%);
  inset-block-start: calc(100% + 8px);
  inset-inline-start: 50%;
  padding: 12px;
  position: absolute;
  translate: -50% 0;
  z-index: 20;
}

.settingPicker {
  inline-size: 100%;
}

.settingPicker :deep(.list) {
  border-block-start: 1px solid var(--divider-color);
  border-radius: 0 0 calc(5px * var(--ui-roundness)) calc(5px * var(--ui-roundness));
  box-shadow: none;
  margin-block-start: 8px;
  position: relative;
}

.settingPicker :deep(.list:has(> .os-scrollbar-vertical:not(.os-scrollbar-unusable)) > li) {
  margin-inline-end: var(--scrollbar-track-width);
}

.settingPicker :deep(.optionWrapper) {
  cursor: pointer;
  user-select: none;
}

.selectedSettings {
  display: grid;
  gap: 8px;
  inline-size: 100%;
  list-style: none;
  margin-block: 0;
  margin-inline: auto;
  max-inline-size: 720px;
  padding: 0;
}

.selectedSetting {
  align-items: center;
  background: var(--card-bg-color);
  border: 1px solid var(--divider-color);
  border-radius: calc(6px * var(--ui-roundness));
  display: grid;
  grid-template-columns: 44px 24px minmax(0, 1fr) auto;
  min-block-size: 56px;
  position: relative;
  user-select: none;
}

.selectedSetting.dragging {
  opacity: 0.5;
}

.selectedSetting.dropBefore::before,
.selectedSetting.dropAfter::after {
  background: var(--primary-color);
  block-size: 3px;
  border-radius: 2px;
  content: '';
  inset-inline: 0;
  position: absolute;
}

.selectedSetting.dropBefore::before {
  inset-block-start: -6px;
}

.selectedSetting.dropAfter::after {
  inset-block-end: -6px;
}

.dragHandle {
  touch-action: none;
  align-items: center;
  align-self: stretch;
  color: var(--secondary-text-color);
  cursor: grab;
  display: flex;
  inline-size: 44px;
  justify-content: center;
}

.dragHandle:active {
  cursor: grabbing;
}

.selectedSettingIcon {
  align-items: center;
  block-size: 20px;
  color: var(--secondary-text-color);
  display: flex;
  inline-size: 20px;
  justify-content: center;
}

.settingActions {
  align-self: stretch;
  display: flex;
}

.settingAction {
  align-items: center;
  background: transparent;
  border: 0;
  border-radius: calc(6px * var(--ui-roundness));
  color: var(--secondary-text-color);
  cursor: pointer;
  display: flex;
  inline-size: 44px;
  justify-content: center;
}

.settingAction:hover:not(:disabled),
.settingAction:focus-visible {
  background: var(--side-nav-hover-color);
  color: var(--side-nav-hover-text-color);
}

.settingAction:disabled {
  cursor: default;
  opacity: 0.35;
}

.reorderStatus {
  block-size: 1px;
  clip-path: inset(50%);
  inline-size: 1px;
  overflow: hidden;
  position: absolute;
  white-space: nowrap;
}

.emptyState {
  color: var(--secondary-text-color);
  margin-block: 24px;
  text-align: center;
}
</style>
