<template>
  <div
    class="floatingRefreshSection"
    :class="{ embedded: props.embedded }"
  >
    <p
      v-if="lastRefreshTimestamp"
      class="lastRefreshTimestamp"
    >
      {{ t('Feed.Feed Last Updated', { feedName: title, date: lastRefreshTimestamp }) }}
    </p>
    <div class="refreshActions">
      <div
        v-if="nextAutoRefreshTimestamp"
        class="nextAutoRefreshTimestamp"
        :title="nextAutoRefreshTooltip"
      >
        <span
          v-if="nextAutoRefreshAt && autoRefreshInterval"
          class="nextAutoRefreshCountdown"
          :class="{ finalMinute: isFinalMinute, spinHourglass }"
          :style="countdownStyle"
          aria-hidden="true"
          @click="spinHourglassOnce"
        >
          <svg viewBox="0 0 18 18">
            <circle
              class="countdownTrack"
              cx="9"
              cy="9"
              r="7"
            />
            <circle
              class="countdownProgress"
              cx="9"
              cy="9"
              r="7"
            />
            <g
              class="countdownHourglass"
              @animationend="stopHourglassSpin"
            >
              <path
                class="countdownHourglassOutline"
                d="M7 5h4M7 13h4M7.5 5c0 2 .5 2.75 1.5 4-1 1.25-1.5 2-1.5 4M10.5 5c0 2-.5 2.75-1.5 4 1 1.25 1.5 2 1.5 4"
              />
              <path
                class="countdownHourglassUpper"
                d="m7.75 6.5 1.25 2.25 1.25-2.25Z"
              />
              <path
                class="countdownHourglassLower"
                d="m9 9.25-1.25 2.25h2.5Z"
              />
            </g>
          </svg>
        </span>
        <p class="lastRefreshTimestamp">
          {{ t('Feed.Next Auto Refresh', { date: nextAutoRefreshTimestamp }) }}
        </p>
      </div>
      <!-- While a refresh runs, the same button cancels it -->
      <FtIconButton
        :disabled="!refreshInProgress && disableRefresh"
        :icon="refreshInProgress ? ['fas', 'xmark'] : ['fas', 'sync']"
        class="refreshButton"
        :title="refreshInProgress ? t('Feed.Cancel Refresh') : refreshFeedButtonTitle"
        :size="12"
        theme="primary"
        @click="click"
      />
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import FtIconButton from '../FtIconButton/FtIconButton.vue'

import store from '../../store/index'
import { getConfiguredKeyboardShortcuts } from '../../../constants'
import { addKeyboardShortcutToActionTitle } from '../../helpers/utils'
import { useTabLifecycle } from '../../tabs/TabContext'

const props = defineProps({
  disableRefresh: {
    type: Boolean,
    default: false
  },
  lastRefreshTimestamp: {
    type: String,
    default: ''
  },
  nextAutoRefreshTimestamp: {
    type: String,
    default: ''
  },
  nextAutoRefreshTooltip: {
    type: String,
    default: ''
  },
  nextAutoRefreshAt: {
    type: Number,
    default: 0
  },
  autoRefreshInterval: {
    type: Number,
    default: 0
  },
  embedded: {
    type: Boolean,
    default: false
  },
  refreshInProgress: {
    type: Boolean,
    default: false
  },
  title: {
    type: String,
    required: true
  }
})

const { t } = useI18n()
const refreshShortcut = computed(() => getConfiguredKeyboardShortcuts(
  store.getters.getKeyboardShortcuts
).APP.SITUATIONAL.REFRESH)

const COUNTDOWN_CIRCUMFERENCE = 2 * Math.PI * 7
const FINAL_MINUTE_MS = 60 * 1000
const now = ref(Date.now())
const spinHourglass = ref(false)
let countdownTicker = null

const remaining = computed(() => {
  return Math.max(props.nextAutoRefreshAt - now.value, 0)
})

const remainingMinutes = computed(() => {
  return Math.ceil(remaining.value / FINAL_MINUTE_MS)
})

const isFinalMinute = computed(() => {
  return remaining.value <= FINAL_MINUTE_MS
})

watch(
  () => [props.nextAutoRefreshAt, props.autoRefreshInterval, remainingMinutes.value],
  ([timestamp, interval, minutes], [previousTimestamp, previousInterval, previousMinutes]) => {
    if (timestamp !== previousTimestamp || interval !== previousInterval) {
      spinHourglass.value = false
    } else if (minutes < previousMinutes && minutes > 1) {
      spinHourglass.value = true
    }
  }
)

const countdownStyle = computed(() => {
  const progress = Math.min(remaining.value / props.autoRefreshInterval, 1)

  return {
    '--countdown-offset': COUNTDOWN_CIRCUMFERENCE * (1 - progress)
  }
})

function updateCountdown() {
  now.value = Date.now()
}

function stopHourglassSpin() {
  spinHourglass.value = false
}

function spinHourglassOnce() {
  spinHourglass.value = true
}

// Only the countdown ring needs a per-second tick. Tabs stay mounted while not
// presented, so leaving the timer running would churn reactivity once a second
// per open feed tab even when no countdown is on screen.
const countdownVisible = computed(() => props.nextAutoRefreshAt > 0 && props.autoRefreshInterval > 0)

function startCountdownTicker() {
  if (countdownTicker !== null) {
    return
  }

  updateCountdown()
  countdownTicker = setInterval(updateCountdown, 1000)
}

function stopCountdownTicker() {
  if (countdownTicker !== null) {
    clearInterval(countdownTicker)
    countdownTicker = null
  }
}

watch(countdownVisible, (visible) => {
  if (visible) {
    startCountdownTicker()
  } else {
    stopCountdownTicker()
  }
})

onMounted(() => {
  if (countdownVisible.value) {
    startCountdownTicker()
  }
  document.addEventListener('visibilitychange', updateCountdown)
})

onBeforeUnmount(() => {
  stopCountdownTicker()
  document.removeEventListener('visibilitychange', updateCountdown)
})

const refreshFeedButtonTitle = computed(() => {
  return addKeyboardShortcutToActionTitle(
    t('Feed.Refresh Feed', { subscriptionName: props.title }),
    refreshShortcut.value
  )
})

const emit = defineEmits(['cancel', 'click'])

useTabLifecycle({
  pullToRefresh(request) {
    request.handled = true
    if (!props.disableRefresh && !props.refreshInProgress) {
      emit('click')
    }
  }
})

function click() {
  if (props.refreshInProgress) {
    emit('cancel')
  } else {
    emit('click')
  }
}
</script>

<style scoped lang="scss" src="./FtRefreshWidget.scss" />
