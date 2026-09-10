<template>
  <FtPrompt
    v-if="isTabPresented !== false"
    :autosize="true"
    theme="collaboratorsPrompt"
    @click="emit('close')"
  >
    <template #label="{ labelId }">
      <h2
        :id="labelId"
        class="collaboratorsTitle"
      >
        {{ t('Video.Collaborators') }}
      </h2>
    </template>
    <div class="collaboratorsList">
      <div
        v-for="collaborator in collaborators"
        :key="collaborator.id"
        class="collaboratorRow"
      >
        <component
          :is="enableChannelLinks ? 'RouterLink' : 'div'"
          :to="`/channel/${collaborator.id}`"
          class="collaboratorLink"
          :class="{ initialCursor: !enableChannelLinks }"
          :data-tab-title="collaborator.name"
          @click="emit('close')"
        >
          <FtRetryImage
            :src="collaborator.thumbnail"
            class="collaboratorModalThumbnail"
            alt=""
          />
          <span class="collaboratorText">
            <span
              class="collaboratorName"
              dir="auto"
            >
              {{ collaborator.name }}
            </span>
            <span
              class="collaboratorSubtitle"
              dir="auto"
            >
              {{ collaborator.subtitle }}
            </span>
          </span>
        </component>
        <FtSubscribeButton
          v-if="!hideUnsubscribeButton"
          :channel-id="collaborator.id"
          :channel-name="collaborator.name"
          :channel-thumbnail="collaborator.thumbnail"
          :subscription-count-text="''"
          :hide-profile-dropdown-toggle="true"
        />
      </div>
    </div>
  </FtPrompt>
</template>

<script setup>
import FtRetryImage from '../FtRetryImage.vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import FtPrompt from '../FtPrompt/FtPrompt.vue'
import FtSubscribeButton from '../FtSubscribeButton/FtSubscribeButton.vue'

import store from '../../store'
import { useTabContext } from '../../tabs/TabContext'

defineProps({
  collaborators: {
    type: Array,
    required: true
  }
})

const emit = defineEmits(['close'])

const { t } = useI18n()
const { isTabPresented } = useTabContext()

const enableChannelLinks = computed(() => !store.getters.getDisableChannelLinks)

const hideUnsubscribeButton = computed(() => store.getters.getHideUnsubscribeButton)
</script>

<style scoped src="./FtCollaboratorsPrompt.css" />
