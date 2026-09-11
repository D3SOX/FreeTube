<template>
  <FtPrompt
    theme="slim"
    fixed-layout
    card-class="searchFiltersCard"
    @click="hideSearchFilters"
  >
    <template #label="{ labelId }">
      <div class="titleContainer">
        <h2
          :id="labelId"
          class="center"
        >
          {{ title }}
        </h2>
        <p
          v-if="activeLabels.length"
          class="activeFilters"
        >
          {{ activeLabels.join(' · ') }}
        </p>
        <button
          type="button"
          class="clearFilterButton"
          :aria-label="$t('Search Filters.Clear Filters')"
          :title="$t('Search Filters.Clear Filters')"
          :style="{visibility: (searchFilterValueChanged ? 'visible' : 'hidden')}"
          @click="clearFilters"
        >
          <FtIcon
            class="clearFilterIcon"
            aria-hidden="true"
            :icon="['fas', 'filter-circle-xmark']"
          />
        </button>
      </div>
    </template>

    <FtFlexBox class="radioFlexBox">
      <FtRadioButton
        v-model="typeValue"
        :title="$t('Search Filters.Type.Type')"
        :labels="typeLabels"
        :values="TYPE_VALUES"
        class="searchRadio"
      />
      <FtRadioButton
        v-model="durationValue"
        :title="$t('Search Filters.Duration.Duration')"
        :labels="durationLabels"
        :values="DURATION_VALUES"
        class="searchRadio"
      />
      <FtRadioButton
        v-model="timeValue"
        :title="$t('Search Filters.Time.Time')"
        :labels="timeLabels"
        :values="TIME_VALUES"
        class="searchRadio"
      />
      <FtCheckboxList
        v-model="featuresValue"
        :title="$t('Search Filters.Features.Features')"
        :labels="featureLabels"
        :values="FEATURE_VALUES"
        class="searchRadio"
      />
      <FtRadioButton
        v-model="prioritizeValue"
        :title="$t('Search Filters.Prioritize.Prioritize')"
        :labels="prioritizeLabels"
        :values="PRIORITIZE_VALUES"
        class="searchRadio"
      />
    </FtFlexBox>
    <template #footer>
      <div class="searchFilterCloseButtonContainer">
        <FtButton
          :label="$t('Close')"
          :icon="['fas', 'xmark']"
          background-color="null"
          text-color="null"
          @click="hideSearchFilters"
        />
      </div>
    </template>
  </FtPrompt>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import FtFlexBox from '../ft-flex-box/ft-flex-box.vue'
import FtRadioButton from '../FtRadioButton/FtRadioButton.vue'
import FtPrompt from '../FtPrompt/FtPrompt.vue'
import FtButton from '../FtButton/FtButton.vue'
import FtCheckboxList from '../FtCheckboxList/FtCheckboxList.vue'

import store from '../../store/index'

const { t } = useI18n()
const tabId = process.env.IS_ELECTRON ? (store.getters.getPresentedTabId ?? 'web') : 'web'

const PRIORITIZE_VALUES = [
  'relevance',
  'popularity'
]

const TIME_VALUES = [
  '',
  'today',
  'week',
  'month',
  'year'
]

const TYPE_VALUES = [
  'all',
  'video',
  'shorts',
  'channel',
  'playlist',
  'movie'
]

const DURATION_VALUES = [
  '',
  'under_three_mins',
  'three_to_twenty_mins',
  'over_twenty_mins'
]

const FEATURE_VALUES = [
  'live',
  '4k',
  'hd',
  'subtitles',
  'creative_commons',
  '360',
  'vr180',
  '3d',
  'hdr',
  'location',
]

const NOT_ALLOWED_FOR_MOVIES_FEATURES = [
  'live',
  'subtitles',
  '3d',
  'creative_commons'
]

const title = computed(() => t('Search Filters.Search Filters'))

const prioritizeLabels = computed(() => [
  t('Search Filters.Prioritize.Most Relevant'),
  t('Search Filters.Prioritize.Popularity')
])

const timeLabels = computed(() => [
  t('Search Filters.Time.Any Time'),
  t('Search Filters.Time.Today'),
  t('Search Filters.Time.This Week'),
  t('Search Filters.Time.This Month'),
  t('Search Filters.Time.This Year')
])

const typeLabels = computed(() => [
  t('Search Filters.Type.All Types'),
  t('Search Filters.Type.Videos'),
  t('Global.Shorts'),
  t('Search Filters.Type.Channels'),
  t('Playlists'),
  t('Search Filters.Type.Movies')
])

const durationLabels = computed(() => [
  t('Search Filters.Duration.All Durations'),
  t('Search Filters.Duration.< 3 minutes'),
  t('Search Filters.Duration.3 - 20 minutes'),
  t('Search Filters.Duration.> 20 minutes')
])

const featureLabels = computed(() => [
  t('Search Filters.Features.Live'),
  t('Search Filters.Features.4K'),
  t('Search Filters.Features.HD'),
  t('Search Filters.Features.Subtitles'),
  t('Search Filters.Features.Creative Commons'),
  t('Search Filters.Features.360 Video'),
  t('Search Filters.Features.VR180'),
  t('Search Filters.Features.3D'),
  t('Search Filters.Features.HDR'),
  t('Search Filters.Features.Location'),
])

const searchSettings = store.getters.getSearchSettings(tabId)

/** @type {import('vue').Ref<'relevance' | 'popularity'>} */
const prioritizeValue = ref(searchSettings.prioritize)

watch(prioritizeValue, (value) => {
  store.commit('setSearchPrioritize', { tabId, value })
})

/** @type {import('vue').Ref<'' | 'today' | 'week' | 'month' | 'year'>} */
const timeValue = ref(searchSettings.time)

watch(timeValue, (value) => {
  if (timeValue.value !== '' && !isVideoOrMovieOrAll(typeValue.value)) {
    typeValue.value = 'all'
  }

  store.commit('setSearchTime', { tabId, value })
})

/** @type {import('vue').Ref<'all' | 'video' | 'shorts' | 'channel' | 'playlist' | 'movie'>} */
const typeValue = ref(searchSettings.type)

watch(typeValue, (value) => {
  if (value === 'shorts') {
    durationValue.value = ''
  } else if (value === 'channel' || value === 'playlist') {
    timeValue.value = ''
    durationValue.value = ''
    if (featuresValue.value.length > 0) {
      featuresValue.value = []
    }
  } else if (value === 'movie') {
    if (featuresValue.value.length > 0) {
      featuresValue.value = featuresValue.value.filter(e => !NOT_ALLOWED_FOR_MOVIES_FEATURES.includes(e))
    }
  }

  store.commit('setSearchType', { tabId, value })
})

/** @type {import('vue').Ref<'' | 'under_three_mins' | 'three_to_twenty_mins' | 'over_twenty_mins'>} */
const durationValue = ref(searchSettings.duration)

watch(durationValue, (value) => {
  if (value !== '' && !isVideoOrMovieOrAll(typeValue.value)) {
    typeValue.value = 'all'
  }

  store.commit('setSearchDuration', { tabId, value })
})

/** @type {import('vue').Ref<('hd' | 'subtitles' | 'creative_commons' | '3d' | 'live' | '4k' | '360' | 'location' | 'hdr' | 'vr180')[]>} */
const featuresValue = ref([...searchSettings.features])

watch(featuresValue, (values) => {
  if (values.length > 0 && (!isVideoOrMovieOrAll(typeValue.value) || NOT_ALLOWED_FOR_MOVIES_FEATURES.some(item => values.includes(item)))) {
    typeValue.value = 'all'
  }

  store.commit('setSearchFeatures', { tabId, value: [...values] })
}, { deep: true })

const activeLabels = computed(() => [
  typeValue.value !== TYPE_VALUES[0] && typeLabels.value[TYPE_VALUES.indexOf(typeValue.value)],
  durationValue.value !== DURATION_VALUES[0] && durationLabels.value[DURATION_VALUES.indexOf(durationValue.value)],
  timeValue.value !== TIME_VALUES[0] && timeLabels.value[TIME_VALUES.indexOf(timeValue.value)],
  prioritizeValue.value !== PRIORITIZE_VALUES[0] && prioritizeLabels.value[PRIORITIZE_VALUES.indexOf(prioritizeValue.value)],
  ...featuresValue.value.map(value => featureLabels.value[FEATURE_VALUES.indexOf(value)])
].filter(Boolean))

const searchFilterValueChanged = computed(() => {
  return prioritizeValue.value !== PRIORITIZE_VALUES[0] ||
    timeValue.value !== TIME_VALUES[0] ||
    typeValue.value !== TYPE_VALUES[0] ||
    durationValue.value !== DURATION_VALUES[0] ||
    featuresValue.value.length > 0
})

watch(searchFilterValueChanged, (value) => {
  store.commit('setSearchFilterValueChanged', { tabId, value })
})

function hideSearchFilters() {
  store.dispatch('hideSearchFilters')
}

/**
 * @param {'all' | 'video' | 'channel' | 'playlist' | 'movie'} type
 */
function isVideoOrMovieOrAll(type) {
  return type === 'video' || type === 'movie' || type === 'all'
}

function clearFilters() {
  prioritizeValue.value = PRIORITIZE_VALUES[0]
  timeValue.value = TIME_VALUES[0]
  typeValue.value = TYPE_VALUES[0]
  durationValue.value = DURATION_VALUES[0]
  featuresValue.value = []
}

</script>

<style scoped src="./FtSearchFilters.css" />
