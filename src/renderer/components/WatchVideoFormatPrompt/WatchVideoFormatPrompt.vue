<template>
  <FtPrompt
    :label="t('Change Format.Change Media Formats')"
    :autosize="true"
    card-class="content-width"
    @click="emit('close')"
  >
    <div class="formatPrompt">
      <div class="currentSource">
        <p class="currentSourceLabel">
          {{ t('Change Format.Stream Source') }}
        </p>
        <div class="currentSourceBadges">
          <span
            class="badge engineBadge"
            :title="localFilePlayback ? t('Change Format.Stream Source') : t('Change Format.Playback Engine')"
          >
            <FtIcon :icon="localFilePlayback ? ['fas', 'file-video'] : ['fas', 'circle-play']" />
            {{ localFilePlayback ? t('Downloads.Local File') : engineLabel }}
          </span>
          <span
            v-if="!localFilePlayback && playbackEngineSelection === playbackEngine"
            class="badge"
            :title="t('Change Format.Streaming Protocol')"
          >
            {{ streamTypeLabel }}
          </span>
        </div>
      </div>

      <div
        v-if="canChangePlaybackEngine && !localFilePlayback"
        class="engineSelector"
      >
        <p class="sectionLabel">
          {{ t('Change Format.Stream Extraction Method') }}
        </p>
        <div class="engineOptions">
          <button
            v-for="engine in engines"
            :key="engine.value"
            type="button"
            class="engineOption"
            :class="{ active: engine.value === playbackEngineSelection }"
            :aria-pressed="engine.value === playbackEngineSelection"
            @click="selectPlaybackEngine(engine.value)"
          >
            {{ engine.label }}
            <FtIcon
              v-if="engine.value === playbackEngineSelection"
              class="engineOptionCheck"
              :icon="['fas', 'check']"
            />
          </button>
        </div>
      </div>

      <ul class="formatOptions">
        <li
          v-for="option in options"
          :key="option.value"
        >
          <button
            type="button"
            class="formatOption"
            :class="{ active: option.active }"
            :disabled="!option.available"
            :aria-pressed="option.active"
            @click="selectFormat(option.value)"
          >
            <FtIcon
              class="formatOptionIcon"
              :icon="option.icon"
              fixed-width
            />
            <span class="formatOptionText">
              <span class="formatOptionTitle">{{ option.label }}</span>
              <span class="formatOptionDescription">
                {{ option.available ? option.description : t('Change Format.Not Available For This Video') }}
              </span>
            </span>
            <FtIcon
              v-if="option.active"
              class="formatOptionCheck"
              :icon="['fas', 'check']"
            />
          </button>
        </li>
      </ul>
    </div>
  </FtPrompt>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import FtPrompt from '../FtPrompt/FtPrompt.vue'

const props = defineProps({
  /** @type {import('vue').PropType<'dash' | 'legacy' | 'audio'>} */
  activeFormat: {
    type: String,
    required: true
  },
  /** @type {import('vue').PropType<'built-in' | 'yt-dlp'>} */
  playbackEngine: {
    type: String,
    required: true
  },
  playbackEngineVersion: {
    type: String,
    default: null
  },
  /** @type {import('vue').PropType<'built-in' | 'yt-dlp'>} */
  playbackEngineSelection: {
    type: String,
    required: true
  },
  /** @type {import('vue').PropType<'sabr' | 'dash' | 'hls' | 'none'>} */
  streamType: {
    type: String,
    required: true
  },
  dashAvailable: {
    type: Boolean,
    required: true
  },
  legacyAvailable: {
    type: Boolean,
    required: true
  },
  audioAvailable: {
    type: Boolean,
    required: true
  },
  canChangePlaybackEngine: {
    type: Boolean,
    default: false
  },
  localFilePlayback: {
    type: Boolean,
    default: false
  },
  localPlaybackDownloads: {
    type: Array,
    default: () => []
  }
})

const emit = defineEmits([
  'change-format',
  'change-playback-engine',
  'use-local-source',
  'use-online-source',
  'close'
])

const { t } = useI18n()

const engineLabel = computed(() => {
  if (props.playbackEngineSelection !== 'yt-dlp') {
    return t('Settings.General Settings.Stream Extraction Method.Built-in')
  }

  // showing the version makes it verifiable that the streams really came from yt-dlp
  return props.playbackEngine !== 'yt-dlp' || props.playbackEngineVersion === null
    ? 'yt-dlp'
    : `yt-dlp ${props.playbackEngineVersion}`
})

const streamTypeLabel = computed(() => {
  switch (props.streamType) {
    case 'sabr':
      return 'SABR'
    case 'hls':
      return 'HLS'
    case 'dash':
      return 'DASH'
    default:
      return t('Change Format.Protocols.Progressive')
  }
})

const engines = computed(() => [
  {
    value: 'yt-dlp',
    label: t('Settings.General Settings.Stream Extraction Method.yt-dlp')
  },
  {
    value: 'built-in',
    label: t('Settings.General Settings.Stream Extraction Method.Built-in')
  }
])

const options = computed(() => {
  const activeDownloadId = props.localFilePlayback
    ? props.localPlaybackDownloads.find(download => download.active)?.id
    : undefined
  const localOptions = props.localPlaybackDownloads.map(download => ({
    value: `local:${download.id}`,
    label: download.mode === 'audio'
      ? t('Change Format.Local Audio File')
      : t('Change Format.Local Video File'),
    description: t('Change Format.Descriptions.Local File'),
    icon: ['fas', download.mode === 'audio' ? 'volume-high' : 'file-video'],
    available: true,
    active: download.id === activeDownloadId
  }))

  if (props.localFilePlayback) {
    return [
      ...localOptions,
      {
        value: 'online',
        label: t('Change Format.Online Video'),
        description: t('Change Format.Descriptions.Online Video'),
        icon: ['fas', 'circle-play'],
        available: true,
        active: false
      }
    ]
  }

  return [...localOptions, {
    value: 'dash',
    label: t('Change Format.Use Dash Formats'),
    description: t('Change Format.Descriptions.Dash'),
    icon: ['fas', 'photo-film'],
    available: props.dashAvailable,
    active: props.activeFormat === 'dash'
  },
  {
    value: 'legacy',
    label: t('Change Format.Use Legacy Formats'),
    description: t('Change Format.Descriptions.Legacy'),
    icon: ['fas', 'file-video'],
    available: props.legacyAvailable,
    active: props.activeFormat === 'legacy'
  },
  {
    value: 'audio',
    label: t('Change Format.Use Audio Formats'),
    description: t('Change Format.Descriptions.Audio'),
    icon: ['fas', 'volume-high'],
    available: props.audioAvailable,
    active: props.activeFormat === 'audio'
  }]
})

/**
 * @param {'dash' | 'legacy' | 'audio'} value
 */
function selectFormat(value) {
  if (value.startsWith('local:')) {
    const downloadId = Number(value.slice('local:'.length))
    if (!props.localPlaybackDownloads.some(download => download.id === downloadId && download.active)) {
      emit('use-local-source', downloadId)
    }
    emit('close')
    return
  }

  if (value === 'online') {
    emit('use-online-source')
    emit('close')
    return
  }

  if (value !== props.activeFormat) {
    emit('change-format', value)
  }

  emit('close')
}

/**
 * @param {'built-in' | 'yt-dlp'} value
 */
function selectPlaybackEngine(value) {
  if (value !== props.playbackEngineSelection) {
    emit('change-playback-engine', value)
  }

  emit('close')
}
</script>

<style scoped>
.formatPrompt {
  display: flex;
  flex-direction: column;
  gap: 16px;
  inline-size: min(440px, 80vw);
  margin-block-start: 8px;
}

.currentSource {
  align-items: center;
  background-color: var(--side-nav-hover-color);
  border-radius: calc(8px * var(--ui-roundness));
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  padding: 12px 14px;
}

.currentSourceLabel {
  color: var(--tertiary-text-color);
  flex: 1 1 auto;
  font-size: 12px;
  letter-spacing: 0.04em;
  margin-block: 0;
  min-inline-size: 0;
  text-transform: uppercase;
}

.currentSourceBadges {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.badge {
  align-items: center;
  background-color: var(--card-bg-color);
  backdrop-filter: var(--card-bg-blur, none);
  border-radius: calc(20px * var(--ui-roundness));
  color: var(--secondary-text-color);
  display: inline-flex;
  font-size: 12px;
  font-weight: 600;
  gap: 5px;
  padding: 4px 10px;
  white-space: nowrap;
}

.engineBadge {
  background-color: var(--accent-color);
  color: var(--text-with-accent-color);
}

.engineSelector {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sectionLabel {
  color: var(--tertiary-text-color);
  font-size: 12px;
  letter-spacing: 0.04em;
  margin-block: 0;
  text-transform: uppercase;
}

.engineOptions {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.engineOption {
  align-items: center;
  background-color: transparent;
  border: 1px solid var(--side-nav-hover-color);
  border-radius: calc(8px * var(--ui-roundness));
  color: inherit;
  cursor: pointer;
  display: flex;
  font: inherit;
  font-weight: 600;
  gap: 8px;
  justify-content: center;
  padding: 10px 12px;
}

.engineOption:hover,
.engineOption:focus-visible {
  background-color: var(--side-nav-hover-color);
}

.engineOption.active {
  border-color: var(--accent-color);
  color: var(--accent-color);
}

.formatOptions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  list-style: none;
  margin-block: 0;
  padding-inline-start: 0;
}

.formatOption {
  align-items: center;
  background-color: transparent;
  border: 1px solid var(--side-nav-hover-color);
  border-radius: calc(8px * var(--ui-roundness));
  color: inherit;
  cursor: pointer;
  display: flex;
  font: inherit;
  gap: 12px;
  inline-size: 100%;
  padding: 12px 14px;
  text-align: start;
  transition: background-color 0.15s ease, border-color 0.15s ease;
}

.formatOption:hover:not(:disabled),
.formatOption:focus-visible {
  background-color: var(--side-nav-hover-color);
}

.formatOption.active {
  border-color: var(--accent-color);
}

.formatOption:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.formatOptionIcon {
  color: var(--accent-color);
  font-size: 18px;
}

.formatOption:disabled .formatOptionIcon {
  color: var(--tertiary-text-color);
}

.formatOptionText {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 2px;
  min-inline-size: 0;
}

.formatOptionTitle {
  font-weight: 600;
}

.formatOptionDescription {
  color: var(--tertiary-text-color);
  font-size: 13px;
}

.formatOptionCheck {
  color: var(--accent-color);
}
</style>
