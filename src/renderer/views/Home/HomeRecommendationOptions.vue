<template>
  <FtIconButton
    ref="trigger"
    class="recommendationOptions"
    :title="t('Display Label', { label: t('Home Page.Recommended for you'), value: t('Video.More Options') })"
    force-dropdown
    dropdown-position-x="left"
    dropdown-portal
    dropdown-class="recommendationOptionsPopover"
    :use-shadow="false"
    theme="base-no-default"
  >
    <template #dropdown-header>
      <div
        :id="`${id}-discovery`"
        class="recommendationDiscoveryHeading"
      >
        {{ t('Home Page.Discovery') }}
      </div>
    </template>
    <template #default>
      <div class="recommendationSettings">
        <div
          class="recommendationDiscovery"
          role="radiogroup"
          :aria-labelledby="`${id}-discovery`"
        >
          <div class="recommendationDiscoveryChoices">
            <label
              v-for="choice in choices"
              :key="choice.value"
              class="recommendationDiscoveryChoice"
              :title="choice.description"
            >
              <input
                type="radio"
                :name="id"
                :value="choice.value"
                :checked="exploration === choice.value"
                :aria-describedby="`${id}-description-${choice.value}`"
                @change="emit('update:exploration', choice.value)"
              >
              <span>
                <FtIcon
                  :icon="choice.icon"
                  aria-hidden="true"
                />
                {{ choice.label }}
              </span>
            </label>
          </div>
          <div class="recommendationDiscoveryDescriptions">
            <p
              v-for="choice in choices"
              :id="`${id}-description-${choice.value}`"
              :key="choice.value"
              :class="{ active: exploration === choice.value }"
            >
              {{ choice.description }}
            </p>
          </div>
        </div>
        <div class="recommendationSettingsActions">
          <button
            type="button"
            @click="reset"
          >
            <FtIcon
              :icon="['fas', 'undo']"
              aria-hidden="true"
            />
            <span>{{ t('Home Page.Reset recommendations') }}</span>
          </button>
          <button
            type="button"
            @click="emit('disable')"
          >
            <FtIcon
              :icon="['fas', 'power-off']"
              aria-hidden="true"
            />
            <span>{{ t('Home Page.Turn off recommendations') }}</span>
          </button>
        </div>
      </div>
    </template>
  </FtIconButton>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed, useId, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'
import FtIconButton from '../../components/FtIconButton/FtIconButton.vue'

defineProps({
  exploration: { type: Number, required: true },
})
const emit = defineEmits(['update:exploration', 'reset', 'disable'])
const { t } = useI18n()
const id = useId()
const trigger = useTemplateRef('trigger')
const choices = computed(() => [
  {
    label: t('Home Page.Familiar'),
    description: t('Home Page.Familiar description'),
    icon: ['fas', 'house'],
    value: 0,
  },
  {
    label: t('Home Page.Balanced'),
    description: t('Home Page.Balanced description'),
    icon: ['fas', 'exchange-alt'],
    value: 0.2,
  },
  {
    label: t('Home Page.Explore'),
    description: t('Home Page.Explore description'),
    icon: ['fas', 'globe'],
    value: 0.5,
  },
])

function reset() {
  trigger.value.hideDropdown()
  trigger.value.$el.querySelector('button').focus()
  emit('reset')
}
</script>

<style src="./HomeRecommendationOptions.css" />
