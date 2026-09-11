<template>
  <FtPrompt
    :label="downloadLabel"
    :autosize="true"
    fixed-layout
    :content-scrollable="false"
    :card-class="activeDownload === null ? 'downloadPromptCard' : 'downloadPromptCard activeDownloadCard'"
    :inert="showSaveTemplatePrompt"
    @click="close"
  >
    <template #label="{ labelId }">
      <header class="downloadHeader">
        <p class="downloadKind">
          {{ downloadLabel }}
        </p>
        <h2
          :id="labelId"
          class="downloadVideoTitle"
          dir="auto"
        >
          {{ title }}
        </h2>
      </header>
      <section
        v-if="activeDownload === null"
        class="optionSection templateSection fixedTemplateSection"
      >
        <div class="templateControls">
          <FtSelect
            class="fullWidth"
            :placeholder="t('Downloads.Template')"
            :value="displayedTemplate"
            :select-names="templateNames"
            :select-values="templateValues"
            :icon="['fas', 'download']"
            @change="handleTemplateChange"
          />
          <FtIconButton
            v-if="isDirty"
            class="saveTemplateButton"
            :title="t('Downloads.Save Template')"
            :icon="['fas', 'save']"
            theme="secondary"
            @click="openSaveTemplatePrompt"
          />
        </div>
        <FtButton
          v-if="!isDirty && selectedCustomTemplate !== undefined"
          :label="t('Downloads.Delete Template')"
          :icon="['fas', 'trash']"
          theme="destructive"
          @click="deleteTemplate"
        />
      </section>
    </template>
    <div class="downloadPromptContent">
      <div
        v-if="activeDownload === null"
        ref="optionsScroller"
        v-overlay-scrollbars
        class="downloadOptions"
      >
        <div ref="optionsContent">
          <section class="optionSection optionGrid">
            <FtSelect
              :placeholder="t('Downloads.Media Type')"
              :value="options.mode"
              :select-names="[t('Downloads.Video'), t('Downloads.Audio'), t('Search Listing.Label.Subtitles')]"
              :select-values="['video', 'audio', 'subtitles']"
              @change="setOption('mode', $event)"
            />
            <FtSelect
              :placeholder="t('Downloads.Maximum Resolution')"
              :value="options.quality"
              :disabled="options.mode !== 'video'"
              :select-names="[t('Downloads.Best Available'), '2160p', '1440p', '1080p', '720p', '480p', '360p']"
              :select-values="['', '2160', '1440', '1080', '720', '480', '360']"
              @change="setOption('quality', $event)"
            />
            <FtSelect
              :placeholder="t('Downloads.Container')"
              :value="options.videoFormat"
              :disabled="options.mode !== 'video'"
              :select-names="[t('Downloads.Automatic'), 'MP4', 'MKV', 'WebM']"
              :select-values="['', 'mp4', 'mkv', 'webm']"
              @change="setOption('videoFormat', $event)"
            />
            <FtSelect
              :placeholder="formatLabel"
              :value="selectedCodec"
              :select-names="codecNames"
              :select-values="codecValues"
              @change="setSelectedCodec"
            />
          </section>

          <details
            :open="!phoneLayout"
            class="advancedDownloadOptions"
          >
            <summary>{{ t('Settings.Categories.Advanced') }}</summary>

            <section class="optionSection">
              <FtInput
                class="fullWidth"
                :placeholder="t('Downloads.File Name Template')"
                :tooltip="fileNameTemplateHelp"
                :show-action-button="false"
                :show-label="true"
                :value="options.filenameTemplate"
                @input="setOption('filenameTemplate', $event)"
              />
            </section>

            <section class="optionSection">
              <h3>{{ t('Downloads.Time Range and Chapters') }}</h3>
              <div class="optionGrid segmentGrid">
                <FtInput
                  :placeholder="t('Downloads.Start Time')"
                  :disabled="subtitlesOnly"
                  :show-action-button="false"
                  :show-label="true"
                  :value="options.startTime"
                  @input="setOption('startTime', $event)"
                />
                <FtInput
                  :placeholder="t('Downloads.End Time')"
                  :disabled="subtitlesOnly"
                  :show-action-button="false"
                  :show-label="true"
                  :value="options.endTime"
                  @input="setOption('endTime', $event)"
                />
              </div>
              <div class="toggleGrid">
                <FtToggleSwitch
                  compact
                  :label="t('Downloads.Split by Chapters')"
                  :default-value="!subtitlesOnly && options.splitChapters"
                  :disabled="subtitlesOnly"
                  @change="setOption('splitChapters', $event)"
                />
              </div>
            </section>

            <section class="optionSection">
              <h3>{{ t('Settings.SponsorBlock Settings.SponsorBlock Settings') }}</h3>
              <div class="toggleGrid">
                <FtToggleSwitch
                  compact
                  :label="t('Downloads.Remove Segments')"
                  :default-value="!subtitlesOnly && options.removeSponsorblock"
                  :disabled="subtitlesOnly"
                  @change="setOption('removeSponsorblock', $event)"
                />
              </div>
              <div
                :class="{ disabledOptions: !sponsorBlockCategoriesEnabled }"
                :inert="!sponsorBlockCategoriesEnabled"
                :aria-disabled="!sponsorBlockCategoriesEnabled"
              >
                <FtCheckboxList
                  v-model="sponsorBlockCategories"
                  class="sponsorCategories"
                  :labels="sponsorBlockCategoryLabels"
                  :values="SPONSORBLOCK_CATEGORIES"
                />
              </div>
            </section>

            <section class="optionSection">
              <h3>{{ t('Downloads.Subtitles and Metadata') }}</h3>
              <div class="toggleGrid">
                <FtToggleSwitch
                  compact
                  :label="t('Downloads.Embed Cover Art')"
                  :default-value="!subtitlesOnly && options.embedThumbnail"
                  :disabled="subtitlesOnly"
                  @change="setOption('embedThumbnail', $event)"
                />
                <FtToggleSwitch
                  compact
                  :label="t('Downloads.Embed Metadata')"
                  :default-value="!subtitlesOnly && options.embedMetadata"
                  :disabled="subtitlesOnly"
                  @change="setOption('embedMetadata', $event)"
                />
                <FtToggleSwitch
                  compact
                  :label="t('Downloads.Include Subtitles')"
                  :default-value="subtitlesOnly || options.includeSubtitles"
                  :disabled="subtitlesOnly"
                  @change="setOption('includeSubtitles', $event)"
                />
                <FtToggleSwitch
                  compact
                  :label="t('Downloads.Embed Subtitles')"
                  :default-value="!subtitlesOnly && options.embedSubtitles"
                  :disabled="subtitlesOnly || !options.includeSubtitles"
                  @change="setOption('embedSubtitles', $event)"
                />
              </div>
              <FtInput
                class="fullWidth subtitleLanguages"
                :placeholder="t('Downloads.Subtitle Languages')"
                :tooltip="t('Downloads.Subtitle Languages Help')"
                :disabled="!subtitlesOnly && !options.includeSubtitles"
                :show-action-button="false"
                :show-label="true"
                :value="options.subtitleLanguages"
                @input="setOption('subtitleLanguages', $event)"
              />
            </section>

            <section class="optionSection">
              <FtInput
                class="fullWidth"
                :placeholder="t('Downloads.Additional yt-dlp Arguments')"
                :show-action-button="false"
                :show-label="true"
                :value="options.customArgs"
                @input="setOption('customArgs', $event)"
              />
            </section>
          </details>
        </div>
      </div>

      <div
        v-else
        class="downloadProgress"
      >
        <div class="downloadProgressState">
          <div
            v-if="downloadInProgress"
            class="downloadProgressBarTrack"
          >
            <div
              class="downloadProgressBarFill"
              :class="{ indeterminate: activeDownload.status === 'processing' }"
              :style="{ inlineSize: `${activeDownload.percent}%` }"
            />
          </div>
          <p class="downloadStatusLine">
            {{ statusLine }}
          </p>
        </div>
        <p
          v-if="activeDownload.status === 'failed' && activeDownload.errorMessage !== 'ENOENT' && activeDownload.errorMessage"
          class="downloadErrorDetails"
        >
          {{ downloadErrorMessage(activeDownload.errorMessage, t) }}
        </p>
        <p
          v-if="activeDownload.titleTruncated"
          class="downloadWarning"
        >
          <FtIcon
            :icon="['fas', 'triangle-exclamation']"
            aria-hidden="true"
          />
          {{ t('Downloads.File Name Shortened') }}
        </p>
        <DownloadFailureHint v-if="activeDownload.status === 'failed'" />
      </div>
    </div>
    <template #footer>
      <footer
        class="downloadFooter"
        :class="{ activeDownloadFooter: activeDownload !== null }"
      >
        <p class="downloadFolderRow">
          <FtIcon :icon="['fas', 'folder-open']" />
          <span>{{ downloadFolderDisplay }}</span>
          <button
            type="button"
            class="chooseFolderButton"
            @click="chooseDownloadFolder"
          >
            {{ downloadFolderRequired ? t('Downloads.Select Folder') : t('Downloads.Choose Folder') }}
          </button>
        </p>
        <FtFlexBox>
          <FtButton
            v-if="activeDownload === null"
            :label="t('Downloads.Download')"
            :icon="['fas', 'download']"
            :disabled="downloadFolderRequired"
            @click="startDownload"
          />
          <FtButton
            v-else-if="downloadInProgress"
            :label="t('Downloads.Cancel Download')"
            :icon="['fas', 'times-circle']"
            theme="destructive"
            @click="cancelDownload"
          />
          <FtButton
            v-if="activeDownload !== null"
            :label="t('Downloads.Open Downloads')"
            :icon="['fas', 'download']"
            :text-color="null"
            :background-color="null"
            @click="openDownloads"
          />
          <FtButton
            :label="activeDownload === null ? t('Cancel') : t('Close')"
            :icon="['fas', 'xmark']"
            :text-color="null"
            :background-color="null"
            @click="close"
          />
        </FtFlexBox>
      </footer>
    </template>
  </FtPrompt>
  <FtPrompt
    v-if="showSaveTemplatePrompt"
    autosize
    :label="t('Downloads.Save Template')"
    @click="closeSaveTemplatePrompt"
  >
    <div class="saveTemplatePrompt">
      <FtInput
        ref="templateNameInput"
        :placeholder="t('Downloads.Template Name')"
        :show-action-button="false"
        :show-label="true"
        :value="newTemplateName"
        @input="(value) => newTemplateName = value"
        @keydown.enter="saveTemplate"
      />
      <FtFlexBox>
        <FtButton
          :label="t('Downloads.Save Template')"
          :icon="['fas', 'save']"
          :disabled="newTemplateName.trim() === ''"
          @click="saveTemplate"
        />
        <FtButton
          :label="t('Cancel')"
          :icon="['fas', 'xmark']"
          :text-color="null"
          :background-color="null"
          @click="closeSaveTemplatePrompt"
        />
      </FtFlexBox>
    </div>
  </FtPrompt>
</template>

<script setup>
import { ytDlp } from '../../helpers/ytDlp'
import { FtIcon } from '@opentubex/icons'
import { computed, nextTick, reactive, ref, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

import { usePhoneLayout } from '../../composables/usePhoneLayout'
import { useScrollClamp } from '../../composables/useScrollClamp'
import DownloadFailureHint from '../DownloadFailureHint/DownloadFailureHint.vue'
import FtButton from '../FtButton/FtButton.vue'
import FtCheckboxList from '../FtCheckboxList/FtCheckboxList.vue'
import FtFlexBox from '../ft-flex-box/ft-flex-box.vue'
import FtIconButton from '../FtIconButton/FtIconButton.vue'
import FtInput from '../FtInput/FtInput.vue'
import FtPrompt from '../FtPrompt/FtPrompt.vue'
import FtSelect from '../FtSelect/FtSelect.vue'
import FtToggleSwitch from '../FtToggleSwitch/FtToggleSwitch.vue'
import store from '../../store/index'
import { DEFAULT_DOWNLOAD_TEMPLATES, replaceAutomaticDownloadTemplateReferences } from '../../helpers/downloadTemplates'
import { showToast } from '../../helpers/utils'
import { downloadErrorMessage } from '../../helpers/downloadErrors'

const props = defineProps({
  videoId: { type: String, default: '' },
  videoIds: { type: Array, default: () => [] },
  playlistId: { type: String, default: '' },
  playlistKey: { type: String, default: '' },
  isPlaylist: { type: Boolean, default: false },
  title: { type: String, required: true },
  thumbnail: { type: String, default: '' }
})
const emit = defineEmits(['close'])
const { t, locale } = useI18n()
const phoneLayout = usePhoneLayout()
const optionsScroller = useTemplateRef('optionsScroller')
const optionsContent = useTemplateRef('optionsContent')
useScrollClamp(optionsScroller, optionsContent)
const downloadLabel = computed(() => props.isPlaylist
  ? t('Downloads.Download Playlist')
  : t('Downloads.Download Video'))

// YouTube offers a machine translation of every video into a few hundred languages,
// and yt-dlp's "all" selector requests every single one of them, which its rate
// limiting cuts short long before it finishes.
const DEFAULT_SUBTITLE_LANGUAGES = [...new Set([locale.value.split('-')[0], 'en'])]
  .map(language => `${language}.*`)
  .join(',')

const BASE_OPTIONS = Object.freeze({
  mode: 'video',
  quality: '',
  videoFormat: '',
  videoCodec: '',
  audioFormat: '',
  filenameTemplate: '{title} [{id}].{ext}',
  startTime: '',
  endTime: '',
  splitChapters: false,
  removeSponsorblock: false,
  sponsorBlockCategories: ['sponsor', 'intro', 'outro', 'selfpromo', 'interaction', 'music_offtopic', 'preview', 'filler'],
  includeSubtitles: false,
  embedSubtitles: true,
  subtitleLanguages: DEFAULT_SUBTITLE_LANGUAGES,
  subtitleFormat: '',
  embedThumbnail: false,
  embedMetadata: false,
  customArgs: ''
})
const customTemplates = computed(() => JSON.parse(store.getters.getYtDlpDownloadTemplates))
const storedSelection = store.getters.getYtDlpSelectedTemplate
const selectedTemplate = ref(storedSelection)
const isDirty = ref(false)
const newTemplateName = ref('')
const showSaveTemplatePrompt = ref(false)
const templateNameInput = useTemplateRef('templateNameInput')
const options = reactive({ ...BASE_OPTIONS })

const SPONSORBLOCK_CATEGORIES = ['sponsor', 'intro', 'outro', 'selfpromo', 'interaction', 'music_offtopic', 'preview', 'filler']
const sponsorBlockCategories = computed({
  get: () => options.sponsorBlockCategories,
  set: value => setOption('sponsorBlockCategories', value)
})
const sponsorBlockCategoryLabels = computed(() => [
  t('Video.Sponsor Block category.sponsor'),
  t('Video.Sponsor Block category.intro'),
  t('Video.Sponsor Block category.outro'),
  t('Video.Sponsor Block category.self-promotion'),
  t('Video.Sponsor Block category.interaction'),
  t('Video.Sponsor Block category.music offtopic'),
  t('Video.Sponsor Block category.recap'),
  t('Video.Sponsor Block category.filler')
])
const subtitlesOnly = computed(() => options.mode === 'subtitles')
// the codec select doubles as the subtitle format select, as neither codec applies to subtitles
const formatOptionKey = computed(() => {
  if (subtitlesOnly.value) return 'subtitleFormat'
  return options.mode === 'video' ? 'videoCodec' : 'audioFormat'
})
const formatLabel = computed(() => {
  if (subtitlesOnly.value) return t('Downloads.Subtitle Format')
  return options.mode === 'video' ? t('Downloads.Video Codec') : t('Downloads.Audio Codec')
})
const sponsorBlockCategoriesEnabled = computed(() => !subtitlesOnly.value && options.removeSponsorblock)
const selectedCodec = computed(() => options[formatOptionKey.value])
const codecNames = computed(() => {
  if (subtitlesOnly.value) return [t('Downloads.Automatic'), 'SRT', 'VTT', 'ASS', 'LRC']
  return options.mode === 'video'
    ? [t('Downloads.Automatic'), 'H.264', 'H.265 / HEVC', 'VP9', 'AV1']
    : [t('Downloads.Best Available'), 'MP3', 'M4A', 'Opus', 'FLAC']
})
const codecValues = computed(() => {
  if (subtitlesOnly.value) return ['', 'srt', 'vtt', 'ass', 'lrc']
  return options.mode === 'video'
    ? ['', 'h264', 'h265', 'vp9', 'av1']
    : ['', 'mp3', 'm4a', 'opus', 'flac']
})
const fileNameTemplateHelp = computed(() => t('Downloads.File Name Template Help', {
  title: '{title}',
  author: '{author}',
  upload_date: '{upload_date}',
  id: '{id}',
  playlist: '{playlist}',
  playlist_index: '{playlist_index}',
  ext: '{ext}'
}))

function getTemplateOptions(value) {
  const defaultTemplate = DEFAULT_DOWNLOAD_TEMPLATES.find(template => template.value === value)
  if (defaultTemplate) return defaultTemplate.options
  const custom = customTemplates.value.find(template => `template:${template.name}` === value)
  if (custom?.options) return custom.options
  if (custom?.args) return { customArgs: custom.args }
  return {}
}

function normalizeOptions(source) {
  return Object.fromEntries(Object.keys(BASE_OPTIONS).map(key => {
    const value = source[key] ?? BASE_OPTIONS[key]
    return [key, Array.isArray(value) ? [...value].sort() : value]
  }))
}

function optionsMatchTemplate(value) {
  return JSON.stringify(normalizeOptions(options)) ===
    JSON.stringify(normalizeOptions(getTemplateOptions(value)))
}

function findMatchingTemplate() {
  const candidates = [
    selectedTemplate.value,
    ...DEFAULT_DOWNLOAD_TEMPLATES.map(template => template.value),
    ...customTemplates.value.map(template => `template:${template.name}`)
  ]

  return [...new Set(candidates)].find(optionsMatchTemplate)
}

function loadTemplate(value) {
  Object.assign(options, normalizeOptions(getTemplateOptions(value)))
  selectedTemplate.value = value
  isDirty.value = false
}
loadTemplate(
  DEFAULT_DOWNLOAD_TEMPLATES.some(template => template.value === storedSelection) || storedSelection.startsWith('template:')
    ? storedSelection
    : 'video:best'
)

const selectedCustomTemplate = computed(() => customTemplates.value.find(
  template => `template:${template.name}` === selectedTemplate.value
))
const displayedTemplate = computed(() => isDirty.value ? 'unsaved' : selectedTemplate.value)
const templateNames = computed(() => [
  ...DEFAULT_DOWNLOAD_TEMPLATES.map(template => template.label(t)),
  ...customTemplates.value.map(template => template.name),
  ...(isDirty.value ? [t('Downloads.Unsaved')] : [])
])
const templateValues = computed(() => [
  ...DEFAULT_DOWNLOAD_TEMPLATES.map(template => template.value),
  ...customTemplates.value.map(template => `template:${template.name}`),
  ...(isDirty.value ? ['unsaved'] : [])
])

function handleTemplateChange(value) {
  if (value !== 'unsaved') {
    loadTemplate(value)
    store.dispatch('updateYtDlpSelectedTemplate', value)
  }
}
function setOption(key, value) {
  options[key] = value
  const matchingTemplate = findMatchingTemplate()
  if (matchingTemplate !== undefined) {
    selectedTemplate.value = matchingTemplate
    isDirty.value = false
    store.dispatch('updateYtDlpSelectedTemplate', matchingTemplate)
  } else {
    isDirty.value = true
  }
}
function setSelectedCodec(value) {
  setOption(formatOptionKey.value, value)
}
function saveTemplate() {
  const name = newTemplateName.value.trim()
  if (name === '') return
  const templates = customTemplates.value.filter(template => template.name !== name)
  templates.push({ name, options: { ...options } })
  const value = `template:${name}`
  store.dispatch('updateYtDlpDownloadTemplates', JSON.stringify(templates))
  store.dispatch('updateYtDlpSelectedTemplate', value)
  selectedTemplate.value = value
  isDirty.value = false
  newTemplateName.value = ''
  showSaveTemplatePrompt.value = false
  showToast({ message: t('Downloads.Template Saved', { name }), icon: ['fas', 'save'] })
}
function openSaveTemplatePrompt() {
  newTemplateName.value = selectedCustomTemplate.value?.name ?? ''
  showSaveTemplatePrompt.value = true
  nextTick(() => templateNameInput.value?.select())
}
function closeSaveTemplatePrompt() {
  showSaveTemplatePrompt.value = false
  newTemplateName.value = ''
}
function deleteTemplate() {
  if (!selectedCustomTemplate.value) return
  const deletedValue = `template:${selectedCustomTemplate.value.name}`
  const templates = customTemplates.value.filter(template => template.name !== selectedCustomTemplate.value.name)
  store.dispatch('updateYtDlpDownloadTemplates', JSON.stringify(templates))
  store.dispatch('updateYtDlpSelectedTemplate', 'video:best')
  store.dispatch('updateYtDlpAutomaticDownloadRules', replaceAutomaticDownloadTemplateReferences(
    store.getters.getYtDlpAutomaticDownloadRules,
    deletedValue,
    'video:best'
  ))
  loadTemplate('video:best')
}

function matchesDownload(download) {
  if (!props.isPlaylist) return download.videoId === props.videoId
  return props.playlistKey !== '' && download.playlistKey === props.playlistKey
}

const runningDownload = Object.values(store.getters.getYtDlpDownloads).filter(download =>
  matchesDownload(download) &&
  ['queued', 'downloading', 'processing', 'pausing', 'paused'].includes(download.status)
).at(-1)
const downloadId = ref(runningDownload?.id ?? null)
const downloadFolderPath = computed(() => store.getters.getYtDlpDownloadFolderPath)
const downloadFolderRequired = computed(() => (process.env.IS_CAPACITOR || window.ftElectron?.isFlatpak) && downloadFolderPath.value === '')
const downloadFolderDisplay = computed(() => downloadFolderPath.value || (downloadFolderRequired.value
  ? t('Downloads.Folder Required')
  : t('Downloads.System Downloads Folder')))

async function chooseDownloadFolder() {
  const path = await ytDlp.ytDlpChooseDownloadFolder(downloadFolderPath.value)
  if (typeof path === 'string' && path.length > 0) store.dispatch('updateYtDlpDownloadFolderPath', path)
}
async function startDownload() {
  const result = await ytDlp.ytDlpDownload({
    ...normalizeOptions(options),
    videoId: props.videoId,
    videoIds: [...props.videoIds],
    playlistId: props.playlistId,
    playlistKey: props.playlistKey,
    isPlaylist: props.isPlaylist,
    title: props.title,
    thumbnail: props.thumbnail,
    // edited options no longer describe the template they started from
    template: isDirty.value ? '' : selectedTemplate.value
  })
  if (result != null && 'id' in result) downloadId.value = result.id
  else if (result != null && 'error' in result) showToast({ message: t('Downloads.Download Failed'), icon: ['fas', 'circle-exclamation'] })
}
const activeDownload = computed(() => downloadId.value === null
  ? null
  : store.getters.getYtDlpDownloads[downloadId.value] ?? {
    id: downloadId.value, status: 'downloading', percent: 0, speed: null, eta: null, errorMessage: null
  })
const downloadInProgress = computed(() => activeDownload.value !== null &&
  ['queued', 'downloading', 'processing', 'pausing', 'paused'].includes(activeDownload.value.status))
const statusLine = computed(() => {
  const download = activeDownload.value
  if (!download) return ''
  if (download.status === 'queued') return t('Downloads.Queued')
  if (download.status === 'paused') return t('Downloads.Paused')
  if (download.status === 'pausing') return t('Downloads.Pausing')
  if (download.status === 'downloading') return [`${download.percent.toFixed(1)}%`, download.speed, download.eta ? `ETA ${download.eta}` : null].filter(Boolean).join(' • ')
  if (download.status === 'processing') return t('Downloads.Processing')
  if (download.status === 'completed') return t('Downloads.Download Complete')
  if (download.status === 'cancelled') return t('Downloads.Download Cancelled')
  return download.errorMessage === 'ENOENT' ? t('Downloads.yt-dlp Not Found') : t('Downloads.Download Failed')
})
function cancelDownload() {
  if (downloadId.value !== null) ytDlp.ytDlpCancelDownload(downloadId.value)
}
function openDownloads() {
  close()
  store.dispatch('showSettingsWindow', 'downloads')
}
function close() { emit('close') }
</script>

<style scoped src="./WatchVideoDownloadPrompt.css" />
