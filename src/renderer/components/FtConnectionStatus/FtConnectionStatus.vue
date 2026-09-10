<template>
  <div
    class="connectionStatus"
    :class="{ restored: state === 'restored', reconnecting }"
    role="status"
    aria-live="polite"
    aria-atomic="true"
  >
    {{ reconnecting ? t('Connection.Reconnecting') : state === 'offline' ? t('Connection.Offline') : t('Connection.Back Online') }}
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps({ state: { type: String, required: true } })
const networkAvailable = ref(navigator.onLine !== false)
const reconnecting = computed(() => props.state === 'offline' && networkAvailable.value)
const updateNetwork = () => { networkAvailable.value = navigator.onLine !== false }
window.addEventListener('online', updateNetwork)
window.addEventListener('offline', updateNetwork)
onBeforeUnmount(() => {
  window.removeEventListener('online', updateNetwork)
  window.removeEventListener('offline', updateNetwork)
})
const { t } = useI18n()
</script>

<style scoped src="./FtConnectionStatus.css" />
