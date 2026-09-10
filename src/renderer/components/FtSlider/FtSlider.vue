<template>
  <label
    class="pure-material-slider"
    :for="id"
  >
    <span class="labelRow">
      <I18nT
        keypath="Display Label"
        tag="span"
        class="label"
        scope="global"
      >
        <template #label>{{ label }}</template>
        <template #value>
          <span class="value">
            <span
              class="valueNumber"
              :style="{ minInlineSize: `${valueWidth}ch` }"
            >{{ currentValue }}</span>{{ valueExtension }}
          </span>
        </template>
      </I18nT>
      <FtPerformanceImpact :setting-key="settingKey" />
      <FtTooltip
        v-if="tooltip !== ''"
        class="selectTooltip"
        :tooltip="tooltip"
      />
      <FtSyncedSettingIndicator
        :setting-key="settingKey"
        :is-changed="isChanged"
        @reset="emit('reset')"
      />
    </span>
    <input
      :id="id"
      v-model.number="currentValue"
      class="input"
      :disabled="disabled"
      type="range"
      :min="minValue"
      :max="maxValue"
      :step="step"
      @input="input"
      @change="change"
    >
  </label>
</template>

<script setup>
import { computed, ref, useId, watch } from 'vue'
import { Translation as I18nT } from 'vue-i18n'

import FtTooltip from '../FtTooltip/FtTooltip.vue'
import FtPerformanceImpact from '../FtPerformanceImpact/FtPerformanceImpact.vue'
import FtSyncedSettingIndicator from '../FtSyncedSettingIndicator/FtSyncedSettingIndicator.vue'

const props = defineProps({
  label: {
    type: String,
    required: true
  },
  defaultValue: {
    type: Number,
    required: true
  },
  minValue: {
    type: Number,
    required: true
  },
  maxValue: {
    type: Number,
    required: true
  },
  step: {
    type: Number,
    required: true
  },
  valueExtension: {
    type: String,
    default: null
  },
  disabled: {
    type: Boolean,
    default: false
  },
  tooltip: {
    type: String,
    default: ''
  },
  settingKey: {
    type: String,
    default: ''
  },
  isChanged: {
    type: Boolean,
    default: null
  }
})

const emit = defineEmits(['change', 'input', 'reset'])

const id = useId()
const currentValue = ref(props.defaultValue)

// Apply new bounds before the value, or a range input clamps it to the old max.
watch(() => props.defaultValue, (value) => {
  if (currentValue.value !== value) {
    currentValue.value = value
  }
}, { flush: 'post' })

// Reserve digit width without relying on a font's figure-space glyph.
const valueWidth = computed(() => Math.max(
  String(props.minValue).length,
  String(props.maxValue).length
))

function change() {
  emit('change', currentValue.value)
}

/**
 * @param {Event} event
 */
function input(event) {
  emit('input', event.target.valueAsNumber)
}

</script>
<style scoped src="./FtSlider.css" />
