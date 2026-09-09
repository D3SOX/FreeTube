<template>
  <FtSettingsSection :title="t('Settings.Sync Settings.Sync Settings')">
    <p class="description">
      {{ t('Settings.Sync Settings.Description') }}
    </p>
    <FtFlexBox class="toggles">
      <FtToggleSwitch
        :label="t('Settings.Sync Settings.Enable Sync')"
        :default-value="syncEnabled"
        compact
        @change="setSyncEnabled"
      />
    </FtFlexBox>
    <template v-if="syncEnabled">
      <FtFlexBox class="fields">
        <FtInput
          :placeholder="t('Settings.Sync Settings.Server URL')"
          :show-action-button="false"
          :data-list="syncServerInstances"
          :value="serverUrl"
          :disabled="connected || authenticating"
          show-label
          @input="serverUrl = $event"
          @blur="saveServerUrl"
        />
        <FtInput
          :placeholder="t('Settings.Sync Settings.Username')"
          :show-action-button="false"
          :value="connected ? savedUsername : username"
          :disabled="connected || serverCredentialsDisabled"
          show-label
          @input="username = $event"
        />
        <FtInput
          v-if="!connected"
          :placeholder="t('Settings.Password Dialog.Password')"
          :show-action-button="false"
          :value="password"
          :disabled="serverCredentialsDisabled"
          input-type="password"
          show-label
          @input="password = $event"
          @keydown.enter="authenticate('login')"
        />
        <FtInput
          v-if="!connected && serverPrivacySupported !== false"
          :placeholder="t('Settings.Sync Settings.Privacy Passphrase')"
          :show-action-button="false"
          :value="privacyPassphrase"
          :disabled="serverCredentialsDisabled"
          input-type="password"
          show-label
          @input="privacyPassphrase = $event"
          @keydown.enter="authenticate('login')"
        />
      </FtFlexBox>
      <p
        v-if="privacyPolicyUrl"
        class="privacyPolicy"
      >
        <a :href="privacyPolicyUrl">
          {{ t('Settings.Sync Settings.Privacy Policy') }}
        </a>
      </p>
      <p
        v-if="!connected && serverPrivacySupported !== false"
        class="privacyHint"
      >
        {{ t('Settings.Sync Settings.Privacy Passphrase Hint') }}
      </p>
      <p
        v-if="!connected && serverCheckStatus === 'checking'"
        class="serverCheckStatus"
        aria-live="polite"
      >
        {{ t('Settings.Sync Settings.Checking Server') }}
      </p>
      <p
        v-if="!connected && serverPrivacySupported === false"
        class="privacyWarning"
        role="status"
      >
        {{ t('Settings.Sync Settings.Enhanced Privacy Unsupported') }}
      </p>

      <div
        v-if="busy && syncProgress"
        class="syncProgress"
        aria-live="polite"
      >
        <div class="syncProgressLabel">
          <span>{{ syncProgressLabel }}</span>
          <span>
            {{ t('Settings.Sync Settings.Sync progress percentage', {
              percentage: syncProgress.percentage,
            }) }}
          </span>
        </div>
        <div
          class="syncProgressTrack"
          role="progressbar"
          :aria-label="syncProgressLabel"
          :aria-valuenow="syncProgress.percentage"
          aria-valuemin="0"
          aria-valuemax="100"
        >
          <div
            class="syncProgressFill"
            :style="{ inlineSize: `${syncProgress.percentage}%` }"
          />
        </div>
      </div>
      <FtLoader v-else-if="busy" />
      <p
        v-if="errorMessage"
        class="error"
        role="alert"
      >
        {{ errorMessage }}
      </p>

      <template v-if="connected">
        <p class="connectionStatus">
          {{ t('Settings.Sync Settings.Connected as', { username: savedUsername }) }}
        </p>
        <p
          v-if="privacyMode === 'enhanced'"
          class="privacyStatus"
        >
          {{ t('Settings.Sync Settings.Enhanced Privacy Enabled') }}
        </p>
        <p
          v-else-if="privacyMode === 'legacy'"
          class="privacyWarning"
          role="alert"
        >
          {{ t('Settings.Sync Settings.Enhanced Privacy Unsupported') }}
        </p>
        <FtFlexBox class="toggles">
          <FtToggleSwitch
            :label="t('Settings.Sync Settings.Automatic Sync')"
            :default-value="autoSync"
            compact
            @change="setAutoSync"
          />
          <FtToggleSwitch
            :label="t('Subscriptions.Subscriptions')"
            :default-value="syncSubscriptionsEnabled"
            :disabled="busy"
            compact
            @change="store.dispatch('updateSyncServerSyncSubscriptions', $event)"
          />
          <FtToggleSwitch
            :label="t('Playlists')"
            :default-value="syncPlaylistsEnabled"
            :disabled="busy"
            compact
            @change="store.dispatch('updateSyncServerSyncPlaylists', $event)"
          />
          <FtToggleSwitch
            :label="t('History.History')"
            :default-value="syncHistoryEnabled"
            :disabled="busy || historySupported === false"
            compact
            @change="store.dispatch('updateSyncServerSyncHistory', $event)"
          />
          <FtToggleSwitch
            :label="t('Settings.Sync Settings.Profiles')"
            :default-value="syncProfilesEnabled"
            :disabled="busy"
            compact
            @change="store.dispatch('updateSyncServerSyncProfiles', $event)"
          />
          <FtToggleSwitch
            v-if="sessionsSupported"
            :label="t('Settings.Sync Settings.Open Tabs')"
            :default-value="syncSessionsEnabled"
            :disabled="busy"
            compact
            @change="store.dispatch('updateSyncServerSyncSessions', $event)"
          />
          <FtToggleSwitch
            v-if="sessionsSupported && syncSessionsEnabled"
            :label="t('Settings.Sync Settings.Use Shared Tabs')"
            :default-value="sharedTabsEnabled"
            :disabled="busy"
            compact
            @change="setSharedTabs"
          />
          <FtToggleSwitch
            :label="t('Settings.Settings')"
            :default-value="syncSettingsEnabled"
            :disabled="busy || settingsSupported === false"
            compact
            @change="store.dispatch('updateSyncServerSyncSettings', $event)"
          />
        </FtFlexBox>
        <p
          v-if="sessionsSupported && syncSessionsEnabled && sharedTabsEnabled"
          class="compatibilityWarning"
        >
          {{ t('Settings.Sync Settings.Shared Tabs Warning') }}
        </p>
        <p
          v-if="lastSyncLabel"
          class="lastSync"
        >
          {{ t('Settings.Sync Settings.Last synced', { date: lastSyncLabel }) }}
        </p>
        <p
          v-if="historySupported === false"
          class="compatibilityWarning"
        >
          {{ t('Settings.Sync Settings.History not supported') }}
        </p>
        <p
          v-if="settingsSupported === false"
          class="compatibilityWarning"
        >
          {{ t('Settings.Sync Settings.Settings not supported') }}
        </p>
        <FtFlexBox class="actions">
          <SyncPairing
            :connected="connected"
            :supported="pairingSupported"
            :disabled="busy || privacyMode !== 'enhanced' || !privacyKey || !privacySalt || !currentDeviceId"
            :server-url="serverUrl"
            :username="savedUsername"
            :privacy-key="privacyKey"
            :privacy-salt="privacySalt"
            :device-id="currentDeviceId"
            @paired="pairingCompleted"
          />
          <FtButton
            :label="t('Settings.Sync Settings.Sync Now')"
            :icon="['fas', 'sync']"
            :disabled="busy"
            @click="syncNow"
          />
          <FtButton
            :label="t('Settings.Sync Settings.Disconnect')"
            :icon="['fas', 'right-from-bracket']"
            :disabled="busy || accountActionBusy"
            @click="disconnect"
          />
          <FtButton
            v-if="accountSessionsSupported && passwordLogin"
            :label="t('Settings.Sync Settings.Change Password')"
            :icon="['fas', 'key']"
            :disabled="busy || accountActionBusy"
            @click="openPasswordPrompt"
          />
          <FtButton
            :label="t('Settings.Sync Settings.Delete Account')"
            theme="destructive"
            :icon="['fas', 'trash']"
            :disabled="busy || accountActionBusy"
            @click="showDeleteAccountPrompt = true"
          />
        </FtFlexBox>
        <SyncAccountManagement
          v-if="accountSessionsSupported"
          ref="accountManagement"
          :server-url="serverUrl"
          :token="syncServerToken"
          :privacy-key="privacyKey"
          :device-id="currentDeviceId"
          :device-name="currentDeviceName"
          @current-revoked="disconnect"
          @password-login-changed="passwordLogin = $event"
        />
      </template>
      <FtFlexBox
        v-else-if="!busy"
        class="actions"
      >
        <SyncPairing
          :connected="connected"
          :supported="pairingSupported"
          :disabled="pairingActionDisabled"
          :server-url="serverUrl"
          :username="username"
          @paired="pairingCompleted"
        />
        <FtButton
          :label="t('Settings.Sync Settings.Log In')"
          :icon="['fas', 'right-to-bracket']"
          :disabled="authenticationActionsDisabled"
          @click="authenticate('login')"
        />
        <FtButton
          :label="t('Settings.Sync Settings.Register')"
          :icon="['fas', 'user-plus']"
          :disabled="authenticationActionsDisabled"
          @click="authenticate('register')"
        />
      </FtFlexBox>
      <FtPrompt
        v-if="dataLossWarning"
        :label="t('Settings.Sync Settings.Data Loss Confirmation')"
        theme="readable-width"
        fixed-layout
        @click="dataLossWarning = null"
      >
        <div class="deleteAccountContent">
          <p class="deleteAccountWarning">
            {{ t('Settings.Sync Settings.Data Loss Warning', {
              deleted: dataLossWarning.deleted,
              previous: dataLossWarning.previous,
              collection: dataLossWarning.collection,
            }) }}
          </p>
          <ul class="dataLossItems">
            <li
              v-for="item in dataLossWarning.items"
              :key="item.id"
            >
              <bdi>{{ item.name }}</bdi>
              <small v-if="item.name !== item.id">{{ item.id }}</small>
            </li>
          </ul>
        </div>
        <template #footer>
          <FtFlexBox class="actions">
            <FtButton
              :label="t('Settings.Sync Settings.Confirm Data Loss')"
              theme="destructive"
              :icon="['fas', 'triangle-exclamation']"
              @click="confirmDataLossSync"
            />
            <FtButton
              :label="t('Cancel')"
              :icon="['fas', 'xmark']"
              @click="dataLossWarning = null"
            />
          </FtFlexBox>
        </template>
      </FtPrompt>
      <FtPrompt
        v-if="showPasswordPrompt"
        :label="t('Settings.Sync Settings.Change Password')"
        theme="readable-width"
        @click="closePasswordPrompt"
      >
        <div class="deleteAccountContent passwordForm">
          <p>{{ t('Settings.Sync Settings.Change Password Warning') }}</p>
          <FtInput
            :placeholder="t('Settings.Sync Settings.Current Password')"
            :show-action-button="false"
            :value="currentPassword"
            :disabled="accountActionBusy"
            input-type="password"
            show-label
            @input="currentPassword = $event"
          />
          <FtInput
            :placeholder="t('Settings.Sync Settings.New Password')"
            :show-action-button="false"
            :value="newPassword"
            :disabled="accountActionBusy"
            input-type="password"
            show-label
            @input="newPassword = $event"
          />
          <FtInput
            :placeholder="t('Settings.Sync Settings.Confirm New Password')"
            :show-action-button="false"
            :value="confirmedPassword"
            :disabled="accountActionBusy"
            input-type="password"
            show-label
            @input="confirmedPassword = $event"
            @keydown.enter="changePassword"
          />
          <p
            v-if="passwordPromptError"
            class="error"
            role="alert"
          >
            {{ passwordPromptError }}
          </p>
          <FtFlexBox class="actions">
            <FtButton
              :label="t('Settings.Sync Settings.Save New Password')"
              :icon="['fas', 'floppy-disk']"
              :disabled="accountActionBusy"
              @click="changePassword"
            />
            <FtButton
              :label="t('Cancel')"
              :icon="['fas', 'xmark']"
              :disabled="accountActionBusy"
              @click="closePasswordPrompt"
            />
          </FtFlexBox>
        </div>
      </FtPrompt>
      <FtPrompt
        v-if="showDeleteAccountPrompt"
        :label="t('Settings.Sync Settings.Delete Account Confirmation')"
        theme="readable-width"
        @click="closeDeleteAccountPrompt"
      >
        <div class="deleteAccountContent">
          <p class="deleteAccountWarning">
            {{ t('Settings.Sync Settings.Delete Account Warning') }}
          </p>
          <FtInput
            :placeholder="t('Settings.Password Dialog.Password')"
            :show-action-button="false"
            :value="deleteAccountPassword"
            input-type="password"
            show-label
            @input="deleteAccountPassword = $event"
            @keydown.enter="deleteAccount"
          />
          <p
            v-if="deleteAccountError"
            class="error"
            role="alert"
          >
            {{ deleteAccountError }}
          </p>
          <FtFlexBox class="actions">
            <FtButton
              :label="t('Settings.Sync Settings.Confirm Delete Account')"
              theme="destructive"
              :icon="['fas', 'trash']"
              :disabled="accountActionBusy"
              @click="deleteAccount"
            />
            <FtButton
              :label="t('Cancel')"
              :icon="['fas', 'xmark']"
              :disabled="accountActionBusy"
              @click="closeDeleteAccountPrompt"
            />
          </FtFlexBox>
        </div>
      </FtPrompt>
    </template>
  </FtSettingsSection>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import FtButton from '../FtButton/FtButton.vue'
import FtFlexBox from '../ft-flex-box/ft-flex-box.vue'
import FtInput from '../FtInput/FtInput.vue'
import FtLoader from '../FtLoader/FtLoader.vue'
import FtPrompt from '../FtPrompt/FtPrompt.vue'
import FtSettingsSection from '../FtSettingsSection/FtSettingsSection.vue'
import FtToggleSwitch from '../FtToggleSwitch/FtToggleSwitch.vue'
import SyncPairing from './SyncPairing.vue'
import SyncAccountManagement from './SyncAccountManagement.vue'

import store from '../../store/index'
import {
  SyncServerClient,
  SyncServerDataLossError,
  isSessionExpiredError,
  normalizeSyncServerUrl,
} from '../../helpers/sync-server'
import { showToast } from '../../helpers/utils'
import { formatDateTime } from '../../helpers/dateFormat'
import {
  getCurrentSyncServerDeviceInfo,
  isValidSyncServerDeviceId,
  randomSyncServerDeviceId,
  resolveSyncServerDeviceName,
} from '../../helpers/sync-server-sessions'

const { locale, t } = useI18n()
const dateFormat = computed(() => store.getters.getDateFormat)
const timeFormat = computed(() => store.getters.getTimeFormat)
const OPENTUBEX_SYNC_SERVER_URL = 'https://sync.d3sox.me'
const OPENTUBEX_SYNC_SERVER_PRIVACY_POLICY_URL =
  'https://github.com/OpenTubeX/sync-server/blob/main/PRIVACY.md'
const syncServerInstances = [
  OPENTUBEX_SYNC_SERVER_URL,
  'https://sync.libretube.dev'
]

const serverUrl = ref(store.getters.getSyncServerUrl)
const username = ref(store.getters.getSyncServerUsername)
const password = ref('')
const privacyPassphrase = ref('')
const serverPrivacySupported = ref(null)
const serverPairingSupported = ref(false)
const serverAccountSessionsSupported = ref(false)
const serverCheckStatus = ref('idle')
const serverCheckError = ref('')
const localError = ref('')
const authenticating = ref(false)
const showDeleteAccountPrompt = ref(false)
const deleteAccountPassword = ref('')
const deleteAccountError = ref('')
const accountActionBusy = ref(false)
const passwordLogin = ref(false)
const showPasswordPrompt = ref(false)
const currentPassword = ref('')
const newPassword = ref('')
const confirmedPassword = ref('')
const passwordPromptError = ref('')
const accountManagement = useTemplateRef('accountManagement')
const dataLossWarning = ref(null)

const savedUsername = computed(() => store.getters.getSyncServerUsername)
const syncEnabled = computed(() => store.getters.getSyncServerEnabled)
const connected = computed(() => store.getters.getSyncServerToken !== '')
const syncServerToken = computed(() => store.getters.getSyncServerToken)
const currentDeviceId = computed(() => store.getters.getSyncServerDeviceId)
const currentDeviceName = computed(() => store.getters.getSyncServerDeviceName)
const privacyPolicyUrl = computed(() => {
  try {
    return normalizeSyncServerUrl(serverUrl.value) === OPENTUBEX_SYNC_SERVER_URL
      ? OPENTUBEX_SYNC_SERVER_PRIVACY_POLICY_URL
      : null
  } catch {
    return null
  }
})
const serverCredentialsDisabled = computed(() => (
  authenticating.value ||
  (!connected.value && serverCheckStatus.value !== 'valid')
))
const accountCredentialsReady = computed(() => (
  username.value.trim() !== '' && password.value !== ''
))
const pairingActionDisabled = computed(() => (
  serverCredentialsDisabled.value
))
const authenticationActionsDisabled = computed(() => (
  serverCredentialsDisabled.value ||
  !accountCredentialsReady.value ||
  (serverPrivacySupported.value === true && privacyPassphrase.value === '')
))
const status = computed(() => store.getters.getSyncServerStatus)
const busy = computed(() => status.value === 'syncing')
const syncProgress = computed(() => store.getters.getSyncServerProgress)
const syncProgressLabel = computed(() => {
  if (!syncProgress.value) return ''
  const labels = {
    download: t('Settings.Sync Settings.Downloading encrypted data'),
    subscriptions: t('Settings.Sync Settings.Syncing subscriptions'),
    playlists: t('Settings.Sync Settings.Syncing playlists'),
    playlistBookmarks: t('Settings.Sync Settings.Syncing playlists'),
    history: t('Settings.Sync Settings.Syncing history'),
    profiles: t('Settings.Sync Settings.Syncing profiles'),
    sessions: t('Settings.Sync Settings.Syncing open tabs'),
    sessionsV2: t('Settings.Sync Settings.Syncing open tabs'),
    settings: t('Settings.Sync Settings.Syncing settings'),
    upload: t('Settings.Sync Settings.Uploading encrypted data'),
    finishing: t('Settings.Sync Settings.Finishing sync'),
  }
  return labels[syncProgress.value.stage]
})
const errorMessage = computed(() => (
  localError.value || serverCheckError.value || store.getters.getSyncServerError
))
const autoSync = computed(() => store.getters.getSyncServerAutoSync)
const syncSubscriptionsEnabled = computed(() => store.getters.getSyncServerSyncSubscriptions)
const syncPlaylistsEnabled = computed(() => store.getters.getSyncServerSyncPlaylists)
const syncHistoryEnabled = computed(() => store.getters.getSyncServerSyncHistory)
const syncProfilesEnabled = computed(() => store.getters.getSyncServerSyncProfiles)
const syncSessionsEnabled = computed(() => store.getters.getSyncServerSyncSessions)
const sharedTabsEnabled = computed(() => store.getters.getSyncServerSharedTabs)
const syncSettingsEnabled = computed(() => store.getters.getSyncServerSyncSettings)
const historySupported = computed(() => store.getters.getSyncServerHistorySupported)
const privacyMode = computed(() => store.getters.getSyncServerPrivacyMode)
const privacyKey = computed(() => store.getters.getSyncServerPrivacyKey)
const privacySalt = computed(() => store.getters.getSyncServerPrivacySalt)
const pairingSupported = computed(() => {
  try {
    return serverPairingSupported.value && normalizeSyncServerUrl(serverUrl.value).startsWith('https://')
  } catch {
    return false
  }
})
const accountSessionsSupported = computed(() => (
  serverAccountSessionsSupported.value &&
  privacyMode.value === 'enhanced' &&
  privacyKey.value !== ''
))
const settingsSupported = computed(() => privacyMode.value === 'enhanced')
const sessionsSupported = computed(() => (
  (process.env.IS_ELECTRON || process.env.IS_CAPACITOR) && privacyMode.value === 'enhanced'
))
const lastSyncLabel = computed(() => {
  const timestamp = store.getters.getSyncServerLastSyncAt
  if (!timestamp) return ''
  return formatDateTime(
    timestamp,
    locale.value,
    dateFormat.value,
    { dateStyle: 'medium' },
    { timeStyle: 'medium' },
    timeFormat.value
  )
})

let serverCheckTimer = null
let serverCheckSequence = 0
let serverCheckClient = null

watch([serverUrl, connected, syncEnabled], ([value, isConnected, isEnabled], [previousValue, wasConnected] = []) => {
  clearTimeout(serverCheckTimer)
  serverCheckClient?.cancel()
  serverCheckClient = null
  const sequence = ++serverCheckSequence
  const disconnected = wasConnected && !isConnected && value === previousValue
  serverPrivacySupported.value = null
  serverPairingSupported.value = false
  serverAccountSessionsSupported.value = false
  serverCheckStatus.value = disconnected ? 'valid' : 'idle'
  serverCheckError.value = ''
  if (!isEnabled || !value.trim()) return
  ensureDeviceIdentity().catch(() => {})

  serverCheckTimer = setTimeout(async () => {
    if (!disconnected && !isConnected) serverCheckStatus.value = 'checking'
    const client = new SyncServerClient(
      value,
      isConnected ? store.getters.getSyncServerToken : ''
    )
    serverCheckClient = client
    try {
      const capabilities = await client.getCapabilities()
      if (sequence !== serverCheckSequence) return
      serverPrivacySupported.value = capabilities.encrypted_sync === 1
      serverPairingSupported.value = capabilities.key_pairing === 1
      serverAccountSessionsSupported.value = capabilities.encrypted_sync === 1 &&
        capabilities.account_sessions === 1
      serverCheckStatus.value = 'valid'
    } catch {
      if (sequence !== serverCheckSequence) return
      if (isConnected) return
      serverCheckStatus.value = 'error'
      serverCheckError.value = t('Settings.Sync Settings.Server Unavailable')
    } finally {
      if (serverCheckClient === client) serverCheckClient = null
    }
  }, 400)
}, { immediate: true })

onBeforeUnmount(() => {
  clearTimeout(serverCheckTimer)
  serverCheckClient?.cancel()
})

async function saveServerUrl() {
  if (connected.value || !serverUrl.value.trim()) return

  try {
    const normalizedUrl = normalizeSyncServerUrl(serverUrl.value)
    serverUrl.value = normalizedUrl
    await store.dispatch('updateSyncServerUrl', normalizedUrl)
  } catch {
    serverCheckStatus.value = 'error'
    serverCheckError.value = t('Settings.Sync Settings.Server Unavailable')
  }
}

async function authenticate(mode) {
  if (busy.value || authenticationActionsDisabled.value) return
  localError.value = ''
  authenticating.value = true
  try {
    const identity = await ensureDeviceIdentity()
    await store.dispatch('authenticateSyncServer', {
      mode,
      serverUrl: serverUrl.value,
      username: username.value,
      password: password.value,
      privacyPassphrase: privacyPassphrase.value,
      deviceId: identity.id,
      deviceName: identity.name,
      deviceSystemInfo: identity.systemInfo,
    })
    serverUrl.value = store.getters.getSyncServerUrl
    username.value = store.getters.getSyncServerUsername
    password.value = ''
    privacyPassphrase.value = ''
    showToast({ message: t('Settings.Sync Settings.Sync completed'), icon: ['fas', 'sync'] })
  } catch (error) {
    localError.value = error.message
  } finally {
    authenticating.value = false
  }
}

async function ensureDeviceIdentity() {
  let id = store.getters.getSyncServerDeviceId
  if (!isValidSyncServerDeviceId(id)) {
    id = randomSyncServerDeviceId()
    await store.dispatch('updateSyncServerDeviceId', id)
  }

  const { name: systemName, ...systemInfo } = await getCurrentSyncServerDeviceInfo()
  const fallbackName = t('Settings.Sync Settings.This Device')
  const name = resolveSyncServerDeviceName(
    store.getters.getSyncServerDeviceName,
    systemName,
    fallbackName
  )
  if (name !== store.getters.getSyncServerDeviceName) {
    await store.dispatch('updateSyncServerDeviceName', name)
  }
  return { id, name, systemInfo }
}

async function syncNow() {
  if (busy.value) return
  localError.value = ''
  try {
    const result = await store.dispatch('syncWithSyncServer', { notifyDataLoss: false })
    if (result !== null) {
      showToast({ message: t('Settings.Sync Settings.Sync completed'), icon: ['fas', 'sync'] })
    }
  } catch (error) {
    if (error instanceof SyncServerDataLossError) {
      dataLossWarning.value = error
      return
    }
    localError.value = error.message
  }
}

function pairingCompleted(result) {
  serverUrl.value = store.getters.getSyncServerUrl
  username.value = store.getters.getSyncServerUsername
  password.value = ''
  privacyPassphrase.value = ''
  const message = result === 'approved'
    ? t('Settings.Sync Settings.Pairing Approved')
    : t('Settings.Sync Settings.Pairing Completed')
  showToast({
    message,
    icon: ['fas', 'key'],
  })
}

async function confirmDataLossSync() {
  if (busy.value) return
  dataLossWarning.value = null
  localError.value = ''
  try {
    const result = await store.dispatch('syncWithSyncServer', { allowDataLoss: true })
    if (result !== null) {
      showToast({ message: t('Settings.Sync Settings.Sync completed'), icon: ['fas', 'sync'] })
    }
  } catch (error) {
    localError.value = error.message
  }
}

async function disconnect() {
  if (busy.value || accountActionBusy.value) return
  localError.value = ''
  await store.dispatch('disconnectSyncServer')
}

function setAutoSync(enabled) {
  store.dispatch('setSyncServerAutoSync', enabled)
}

async function setSharedTabs(enabled) {
  await store.dispatch('updateSyncServerSharedTabs', enabled)
  store.dispatch('scheduleSyncServer', 'sessions')
}

function setSyncEnabled(enabled) {
  localError.value = ''
  store.dispatch('setSyncServerEnabled', enabled)
}

function closeDeleteAccountPrompt() {
  if (busy.value || accountActionBusy.value) return
  showDeleteAccountPrompt.value = false
  deleteAccountPassword.value = ''
  deleteAccountError.value = ''
}

async function deleteAccount() {
  if (busy.value || accountActionBusy.value) return
  deleteAccountError.value = ''
  if (!deleteAccountPassword.value) {
    deleteAccountError.value = t('Settings.Sync Settings.Password Required')
    return
  }

  accountActionBusy.value = true
  let deleted = false
  try {
    await store.dispatch('deleteSyncServerAccount', deleteAccountPassword.value)
    deleted = true
  } catch (error) {
    deleteAccountError.value = error.message
  } finally {
    accountActionBusy.value = false
  }
  if (deleted) {
    closeDeleteAccountPrompt()
    showToast({ message: t('Settings.Sync Settings.Account Deleted'), icon: ['fas', 'trash'] })
  }
}

function openPasswordPrompt() {
  passwordPromptError.value = ''
  showPasswordPrompt.value = true
}

function closePasswordPrompt() {
  if (accountActionBusy.value) return
  resetPasswordPrompt()
}

function resetPasswordPrompt() {
  showPasswordPrompt.value = false
  passwordPromptError.value = ''
  currentPassword.value = ''
  newPassword.value = ''
  confirmedPassword.value = ''
}

async function changePassword() {
  if (busy.value || accountActionBusy.value) return
  passwordPromptError.value = ''
  if (!currentPassword.value || !newPassword.value || !confirmedPassword.value) {
    passwordPromptError.value = t('Settings.Sync Settings.All Password Fields Required')
    return
  }
  if (newPassword.value.length < 8) {
    passwordPromptError.value = t('Settings.Sync Settings.New Password Too Short')
    return
  }
  if (newPassword.value !== confirmedPassword.value) {
    passwordPromptError.value = t('Settings.Sync Settings.New Passwords Do Not Match')
    return
  }

  accountActionBusy.value = true
  const client = new SyncServerClient(serverUrl.value, syncServerToken.value)
  try {
    const response = await client.changePassword(currentPassword.value, newPassword.value)
    if (!response || typeof response.jwt !== 'string' || !response.jwt) throw new Error()
    await store.dispatch('replaceSyncServerToken', response.jwt)
    resetPasswordPrompt()
    showToast({
      message: t('Settings.Sync Settings.Password Changed'),
      icon: ['fas', 'key'],
    })
    await accountManagement.value?.loadSessions(response.jwt)
  } catch (error) {
    if (isSessionExpiredError(error)) {
      await store.dispatch('expireSyncServerSession')
      return
    }
    passwordPromptError.value = error?.message || t('Settings.Sync Settings.Account Management Failed')
  } finally {
    client.cancel()
    accountActionBusy.value = false
  }
}
</script>

<style scoped src="./SyncSettings.css" />
