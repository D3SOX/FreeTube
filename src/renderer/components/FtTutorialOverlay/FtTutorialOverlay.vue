<template>
  <Teleport to=".app">
    <div
      class="tutorialOverlay"
      :class="{ centered: targetRect === null }"
      role="presentation"
      @keydown="handleKeydown"
    >
      <div
        v-if="targetRect"
        class="tutorialHighlight"
        :style="highlightStyle"
        aria-hidden="true"
      />
      <FtCard
        ref="cardRef"
        class="tutorialCard"
        :class="{ tutorialImportCard: step.showImportAction }"
        :style="cardStyle"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        :aria-describedby="descriptionId"
      >
        <div
          v-if="steps.length > 1"
          class="tutorialProgress"
          aria-hidden="true"
        >
          <span
            v-for="(_, index) in steps"
            :key="index"
            :class="{ active: index === stepIndex }"
          />
        </div>
        <div
          class="tutorialIcon"
          aria-hidden="true"
        >
          <FtIcon :icon="step.icon" />
        </div>
        <h2
          :id="titleId"
          ref="titleRef"
          tabindex="-1"
        >
          {{ step.title }}
        </h2>
        <div
          ref="scrollRef"
          v-overlay-scrollbars
          class="tutorialScroll"
        >
          <div
            ref="contentRef"
            class="tutorialContent"
          >
            <p :id="descriptionId">
              {{ step.description }}
            </p>
            <FtSelect
              v-if="step.showTabLayoutSelect"
              class="tutorialTabLayoutSelect"
              :placeholder="t('Settings.Theme Settings.Tab Layout.Tab Layout')"
              :value="tabBarPosition"
              setting-key="tabBarPosition"
              :select-names="tabBarPositionNames"
              :select-values="TAB_BAR_POSITIONS"
              :icon="['fac', 'horizontal-tabs']"
              @change="updateTabBarPosition"
            />
            <div
              v-if="step.showAppearanceSelects"
              class="tutorialSelects"
            >
              <FtSelect
                :placeholder="t('Settings.Theme Settings.Base Theme.Base Theme')"
                :value="baseTheme"
                setting-key="baseTheme"
                :select-names="baseThemeNames"
                :select-values="BASE_THEME_VALUES"
                :icon="['fas', 'palette']"
                @change="updateBaseTheme"
              />
              <FtSelect
                :placeholder="t('Settings.Player Settings.Default Quality.Default Quality')"
                :value="defaultQuality"
                setting-key="defaultQuality"
                :select-names="qualityNames"
                :select-values="qualityValues"
                :icon="['fas', 'photo-film']"
                @change="updateDefaultQuality"
              />
            </div>
            <div
              class="tutorialActions"
              :class="{ tutorialImportActions: step.showImportAction }"
            >
              <FtButton
                v-if="steps.length > 1 && stepIndex === 0"
                :label="t('Tutorial.Skip')"
                :icon="['fas', 'step-forward']"
                :text-color="null"
                :background-color="null"
                @click="finishTutorial"
              />
              <FtButton
                v-if="steps.length > 1 && stepIndex > 0"
                class="tutorialCompactAction"
                :aria-label="t('Back')"
                :text-color="null"
                :background-color="null"
                @click="retreatTutorial"
              >
                <FtIcon
                  :icon="['fas', 'arrow-left']"
                  aria-hidden="true"
                />
                <span class="tutorialActionText">{{ t('Back') }}</span>
              </FtButton>
              <FtButton
                v-if="step.showImportAction"
                class="tutorialCompactAction"
                :aria-label="t('Tutorial.Import Data.Not Now')"
                :text-color="null"
                :background-color="null"
                @click="finishTutorial"
              >
                <FtIcon
                  :icon="['fas', 'xmark']"
                  aria-hidden="true"
                />
                <span class="tutorialActionText">{{ t('Tutorial.Import Data.Not Now') }}</span>
              </FtButton>
              <FtButton
                v-if="step.showImportAction"
                class="tutorialPrimaryAction"
                :aria-label="t('Tutorial.Import Data.Action')"
                @click="openDataImport"
              >
                <FtIcon
                  :icon="['fas', 'database']"
                  aria-hidden="true"
                />
                <span class="tutorialActionText">{{ t('Tutorial.Import Data.Action') }}</span>
              </FtButton>
              <FtButton
                v-else
                ref="primaryButtonRef"
                :label="primaryButtonLabel"
                :icon="isLastStep ? ['fas', 'check'] : ['fas', 'arrow-right']"
                @click="advanceTutorial"
              />
            </div>
          </div>
        </div>
      </FtCard>
    </div>
  </Teleport>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import store from '../../store/index'
import { normalizeTabBarPosition, TAB_BAR_POSITIONS } from '../../constants/tabBarPosition'
import { AUTO_QUALITY_FALLBACK, playbackEngineSupportsAutoQuality } from '../../helpers/player/autoQuality'
import { clampOverlayScrollTop, restoreOverlayScrollTop } from '../../helpers/overlayScrollbars'

import FtButton from '../FtButton/FtButton.vue'
import FtCard from '../ft-card/ft-card.vue'
import FtSelect from '../FtSelect/FtSelect.vue'
import { lockBodyScroll, unlockBodyScroll } from '../FtPrompt/scrollLock'

const props = defineProps({
  newInstallation: {
    type: Boolean,
    required: true
  }
})

const emit = defineEmits(['close'])

const { t } = useI18n()
const titleId = useId()
const descriptionId = useId()
const promptId = useId()
const cardRef = useTemplateRef('cardRef')
const primaryButtonRef = useTemplateRef('primaryButtonRef')
const titleRef = useTemplateRef('titleRef')
const scrollRef = useTemplateRef('scrollRef')
const contentRef = useTemplateRef('contentRef')
const stepIndex = ref(0)
const targetRect = ref(null)
const cardStyle = ref({})
let updateFrame = null
let lastActiveElement = null
let contentResizeObserver = null
let targetResizeObserver = null
let observedTarget = null

const BASE_THEME_VALUES = [
  'system', 'light', 'dark', 'black', 'openTubeXLight', 'openTubeXDark', 'nordic', 'hotPink', 'pastelPink',
  'catppuccinFrappe', 'catppuccinLatte', 'catppuccinMocha', 'dracula',
  'everforestDarkHard', 'everforestDarkMedium', 'everforestDarkLow',
  'everforestLightHard', 'everforestLightMedium', 'everforestLightLow',
  'gruvboxDark', 'gruvboxLight', 'solarizedDark', 'solarizedLight'
]
const RESOLUTION_VALUES = ['2160', '1440', '1080', '720', '480', '360', '240', '144']

const newUserSteps = computed(() => [
  {
    icon: ['fas', 'play'],
    title: t('Tutorial.Welcome.Title'),
    description: t('Tutorial.Welcome.Description'),
    target: null
  },
  {
    icon: ['fas', 'rss'],
    title: t('Tutorial.Navigation.Title'),
    description: t('Tutorial.Navigation.Description'),
    target: '[data-tutorial="navigation"]'
  },
  {
    icon: ['fas', 'search'],
    title: t('Tutorial.Search.Title'),
    description: t('Tutorial.Search.Description'),
    target: '.searchContainer[data-tutorial="search"] .ft-input, .navSearchButton[data-tutorial="search"]'
  },
  ...(process.env.IS_ELECTRON
    ? [{
        icon: ['fas', 'clone'],
        title: t('Tutorial.Tabs.Title'),
        description: t('Tutorial.Tabs.Description'),
        target: '[data-tutorial="tabs"]',
        showTabLayoutSelect: true
      }]
    : []),
  {
    icon: ['fas', 'sliders-h'],
    title: t('Tutorial.Quick Settings.Title'),
    description: t('Tutorial.Quick Settings.Description'),
    target: '[data-tutorial="quick-settings"]',
    showAppearanceSelects: true
  },
  {
    icon: ['fas', 'database'],
    title: t('Tutorial.Import Data.Title'),
    description: t('Tutorial.Import Data.Description'),
    target: null,
    showImportAction: true
  }
])

const returningUserSteps = computed(() => [{
  icon: ['fas', 'sliders-h'],
  title: t('Tutorial.Settings Moved.Title'),
  description: t('Tutorial.Settings Moved.Description'),
  target: '[data-tutorial="quick-settings"]'
}])

const steps = computed(() => props.newInstallation ? newUserSteps.value : returningUserSteps.value)
const step = computed(() => steps.value[stepIndex.value])
const isLastStep = computed(() => stepIndex.value === steps.value.length - 1)
const primaryButtonLabel = computed(() => {
  if (!props.newInstallation) return t('Tutorial.Got It')
  return isLastStep.value ? t('Tutorial.Finish') : t('Tutorial.Next')
})
const tabBarPositionNames = computed(() => [
  t('Settings.Theme Settings.Tab Layout.Horizontal Top'),
  t('Settings.Theme Settings.Tab Layout.Horizontal Bottom'),
  t('Settings.Theme Settings.Tab Layout.Vertical Left'),
  t('Settings.Theme Settings.Tab Layout.Vertical Right')
])
const tabBarPosition = computed(() => normalizeTabBarPosition(store.getters.getTabBarPosition))
const baseThemeNames = computed(() => [
  t('Settings.Theme Settings.Base Theme.System Default'),
  t('Settings.Theme Settings.Base Theme.Light'),
  t('Settings.Theme Settings.Base Theme.Dark'),
  t('Settings.Theme Settings.Base Theme.Black'),
  t('Settings.Theme Settings.Base Theme.OpenTubeX Light'),
  t('Settings.Theme Settings.Base Theme.OpenTubeX Dark'),
  t('Settings.Theme Settings.Base Theme.Nordic'),
  t('Settings.Theme Settings.Base Theme.Hot Pink'),
  t('Settings.Theme Settings.Base Theme.Pastel Pink'),
  t('Settings.Theme Settings.Base Theme.Catppuccin Frappe'),
  t('Settings.Theme Settings.Base Theme.Catppuccin Latte'),
  t('Settings.Theme Settings.Base Theme.Catppuccin Mocha'),
  t('Settings.Theme Settings.Base Theme.Dracula'),
  t('Settings.Theme Settings.Base Theme.Everforest Dark Hard'),
  t('Settings.Theme Settings.Base Theme.Everforest Dark Medium'),
  t('Settings.Theme Settings.Base Theme.Everforest Dark Low'),
  t('Settings.Theme Settings.Base Theme.Everforest Light Hard'),
  t('Settings.Theme Settings.Base Theme.Everforest Light Medium'),
  t('Settings.Theme Settings.Base Theme.Everforest Light Low'),
  t('Settings.Theme Settings.Base Theme.Gruvbox Dark'),
  t('Settings.Theme Settings.Base Theme.Gruvbox Light'),
  t('Settings.Theme Settings.Base Theme.Solarized Dark'),
  t('Settings.Theme Settings.Base Theme.Solarized Light')
])
const baseTheme = computed(() => store.getters.getBaseTheme)
const autoQualityAvailable = computed(() => playbackEngineSupportsAutoQuality(store.getters.getVideoPlaybackEngine))
const qualityValues = computed(() => autoQualityAvailable.value ? [...RESOLUTION_VALUES, 'auto'] : RESOLUTION_VALUES)
const qualityNames = computed(() => [
  t('Settings.Player Settings.Default Quality.4k'),
  t('Settings.Player Settings.Default Quality.1440p'),
  t('Settings.Player Settings.Default Quality.1080p'),
  t('Settings.Player Settings.Default Quality.720p'),
  t('Settings.Player Settings.Default Quality.480p'),
  t('Settings.Player Settings.Default Quality.360p'),
  t('Settings.Player Settings.Default Quality.240p'),
  t('Settings.Player Settings.Default Quality.144p'),
  ...(autoQualityAvailable.value ? [t('Settings.Player Settings.Default Quality.Auto')] : [])
])
const defaultQuality = computed(() => {
  const value = store.getters.getDefaultQuality
  return value === 'auto' && !autoQualityAvailable.value ? AUTO_QUALITY_FALLBACK : value
})

watch(tabBarPosition, schedulePositionUpdate, { flush: 'post' })

const highlightStyle = computed(() => {
  if (targetRect.value === null) return {}

  return {
    insetBlockStart: `${targetRect.value.top}px`,
    left: `${targetRect.value.left}px`,
    inlineSize: `${targetRect.value.width}px`,
    blockSize: `${targetRect.value.height}px`
  }
})

onMounted(() => {
  lastActiveElement = document.activeElement
  lockBodyScroll()
  store.commit('addOpenPrompt', promptId)
  window.addEventListener('resize', schedulePositionUpdate)
  window.addEventListener('scroll', schedulePositionUpdate, true)
  document.addEventListener('keydown', handleDocumentKeydown, true)
  updatePosition()
  nextTick(() => {
    primaryButtonRef.value?.$el.focus()
    observeTutorialContent()
  })
})

onBeforeUnmount(() => {
  if (updateFrame !== null) cancelAnimationFrame(updateFrame)
  window.removeEventListener('resize', schedulePositionUpdate)
  window.removeEventListener('scroll', schedulePositionUpdate, true)
  document.removeEventListener('keydown', handleDocumentKeydown, true)
  contentResizeObserver?.disconnect()
  targetResizeObserver?.disconnect()
  store.commit('removeOpenPrompt', promptId)
  unlockBodyScroll()
  nextTick(() => lastActiveElement?.focus())
})

function schedulePositionUpdate() {
  if (updateFrame !== null) cancelAnimationFrame(updateFrame)
  updateFrame = requestAnimationFrame(() => {
    updateFrame = null
    updatePosition()
  })
}

function clampTutorialScroll() {
  if (scrollRef.value && contentRef.value) {
    clampOverlayScrollTop(scrollRef.value, contentRef.value)
  }
}

function observeTutorialContent() {
  contentResizeObserver?.disconnect()
  if (!contentRef.value) return

  contentResizeObserver = new ResizeObserver(clampTutorialScroll)
  contentResizeObserver.observe(contentRef.value)
  clampTutorialScroll()
}

function observeTarget(target) {
  if (observedTarget === target) return

  targetResizeObserver?.disconnect()
  observedTarget = target

  if (target) {
    targetResizeObserver ??= new ResizeObserver(schedulePositionUpdate)
    targetResizeObserver.observe(target)
  }
}

async function updatePosition() {
  const target = step.value.target === null
    ? null
    : Array.from(document.querySelectorAll(step.value.target)).find(element => {
        const rect = element.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0
      })
  observeTarget(target)
  const rect = target?.getBoundingClientRect()
  targetRect.value = rect && rect.width > 0 && rect.height > 0
    ? {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height
      }
    : null

  cardStyle.value = {}
  await nextTick()

  if (targetRect.value === null) return

  const card = cardRef.value?.$el
  if (!card) return

  const cardRect = card.getBoundingClientRect()
  const gap = 14
  const cardViewportPadding = 12
  const availableOnRight = window.innerWidth - targetRect.value.left - targetRect.value.width
  const availableOnLeft = targetRect.value.left
  const minimumSideCardWidth = 240
  const placeBesideTarget = targetRect.value.height > window.innerHeight / 2 &&
    Math.max(availableOnLeft, availableOnRight) - gap - cardViewportPadding >= minimumSideCardWidth

  if (placeBesideTarget) {
    const placeOnRight = availableOnRight >= availableOnLeft
    const availableWidth = (placeOnRight ? availableOnRight : availableOnLeft) - gap - cardViewportPadding
    const width = Math.min(cardRect.width, availableWidth)
    const left = placeOnRight
      ? targetRect.value.left + targetRect.value.width + gap
      : targetRect.value.left - gap - width

    cardStyle.value = {
      inlineSize: `${width}px`,
      left: `${left}px`
    }
    await nextTick()

    const resizedCardRect = card.getBoundingClientRect()
    const top = Math.min(
      window.innerHeight - resizedCardRect.height - cardViewportPadding,
      Math.max(
        cardViewportPadding,
        targetRect.value.top + targetRect.value.height / 2 - resizedCardRect.height / 2
      )
    )
    cardStyle.value = {
      ...cardStyle.value,
      insetBlockStart: `${top}px`
    }
    return
  }

  const availableBelow = window.innerHeight - targetRect.value.top - targetRect.value.height
  const top = availableBelow >= cardRect.height + gap
    ? targetRect.value.top + targetRect.value.height + gap
    : Math.max(cardViewportPadding, targetRect.value.top - cardRect.height - gap)
  const idealLeft = targetRect.value.left + targetRect.value.width / 2 - cardRect.width / 2
  const left = Math.min(
    window.innerWidth - cardRect.width - cardViewportPadding,
    Math.max(cardViewportPadding, idealLeft)
  )

  cardStyle.value = {
    insetBlockStart: `${top}px`,
    left: `${left}px`
  }
}

function handleDocumentKeydown(event) {
  if (event.key === 'Escape') {
    if (event.target.closest?.('.tutorialCard .select.open')) return

    event.preventDefault()
    event.stopPropagation()
  }
}

function handleKeydown(event) {
  event.stopPropagation()

  if (event.key !== 'Tab') return

  const buttons = Array.from(cardRef.value?.$el.querySelectorAll('button:not(:disabled)') ?? [])
  if (buttons.length === 0) return

  const currentIndex = buttons.indexOf(document.activeElement)
  const nextIndex = event.shiftKey
    ? (currentIndex <= 0 ? buttons.length - 1 : currentIndex - 1)
    : (currentIndex === -1 || currentIndex === buttons.length - 1 ? 0 : currentIndex + 1)

  event.preventDefault()
  buttons[nextIndex].focus()
  store.dispatch('showOutlines')
}

async function updateTabBarPosition(value) {
  await store.dispatch('updateTabBarPosition', value)
}

function updateBaseTheme(value) {
  store.dispatch('updateBaseTheme', value)
}

function updateDefaultQuality(value) {
  store.dispatch('updateDefaultQuality', value)
}

async function openDataImport() {
  finishTutorial()
  await nextTick()
  store.commit('setSettingsWindowSection', 'data')
  store.dispatch('showSettingsWindow')
}

async function advanceTutorial() {
  if (isLastStep.value) {
    finishTutorial()
    return
  }

  await setTutorialStep(stepIndex.value + 1)
}

async function retreatTutorial() {
  await setTutorialStep(stepIndex.value - 1)
}

async function setTutorialStep(index) {
  stepIndex.value = index
  await nextTick()
  if (scrollRef.value) restoreOverlayScrollTop(scrollRef.value, 0)
  clampTutorialScroll()
  await updatePosition()
  titleRef.value?.focus()
}

function finishTutorial() {
  emit('close')
}
</script>

<style scoped src="./FtTutorialOverlay.css" />
