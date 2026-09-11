<template>
  <FtCard
    class="transcriptCard"
    :class="{ transcriptCardFullscreen: fullscreenOverlay }"
  >
    <Teleport
      :to="phonePanelHeader || 'body'"
      :disabled="!phonePanelHeader"
    >
      <div class="transcriptHeader">
        <h3 class="transcriptTitle">
          <FtIcon
            v-if="fullscreenOverlay"
            :icon="['fas', 'file-lines']"
          />
          {{ t('Video.Transcript.Title') }}
        </h3>
        <div
          class="transcriptHeaderActions"
          @focusout="handleHeaderActionsFocusout"
          @keydown.esc.stop.prevent="languageMenuOpen = false"
        >
          <button
            type="button"
            class="transcriptHeaderAction"
            :class="{ active: searchOpen }"
            :title="t('Video.Transcript.Search')"
            :aria-label="t('Video.Transcript.Search')"
            :aria-expanded="String(searchOpen)"
            @click="toggleTranscriptSearch"
          >
            <FtIcon :icon="['fas', 'magnifying-glass']" />
          </button>
          <button
            v-if="captions.length > 1"
            type="button"
            class="transcriptHeaderAction"
            :class="{ active: languageMenuOpen }"
            :title="t('Video.Transcript.Language')"
            :aria-label="t('Video.Transcript.Language')"
            :aria-expanded="String(languageMenuOpen)"
            @click="languageMenuOpen = !languageMenuOpen"
          >
            <FtIcon :icon="['fas', 'language']" />
          </button>
          <div
            v-if="captions.length > 0"
            class="transcriptActions"
          >
            <FtIconButton
              :title="t('Copy')"
              :icon="['fas', 'copy']"
              :disabled="isLoading || segments.length === 0"
              theme="base-no-default"
              :use-shadow="false"
              @click="copyTranscript"
            />
            <FtIconButton
              :title="t('Video.Transcript.Save')"
              :icon="['fas', 'download']"
              :disabled="isLoading || segments.length === 0"
              theme="base-no-default"
              :use-shadow="false"
              @click="saveTranscript"
            />
          </div>
          <FtIconButton
            v-if="!phonePanelHeader"
            :title="t('Video.Transcript.Close')"
            :icon="['fas', 'xmark']"
            theme="base-no-default"
            :use-shadow="false"
            @click="emit('close')"
          />
          <div
            v-if="languageMenuOpen"
            class="transcriptLanguageMenu"
          >
            <button
              v-for="(caption, index) in captions"
              :key="index"
              type="button"
              :class="{ selected: selectedCaptionIndex === String(index) }"
              @click="selectCaptionLanguage(index)"
            >
              <span>{{ caption.label }}</span>
              <FtIcon
                v-if="selectedCaptionIndex === String(index)"
                :icon="['fas', 'check']"
              />
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <div
      v-if="captions.length > 0 && searchOpen"
      class="transcriptControls"
    >
      <FtInput
        input-type="search"
        :value="searchQuery"
        :placeholder="t('Video.Transcript.Search')"
        :show-action-button="false"
        @input="searchQuery = $event"
      />
    </div>

    <FtLoader v-if="isLoading" />
    <p
      v-else-if="statusMessage"
      class="transcriptMessage"
    >
      {{ statusMessage }}
    </p>
    <div
      v-else
      ref="segmentList"
      v-overlay-scrollbars
      class="transcriptSegments"
      :class="{ transcriptFadeTop, transcriptFadeBottom }"
      role="list"
      :aria-label="t('Video.Transcript.Title')"
      @scroll="updateTranscriptFadeState"
    >
      <div
        v-for="segment in filteredSegments"
        :key="`${segment.start}-${segment.index}`"
        role="listitem"
      >
        <button
          :data-segment-index="segment.index"
          class="transcriptSegment"
          :class="{ active: segment.index === activeSegmentIndex }"
          :aria-current="segment.index === activeSegmentIndex ? 'true' : null"
          @click="emit('timestamp-event', segment.start)"
        >
          <span class="transcriptTimestamp">{{ formatTimestamp(segment.start) }}</span>
          <span class="transcriptText">{{ segment.text }}</span>
        </button>
      </div>
    </div>
  </FtCard>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { inject, computed, nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import store from '../../store/index'
import { getSubtitleRequestUrl } from '../../helpers/player/subtitleCookies'

import FtCard from '../ft-card/ft-card.vue'
import FtIconButton from '../FtIconButton/FtIconButton.vue'
import FtInput from '../FtInput/FtInput.vue'
import FtLoader from '../FtLoader/FtLoader.vue'
import { getTranscriptPreScrollTop } from './transcriptScroll.js'
import { filterTranscriptSegments } from './transcriptSearch.js'
import { findActiveTranscriptSegmentIndex } from './activeTranscriptSegment.js'

import { restoreOverlayScrollTop } from '../../helpers/overlayScrollbars'
import {
  copyToClipboard,
  formatDurationAsTimestamp,
  showToast,
  writeFileWithPicker
} from '../../helpers/utils'

const phonePanelHeader = inject('phonePanelHeader', null)
const props = defineProps({
  captions: {
    type: Array,
    default: () => []
  },
  currentTime: {
    type: Number,
    default: 0
  },
  preferredCaptionIndex: {
    type: Number,
    default: 0
  },
  videoTitle: {
    type: String,
    default: ''
  },
  fullscreenOverlay: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['close', 'timestamp-event'])
const { t } = useI18n()

const selectedCaptionIndex = ref(String(props.preferredCaptionIndex))
const languageMenuOpen = ref(false)
const searchOpen = ref(false)
const searchQuery = ref('')
const segments = ref([])
const isLoading = ref(false)
const loadFailed = ref(false)
const segmentList = useTemplateRef('segmentList')
const transcriptFadeTop = ref(false)
const transcriptFadeBottom = ref(false)

/** @type {AbortController|null} */
let loadController = null
let hasAlignedActiveSegment = false
let segmentResizeObserver = null

const normalizedSearchQuery = computed(() => searchQuery.value.trim().toLocaleLowerCase())
const filteredSegments = computed(() => {
  return filterTranscriptSegments(segments.value, normalizedSearchQuery.value)
})
const activeSegmentIndex = computed(() => {
  return findActiveTranscriptSegmentIndex(segments.value, props.currentTime)
})
const statusMessage = computed(() => {
  if (props.captions.length === 0) {
    return t('Video.Transcript.Unavailable')
  }
  if (loadFailed.value) {
    return t('Video.Transcript.Load Error')
  }
  if (segments.value.length === 0) {
    return t('Video.Transcript.Empty')
  }
  if (filteredSegments.value.length === 0) {
    return t('Video.Transcript.No Results')
  }

  return ''
})

watch(
  [() => props.captions, selectedCaptionIndex],
  async ([captions]) => {
    loadController?.abort()
    loadController = null
    hasAlignedActiveSegment = false
    segments.value = []
    isLoading.value = false
    loadFailed.value = false

    const caption = captions[Number(selectedCaptionIndex.value)]
    if (!caption) {
      return
    }

    const controller = new AbortController()
    loadController = controller
    isLoading.value = true

    try {
      const url = await getSubtitleRequestUrl(caption.url, store.getters)
      const response = await fetch(url, { signal: controller.signal })
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      segments.value = parseTranscript(await response.text())
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error('Unable to load transcript', error)
        loadFailed.value = true
      }
    } finally {
      if (loadController === controller) {
        loadController = null
        isLoading.value = false
      }
    }
  },
  { immediate: true, deep: true }
)

watch(() => props.captions, (captions) => {
  if (Number(selectedCaptionIndex.value) >= captions.length) {
    selectedCaptionIndex.value = '0'
  }
})

watch(() => props.preferredCaptionIndex, (index) => {
  selectedCaptionIndex.value = String(index)
})

watch(() => props.fullscreenOverlay, () => {
  searchOpen.value = false
  searchQuery.value = ''
  languageMenuOpen.value = false
})

watch(normalizedSearchQuery, () => {
  if (segmentList.value != null) {
    restoreOverlayScrollTop(segmentList.value, 0)
  }
})

watch(segmentList, (list) => {
  segmentResizeObserver?.disconnect()
  segmentResizeObserver = null

  if (list) {
    segmentResizeObserver = new ResizeObserver(updateTranscriptFadeState)
    segmentResizeObserver.observe(list)
    nextTick(updateTranscriptFadeState)
  }
}, { flush: 'post' })

watch(filteredSegments, () => nextTick(updateTranscriptFadeState))

watch(activeSegmentIndex, async (index) => {
  if (index < 0 || normalizedSearchQuery.value !== '') {
    return
  }

  await nextTick()
  const list = segmentList.value
  const activeSegment = list?.querySelector(`[data-segment-index="${index}"]`)
  if (!list || !activeSegment) {
    return
  }

  const top = activeSegment.offsetTop - list.clientHeight / 2 + activeSegment.clientHeight / 2
  if (!hasAlignedActiveSegment) {
    list.scrollTop = getTranscriptPreScrollTop(list.scrollTop, top, list.clientHeight)
  }

  list.scrollTo({ top, behavior: 'smooth' })
  hasAlignedActiveSegment = true
})

onBeforeUnmount(() => {
  loadController?.abort()
  segmentResizeObserver?.disconnect()
})

function formatTimestamp(seconds) {
  return formatDurationAsTimestamp(Math.floor(seconds))
}

function toggleTranscriptSearch() {
  searchOpen.value = !searchOpen.value
  if (!searchOpen.value) {
    searchQuery.value = ''
  }
}

function updateTranscriptFadeState() {
  const list = segmentList.value
  if (!list) {
    transcriptFadeTop.value = false
    transcriptFadeBottom.value = false
    return
  }

  transcriptFadeTop.value = list.scrollTop > 1
  transcriptFadeBottom.value = list.scrollTop + list.clientHeight < list.scrollHeight - 1
}

function selectCaptionLanguage(index) {
  selectedCaptionIndex.value = String(index)
  languageMenuOpen.value = false
}

function handleHeaderActionsFocusout(event) {
  if (!event.currentTarget.contains(event.relatedTarget)) {
    languageMenuOpen.value = false
  }
}

function transcriptText() {
  return segments.value
    .map(segment => `${formatTimestamp(segment.start)} ${segment.text}`)
    .join('\n')
}

async function copyTranscript() {
  await copyToClipboard(transcriptText(), {
    messageOnSuccess: t('Video.Transcript.Copied')
  })
}

async function saveTranscript() {
  const safeTitle = (props.videoTitle || t('Video.Transcript.Title'))
    .replaceAll(/[\\/:*?"<>|]/g, '_')

  try {
    const saved = await writeFileWithPicker(
      `${safeTitle} - transcript.txt`,
      transcriptText(),
      t('Video.Transcript.Text File'),
      'text/plain',
      '.txt',
      'video-transcript-export',
      'downloads'
    )

    if (saved) {
      showToast({ message: t('Video.Transcript.Saved'), icon: ['fas', 'save'] })
    }
  } catch (error) {
    console.error('Unable to save transcript', error)
    showToast({
      message: `${t('Video.Transcript.Save Error')}: ${error}`,
      time: 5000,
      icon: ['fas', 'circle-exclamation'],
    })
  }
}

/**
 * @param {string} transcript
 * @returns {{ index: number, start: number, end: number, text: string }[]}
 */
function parseTranscript(transcript) {
  const blocks = transcript.replaceAll('\r', '').replace(/^\uFEFF/, '').split(/\n{2,}/)
  const parsedSegments = []

  for (const block of blocks) {
    const lines = block.split('\n')
    const timingIndex = lines.findIndex(line => line.includes('-->'))
    if (timingIndex === -1) {
      continue
    }

    const timestamps = lines[timingIndex].match(
      /((?:\d+:)?\d{2}:\d{2}[.,]\d{3})\s+-->\s+((?:\d+:)?\d{2}:\d{2}[.,]\d{3})/
    )
    if (!timestamps) {
      continue
    }

    const cueText = lines.slice(timingIndex + 1).join('\n')

    parsedSegments.push({
      start: parseTimestamp(timestamps[1]),
      end: parseTimestamp(timestamps[2]),
      text: cleanCaptionText(cueText),
      hasInlineTimestamps: /<(?:\d+:)?\d{2}:\d{2}[.,]\d{3}>/.test(cueText)
    })
  }

  parsedSegments.sort((a, b) => a.start - b.start)
  const segments = parsedSegments.some(segment => segment.hasInlineTimestamps)
    ? normalizeRollingCaptions(parsedSegments)
    : parsedSegments.filter(segment => segment.text !== '')

  let activeUntil = Number.NEGATIVE_INFINITY
  return segments.map(({ start, end, text }, index) => {
    activeUntil = Math.max(activeUntil, end)
    return { index, start, end, text, activeUntil }
  })
}

/**
 * YouTube's auto-generated VTT alternates rolling karaoke cues with short
 * committed cues. Keep only the text added by each cue to avoid duplicates.
 * @param {{ start: number, end: number, text: string }[]} segments
 * @returns {{ start: number, end: number, text: string }[]}
 */
function normalizeRollingCaptions(segments) {
  const normalized = []
  let previousText = ''

  for (const segment of segments) {
    const text = removeOverlappingPrefix(previousText, segment.text)
    previousText = segment.text

    if (text !== '') {
      normalized.push({ ...segment, text })
    }
  }

  return normalized.map((segment, index) => ({
    ...segment,
    end: normalized[index + 1]?.start ?? segment.end
  }))
}

function removeOverlappingPrefix(previousText, text) {
  if (previousText === '' || text === '') {
    return text
  }

  const previousWords = previousText.split(' ')
  const words = text.split(' ')
  const maxOverlap = Math.min(previousWords.length, words.length)

  for (let length = maxOverlap; length > 0; length--) {
    const previousStart = previousWords.length - length
    const matches = words.slice(0, length).every((word, index) => (
      word === previousWords[previousStart + index]
    ))

    if (matches) {
      return words.slice(length).join(' ')
    }
  }

  return text
}

function parseTimestamp(timestamp) {
  const parts = timestamp.replace(',', '.').split(':').map(Number)
  const seconds = parts.pop()
  const minutes = parts.pop() ?? 0
  const hours = parts.pop() ?? 0

  return hours * 3600 + minutes * 60 + seconds
}

function cleanCaptionText(text) {
  const element = document.createElement('div')
  element.innerHTML = text
    .replaceAll(/<(?:\d+:)?\d{2}:\d{2}[.,]\d{3}>/g, '')
    .replaceAll(/<br\s*\/?>/gi, '\n')
  return element.textContent.replaceAll(/\s*\n\s*/g, ' ').replaceAll(/\s+/g, ' ').trim()
}
</script>

<style scoped src="./WatchVideoTranscript.css" />
