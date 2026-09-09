<template>
  <div class="settingsCategory">
    <SponsorBlockSettings />
    <RydSettings />
    <VoiceOverTranslationSettings v-if="USING_ELECTRON || IS_CAPACITOR" />
  </div>
</template>

<script setup>
import RydSettings from '../RydSettings.vue'
import SponsorBlockSettings from '../SponsorBlockSettings.vue'
import VoiceOverTranslationSettings from '../VoiceOverTranslationSettings.vue'

const IS_CAPACITOR = !!process.env.IS_CAPACITOR
const USING_ELECTRON = !!process.env.IS_ELECTRON
</script>
