<template>
  <button
    v-if="canConfigureSync"
    type="button"
    class="syncedSettingIndicator"
    :class="{ syncDisabled: !isSynced, indicatorDisabled: disabled }"
    :disabled="disabled"
    :aria-pressed="isSynced"
    :aria-label="label"
    :title="label"
    @click.prevent.stop="toggleSync"
  >
    <FtIcon :icon="isSynced ? ['fas', 'link'] : ['fas', 'link-slash']" />
  </button>
  <button
    v-if="showReset"
    type="button"
    class="changedSettingIndicator"
    :class="{ indicatorDisabled: disabled }"
    :disabled="disabled"
    :aria-label="resetLabel"
    :title="resetLabel"
    @click.prevent.stop="resetToDefault"
  >
    <FtIcon :icon="['fas', 'undo']" />
  </button>
  <!-- Kept as reserved space rather than left out: a control that grows by an
       icon the moment its value leaves the default reflows, which can re-wrap
       a slider's label while it is still being dragged. -->
  <span
    v-else-if="canShowReset"
    class="changedSettingIndicatorPlaceholder"
    aria-hidden="true"
  >
    <FtIcon :icon="['fas', 'undo']" />
  </span>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import {
  DEFAULT_SETTINGS,
  isSettingSyncEnabled,
  isSettingSyncable
} from '../../store/modules/settings'
import store from '../../store/index'

const props = defineProps({
  settingKey: {
    type: String,
    default: ''
  },
  settingKeys: {
    type: Array,
    default: () => []
  },
  enableLabel: {
    type: String,
    default: ''
  },
  disableLabel: {
    type: String,
    default: ''
  },
  isChanged: {
    type: Boolean,
    default: null
  },
  disabled: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['reset'])

const { t } = useI18n()

const syncableSettingKeys = computed(() => {
  const keys = props.settingKeys.length > 0 ? props.settingKeys : [props.settingKey]
  return keys.filter(isSettingSyncable)
})

const canConfigureSync = computed(() => {
  const settings = store.state.settings
  return settings.syncServerEnabled &&
    settings.syncServerToken !== '' &&
    settings.syncServerSyncSettings &&
    syncableSettingKeys.value.length > 0
})

const isSynced = computed(() => {
  return syncableSettingKeys.value.some(settingKey => (
    isSettingSyncEnabled(store.state.settings, settingKey)
  ))
})

const canShowReset = computed(() => {
  return store.state.settings.highlightChangedSettings === true &&
    props.settingKey !== 'highlightChangedSettings' &&
    (props.settingKey !== '' || props.isChanged !== null)
})

const showReset = computed(() => {
  return canShowReset.value &&
    (props.isChanged ?? (
      Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, props.settingKey) &&
      !settingsValuesEqual(store.state.settings[props.settingKey], DEFAULT_SETTINGS[props.settingKey])
    ))
})

const label = computed(() => isSynced.value
  ? props.disableLabel || t('Settings.Sync Settings.Disable Setting Sync')
  : props.enableLabel || t('Settings.Sync Settings.Enable Setting Sync'))

const resetLabel = computed(() => t('Settings.Reset Setting to Default'))

function settingsValuesEqual(currentValue, defaultValue) {
  if (Object.is(currentValue, defaultValue)) {
    return true
  }

  if (typeof currentValue !== 'object' || currentValue === null ||
      typeof defaultValue !== 'object' || defaultValue === null) {
    return false
  }

  return JSON.stringify(currentValue) === JSON.stringify(defaultValue)
}

function resetToDefault() {
  if (props.disabled) return

  if (props.isChanged !== null) {
    emit('reset')
  } else {
    store.dispatch('resetSettingToDefault', props.settingKey)
  }
}

async function toggleSync() {
  if (props.disabled) return

  const excluded = Array.isArray(store.state.settings.syncServerSettingsExcluded)
    ? store.state.settings.syncServerSettingsExcluded
    : []
  const settingKeys = new Set(syncableSettingKeys.value)
  const enableSync = !isSynced.value
  const next = !enableSync
    ? Array.from(new Set([...excluded, ...settingKeys]))
    : excluded.filter(settingKey => !settingKeys.has(settingKey))
  await store.dispatch('updateSyncServerSettingsExcluded', next)
  if (enableSync) {
    store.dispatch('scheduleSyncServer', 'settings')
  }
}
</script>

<style scoped>
.syncedSettingIndicator,
.changedSettingIndicator,
.changedSettingIndicatorPlaceholder {
  padding: 0;
  border: 0;
  color: inherit;
  background: none;
  cursor: pointer;
  display: inline-flex;
  font-size: 0.75em;
  margin-inline-start: 6px;
  vertical-align: middle;
}

.syncedSettingIndicator:hover,
.syncedSettingIndicator:focus-visible,
.changedSettingIndicator:hover,
.changedSettingIndicator:focus-visible {
  color: var(--settings-changed-color, var(--primary-color));
  outline: 2px solid var(--settings-changed-color, var(--primary-color));
  outline-offset: 2px;
}

.changedSettingIndicator {
  color: var(--settings-changed-color, var(--primary-color));
}

.changedSettingIndicatorPlaceholder {
  visibility: hidden;
  cursor: default;
}

.syncDisabled {
  opacity: 0.55;
}

.indicatorDisabled {
  pointer-events: none;
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
