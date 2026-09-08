<template>
  <label
    class="pure-material-slider"
    :for="id"
  >
    <span class="labelRow">
      <span class="label">
        {{ $t('Display Label', {label: label, value: displayLabel}) }}
      </span>
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

// U+2007, as wide as a digit
const FIGURE_SPACE = '\u2007'

const id = useId()
const currentValue = ref(props.defaultValue)

// Apply new bounds before the value, or a range input clamps it to the old max.
watch(() => props.defaultValue, (value) => {
  if (currentValue.value !== value) {
    currentValue.value = value
  }
}, { flush: 'post' })

/**
 * @param {number} value
 */
function formatValue(value) {
  return props.valueExtension === null
    ? `${value}`
    : `${value}${props.valueExtension}`
}

/** The widest value the slider can show, in characters. */
const valueWidth = computed(() => Math.max(
  formatValue(props.minValue).length,
  formatValue(props.maxValue).length
))

/*
 * Padding shorter values out to that width keeps the label the same size all
 * the way along the slider, so dragging it can't make the label wrap and
 * unwrap. Figure spaces are as wide as a digit and, unlike ordinary spaces,
 * are neither collapsed nor a place to break the line.
 */
const displayLabel = computed(() => formatValue(currentValue.value).padEnd(valueWidth.value, FIGURE_SPACE))

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
