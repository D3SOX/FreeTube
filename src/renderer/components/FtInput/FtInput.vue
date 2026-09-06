<!-- eslint-disable vuejs-accessibility/mouse-events-have-key-events -->
<template>
  <div
    class="ft-input-component"
    :class="{
      search: isSearch,
      forceTextColor,
      showActionButton,
      showClearTextButton,
      clearTextButtonVisible: showClearTextButton && (inputDataPresent || showOptions),
      inputDataPresent,
      showOptions
    }"
  >
    <label
      v-if="showLabel"
      :for="id"
      class="selectLabel"
      :class="{ disabled, hasIcon: icon !== null }"
    >
      <FtIcon
        v-if="icon !== null"
        :icon="icon"
        class="selectLabelIcon"
      />
      <span class="selectLabelText">{{ label || placeholder }}</span>
      <FtTooltip
        v-if="tooltip !== ''"
        class="selectTooltip"
        position="bottom"
        :tooltip="tooltip"
      />
      <FtSyncedSettingIndicator :setting-key="settingKey" />
    </label>
    <button
      v-if="showClearTextButton"
      class="clearInputTextButton"
      :class="{
        visible: inputDataPresent || showOptions
      }"
      :aria-label="t('Search Bar.Clear Input')"
      :title="t('Search Bar.Clear Input')"
      @click="handleClearTextClick"
    >
      <FtIcon
        class="buttonIcon"
        :icon="['fas', 'times-circle']"
      />
    </button>
    <span class="inputWrapper">
      <input
        :id="id"
        ref="inputRef"
        :value="inputDataDisplayed"
        class="ft-input"
        :class="{ disabled }"
        :style="inputTextStyle"
        :maxlength="maxlength"
        :type="inputType"
        :placeholder="placeholder"
        :disabled="disabled"
        :spellcheck="false"
        :aria-label="showLabel ? null : placeholder"
        @input="handleInput"
        @focus="handleFocus"
        @blur="handleInputBlur"
        @keydown="handleKeyDown"
      >
      <slot name="extraAction" />
      <button
        v-if="showActionButton"
        class="inputAction"
        :class="{
          enabled: inputDataPresent || allowActionButtonWhenEmpty,
          withLabel: showLabel
        }"
        :aria-label="actionButtonLabel"
        :title="actionButtonLabel"
        @click="handleClick"
      >
        <FtIcon
          class="buttonIcon"
          :icon="actionButtonIconName"
        />
      </button>
    </span>
    <div class="options">
      <ul
        v-if="showOptions"
        ref="optionsList"
        v-overlay-scrollbars
        class="list"
        @mouseenter="searchState.isPointerInList = true"
        @mouseleave="searchState.isPointerInList = false"
      >
        <!-- eslint-disable vuejs-accessibility/click-events-have-key-events -->
        <li
          v-for="(entry, index) in visibleDataList"
          :key="index"
          :class="{ hover: searchState.selectedOption === index }"
          @mouseenter="searchState.selectedOption = index"
          @mouseleave="resetSelectedOption"
        >
          <component
            :is="getDataListProperty(index)?.isLink ? 'a' : 'div'"
            class="optionWrapper"
            :href="getDataListProperty(index)?.href"
            :aria-label="getDataListProperty(index)?.ariaLabel"
            :title="getDataListProperty(index)?.ariaLabel"
            @click.prevent="handleOptionClick(index, $event)"
            @auxclick.middle="handleOptionAuxClick(index, $event)"
          >
            <FtIcon
              v-if="getDataListProperty(index)?.iconName"
              :icon="['fas', getDataListProperty(index).iconName]"
              class="searchResultIcon"
            />
            <bdi>{{ getDataListProperty(index)?.displayText ?? entry }}</bdi>
          </component>
          <a
            v-if="getDataListProperty(index)?.isRemoveable"
            class="removeButton"
            :class="{ removeButtonSelected: removeButtonSelectedIndex === index }"
            role="button"
            :aria-label="t('Search Bar.Remove')"
            :title="t('Search Bar.Remove')"
            href="javascript:void(0)"
            @click.prevent.stop="handleRemoveClick(index)"
          >
            <FtIcon :icon="['fas', 'xmark']" />
          </a>
        </li>
        <!-- skipped -->
      </ul>
    </div>
  </div>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed, nextTick, reactive, ref, shallowRef, useId, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import FtTooltip from '../FtTooltip/FtTooltip.vue'
import FtSyncedSettingIndicator from '../FtSyncedSettingIndicator/FtSyncedSettingIndicator.vue'

import store from '../../store/index'

import { clampOverlayScrollTop, restoreOverlayScrollTop } from '../../helpers/overlayScrollbars'
import { isKeyboardEventKeyPrintableChar, isNullOrEmpty } from '../../helpers/strings'
import { getInputTextAscentOffset } from './inputTextMetrics'

const { t } = useI18n()

const props = defineProps({
  inputType: {
    type: String,
    default: 'text'
  },
  placeholder: {
    type: String,
    required: true
  },
  label: {
    type: String,
    default: null
  },
  icon: {
    type: Array,
    default: null
  },
  maxlength: {
    type: Number,
    default: null
  },
  value: {
    type: String,
    default: ''
  },
  showActionButton: {
    type: Boolean,
    default: true
  },
  actionButtonLabel: {
    type: String,
    default: '',
  },
  forceActionButtonIconName: {
    type: Array,
    default: null
  },
  showClearTextButton: {
    // Reserved for TopNav autocomplete. Regular search fields use inputType="search"
    // so Chromium supplies the themed native cancel control.
    type: Boolean,
    default: false
  },
  showLabel: {
    type: Boolean,
    default: false
  },
  isSearch: {
    type: Boolean,
    default: false
  },
  disabled: {
    type: Boolean,
    default: false
  },
  dataList: {
    type: Array,
    default: () => []
  },
  dataListProperties: {
    type: Array,
    default: () => []
  },
  searchResultIconNames: {
    type: Array,
    default: null
  },
  showDataWhenEmpty: {
    type: Boolean,
    default: false
  },
  tooltip: {
    type: String,
    default: ''
  },
  allowActionButtonWhenEmpty: {
    type: Boolean,
    default: false
  },
  settingKey: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['blur', 'clear', 'click', 'input', 'keydown', 'remove'])

const id = useId()

const inputRef = useTemplateRef('inputRef')
const optionsList = useTemplateRef('optionsList')

const inputData = ref(props.value)
const searchState = reactive({
  showOptions: false,
  selectedOption: -1,
  isPointerInList: false,
  keyboardSelectedOptionIndex: -1
})
const visibleDataList = ref(props.dataList)
const visibleDataListIndexes = ref(props.dataList.map((_, index) => index))
const removeButtonSelectedIndex = ref(-1)
const removalMade = ref(false)
const actionButtonIconName = shallowRef(props.forceActionButtonIconName ?? ['fas', 'search'])

const showOptions = computed(() => {
  return (inputData.value !== '' || props.showDataWhenEmpty) && visibleDataList.value.length > 0 && searchState.showOptions
})

const forceTextColor = computed(() => props.isSearch && store.getters.getBarColor)

const searchStateKeyboardSelectedOptionValue = computed(() => {
  return searchState.keyboardSelectedOptionIndex === -1
    ? null
    : visibleDataList.value[searchState.keyboardSelectedOptionIndex]
})

const inputDataDisplayed = computed(() => {
  if (!props.isSearch) { return inputData.value }

  /** @type {string | null | undefined} */
  const selectedOptionValue = searchStateKeyboardSelectedOptionValue.value
  if (selectedOptionValue != null && selectedOptionValue !== '') {
    return selectedOptionValue
  }

  return inputData.value
})

const inputDataPresent = computed(() => inputDataDisplayed.value.length > 0)
const inputTextStyle = computed(() => {
  if (!props.isSearch) return null

  const offset = getInputTextAscentOffset(inputDataDisplayed.value)
  const centeredPadding = (45 - 20) / 2

  return {
    '--search-input-padding-block-start': `${centeredPadding - offset}px`,
    '--search-input-padding-block-end': `${centeredPadding + offset}px`
  }
})

watch(() => props.dataList, () => updateVisibleDataList(removalMade.value), { deep: true })
watch(inputData, () => updateVisibleDataList())
watch(() => props.value, (value) => {
  inputData.value = value
})

updateVisibleDataList()

/**
 * @param {KeyboardEvent | MouseEvent} [event]
 * @param {number} [dataListIndex]
 */
function handleClick(event, dataListIndex = searchState.keyboardSelectedOptionIndex) {
  const selectedValue = searchStateKeyboardSelectedOptionValue.value
  const query = (selectedValue != null && selectedValue !== '') ? selectedValue : inputData.value
  inputData.value = query

  // No action if no input text
  if (!inputDataPresent.value && !props.allowActionButtonWhenEmpty) {
    return
  }

  searchState.showOptions = false
  searchState.selectedOption = -1
  searchState.keyboardSelectedOptionIndex = -1
  removeButtonSelectedIndex.value = -1

  emit('input', query)
  emit('click', query, { event, dataListIndex })
}

/**
 * @param {string | InputEvent} data
 */
function handleInput(data) {
  const text = typeof data === 'string' ? data : inputRef.value.value
  inputData.value = text

  if (
    props.isSearch &&
    searchState.selectedOption !== -1 &&
    inputData.value === visibleDataList.value[searchState.selectedOption]
  ) {
    return
  }

  handleActionIconChange()
  emit('input', text)
}

function handleClearTextClick() {
  // No action if no input text
  if (!inputDataPresent.value) { return }

  inputData.value = ''
  handleActionIconChange()
  updateVisibleDataList()
  searchState.isPointerInList = false

  inputRef.value.value = ''

  // Focus on input element after text is clear for better UX
  inputRef.value.focus()

  emit('clear')
}

async function handleActionIconChange() {
  // Only need to update icon if visible
  if (!props.showActionButton) { return }

  if (!inputDataPresent.value && props.forceActionButtonIconName === null) {
    // Change back to default icon if text is blank
    actionButtonIconName.value = ['fas', 'search']
    return
  }

  // Update action button icon according to input
  try {
    const result = await store.dispatch('getYoutubeUrlInfo', inputData.value)

    let isYoutubeLink = false

    switch (result.urlType) {
      case 'video':
      case 'playlist':
      case 'search':
      case 'channel':
      case 'hashtag':
      case 'post':
      case 'trending':
      case 'subscriptions':
      case 'history':
      case 'userplaylists':
        isYoutubeLink = true
        break

      case 'invalid_url':
      default: {
        // isYoutubeLink is already `false`
      }
    }

    if (props.forceActionButtonIconName === null) {
      if (isYoutubeLink) {
        // Go to URL (i.e. Video/Playlist/Channel
        actionButtonIconName.value = ['fas', 'arrow-right']
      } else {
        // Search with text
        actionButtonIconName.value = ['fas', 'search']
      }
    }
  } catch (ex) {
    // On exception, consider text as invalid URL
    if (props.forceActionButtonIconName === null) {
      actionButtonIconName.value = ['fas', 'search']
    }

    // Rethrow exception
    throw ex
  }
}

/**
 * @param {number} index
 * @param {MouseEvent} [event]
 */
function handleOptionClick(index, event) {
  if (removeButtonSelectedIndex.value !== -1) {
    handleRemoveClick(index)
    return
  }

  const selectedValue = visibleDataList.value[index]
  if (selectedValue == null) {
    resetSelectedOption()
    return
  }

  searchState.showOptions = false
  searchState.isPointerInList = false
  inputData.value = selectedValue
  emit('input', inputData.value)
  handleClick(event, getDataListIndex(index))
}

/**
 * Let web browsers follow the real link themselves. Electron needs to route
 * middle-clicks through its logical tab service instead.
 * @param {number} index
 * @param {MouseEvent} event
 */
function handleOptionAuxClick(index, event) {
  if (!process.env.IS_ELECTRON || !getDataListProperty(index)?.isLink) {
    return
  }

  event.preventDefault()
  inputRef.value.focus()
  emit('click', visibleDataList.value[index], {
    event,
    dataListIndex: getDataListIndex(index)
  })
}

function resetSelectedOption() {
  searchState.selectedOption = -1
  removeButtonSelectedIndex.value = -1
}

/**
 * @param {number} index
 */
function handleRemoveClick(index) {
  if (!getDataListProperty(index)?.isRemoveable) { return }

  // keep input in focus even when the to-be-removed "Remove" button was clicked
  inputRef.value.focus()
  removalMade.value = true
  emit('remove', visibleDataList.value[index], { dataListIndex: getDataListIndex(index) })
}

/**
 * @param {number} visibleIndex
 * @returns {number}
 */
function getDataListIndex(visibleIndex) {
  return visibleDataListIndexes.value[visibleIndex]
}

/**
 * @param {number} visibleIndex
 * @returns {object | undefined}
 */
function getDataListProperty(visibleIndex) {
  return props.dataListProperties[getDataListIndex(visibleIndex)]
}

/**
 * @param {KeyboardEvent} event
 */
function handleKeyDown(event) {
  emit('keydown', event)
  if (event.defaultPrevented) {
    return
  }

  // Update Input box value if enter key was pressed and option selected
  if (event.key === 'Enter' && !event.isComposing) {
    if (removeButtonSelectedIndex.value !== -1) {
      handleRemoveClick(removeButtonSelectedIndex.value)
    } else if (searchState.selectedOption !== -1) {
      searchState.showOptions = false
      event.preventDefault()
      handleOptionClick(searchState.selectedOption)
    } else {
      handleClick(event)
    }

    return
  }

  if (visibleDataList.value.length === 0) { return }

  searchState.showOptions = true

  // "select" the Remove button through right arrow navigation, and unselect it with the left arrow
  if (event.key === 'ArrowRight') {
    removeButtonSelectedIndex.value = searchState.selectedOption
  } else if (event.key === 'ArrowLeft') {
    removeButtonSelectedIndex.value = -1
  } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    event.preventDefault()
    const newIndex = searchState.selectedOption + (event.key === 'ArrowDown' ? 1 : -1)
    updateSelectedOptionIndex(newIndex)
  } else {
    const selectedOptionValue = searchStateKeyboardSelectedOptionValue.value

    // Keyboard selected & is char
    if (!isNullOrEmpty(selectedOptionValue) && isKeyboardEventKeyPrintableChar(event.key)) {
      // Update input based on KB selected suggestion value instead of current input value
      event.preventDefault()
      handleInput(`${selectedOptionValue}${event.key}`)
    }
  }
}

/**
 * Updates the selected dropdown option index and handles the under/over-flow behavior
 * @param {number} index
 */
function updateSelectedOptionIndex(index) {
  searchState.selectedOption = index

  // unset selection of "Remove" button
  removeButtonSelectedIndex.value = -1

  // Allow deselecting suggestion
  if (searchState.selectedOption < -1) {
    searchState.selectedOption = visibleDataList.value.length - 1
  } else if (searchState.selectedOption > visibleDataList.value.length - 1) {
    searchState.selectedOption = -1
  }

  // Update displayed value
  searchState.keyboardSelectedOptionIndex = searchState.selectedOption
}

function handleInputBlur() {
  if (!searchState.isPointerInList) {
    searchState.showOptions = false
  }
  emit('blur', inputData.value)
}

function handleFocus() {
  searchState.showOptions = true
}

async function updateVisibleDataList(preserveSelectionAfterRemoval = false) {
  if (optionsList.value != null) {
    restoreOverlayScrollTop(optionsList.value, 0)
  }

  if (inputData.value.trim() === '') {
    visibleDataList.value = props.dataList
    visibleDataListIndexes.value = props.dataList.map((_, index) => index)
  } else {
    // get list of items that match input
    const lowerCaseInputData = inputData.value.toLowerCase()

    visibleDataListIndexes.value = props.dataList
      .map((_, index) => index)
      .filter(index => props.dataList[index].toLowerCase().includes(lowerCaseInputData))
    visibleDataList.value = visibleDataListIndexes.value.map(index => props.dataList[index])
  }

  // Keep the same row selected only while the removal is reflected in the
  // data list. A text change must clear it, otherwise its index can point past
  // the newly filtered list and submit an undefined value.
  if (!preserveSelectionAfterRemoval || searchState.selectedOption >= visibleDataList.value.length) {
    resetSelectedOption()
    searchState.keyboardSelectedOptionIndex = -1
  }

  removalMade.value = false

  await nextTick()
  const list = optionsList.value
  const finalOption = list?.querySelector(':scope > li:last-of-type') ?? null
  if (list !== null) clampOverlayScrollTop(list, finalOption)
}

defineExpose({
  focus: () => {
    inputRef.value?.focus()
  },
  blur: () => {
    inputRef.value?.blur()
  },
  select: () => {
    inputRef.value?.select()
  },

  /**
   * @param {string} text
   */
  setText: (text) => {
    inputData.value = text
  },

  clear: () => {
    handleClearTextClick()
  }
})
</script>

<style scoped src="./FtInput.css" />
