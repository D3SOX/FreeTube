<template>
  <div class="settingsCategory hideFirstSectionTitle">
    <GeneralSettings />
    <UnifiedPushSettings v-if="IS_ANDROID" />
    <CommentTranslationSettings v-if="SUPPORTS_LOCAL_API" />
    <ContextMenuSearchSettings v-if="USING_ELECTRON" />
  </div>
</template>

<script setup>
import { Capacitor } from '@capacitor/core'
import ContextMenuSearchSettings from '../ContextMenuSearchSettings/ContextMenuSearchSettings.vue'
import CommentTranslationSettings from '../CommentTranslationSettings/CommentTranslationSettings.vue'
import GeneralSettings from '../GeneralSettings/GeneralSettings.vue'
import UnifiedPushSettings from '../UnifiedPushSettings.vue'

const USING_ELECTRON = !!process.env.IS_ELECTRON
const IS_ANDROID = !!process.env.IS_CAPACITOR && Capacitor.getPlatform() === 'android'
const SUPPORTS_LOCAL_API = !!process.env.SUPPORTS_LOCAL_API
</script>
