<template>
  <!-- UnifiedPush is the protocol's name. -->
  <!-- eslint-disable-next-line @intlify/vue-i18n/no-raw-text -->
  <FtSettingsSection title="UnifiedPush">
    <div
      class="unifiedPushSettings"
      :aria-busy="busy"
    >
      <p>{{ t('UnifiedPush.Description') }}</p>
      <p v-if="state && state.distributors.length === 0">
        {{ t('UnifiedPush.No Providers') }}
      </p>
      <template v-else-if="state">
        <FtSelect
          :placeholder="t('UnifiedPush.Provider')"
          :value="distributor"
          :select-names="state.distributors.map(item => item.name)"
          :select-values="state.distributors.map(item => item.id)"
          :disabled="busy"
          :icon="['fas', 'link']"
          @change="distributor = $event"
        />
        <FtInput
          :placeholder="t('UnifiedPush.VAPID Key')"
          :value="vapid"
          :show-label="true"
          :show-action-button="false"
          :disabled="busy"
          @input="vapid = $event"
        />
      </template>
      <p role="status">
        {{ activeProvider ? `${status} · ${activeProvider}` : status }}
      </p>
      <p
        v-if="error"
        role="alert"
      >
        {{ error }}
      </p>
      <div class="unifiedPushActions">
        <FtButton
          :disabled="busy || !distributor || !state?.distributors.length"
          @click="connect"
        >
          <FtIcon
            :icon="['fas', 'link']"
            aria-hidden="true"
          />
          {{ t('UnifiedPush.Connect') }}
        </FtButton>
        <FtButton
          v-if="state?.enabled"
          :disabled="busy"
          @click="run(() => unifiedPush.unregister())"
        >
          <FtIcon
            :icon="['fas', 'link-slash']"
            aria-hidden="true"
          />
          {{ t('UnifiedPush.Disconnect') }}
        </FtButton>
        <FtButton
          :disabled="busy"
          @click="run(reload)"
        >
          <FtIcon
            :icon="['fas', 'sync']"
            aria-hidden="true"
          />
          {{ t('UnifiedPush.Refresh') }}
        </FtButton>
        <FtButton
          v-if="state?.hasSubscription"
          :disabled="busy"
          @click="copyConnection"
        >
          <FtIcon
            :icon="['fas', 'copy']"
            aria-hidden="true"
          />
          {{ t('UnifiedPush.Copy Connection') }}
        </FtButton>
      </div>
      <p>{{ t('UnifiedPush.Sender Hint') }}</p>
    </div>
  </FtSettingsSection>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { FtIcon } from '@opentubex/icons'
import FtButton from './FtButton/FtButton.vue'
import FtInput from './FtInput/FtInput.vue'
import FtSelect from './FtSelect/FtSelect.vue'
import FtSettingsSection from './FtSettingsSection/FtSettingsSection.vue'
import { unifiedPush } from '../helpers/unifiedPush'
import { showToast } from '../helpers/utils'

const { t } = useI18n()
const state = ref(null)
const distributor = ref('')
const vapid = ref('')
const busy = ref(false)
const error = ref('')
let disposed = false
let listener
let revision = 0

const activeProvider = computed(() => state.value?.enabled
  ? state.value.distributors.find(item => item.id === state.value.distributor)?.name
  : '')
const status = computed(() => {
  if (!state.value) return ''
  if (!state.value.notificationsAllowed) return t('Video.Notification unavailable')
  switch (state.value.status) {
    case 'registered': return t('UnifiedPush.Connected')
    case 'registering': return t('UnifiedPush.Waiting')
    case 'error': return t('UnifiedPush.Failed')
    case 'unavailable':
    case 'unregistered': return t('UnifiedPush.Unavailable')
    default: return t('Settings.General Settings.Avoid translation.Disabled')
  }
})

async function reload() {
  const request = ++revision
  const next = await unifiedPush.getState()
  if (disposed || request !== revision) return
  if (!state.value) vapid.value = next.vapid
  state.value = next
  if (!next.distributors.some(item => item.id === distributor.value)) {
    distributor.value = next.distributors.find(item => item.id === next.distributor)?.id ?? next.distributors[0]?.id ?? ''
  }
}

async function run(action = reload) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await action()
    if (action !== reload) await reload()
  } catch (reason) {
    error.value = reason?.code === 'notifications-denied' ? t('Video.Notification unavailable') : t('UnifiedPush.Failed')
  } finally {
    busy.value = false
  }
}

function connect() {
  return run(() => unifiedPush.register({ distributor: distributor.value, vapid: vapid.value.trim() }))
}

async function copyConnection() {
  try {
    await unifiedPush.copySubscription()
    showToast({ message: t('UnifiedPush.Copied'), icon: ['fas', 'copy'] })
  } catch {
    error.value = t('Clipboard.Copy failed')
  }
}

onMounted(async () => {
  try {
    listener = await unifiedPush.addStateListener(() => {
      reload().catch(() => { error.value = t('UnifiedPush.Failed') })
    })
    if (disposed) { listener.remove(); return }
    await run(reload)
  } catch {
    error.value = t('UnifiedPush.Failed')
  }
})
onUnmounted(() => {
  disposed = true
  revision++
  listener?.remove()
})
</script>

<style scoped>
.unifiedPushSettings {
  display: grid;
  gap: 16px;
  max-inline-size: 640px;
}

.unifiedPushSettings p {
  margin: 0;
  overflow-wrap: anywhere;
}

.unifiedPushActions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.unifiedPushActions button {
  min-block-size: 48px;
}
</style>
