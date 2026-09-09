<template>
  <Teleport :to="fullscreenTarget || 'body'">
    <div
      class="connectionStatus"
      :class="{ restored: state === 'restored', hidden: state === 'online' }"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {{ state === 'offline' ? t('Connection.Reconnecting') : state === 'restored' ? t('Connection.Back Online') : '' }}
    </div>
  </Teleport>
</template>

<script setup>
import { onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { connectionEvents, getConnectionState } from '../../helpers/networkRecovery'

const { t } = useI18n()
const state = ref(getConnectionState())
const fullscreenTarget = ref(document.fullscreenElement)
const update = event => { state.value = event.detail }
const fullscreenChanged = () => { fullscreenTarget.value = document.fullscreenElement }
connectionEvents.addEventListener('change', update)
document.addEventListener('fullscreenchange', fullscreenChanged)
onBeforeUnmount(() => {
  connectionEvents.removeEventListener('change', update)
  document.removeEventListener('fullscreenchange', fullscreenChanged)
})
</script>

<style src="./FtConnectionStatus.css" />
