<template>
  <FtButton
    v-if="connected && supported"
    :label="t('Settings.Sync Settings.Pair Another Device')"
    :icon="['fas', 'key']"
    :disabled="disabled"
    @click="openScanner"
  />
  <FtButton
    v-else-if="!connected && supported"
    :label="t('Settings.Sync Settings.Pair With Existing Device')"
    :icon="['fas', 'key']"
    :disabled="disabled"
    @click="openReceiver"
  />

  <FtPrompt
    v-if="receivePromptOpen"
    :label="t('Settings.Sync Settings.Pair With Existing Device')"
    :inert="receiveStage === 'finishing'"
    theme="readable-width"
    fixed-layout
    @click="closeReceiver"
  >
    <div
      class="pairingContent"
      :class="{ pairingWaiting: receiveStage === 'waiting' }"
    >
      <template v-if="receiveStage === 'name'">
        <p>{{ t('Settings.Sync Settings.Pairing Device Name Hint') }}</p>
        <FtInput
          :placeholder="t('Settings.Sync Settings.Device Name')"
          :show-action-button="false"
          :value="deviceName"
          show-label
          @input="deviceName = $event"
          @keydown.enter="startReceiving"
        />
        <FtFlexBox class="pairingActions">
          <FtButton
            :label="t('Settings.Sync Settings.Create Pairing Code')"
            :icon="['fas', 'key']"
            :disabled="deviceName.trim() === ''"
            @click="startReceiving"
          />
        </FtFlexBox>
      </template>
      <template v-else-if="receiveStage === 'creating'">
        <FtLoader />
        <p aria-live="polite">
          {{ t('Settings.Sync Settings.Creating Pairing Code') }}
        </p>
      </template>
      <template v-else-if="receiveStage === 'waiting'">
        <template v-if="showTextCode">
          <label class="pairingCodeField">
            <span>{{ t('Settings.Sync Settings.Pairing Code') }}</span>
            <input
              :value="pairingCode"
              readonly
              spellcheck="false"
              @focus="$event.target.select()"
              @click="$event.target.select()"
            >
          </label>
          <p>{{ t('Settings.Sync Settings.Text Pairing Code Hint') }}</p>
        </template>
        <template v-else>
          <img
            class="pairingQr"
            :src="qrImage"
            :alt="t('Settings.Sync Settings.Pairing QR Alt', { device: deviceName })"
          >
          <p>{{ t('Settings.Sync Settings.Scan Pairing Code') }}</p>
        </template>
        <FtFlexBox class="pairingActions pairingModeActions">
          <FtButton
            :label="showTextCode
              ? t('Settings.Sync Settings.Show QR Code')
              : t('Settings.Sync Settings.Use Text Pairing Code')"
            :icon="showTextCode ? ['fas', 'qrcode'] : ['fas', 'keyboard']"
            @click="showTextCode = !showTextCode"
          />
        </FtFlexBox>
        <p class="pairingWarning">
          {{ t('Settings.Sync Settings.Pairing QR Warning') }}
        </p>
        <div
          class="pairingPollStatus pairingSecondary"
          aria-live="polite"
        >
          <FtLoader />
          <span>{{ t('Settings.Sync Settings.Pairing Expires', { time: receiveExpiryLabel }) }}</span>
        </div>
      </template>
      <template v-else-if="receiveStage === 'confirm'">
        <p class="pairingWarning">
          {{ t('Settings.Sync Settings.Compare Pairing Codes') }}
        </p>
        <p class="pairingVerificationCode">
          {{ receiveVerificationCode }}
        </p>
        <p>{{ t('Settings.Sync Settings.Pairing Code Match Hint') }}</p>
        <FtFlexBox class="pairingActions">
          <FtButton
            :label="t('Settings.Sync Settings.Pairing Codes Match')"
            :icon="['fas', 'check']"
            @click="confirmReceiver"
          />
        </FtFlexBox>
      </template>
      <template v-else-if="receiveStage === 'finishing'">
        <FtLoader />
        <p aria-live="polite">
          {{ receiveVerificationCode
            ? t('Settings.Sync Settings.Completing Pairing')
            : t('Settings.Sync Settings.Verifying Pairing') }}
        </p>
      </template>
      <template v-else>
        <p
          class="pairingError"
          role="alert"
        >
          {{ receiveError }}
        </p>
        <FtFlexBox class="pairingActions">
          <FtButton
            :label="t('Settings.Sync Settings.Try Again')"
            :icon="['fas', 'sync']"
            @click="resetReceiver"
          />
        </FtFlexBox>
      </template>
    </div>
    <template #footer>
      <FtFlexBox class="pairingFooter">
        <FtButton
          :label="t('Cancel')"
          :icon="['fas', 'xmark']"
          @click="closeReceiver"
        />
      </FtFlexBox>
    </template>
  </FtPrompt>

  <FtPrompt
    v-if="approvePromptOpen"
    :label="t('Settings.Sync Settings.Pair Another Device')"
    theme="readable-width"
    fixed-layout
    @click="closeScanner"
  >
    <div class="pairingContent">
      <template v-if="approveStage === 'scanning'">
        <p>{{ t('Settings.Sync Settings.Pairing Scan Hint') }}</p>
        <FtLoader v-if="usingNativeScanner" />
        <div
          v-else
          class="scannerFrame"
        >
          <video
            ref="scannerVideo"
            class="scannerVideo"
            autoplay
            muted
            playsinline
          />
        </div>
        <p
          class="pairingSecondary"
          aria-live="polite"
        >
          {{ t('Settings.Sync Settings.Waiting For Pairing Code') }}
        </p>
        <FtFlexBox class="pairingActions">
          <FtButton
            :label="t('Settings.Sync Settings.Enter Pairing Code')"
            :icon="['fas', 'keyboard']"
            @click="openManualEntry"
          />
        </FtFlexBox>
      </template>
      <template v-else-if="approveStage === 'manual'">
        <p>{{ t('Settings.Sync Settings.Pairing Code Entry Hint') }}</p>
        <label class="pairingCodeField">
          <span>{{ t('Settings.Sync Settings.Pairing Code') }}</span>
          <textarea
            ref="manualPairingCodeInput"
            v-model="manualPairingCode"
            maxlength="2048"
            rows="8"
            spellcheck="false"
          />
        </label>
        <p
          v-if="approveError"
          class="pairingError"
          role="alert"
        >
          {{ approveError }}
        </p>
        <FtFlexBox class="pairingActions">
          <FtButton
            :label="t('Settings.Sync Settings.Check Pairing Code')"
            :icon="['fas', 'check']"
            :disabled="manualPairingCode.trim() === ''"
            @click="submitManualCode"
          />
          <FtButton
            :label="t('Settings.Sync Settings.Scan QR Code')"
            :icon="['fas', 'qrcode']"
            @click="restartScanner"
          />
        </FtFlexBox>
      </template>
      <template v-else-if="approveStage === 'checking' || approveStage === 'approving'">
        <FtLoader />
        <p aria-live="polite">
          {{ approveStage === 'checking'
            ? t('Settings.Sync Settings.Checking Pairing Request')
            : t('Settings.Sync Settings.Approving Pairing Request') }}
        </p>
      </template>
      <template v-else-if="approveStage === 'confirm'">
        <p class="pairingWarning">
          {{ t('Settings.Sync Settings.Pairing Approval Warning') }}
        </p>
        <dl class="pairingDetails">
          <div>
            <dt>{{ t('Settings.Sync Settings.Server URL') }}</dt>
            <dd>{{ pairingRequest.origin }}</dd>
          </div>
          <div>
            <dt>{{ t('Settings.Sync Settings.Username') }}</dt>
            <dd>{{ username }}</dd>
          </div>
          <div>
            <dt>{{ t('Settings.Sync Settings.Device Name') }}</dt>
            <dd>{{ pairingRequest.recipientDeviceName }}</dd>
          </div>
        </dl>
        <FtFlexBox class="pairingActions">
          <FtButton
            :label="t('Settings.Sync Settings.Approve Pairing')"
            :icon="['fas', 'key']"
            @click="approvePairing"
          />
        </FtFlexBox>
      </template>
      <template v-else-if="approveStage === 'approved'">
        <p class="pairingWarning">
          {{ t('Settings.Sync Settings.Compare Pairing Codes') }}
        </p>
        <p class="pairingVerificationCode">
          {{ approvalVerificationCode }}
        </p>
        <p>{{ t('Settings.Sync Settings.Pairing Approval Code Hint') }}</p>
      </template>
      <template v-else>
        <p
          class="pairingError"
          role="alert"
        >
          {{ approveError }}
        </p>
        <FtFlexBox class="pairingActions">
          <FtButton
            :label="pairingApproval
              ? t('Settings.Sync Settings.Try Again')
              : t('Settings.Sync Settings.Scan Again')"
            :icon="['fas', 'sync']"
            @click="pairingApproval ? approvePairing() : restartScanner()"
          />
          <FtButton
            v-if="!pairingApproval"
            :label="t('Settings.Sync Settings.Enter Pairing Code')"
            :icon="['fas', 'keyboard']"
            @click="openManualEntry"
          />
        </FtFlexBox>
      </template>
    </div>
    <template #footer>
      <FtFlexBox class="pairingFooter">
        <FtButton
          :label="approveStage === 'approved' ? t('Close') : t('Cancel')"
          :icon="['fas', 'xmark']"
          @click="closeScanner"
        />
      </FtFlexBox>
    </template>
  </FtPrompt>
</template>

<script setup>
import QRCode from 'qrcode'
import QrScanner from 'qr-scanner'
import { computed, nextTick, onBeforeUnmount, ref, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

import FtButton from '../FtButton/FtButton.vue'
import FtFlexBox from '../ft-flex-box/ft-flex-box.vue'
import FtInput from '../FtInput/FtInput.vue'
import FtLoader from '../FtLoader/FtLoader.vue'
import FtPrompt from '../FtPrompt/FtPrompt.vue'

import {
  bindPairingRequestToAccount,
  createPairingQrPayload,
  createPairingRecipient,
  decryptPairingKey,
  encryptPairingKey,
  pairingSessionMatchesRequest,
  parsePairingQrPayload,
  randomPairingVerificationCode,
} from '../../helpers/sync-server-pairing'
import {
  PRIVACY_VERSION,
  decryptLegacySyncDocument,
  decryptSyncDocument,
} from '../../helpers/sync-server-privacy'
import { SyncServerClient, normalizeSyncServerUrl } from '../../helpers/sync-server'
import {
  encryptSyncServerDeviceInfo,
  getCurrentSyncServerDeviceInfo,
} from '../../helpers/sync-server-sessions'
import { formatTime } from '../../helpers/dateFormat'
import store from '../../store/index'

const props = defineProps({
  connected: Boolean,
  supported: Boolean,
  disabled: Boolean,
  serverUrl: {
    type: String,
    required: true,
  },
  username: {
    type: String,
    required: true,
  },
  privacyKey: {
    type: String,
    default: '',
  },
  privacySalt: {
    type: String,
    default: '',
  },
  deviceId: {
    type: String,
    default: '',
  },
})

const emit = defineEmits(['paired'])
const { locale, t } = useI18n()
const usingNativeScanner = Boolean(process.env.IS_CAPACITOR)
const timeFormat = computed(() => store.getters.getTimeFormat)

const receivePromptOpen = ref(false)
const receiveStage = ref('name')
const receiveError = ref('')
const fallbackDeviceName = t('Settings.Sync Settings.This Device')
const deviceName = ref(fallbackDeviceName)
const qrImage = ref('')
const pairingCode = ref('')
const showTextCode = ref(false)
const receiveExpiresAt = ref(0)
const receiveVerificationCode = ref('')
const approvePromptOpen = ref(false)
const approveStage = ref('scanning')
const approveError = ref('')
const manualPairingCode = ref('')
const pairingRequest = ref(null)
const approvalVerificationCode = ref('')
const scannerVideo = useTemplateRef('scannerVideo')
const manualPairingCodeInput = useTemplateRef('manualPairingCodeInput')

const receiveExpiryLabel = computed(() => formatTime(
  receiveExpiresAt.value,
  locale.value,
  timeFormat.value,
  { timeStyle: 'medium' }
))

let receiver = null
let pollTimer = null
let scanner = null
let scannerHandled = false
let receiveSequence = 0
let approveSequence = 0
let pairingClient = null
const pairingApproval = ref(null)

const currentDeviceInfoPromise = getCurrentSyncServerDeviceInfo().catch(() => ({ name: '' }))
currentDeviceInfoPromise.then(({ name }) => {
  const trimmedName = name?.trim()
  if (trimmedName && deviceName.value === fallbackDeviceName) {
    deviceName.value = trimmedName
  }
})

function openReceiver() {
  resetReceiver()
  receivePromptOpen.value = true
}

function resetReceiver() {
  receiveStage.value = 'name'
  receiveError.value = ''
  qrImage.value = ''
  pairingCode.value = ''
  showTextCode.value = false
  receiveExpiresAt.value = 0
  receiveVerificationCode.value = ''
}

async function startReceiving() {
  const sequence = ++receiveSequence
  receiveStage.value = 'creating'
  receiveError.value = ''

  const { name } = await currentDeviceInfoPromise
  if (sequence !== receiveSequence || !receivePromptOpen.value) return
  const trimmedSystemName = name?.trim()
  if (trimmedSystemName && deviceName.value === fallbackDeviceName) {
    deviceName.value = trimmedSystemName
  }
  const requestedName = deviceName.value.trim()
  if (!requestedName) {
    receiveError.value = t('Settings.Sync Settings.Device Name Required')
    receiveStage.value = 'error'
    return
  }
  deviceName.value = requestedName

  const client = new SyncServerClient(props.serverUrl)
  try {
    const capabilities = await client.getCapabilities()
    if (capabilities.key_pairing !== 1 || capabilities.encrypted_sync !== 1) {
      throw new Error(t('Settings.Sync Settings.Pairing Unsupported'))
    }
    const recipient = await createPairingRecipient(requestedName)
    const session = await client.createPairingSession(recipient)
    if (sequence !== receiveSequence || !receivePromptOpen.value) {
      try {
        await client.cancelPairingSession(recipient.sessionId, recipient.recipientToken)
      } catch {}
      client.cancel()
      return
    }
    const code = createPairingQrPayload(
      recipient,
      normalizeSyncServerUrl(props.serverUrl)
    )
    const request = parsePairingQrPayload(code)
    if (!pairingSessionMatchesRequest(session, request)) throw new Error()

    receiver = { client, recipient, request, consumed: false, transfer: null }
    receiveExpiresAt.value = session.expires_at
    const image = await QRCode.toDataURL(code, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 320,
    })
    if (sequence !== receiveSequence || receiver?.client !== client || !receivePromptOpen.value) {
      return
    }
    qrImage.value = image
    pairingCode.value = code
    receiveStage.value = 'waiting'
    schedulePoll()
  } catch (error) {
    client.cancel()
    receiver = null
    if (sequence !== receiveSequence || !receivePromptOpen.value) return
    receiveError.value = error?.message || t('Settings.Sync Settings.Pairing Failed')
    receiveStage.value = 'error'
  }
}

function schedulePoll() {
  clearTimeout(pollTimer)
  pollTimer = setTimeout(pollReceiver, 2000)
}

async function pollReceiver() {
  const active = receiver
  if (!active || receiveStage.value !== 'waiting') return
  try {
    const session = await active.client.getPairingSession(
      active.request.sessionId,
      active.recipient.recipientToken
    )
    if (receiver !== active || !receivePromptOpen.value) return
    const boundRequest = session.account_id === null
      ? active.request
      : bindPairingRequestToAccount(active.request, session.account_id)
    if (!pairingSessionMatchesRequest(session, boundRequest, session.approved === true)) {
      throw new Error(t('Settings.Sync Settings.Pairing Request Changed'))
    }
    if (!session.approved) {
      schedulePoll()
      return
    }

    receiveStage.value = 'finishing'
    const transfer = await active.client.consumePairingSession(
      active.request.sessionId,
      active.recipient.recipientToken
    )
    if (receiver !== active || !receivePromptOpen.value) return
    active.consumed = true
    const privacy = await decryptPairingKey(
      boundRequest,
      transfer.approving_device_id,
      active.recipient.recipientKey,
      transfer.encrypted_payload
    )
    if (receiver !== active || !receivePromptOpen.value) return
    const verificationClient = new SyncServerClient(boundRequest.origin, privacy.token)
    try {
      await verifyPrivacyKey(verificationClient, privacy.key)
    } finally {
      verificationClient.cancel()
    }
    if (receiver !== active || !receivePromptOpen.value) return
    active.request = boundRequest
    active.transfer = privacy
    receiveVerificationCode.value = privacy.verificationCode
    receiveStage.value = 'confirm'
  } catch (error) {
    receiveError.value = error?.message || t('Settings.Sync Settings.Pairing Failed')
    receiveStage.value = 'error'
    releaseReceiver()
  }
}

async function confirmReceiver() {
  const active = receiver
  if (!active?.transfer || receiveStage.value !== 'confirm') return
  receiveStage.value = 'finishing'
  const privacy = active.transfer
  try {
    const { name, ...deviceSystemInfo } = await getCurrentSyncServerDeviceInfo()
    await store.dispatch('completeSyncServerPairing', {
      serverUrl: active.request.origin,
      username: privacy.username,
      token: privacy.token,
      privacyKey: privacy.key,
      privacySalt: privacy.salt,
      deviceId: active.recipient.recipientDeviceId,
      deviceName: active.recipient.recipientDeviceName,
      deviceSystemInfo,
    })
    await finishReceiver()
    emit('paired', 'completed')
    store.dispatch('syncWithSyncServer').catch(() => {
      // The store exposes normal sync failures in the settings UI. Pairing has
      // already succeeded because the transferred key was verified and saved.
    })
  } catch (error) {
    receiveError.value = error?.message || t('Settings.Sync Settings.Pairing Failed')
    receiveStage.value = 'error'
    releaseReceiver()
  }
}

async function verifyPrivacyKey(client, privacyKey) {
  const manifest = await client.getEncryptedSyncManifest()
  const firstCollection = manifest.collections[0]?.collection
  if (firstCollection) {
    const collection = await client.getEncryptedSyncCollection(firstCollection)
    if (!collection.payload) throw new Error(t('Settings.Sync Settings.Pairing Verification Unavailable'))
    await decryptSyncDocument(collection.payload, privacyKey)
    return
  }
  if (manifest.legacy_encrypted_data) {
    const legacy = await client.getLegacyEncryptedSync()
    if (legacy.payload) {
      await decryptLegacySyncDocument(legacy.payload, privacyKey)
      return
    }
  }
  throw new Error(t('Settings.Sync Settings.Pairing Verification Unavailable'))
}

function releaseReceiver() {
  clearTimeout(pollTimer)
  pollTimer = null
  receiver?.client.cancel()
  receiver = null
  qrImage.value = ''
  pairingCode.value = ''
  showTextCode.value = false
}

async function finishReceiver() {
  releaseReceiver()
  receivePromptOpen.value = false
  resetReceiver()
}

async function closeReceiver() {
  receiveSequence++
  receivePromptOpen.value = false
  clearTimeout(pollTimer)
  pollTimer = null
  const active = receiver
  receiver = null
  qrImage.value = ''
  pairingCode.value = ''
  showTextCode.value = false
  if (active && !active.consumed) {
    try {
      await active.client.cancelPairingSession(
        active.request.sessionId,
        active.recipient.recipientToken
      )
    } catch {
      // Expiry and concurrent cancellation both leave the session unusable.
    }
  }
  active?.client.cancel()
  resetReceiver()
}

async function openScanner() {
  approveSequence++
  approvePromptOpen.value = true
  approveStage.value = 'scanning'
  approveError.value = ''
  manualPairingCode.value = ''
  pairingRequest.value = null
  pairingApproval.value = null
  approvalVerificationCode.value = ''
  await nextTick()
  startScanner()
}

async function startScanner() {
  const sequence = approveSequence
  stopScanner()
  scannerHandled = false
  try {
    if (usingNativeScanner) {
      const { scanNativePairingCode } = await import('../../helpers/nativePairingScanner')
      if (sequence !== approveSequence || !approvePromptOpen.value) return
      const code = await scanNativePairingCode({
        instructions: t('Settings.Sync Settings.Pairing Scan Hint'),
        cancelLabel: t('Cancel'),
        torchOnLabel: t('Settings.Sync Settings.Turn Flashlight Off'),
        torchOffLabel: t('Settings.Sync Settings.Turn Flashlight On'),
      })
      if (sequence !== approveSequence || !approvePromptOpen.value) return
      if (code === null) {
        await openManualEntry()
      } else {
        await handleScan({ data: code })
      }
      return
    }
    scanner = new QrScanner(scannerVideo.value, handleScan, {
      highlightScanRegion: true,
      highlightCodeOutline: true,
      maxScansPerSecond: 10,
      preferredCamera: 'environment',
      returnDetailedScanResult: true,
    })
    await scanner.start()
  } catch {
    if (sequence !== approveSequence || !approvePromptOpen.value) return
    stopScanner()
    if (usingNativeScanner) await openManualEntry()
    approveError.value = t('Settings.Sync Settings.Camera Unavailable')
    if (!usingNativeScanner) approveStage.value = 'error'
  }
}

async function openManualEntry() {
  approveSequence++
  pairingClient?.cancel()
  pairingClient = null
  stopScanner()
  scannerHandled = false
  approveStage.value = 'manual'
  approveError.value = ''
  pairingRequest.value = null
  pairingApproval.value = null
  await nextTick()
  manualPairingCodeInput.value?.focus()
}

function submitManualCode() {
  const code = manualPairingCode.value.trim()
  if (!code) return
  scannerHandled = false
  handleScan({ data: code })
}

async function handleScan(result) {
  if (scannerHandled) return
  scannerHandled = true
  stopScanner()
  approveStage.value = 'checking'
  const sequence = approveSequence
  try {
    const request = parsePairingQrPayload(result.data)
    manualPairingCode.value = ''
    if (request.origin !== normalizeSyncServerUrl(props.serverUrl)) {
      throw new Error(t('Settings.Sync Settings.Pairing Server Mismatch'))
    }
    if (sequence !== approveSequence || !approvePromptOpen.value) return
    pairingRequest.value = request
    approveStage.value = 'confirm'
  } catch (error) {
    pairingClient = null
    if (sequence !== approveSequence || !approvePromptOpen.value) return
    approveError.value = error?.message || t('Settings.Sync Settings.Pairing Failed')
    approveStage.value = 'error'
  }
}

async function approvePairing() {
  const sequence = approveSequence
  approveStage.value = 'approving'
  approveError.value = ''
  try {
    const client = new SyncServerClient(props.serverUrl, store.getters.getSyncServerToken)
    pairingClient = client
    if (!pairingApproval.value) {
      const encryptedDeviceInfo = await encryptSyncServerDeviceInfo(
        {
          name: pairingRequest.value.recipientDeviceName,
          platform: '',
          architecture: '',
          release: '',
        },
        props.privacyKey,
        pairingRequest.value.recipientDeviceId
      )
      const claim = await client.claimPairingSession(pairingRequest.value, encryptedDeviceInfo)
      if (sequence !== approveSequence || !approvePromptOpen.value) return
      const request = bindPairingRequestToAccount(
        pairingRequest.value,
        claim.session.account_id
      )
      if (!pairingSessionMatchesRequest(claim.session, request)) {
        throw new Error(t('Settings.Sync Settings.Pairing Request Changed'))
      }
      pairingApproval.value = {
        request,
        approvingDeviceId: props.deviceId,
        verificationCode: randomPairingVerificationCode(),
        token: claim.jwt,
        encryptedPayload: '',
      }
    }
    const approval = pairingApproval.value
    if (!approval.encryptedPayload) {
      approval.encryptedPayload = await encryptPairingKey(
        approval.request,
        approval.approvingDeviceId,
        {
          username: props.username.trim(),
          token: approval.token,
          key: props.privacyKey,
          salt: props.privacySalt,
          version: PRIVACY_VERSION,
          verificationCode: approval.verificationCode,
        }
      )
    }
    if (sequence !== approveSequence || !approvePromptOpen.value) return
    await client.approvePairingSession(
      approval.request.sessionId,
      approval.approvingDeviceId,
      approval.encryptedPayload
    )
    if (pairingClient === client) pairingClient = null
    if (sequence !== approveSequence || !approvePromptOpen.value) return
    approvalVerificationCode.value = approval.verificationCode
    approveStage.value = 'approved'
    emit('paired', 'approved')
  } catch (error) {
    pairingClient = null
    if (sequence !== approveSequence || !approvePromptOpen.value) return
    approveError.value = error?.message || t('Settings.Sync Settings.Pairing Failed')
    approveStage.value = 'error'
  }
}

async function restartScanner() {
  approveSequence++
  pairingClient?.cancel()
  pairingClient = null
  stopScanner()
  approveStage.value = 'scanning'
  approveError.value = ''
  manualPairingCode.value = ''
  pairingRequest.value = null
  pairingApproval.value = null
  approvalVerificationCode.value = ''
  await nextTick()
  startScanner()
}

function stopScanner() {
  scanner?.destroy()
  scanner = null
}

function closeScanner() {
  approveSequence++
  pairingClient?.cancel()
  pairingClient = null
  stopScanner()
  approvePromptOpen.value = false
  approveStage.value = 'scanning'
  approveError.value = ''
  manualPairingCode.value = ''
  pairingRequest.value = null
  pairingApproval.value = null
  approvalVerificationCode.value = ''
}

onBeforeUnmount(() => {
  receiveSequence++
  approveSequence++
  stopScanner()
  pairingClient?.cancel()
  pairingClient = null
  clearTimeout(pollTimer)
  receiver?.client.cancel()
  receiver = null
})
</script>

<style scoped src="./SyncPairing.css" />
