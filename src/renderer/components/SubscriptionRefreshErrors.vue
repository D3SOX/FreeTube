<template>
  <FtPrompt
    v-if="subscriptionRefreshErrors"
    :label="t('Subscriptions.Error Channels')"
    theme="readable-width"
    fixed-layout
    @click="subscriptionRefreshErrors = null"
  >
    <div class="refreshErrors">
      <section
        v-for="channel in subscriptionRefreshErrors.values()"
        :key="channel.id"
      >
        <h3>{{ channel.name }}</h3>
        <p
          v-for="reason in channel.reasons"
          :key="reason"
        >
          {{ reason }}
        </p>
      </section>
    </div>
    <template #footer>
      <FtFlexBox>
        <FtButton
          :label="t('Subscriptions.Copy Error Details')"
          :icon="['fas', 'copy']"
          @click="copyDetails"
        />
        <FtButton
          :label="t('Close')"
          :icon="['fas', 'xmark']"
          :text-color="null"
          :background-color="null"
          @click="subscriptionRefreshErrors = null"
        />
      </FtFlexBox>
    </template>
  </FtPrompt>
</template>

<script setup>
import { useI18n } from 'vue-i18n'
import FtPrompt from './FtPrompt/FtPrompt.vue'
import FtButton from './FtButton/FtButton.vue'
import FtFlexBox from './ft-flex-box/ft-flex-box.vue'
import { subscriptionRefreshErrors } from '../helpers/subscriptionRefreshErrors'
import { copyToClipboard } from '../helpers/utils'

const { t } = useI18n()

function copyDetails() {
  copyToClipboard([...subscriptionRefreshErrors.value.values()].map(channel => channel.trace).join('\n'))
}
</script>

<style scoped>
.refreshErrors {
  padding-inline: 16px;
  overflow-wrap: anywhere;
}

.refreshErrors section + section {
  border-block-start: 1px solid var(--tertiary-text-color);
  margin-block-start: 16px;
  padding-block-start: 8px;
}

.refreshErrors p {
  white-space: pre-wrap;
}
</style>
