<template>
  <div
    ref="selectRoot"
    class="select"
    :class="{ containsTooltip: tooltip !== '', open: dropdownShown }"
    @focusout="handleFocusOut"
  >
    <select
      :id="`${id}-native`"
      :aria-describedby="describeById"
      aria-hidden="true"
      class="nativeSelect"
      :value="value"
      :name="id"
      :disabled="disabled"
      inert
      tabindex="-1"
      @change="change"
    >
      <option
        v-for="(name, index) in selectNames"
        :key="selectValues[index]"
        :dir="isLocaleSelector ? 'auto' : null"
        :value="selectValues[index]"
        :lang="isLocaleSelector && selectValues[index] !== 'system' && selectValues[index] !== '' ? selectValues[index] : null"
      >
        {{ name }}
      </option>
    </select>
    <button
      :id="id"
      ref="selectButton"
      type="button"
      role="combobox"
      aria-haspopup="listbox"
      class="select-text"
      :class="{ disabled, withOptionVisuals: hasOptionVisuals }"
      :aria-controls="`${id}-listbox`"
      :aria-describedby="describeById"
      :aria-expanded="dropdownShown"
      :aria-activedescendant="dropdownShown ? `${id}-option-${activeIndex}` : null"
      :disabled="disabled"
      :dir="isLocaleSelector ? 'auto' : null"
      :lang="selectedLocale"
      @click="toggleDropdown"
      @keydown="handleButtonKeydown"
    >
      <FtIcon
        v-if="selectedOptionIcon"
        :icon="selectedOptionIcon"
        class="optionIcon"
        aria-hidden="true"
      />
      <span
        v-else-if="selectedOptionColor !== undefined"
        class="optionColorDot"
        :class="{ empty: selectedOptionColor == null }"
        :style="selectedOptionColor == null ? null : { '--option-color': selectedOptionColor }"
        aria-hidden="true"
      />
      <span class="selectedValue">{{ selectedName }}</span>
    </button>
    <FtIcon
      :icon="['fas', 'angle-down']"
      class="iconSelect"
    />
    <span class="select-highlight" />
    <span class="select-bar" />
    <label
      :id="`${id}-label`"
      class="select-label"
      :for="id"
    >
      <FtIcon
        v-if="showIcon && icon !== null"
        :icon="icon"
        class="select-icon"
        :color="iconColor"
      />
      <span class="select-label-text">
        <span class="select-placeholder">{{ placeholder }}</span>
        <FtPerformanceImpact
          compact
          :setting-key="settingKey"
        />
        <FtSyncedSettingIndicator
          v-if="tooltip === ''"
          :setting-key="settingKey"
          :is-changed="isChanged"
          :disabled="disabled"
          @reset="emit('reset')"
        />
      </span>
    </label>
    <span
      v-if="tooltip !== ''"
      class="selectIndicators"
    >
      <FtTooltip
        class="selectTooltip"
        :tooltip="tooltip"
      />
      <FtSyncedSettingIndicator
        :setting-key="settingKey"
        :is-changed="isChanged"
        :disabled="disabled"
        @reset="emit('reset')"
      />
    </span>
    <span
      class="selectSearchHighlightFrame"
      aria-hidden="true"
    />
    <Teleport :to="dropdownTarget">
      <FtMobileSheet
        v-if="dropdownRendered"
        :enabled="phoneLayout"
        :open="dropdownShown"
        :title="placeholder"
        @closed="dropdownShown = false; dropdownRendered = false"
        @close="closeDropdown"
      >
        <input
          v-if="phoneLayout && selectNames.length > 10"
          v-model="search"
          class="pickerSearch"
          type="search"
          :aria-label="$t('Search Bar.Search')"
          :placeholder="$t('Search Bar.Search')"
        >
        <ul
          v-if="dropdownRendered"
          :id="`${id}-listbox`"
          ref="dropdown"
          v-overlay-scrollbars
          class="selectDropdown"
          :class="[dropdownPlacement, { phonePicker: phoneLayout }]"
          role="listbox"
          tabindex="-1"
          :aria-labelledby="`${id}-label`"
          :style="phoneLayout ? null : dropdownStyle"
          @pointerdown="handleDropdownPointerDown"
          @keydown="handlePickerKeydown"
        >
          <!-- Desktop uses aria-activedescendant; phone sheets move focus between rows. -->
          <!-- eslint-disable-next-line vuejs-accessibility/interactive-supports-focus -->
          <li
            v-for="{ name, index } in filteredOptions"
            :id="`${id}-option-${index}`"
            :key="selectValues[index]"
            ref="options"
            class="selectOption"
            :class="{
              active: index === activeIndex,
              selected: selectValues[index] === value,
              hasOptionVisuals
            }"
            role="option"
            :tabindex="phoneLayout ? 0 : -1"
            :aria-selected="selectValues[index] === value"
            :dir="isLocaleSelector ? 'auto' : null"
            :lang="isLocaleSelector && selectValues[index] !== 'system' && selectValues[index] !== '' ? selectValues[index] : null"
            @mousedown.prevent
            @pointermove="activeIndex = index"
            @click="selectOption(index)"
            @keydown.enter.space.prevent="selectOption(index)"
          >
            <FtIcon
              v-if="optionIcons[index]"
              :icon="optionIcons[index]"
              class="optionIcon"
              aria-hidden="true"
            />
            <span
              v-else-if="optionColors[index] !== undefined"
              class="optionColorDot"
              :class="{ empty: optionColors[index] == null }"
              :style="optionColors[index] == null ? null : { '--option-color': optionColors[index] }"
              aria-hidden="true"
            />
            <span class="optionName">{{ name }}</span>
            <FtIcon
              v-if="phoneLayout && selectValues[index] === value"
              :icon="['fas', 'check']"
              aria-hidden="true"
            />
          </li>
        </ul>
      </FtMobileSheet>
    </Teleport>
  </div>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, useId, useTemplateRef, watch } from 'vue'

import FtMobileSheet from '../FtMobileSheet/FtMobileSheet.vue'
import { usePhoneLayout } from '../../composables/usePhoneLayout'

import FtTooltip from '../FtTooltip/FtTooltip.vue'
import FtPerformanceImpact from '../FtPerformanceImpact/FtPerformanceImpact.vue'
import FtSyncedSettingIndicator from '../FtSyncedSettingIndicator/FtSyncedSettingIndicator.vue'
import { clampOverlayScrollTop } from '../../helpers/overlayScrollbars'

const props = defineProps({
  placeholder: {
    type: String,
    required: true
  },
  value: {
    type: String,
    required: true
  },
  selectNames: {
    type: Array,
    required: true
  },
  selectValues: {
    type: Array,
    required: true
  },
  optionColors: {
    type: Array,
    default: () => []
  },
  optionIcons: {
    type: Array,
    default: () => []
  },
  tooltip: {
    type: String,
    default: ''
  },
  disabled: {
    type: Boolean,
    default: false
  },
  describeById: {
    type: String,
    default: null
  },
  icon: {
    type: Array,
    default: null
  },
  showIcon: {
    type: Boolean,
    default: true
  },
  iconColor: {
    type: String,
    default: null
  },
  isLocaleSelector: {
    type: Boolean,
    default: false
  },
  settingKey: {
    type: String,
    default: ''
  },
  isChanged: {
    type: Boolean,
    default: null
  },
  dropdownZIndex: {
    type: [Number, String],
    default: null
  }
})

const emit = defineEmits(['change', 'open', 'reset'])

const id = useId()
const selectRoot = useTemplateRef('selectRoot')
const selectButton = useTemplateRef('selectButton')
const dropdown = useTemplateRef('dropdown')
const options = useTemplateRef('options')

const phoneLayout = usePhoneLayout()
const search = ref('')
const filteredOptions = computed(() => props.selectNames
  .map((name, index) => ({ name, index }))
  .filter(({ name }) => !phoneLayout.value || name.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase())))
const dropdownShown = ref(false)
const dropdownRendered = ref(false)
const activeIndex = ref(0)
const dropdownStyle = ref({ zIndex: props.dropdownZIndex })
const dropdownTarget = shallowRef(document.fullscreenElement ?? document.body)
const dropdownPlacement = ref('below')
let typeahead = ''
let typeaheadTimer = null
let pointerDownInDropdown = false

const selectedIndex = computed(() => props.selectValues.indexOf(props.value))
const selectedName = computed(() => props.selectNames[selectedIndex.value] ?? '')
const hasOptionVisuals = computed(() =>
  props.optionColors.some(color => color === null || (typeof color === 'string' && color.length > 0)) ||
  props.optionIcons.some(icon => Array.isArray(icon))
)
const selectedOptionColor = computed(() => props.optionColors[selectedIndex.value])
const selectedOptionIcon = computed(() => props.optionIcons[selectedIndex.value] ?? null)
const selectedLocale = computed(() => {
  if (!props.isLocaleSelector || props.value === 'system' || props.value === '') {
    return null
  }

  return props.value
})

watch(dropdownShown, (shown) => {
  if (shown) {
    dropdownRendered.value = true
    document.addEventListener('pointerdown', handleOutsidePointerDown, true)
    window.addEventListener('resize', refreshDropdownLayout)
    window.addEventListener('scroll', updateDropdownPosition, true)
  } else {
    if (!phoneLayout.value) dropdownRendered.value = false
    removeDropdownListeners()
  }
})

watch([search, phoneLayout], async () => {
  await nextTick()
  await refreshDropdownLayout()
})

watch(() => props.disabled, (disabled) => {
  if (disabled) closeDropdown()
})

watch([() => props.selectNames, () => props.selectValues], async () => {
  if (!dropdownShown.value) return

  activeIndex.value = Math.max(0, selectedIndex.value)
  await nextTick()
  await refreshDropdownLayout()
  scrollActiveOptionIntoView()
}, { flush: 'post' })

onBeforeUnmount(() => {
  removeDropdownListeners()
  if (typeaheadTimer !== null) {
    clearTimeout(typeaheadTimer)
  }
})

function toggleDropdown() {
  if (dropdownShown.value) {
    closeDropdown()
  } else {
    openDropdown()
  }
}

function openDropdown() {
  if (props.disabled) return

  search.value = ''
  emit('open')
  activeIndex.value = Math.max(0, selectedIndex.value)
  dropdownTarget.value = selectRoot.value?.closest('.prompt, .tutorialCard, .tabOrganizerBackdrop') ?? document.fullscreenElement ?? document.body
  dropdownShown.value = true

  nextTick(async () => {
    await refreshDropdownLayout()
    scrollActiveOptionIntoView()
  })
}

function closeDropdown() {
  dropdownShown.value = false
}

function updateDropdownPosition() {
  if (phoneLayout.value) return
  const button = selectButton.value
  const menu = dropdown.value
  if (button === null || menu === null) {
    return
  }

  const viewportMargin = 8
  const menuGap = 4
  const maximumHeight = 400
  const minimumTop = Math.max(viewportMargin, getTopChromeBottom() + menuGap)
  const maximumBottom = window.innerHeight - viewportMargin
  const buttonRect = button.getBoundingClientRect()
  const spaceBelow = Math.max(0, maximumBottom - buttonRect.bottom - menuGap)
  const spaceAbove = Math.max(0, buttonRect.top - menuGap - minimumTop)
  const naturalHeight = menu.scrollHeight + menu.offsetHeight - menu.clientHeight
  const desiredHeight = Math.min(maximumHeight, naturalHeight)
  const openAbove = desiredHeight > spaceBelow && spaceAbove > spaceBelow
  const availableHeight = Math.max(0, openAbove ? spaceAbove : spaceBelow)
  const menuHeight = Math.min(desiredHeight, availableHeight)
  const menuChromeWidth = menu.offsetWidth - menu.clientWidth
  const widestOption = Math.max(
    buttonRect.width,
    ...(options.value ?? []).map(option => option.scrollWidth + menuChromeWidth)
  )
  const menuWidth = Math.min(widestOption, window.innerWidth - viewportMargin * 2)
  const centeredLeft = buttonRect.left + (buttonRect.width - menuWidth) / 2
  const left = Math.max(
    viewportMargin,
    Math.min(centeredLeft, window.innerWidth - viewportMargin - menuWidth)
  )
  const top = openAbove
    ? Math.max(minimumTop, buttonRect.top - menuGap - menuHeight)
    : Math.max(
        minimumTop,
        Math.min(buttonRect.bottom + menuGap, maximumBottom - menuHeight)
      )

  dropdownPlacement.value = openAbove ? 'above' : 'below'
  dropdownStyle.value = {
    inlineSize: `${menuWidth}px`,
    left: `${snapToDevicePixels(left)}px`,
    top: `${snapToDevicePixels(top)}px`,
    maxBlockSize: naturalHeight > menuHeight ? `${menuHeight}px` : null,
    zIndex: props.dropdownZIndex
  }
}

async function refreshDropdownLayout() {
  updateDropdownPosition()
  await nextTick()

  const menu = dropdown.value
  const contentEnd = options.value?.at(-1) ?? null
  if (menu !== null) clampOverlayScrollTop(menu, contentEnd)
}

/**
 * The button's bounding box rarely lands on a whole pixel, and Chromium only
 * snaps an option's text to the pixel grid once it has a background to paint,
 * so hovering an option at a fractional offset visibly nudges its label. Place
 * the menu on the device pixel grid instead, which keeps every option's text
 * where it already was.
 *
 * @param {number} value
 */
function snapToDevicePixels(value) {
  const ratio = window.devicePixelRatio || 1
  return Math.round(value * ratio) / ratio
}

function getTopChromeBottom() {
  if (document.fullscreenElement !== null) {
    return 0
  }

  let bottom = 0
  for (const selector of ['.topNav', '.tabBar.position-top']) {
    const element = document.querySelector(selector)
    if (element !== null) {
      bottom = Math.max(bottom, element.getBoundingClientRect().bottom)
    }
  }

  return bottom
}

function moveActiveIndex(offset) {
  activeIndex.value = Math.max(0, Math.min(props.selectValues.length - 1, activeIndex.value + offset))
  scrollActiveOptionIntoView()
}

function scrollActiveOptionIntoView() {
  nextTick(() => options.value?.[activeIndex.value]?.scrollIntoView({ block: 'nearest' }))
}

/**
 * @param {KeyboardEvent} event
 */
function handleButtonKeydown(event) {
  // Alt+Arrow is the platform shortcut for opening/closing a select
  if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && event.altKey) {
    event.preventDefault()
    if (dropdownShown.value) {
      closeDropdown()
    } else {
      openDropdown()
    }
    return
  }

  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    const offset = event.key === 'ArrowDown' ? 1 : -1
    if (dropdownShown.value) {
      moveActiveIndex(offset)
    } else {
      // Native selects change the value straight away while closed
      selectOffset(offset)
    }
    return
  }

  if (event.key === 'Home' || event.key === 'End') {
    event.preventDefault()
    const index = event.key === 'Home' ? 0 : props.selectValues.length - 1
    if (dropdownShown.value) {
      activeIndex.value = index
      scrollActiveOptionIntoView()
    } else {
      selectOption(index)
    }
    return
  }

  if (event.key === 'PageDown' || event.key === 'PageUp') {
    event.preventDefault()
    const offset = event.key === 'PageDown' ? 10 : -10
    if (dropdownShown.value) {
      moveActiveIndex(offset)
    } else {
      selectOffset(offset)
    }
    return
  }

  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    if (dropdownShown.value) {
      selectOption(activeIndex.value)
    } else {
      openDropdown()
    }
    return
  }

  if (event.key === 'Escape' && dropdownShown.value) {
    event.preventDefault()
    event.stopPropagation()
    closeDropdown()
    return
  }

  if (event.key === 'Tab') {
    closeDropdown()
    return
  }

  if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
    handleTypeahead(event.key)
  }
}

function handleTypeahead(character) {
  typeahead += character.toLocaleLowerCase()
  if (typeaheadTimer !== null) {
    clearTimeout(typeaheadTimer)
  }
  typeaheadTimer = setTimeout(() => {
    typeahead = ''
    typeaheadTimer = null
  }, 700)

  const match = props.selectNames.findIndex(name => name.toLocaleLowerCase().startsWith(typeahead))
  if (match === -1) {
    return
  }

  if (dropdownShown.value) {
    activeIndex.value = match
    scrollActiveOptionIntoView()
  } else {
    selectOption(match)
  }
}

/**
 * Moves the selection relative to the currently selected option, like a closed native select does.
 * Clamping happens after the offset is applied, so that moving down from a value that isn't in
 * the list (`selectedIndex` is -1) lands on the first option instead of skipping it.
 * @param {number} offset
 */
function selectOffset(offset) {
  const index = Math.max(0, Math.min(props.selectValues.length - 1, selectedIndex.value + offset))
  selectOption(index)
}

function selectOption(index) {
  if (props.disabled) {
    closeDropdown()
    return
  }

  const selectedValue = props.selectValues[index]
  if (selectedValue !== props.value) {
    emit('change', selectedValue)
  }
  closeDropdown()
  selectButton.value?.focus()
}

function handleOutsidePointerDown(event) {
  if (phoneLayout.value) return
  const target = event.target
  if (target instanceof Node && (selectRoot.value?.contains(target) || dropdown.value?.contains(target))) {
    return
  }

  closeDropdown()
}

function handleFocusOut(event) {
  if (phoneLayout.value) return
  if (pointerDownInDropdown) {
    return
  }

  const nextTarget = event.relatedTarget
  const focusStaysInControl = nextTarget instanceof Node && (
    selectRoot.value?.contains(nextTarget) || dropdown.value?.contains(nextTarget)
  )

  if (!focusStaysInControl) {
    closeDropdown()
  }
}

function handlePickerKeydown(event) {
  if (!phoneLayout.value || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const rows = options.value ?? []
  const current = rows.indexOf(document.activeElement)
  const next = event.key === 'Home'
    ? 0
    : event.key === 'End'
      ? rows.length - 1
      : Math.max(0, Math.min(rows.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)))
  activeIndex.value = filteredOptions.value[next]?.index ?? activeIndex.value
  rows[next]?.focus()
}

function handleDropdownPointerDown() {
  pointerDownInDropdown = true
  setTimeout(() => {
    pointerDownInDropdown = false
  }, 0)
}

function removeDropdownListeners() {
  document.removeEventListener('pointerdown', handleOutsidePointerDown, true)
  window.removeEventListener('resize', refreshDropdownLayout)
  window.removeEventListener('scroll', updateDropdownPosition, true)
}

/**
 * @param {Event} event
 */
function change(event) {
  const select = event.target
  emit('change', select.value)
  nextTick(() => {
    // Keep the native control driven by `value` when an async update is rejected.
    select.value = props.value
  })
}
</script>

<style scoped src="./FtSelect.css" />
