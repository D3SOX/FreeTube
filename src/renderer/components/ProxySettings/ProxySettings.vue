<template>
  <FtSettingsSection
    :title="$t('Settings.Proxy Settings.Proxy Settings')"
  >
    <FtFlexBox class="settingsFlexStart500px">
      <p
        v-if="useProxy"
        class="proxy-warning"
      >
        <FtIcon
          :icon="['fas', 'circle-exclamation']"
          class="warning-icon"
        />
        {{ $t('Settings.Proxy Settings.Proxy Warning') }}
      </p>
      <FtToggleSwitch
        :label="$t('Settings.Proxy Settings.Enable Tor / Proxy')"
        :default-value="useProxy"
        @change="handleUpdateProxy"
      />
    </FtFlexBox>
    <template
      v-if="useProxy"
    >
      <FtFlexBox>
        <FtSelect
          :placeholder="$t('Settings.Proxy Settings.Proxy Protocol')"
          :value="proxyProtocol"
          :select-names="PROTOCOL_NAMES"
          :select-values="PROTOCOL_VALUES"
          class="protocol-dropdown"
          :icon="['fas', 'network-wired']"
          @change="handleUpdateProxyProtocol"
        />
      </FtFlexBox>
      <FtFlexBox>
        <FtInput
          :placeholder="$t('Settings.Proxy Settings.Proxy Host')"
          :show-action-button="false"
          show-label
          :value="proxyHostname"
          @input="handleUpdateProxyHostname"
          @keydown.enter="testProxy"
        />
        <FtInput
          :placeholder="$t('Settings.Proxy Settings.Proxy Port Number')"
          :show-action-button="false"
          show-label
          :value="proxyPort"
          :maxlength="5"
          @input="handleUpdateProxyPort"
          @keydown.enter="testProxy"
        />
      </FtFlexBox>
      <FtFlexBox
        v-if="areCredentialsSupported"
      >
        <FtInput
          :placeholder="$t('Settings.Proxy Settings.Proxy Username')"
          :show-action-button="false"
          show-label
          :value="proxyUsername"
          @input="handleUpdateProxyUsername"
          @keydown.enter="testProxy"
        />
        <FtInput
          :placeholder="$t('Settings.Proxy Settings.Proxy Password')"
          :show-action-button="false"
          show-label
          :value="proxyPassword"
          input-type="password"
          @input="handleUpdateProxyPassword"
          @keydown.enter="testProxy"
        />
      </FtFlexBox>
      <p
        class="center"
      >
        {{ $t('Settings.Proxy Settings.Clicking on Test Proxy will send a request to') }} {{ proxyTestUrl }}
      </p>
      <FtFlexBox class="proxyTestActions">
        <FtButton
          :label="$t('Settings.Proxy Settings.Test Proxy')"
          :icon="['fas', 'flask']"
          @click="testProxy"
        />
      </FtFlexBox>
      <FtLoader
        v-if="isLoading"
      />
      <div
        v-if="!isLoading && dataAvailable"
        class="center"
      >
        <h3>
          {{ $t('Settings.Proxy Settings.Your Info') }}
        </h3>
        <p>
          {{ $t('Display Label', { label: $t('Settings.Proxy Settings.Ip'), value: proxyIp }) }}
        </p>
        <p>
          {{ $t('Display Label', { label: $t('Settings.Proxy Settings.Country'), value: proxyCountry }) }}
        </p>
        <p>
          {{ $t('Display Label', { label: $t('Settings.Proxy Settings.Region'), value: proxyRegion }) }}
        </p>
        <p>
          {{ $t('Display Label', { label: $t('Settings.Proxy Settings.City'), value: proxyCity }) }}
        </p>
      </div>
    </template>
    <FtFlexBox
      v-if="!IS_CAPACITOR"
      class="settingsFlexStart500px"
    >
      <FtInput
        :placeholder="$t('Settings.Proxy Settings.IP Block Recovery Script Path')"
        :show-action-button="true"
        :allow-action-button-when-empty="true"
        :force-action-button-icon-name="['fas', 'folder-open']"
        show-label
        :value="videoIpBlockScriptPath"
        :tooltip="$t('Tooltips.Proxy Settings.IP Block Recovery Script Path')"
        @input="handleUpdateVideoIpBlockScriptPath"
        @click="handlePickVideoIpBlockRecoveryScriptPath"
      />
    </FtFlexBox>
  </FtSettingsSection>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import FtSettingsSection from '../FtSettingsSection/FtSettingsSection.vue'
import FtToggleSwitch from '../FtToggleSwitch/FtToggleSwitch.vue'
import FtButton from '../FtButton/FtButton.vue'
import FtSelect from '../FtSelect/FtSelect.vue'
import FtInput from '../FtInput/FtInput.vue'
import FtLoader from '../FtLoader/FtLoader.vue'
import FtFlexBox from '../ft-flex-box/ft-flex-box.vue'

import store from '../../store/index'
import { getProxyTestUrl } from '../../helpers/proxy-test'
import { capacitorHttpFetch } from '../../helpers/api/capacitor-http'

import { debounce, showToast } from '../../helpers/utils'

const { locale, t } = useI18n()
const IS_CAPACITOR = !!process.env.IS_CAPACITOR

const PROTOCOL_NAMES = [
  'HTTP',
  'HTTPS',
  'SOCKS4',
  'SOCKS5'
]

const PROTOCOL_VALUES = [
  'http',
  'https',
  'socks4',
  'socks5'
]

const isLoading = ref(false)
const dataAvailable = ref(false)
const proxyIp = ref('')
const proxyCountry = ref('')
const proxyRegion = ref('')
const proxyCity = ref('')

/** @type {import('vue').ComputedRef<boolean>} */
const useProxy = computed(() => {
  return store.getters.getUseProxy
})

/** @type {import('vue').ComputedRef<string>} */
const proxyProtocol = computed(() => {
  return store.getters.getProxyProtocol
})

/** @type {import('vue').ComputedRef<string>} */
const proxyHostname = computed(() => {
  return store.getters.getProxyHostname
})

/** @type {import('vue').ComputedRef<string>} */
const proxyPort = computed(() => {
  return store.getters.getProxyPort
})

/** @type {import('vue').ComputedRef<string>} */
const proxyUsername = computed(() => {
  return store.getters.getProxyUsername
})

/** @type {import('vue').ComputedRef<string>} */
const proxyPassword = computed(() => {
  return store.getters.getProxyPassword
})

/** @type {import('vue').ComputedRef<string>} */
const videoIpBlockScriptPath = computed(() => {
  return store.getters.getVideoIpBlockScriptPath
})

const proxyUrl = computed(() => {
  return `${proxyProtocol.value}://${proxyHostname.value}:${proxyPort.value}`
})

const proxyTestUrl = computed(() => getProxyTestUrl(locale.value))

/** @type {import('vue').ComputedRef<boolean>} */
const areCredentialsSupported = computed(() => {
  return proxyProtocol.value === 'http' || proxyProtocol.value === 'https' ||
    (IS_CAPACITOR && proxyProtocol.value === 'socks5')
})

/**
 * @param {boolean} enabled
 */
function handleUpdateProxy(enabled) {
  if (enabled) {
    enableProxy()
  } else {
    disableProxy()
  }

  store.dispatch('updateUseProxy', enabled)
}

/**
 * @param {string} value
 */
function handleUpdateProxyProtocol(value) {
  if (useProxy.value) {
    enableProxy()
  }

  store.dispatch('updateProxyProtocol', value)
}

/**
 * @param {string} value
 */
function handleUpdateProxyHostname(value) {
  if (useProxy.value) {
    debouncedEnableProxy()
  }

  store.dispatch('updateProxyHostname', value)
}

onBeforeUnmount(() => {
  if (proxyHostname.value === '') {
    store.dispatch('updateProxyHostname', '127.0.0.1')
  }

  if (proxyPort.value === '') {
    store.dispatch('updateProxyPort', '9050')
  }
})

/**
 * @param {string} value
 */
function handleUpdateProxyPort(value) {
  if (useProxy.value) {
    debouncedEnableProxy()
  }

  store.dispatch('updateProxyPort', value)
}

/**
 * @param {string} value
 */
function handleUpdateProxyUsername(value) {
  if (useProxy.value) {
    debouncedEnableProxy()
  }

  store.dispatch('updateProxyUsername', value)
}

/**
 * @param {string} value
 */
function handleUpdateProxyPassword(value) {
  if (useProxy.value) {
    debouncedEnableProxy()
  }

  store.dispatch('updateProxyPassword', value)
}

/**
 * @param {string} value
 */
function handleUpdateVideoIpBlockScriptPath(value) {
  store.dispatch('updateVideoIpBlockScriptPath', value)
}

async function handlePickVideoIpBlockRecoveryScriptPath() {
  if (!process.env.IS_ELECTRON || typeof window.ftElectron?.chooseIpBlockRecoveryScript !== 'function') {
    return
  }

  try {
    const scriptPath = await window.ftElectron.chooseIpBlockRecoveryScript(videoIpBlockScriptPath.value)
    if (typeof scriptPath === 'string' && scriptPath.length > 0) {
      store.dispatch('updateVideoIpBlockScriptPath', scriptPath)
    }
  } catch (error) {
    console.error('Failed to select IP block recovery script:', error)
    showToast({
      message: t('Settings.Proxy Settings.Failed to select IP block recovery script'),
      icon: ['fas', 'circle-exclamation'],
    })
  }
}

function enableProxy() {
  if (process.env.IS_ELECTRON) {
    window.ftElectron.enableProxy(proxyUrl.value)
  }
}

const debouncedEnableProxy = debounce(enableProxy, 200)

function disableProxy() {
  if (process.env.IS_ELECTRON) {
    window.ftElectron.disableProxy()
  }

  dataAvailable.value = false
  proxyIp.value = ''
  proxyCountry.value = ''
  proxyRegion.value = ''
  proxyCity.value = ''
}

async function testProxy() {
  isLoading.value = true

  if (!useProxy.value) {
    enableProxy()
  }

  try {
    if (IS_CAPACITOR) {
      await store.dispatch('waitForAndroidProxySettings')
      if (!useProxy.value) return
    }
    const response = await (IS_CAPACITOR ? capacitorHttpFetch : fetch)(proxyTestUrl.value)
    if (!response.ok) throw new Error('Proxy test request failed')
    const json = await response.json()

    proxyIp.value = json.ip
    proxyCountry.value = json.country
    proxyRegion.value = json.region
    proxyCity.value = json.city
    dataAvailable.value = true
  } catch (error) {
    console.error('errored while testing proxy:', error)
    showToast({
      message: t('Settings.Proxy Settings["Error getting network information. Is your proxy configured properly?"]'),
      icon: ['fas', 'circle-exclamation'],
    })
    dataAvailable.value = false
  } finally {
    if (!useProxy.value) {
      disableProxy()
    }

    isLoading.value = false
  }
}
</script>

<style scoped src="./ProxySettings.css" />
