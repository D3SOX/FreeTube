<template>
  <div class="settingsCategory">
    <PlayerSettings />
    <ChannelSettings />
    <YtDlpStreamingSettings v-if="supportsYtDlp" />
    <CaptionSettings />
  </div>
</template>

<script setup>
import { supportsYtDlp } from '../../helpers/ytDlpCapabilities'
import CaptionSettings from '../CaptionSettings/CaptionSettings.vue'
import ChannelSettings from '../ChannelSettings/ChannelSettings.vue'
import PlayerSettings from '../PlayerSettings/PlayerSettings.vue'
import YtDlpStreamingSettings from '../YtDlpStreamingSettings/YtDlpStreamingSettings.vue'

</script>
