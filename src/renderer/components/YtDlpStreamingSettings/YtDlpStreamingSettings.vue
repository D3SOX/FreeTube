<template>
  <FtSettingsSection :title="t('Settings.Player Settings.yt-dlp Streaming')">
    <FtFlexBox>
      <FtToggleSwitch
        :label="t('Settings.Player Settings.Preload Upcoming Videos')"
        :compact="true"
        :default-value="ytDlpPreloadEnabled"
        setting-key="ytDlpPreloadEnabled"
        :tooltip="t('Tooltips.Player Settings.Preload Upcoming Videos')"
        @change="updateYtDlpPreloadEnabled"
      />
    </FtFlexBox>
    <FtSliderGrid>
      <FtSlider
        :label="t('Settings.Player Settings.Parallel Segment Loading')"
        :default-value="segmentPrefetchLimit"
        setting-key="segmentPrefetchLimit"
        :min-value="DEFAULT_SEGMENT_PREFETCH_LIMIT"
        :max-value="MAX_SEGMENT_PREFETCH_LIMIT"
        :step="1"
        :tooltip="t('Tooltips.Player Settings.Parallel Segment Loading')"
        @change="updateSegmentPrefetchLimit"
      />
      <FtSlider
        :label="t('Settings.Player Settings.Upcoming Videos to Preload')"
        :default-value="ytDlpPreloadCount"
        setting-key="ytDlpPreloadCount"
        :min-value="0"
        :max-value="MAX_YT_DLP_PRELOAD_COUNT"
        :step="1"
        :disabled="!ytDlpPreloadEnabled"
        :tooltip="t('Tooltips.Player Settings.Upcoming Videos to Preload')"
        @change="updateYtDlpPreloadCount"
      />
      <FtSlider
        :label="t('Settings.Player Settings.Concurrent Preloads')"
        :default-value="ytDlpPreloadConcurrency"
        setting-key="ytDlpPreloadConcurrency"
        :min-value="1"
        :max-value="MAX_YT_DLP_PRELOAD_CONCURRENCY"
        :step="1"
        :disabled="!ytDlpPreloadEnabled"
        :tooltip="t('Tooltips.Player Settings.Concurrent Preloads')"
        @change="updateYtDlpPreloadConcurrency"
      />
    </FtSliderGrid>
  </FtSettingsSection>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import FtFlexBox from '../ft-flex-box/ft-flex-box.vue'
import FtSettingsSection from '../FtSettingsSection/FtSettingsSection.vue'
import FtSlider from '../FtSlider/FtSlider.vue'
import FtSliderGrid from '../FtSliderGrid/FtSliderGrid.vue'
import FtToggleSwitch from '../FtToggleSwitch/FtToggleSwitch.vue'

import store from '../../store/index'
import {
  DEFAULT_SEGMENT_PREFETCH_LIMIT,
  MAX_SEGMENT_PREFETCH_LIMIT,
} from '../../helpers/player/segmentPrefetch'
import {
  MAX_YT_DLP_PRELOAD_CONCURRENCY,
  MAX_YT_DLP_PRELOAD_COUNT,
} from '../../helpers/player/ytDlpPlaybackPreload'

const { t } = useI18n()

const segmentPrefetchLimit = computed(() => store.getters.getSegmentPrefetchLimit)
const ytDlpPreloadEnabled = computed(() => store.getters.getYtDlpPreloadEnabled)
const ytDlpPreloadCount = computed(() => store.getters.getYtDlpPreloadCount)
const ytDlpPreloadConcurrency = computed(() => store.getters.getYtDlpPreloadConcurrency)

function updateYtDlpPreloadEnabled(value) {
  store.dispatch('updateYtDlpPreloadEnabled', value)
}

function updateSegmentPrefetchLimit(value) {
  store.dispatch('updateSegmentPrefetchLimit', value)
}

function updateYtDlpPreloadCount(value) {
  store.dispatch('updateYtDlpPreloadCount', value)
}

function updateYtDlpPreloadConcurrency(value) {
  store.dispatch('updateYtDlpPreloadConcurrency', value)
}
</script>
