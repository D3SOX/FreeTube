<template>
  <FtButton
    class="appIconSettingsButton"
    :label="t('App Icon.Title')"
    :icon="['fas', 'icons']"
    @click="open = true"
  />
  <FtSettingsSubpage
    :open="open"
    :title="t('App Icon.Title')"
    :icon="['fas', 'icons']"
    grow-with-content
    @close="open = false"
  >
    <div ref="contentRef">
      <fieldset
        class="appIconPresets"
        :disabled="busy || selected === null"
        :aria-label="t('App Icon.Title')"
        :aria-busy="busy"
      >
        <label
          v-for="preset in APP_ICON_PRESETS"
          :key="preset.id"
          class="appIconPreset"
        >
          <img
            :src="`static/app-icons/${variant}/${preset.id}.svg`"
            width="64"
            height="64"
            alt=""
          >
          <span>{{ preset.translationKey
            ? themeNames[preset.translationKey]
            : t('Settings.General Settings.Thumbnail Preference.Default') }}</span>
          <input
            v-model="selected"
            type="radio"
            name="appIconPreset"
            :value="preset.id"
            @change="select(preset.id)"
          >
        </label>
      </fieldset>
      <p
        v-if="failed"
        role="alert"
      >
        {{ t('App Icon.Error') }}
      </p>
    </div>
  </FtSettingsSubpage>
  <FtPrompt
    v-if="showAppliedPrompt"
    card-class="appIconAppliedPrompt"
    :label="t('App Icon.Title')"
    :extra-labels="[
      t('App Icon.Saved Message'),
      t('Settings[\'The app needs to restart for changes to take effect. Restart and apply change?\']')
    ]"
    :option-names="[t('App Icon.Restart'), t('Dismiss')]"
    :option-values="['restart', 'dismiss']"
    :option-icons="[['fas', 'sync'], ['fas', 'xmark']]"
    :busy="busy"
    @click="handleAppliedPrompt"
  />
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { registerPlugin } from '@capacitor/core'
import { APP_ICON_PRESETS } from '../../appIconPresets'
import FtButton from './FtButton/FtButton.vue'
import FtSettingsSubpage from './FtSettingsSubpage/FtSettingsSubpage.vue'
import FtPrompt from './FtPrompt/FtPrompt.vue'
import { restartAndroidApp } from '../helpers/androidUi'
import { clampOverlayScrollTop, restoreOverlayScrollTop } from '../helpers/overlayScrollbars'

const AppIcon = registerPlugin('AppIcon')
const { t, tm } = useI18n()
const themeNames = computed(() => tm('Settings.Theme Settings.Base Theme'))
const selected = ref(null)
let confirmed = null
const variant = ref('main')
const busy = ref(false)
const failed = ref(false)
const open = ref(false)
const showAppliedPrompt = ref(false)
const contentRef = useTemplateRef('contentRef')
let resizeObserver

async function refresh() {
  const result = await AppIcon.getName()
  selected.value = result.value
  confirmed = result.value
  variant.value = result.variant
}

watch(open, async (isOpen) => {
  resizeObserver?.disconnect()
  if (!isOpen) return
  failed.value = false
  await nextTick()
  const content = contentRef.value
  if (!content) return
  const scroller = content.closest('.settingsSubpageScroll')
  restoreOverlayScrollTop(scroller, 0)
  resizeObserver = new ResizeObserver(() => clampOverlayScrollTop(scroller, content))
  resizeObserver.observe(content)
  resizeObserver.observe(scroller)
  try {
    await refresh()
  } catch (error) {
    console.error('Unable to read launcher icon', error)
    failed.value = true
  }
})

onBeforeUnmount(() => resizeObserver?.disconnect())

async function select(name) {
  if (busy.value) return
  busy.value = true
  failed.value = false
  try {
    await AppIcon.change({ name })
    await refresh()
    showAppliedPrompt.value = true
  } catch (error) {
    console.error('Unable to change launcher icon', error)
    selected.value = confirmed
    failed.value = true
    // Read native state even after failure, including a partially applied switch.
    await refresh().catch(() => {})
  } finally {
    busy.value = false
  }
}

async function handleAppliedPrompt(option) {
  if (option !== 'restart') {
    showAppliedPrompt.value = false
    return
  }
  busy.value = true
  try {
    await restartAndroidApp()
    showAppliedPrompt.value = false
  } catch (error) {
    console.error('Unable to restart app', error)
  } finally {
    busy.value = false
  }
}
</script>

<style scoped src="./AppIconSettings.css" />
