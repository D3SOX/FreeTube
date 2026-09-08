<template>
  <FtSettingsSubpage
    :open="open"
    :title="t('Theme Discovery.Discover Themes')"
    :icon="['fas', 'search']"
    flush
    @close="emit('close')"
  >
    <div class="themeDiscovery">
      <div class="discoveryToolbar">
        <FtIconButton
          :title="t('Theme Discovery.Refresh')"
          :icon="['fas', 'sync']"
          :disabled="loading"
          @click="load(true)"
        />
      </div>
      <div
        ref="scroller"
        v-overlay-scrollbars
        class="discoveryScroller"
        :aria-busy="loading"
      >
        <div ref="content">
          <p
            v-if="loadFailed"
            class="discoveryMessage"
            role="alert"
          >
            {{ t('Theme Discovery.Load Error') }}
          </p>
          <p
            v-if="!loading && !loadFailed && entries.length === 0"
            class="discoveryMessage"
          >
            {{ t('Theme Discovery.No Themes') }}
          </p>
          <div class="themeGallery">
            <article
              v-for="entry in entries"
              :key="entry.theme.id"
              class="themeCard"
            >
              <div class="themePreview">
                <button
                  v-if="entry.screenshots.length && !failedImages.has(currentScreenshot(entry))"
                  type="button"
                  @click="preview = entry"
                >
                  <Transition
                    name="themeScreenshot"
                    mode="out-in"
                  >
                    <img
                      :key="currentScreenshot(entry)"
                      :src="currentScreenshot(entry)"
                      :alt="entry.title"
                      loading="lazy"
                      referrerpolicy="no-referrer"
                      @error="failedImages.add($event.currentTarget.src)"
                    >
                  </Transition>
                </button>
                <span v-else>{{ t('Theme Discovery.No Preview') }}</span>
              </div>
              <div
                v-if="entry.screenshots.length > 1"
                class="screenshotChoices"
              >
                <button
                  v-for="(screenshot, index) in entry.screenshots"
                  :key="screenshot"
                  :aria-label="`${entry.title} (${index + 1})`"
                  :aria-pressed="currentScreenshot(entry) === screenshot"
                  @click="selectedScreenshots[entry.theme.id] = screenshot"
                >
                  {{ index + 1 }}
                </button>
              </div>
              <div class="themeDetails">
                <h2>{{ entry.title }}</h2>
                <a
                  v-if="entry.author"
                  :href="`https://github.com/${encodeURIComponent(entry.author)}`"
                  @click.prevent="openExternalLink(`https://github.com/${encodeURIComponent(entry.author)}`)"
                >{{ `@${entry.author}` }}</a>
                <p v-if="entry.description">
                  {{ entry.description }}
                </p>
                <div class="themeActions">
                  <FtButton
                    :label="installLabel(entry)"
                    :icon="['fas', hasUpdate(entry) ? 'sync' : installed(entry) ? 'check' : 'download']"
                    :disabled="installing !== null || (active(entry) && !hasUpdate(entry))"
                    @click="install(entry)"
                  />
                  <FtButton
                    :label="t('Theme Discovery.View on GitHub')"
                    :icon="['fab', 'github']"
                    @click="openExternalLink(entry.url)"
                  />
                </div>
              </div>
            </article>
          </div>
          <FtSpinner
            v-if="loading"
            :label="t('Theme Discovery.Loading')"
          />
          <FtButton
            v-if="!loading && hasMore && (!autoLoad || loadFailed)"
            class="loadMore"
            :label="t('Theme Discovery.Load More')"
            :icon="['fas', 'plus']"
            :disabled="loading"
            @click="load(false)"
          />
          <div
            v-if="autoLoad && hasMore && !loading && !loadFailed"
            v-observe-visibility="autoLoadOptions"
            class="themeAutoLoadSentinel"
          />
        </div>
      </div>
    </div>
  </FtSettingsSubpage>
  <FtPrompt
    v-if="preview && open"
    :label="preview.title"
    fixed-layout
    @click="preview = null"
  >
    <template #label="{ labelId }">
      <div class="screenshotHeader">
        <h2 :id="labelId">
          {{ preview.title }}
        </h2>
        <FtIconButton
          :title="t('Close')"
          :icon="['fas', 'xmark']"
          @click="preview = null"
        />
      </div>
    </template>
    <div class="fullScreenshotStage">
      <Transition
        name="themeScreenshot"
        mode="out-in"
      >
        <img
          v-if="!failedImages.has(currentScreenshot(preview))"
          :key="currentScreenshot(preview)"
          class="fullThemeScreenshot"
          :src="currentScreenshot(preview)"
          :alt="preview.title"
          referrerpolicy="no-referrer"
          @error="failedImages.add($event.currentTarget.src)"
        >
        <p v-else>
          {{ t('Theme Discovery.No Preview') }}
        </p>
      </Transition>
    </div>
    <template #footer>
      <div
        v-if="preview.screenshots.length > 1"
        class="screenshotNavigation"
      >
        <FtIconButton
          :title="t('Video.Previous')"
          :icon="['fas', 'angle-left']"
          @click="switchPreview(-1)"
        />
        <span aria-live="polite">{{ `${preview.screenshots.indexOf(currentScreenshot(preview)) + 1} / ${preview.screenshots.length}` }}</span>
        <FtIconButton
          :title="t('Video.Next')"
          :icon="['fas', 'angle-right']"
          @click="switchPreview(1)"
        />
      </div>
    </template>
  </FtPrompt>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, reactive, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import FtButton from './FtButton/FtButton.vue'
import FtPrompt from './FtPrompt/FtPrompt.vue'
import FtIconButton from './FtIconButton/FtIconButton.vue'
import FtSpinner from './FtSpinner/FtSpinner.vue'
import FtSettingsSubpage from './FtSettingsSubpage/FtSettingsSubpage.vue'
import store from '../store/index'
import { customThemeValue } from '../../customTheme'
import { saveCustomTheme } from '../helpers/customTheme'
import { loadThemeFeed } from '../helpers/themeDiscovery'
import { clampOverlayScrollTop, restoreOverlayScrollTop } from '../helpers/overlayScrollbars'
import { openExternalLink, showToast } from '../helpers/utils'

const props = defineProps({ open: Boolean })
const emit = defineEmits(['close'])
const { t } = useI18n()
const entries = ref([])
const loading = ref(false)
const loadFailed = ref(false)
const hasMore = ref(false)
const installing = ref(null)
const preview = ref(null)
const scroller = useTemplateRef('scroller')
const content = useTemplateRef('content')
const selectedScreenshots = reactive({})
const failedImages = reactive(new Set())
const autoLoad = computed(() => store.getters.getGeneralAutoLoadMorePaginatedItemsEnabled)
const autoLoadOptions = computed(() => ({
  callback: loadNextIfVisible,
  intersection: { root: scroller.value },
}))
const installedThemes = computed(() => store.getters.getCustomThemes)
let page = 1
let controller
let observer

function clampScroll() {
  if (scroller.value && content.value) clampOverlayScrollTop(scroller.value, content.value)
}

watch(() => props.open, async (open) => {
  controller?.abort()
  observer?.disconnect()
  if (!open) {
    preview.value = null
    return
  }
  loading.value = true
  await nextTick()
  if (!props.open) return
  restoreOverlayScrollTop(scroller.value, 0)
  observer = new ResizeObserver(clampScroll)
  observer.observe(content.value)
  observer.observe(scroller.value)
  await load(true)
}, { immediate: true })

onBeforeUnmount(() => {
  controller?.abort()
  observer?.disconnect()
})

function loadNextIfVisible(visible) {
  if (visible && props.open && autoLoad.value && hasMore.value && !loading.value && !loadFailed.value) {
    load(false)
  }
}

async function load(refresh) {
  controller?.abort()
  const request = new AbortController()
  controller = request
  loading.value = true
  loadFailed.value = false
  try {
    const result = await loadThemeFeed(refresh ? 1 : page, AbortSignal.any([
      request.signal, AbortSignal.timeout(20_000)
    ]))
    if (request.signal.aborted) return
    if (refresh) {
      entries.value = result.themes
      page = 2
      failedImages.clear()
      for (const key of Object.keys(selectedScreenshots)) delete selectedScreenshots[key]
    } else {
      const ids = new Set(entries.value.map(entry => entry.theme.id))
      entries.value.push(...result.themes.filter(entry => !ids.has(entry.theme.id)))
      page++
    }
    hasMore.value = result.hasMore
  } catch {
    if (!request.signal.aborted) loadFailed.value = true
  } finally {
    if (controller === request) {
      loading.value = false
      await nextTick()
      clampScroll()
    }
  }
}

function currentScreenshot(entry) {
  return selectedScreenshots[entry.theme.id] ?? entry.screenshots[0]
}

function switchPreview(direction) {
  const entry = preview.value
  const index = entry.screenshots.indexOf(currentScreenshot(entry))
  selectedScreenshots[entry.theme.id] = entry.screenshots[
    (index + direction + entry.screenshots.length) % entry.screenshots.length
  ]
}

function installed(entry) {
  return installedThemes.value.some(theme => theme.id === entry.theme.id)
}

function hasUpdate(entry) {
  const saved = installedThemes.value.find(theme => theme.id === entry.theme.id)
  return saved && saved.discussionThemeHash !== entry.theme.discussionThemeHash
}

function active(entry) {
  return store.getters.getBaseTheme === customThemeValue(entry.theme.id)
}

function installLabel(entry) {
  if (installing.value === entry.theme.id) return t('Theme Discovery.Loading')
  if (hasUpdate(entry)) return t('Theme Discovery.Update and Apply')
  if (active(entry)) return t('Theme Discovery.Applied')
  return installed(entry) ? t('Theme Discovery.Apply Theme') : t('Theme Discovery.Install and Apply')
}

async function install(entry) {
  if (installing.value !== null) return
  installing.value = entry.theme.id
  try {
    if (!installed(entry) || hasUpdate(entry)) {
      const themes = await saveCustomTheme(entry.theme)
      await store.dispatch('updateCustomThemes', themes)
    }
    await store.dispatch('updateBaseTheme', customThemeValue(entry.theme.id))
    showToast({ message: t('Settings.Theme Settings.Custom Theme.Theme Saved'), icon: ['fas', 'check'] })
  } catch {
    showToast({ message: t('Settings.Theme Settings.Custom Theme.Unable to Save'), icon: ['fas', 'triangle-exclamation'] })
  } finally {
    installing.value = null
  }
}
</script>

<style scoped>
.themeDiscovery {
  display: flex;
  flex-direction: column;
  block-size: 100%;
  min-block-size: 0;
}

.discoveryToolbar {
  display: flex;
  justify-content: flex-end;
}

.discoveryToolbar {
  flex-shrink: 0;
  padding: 16px;
}

.discoveryMessage {
  padding-block: 24px;
  text-align: center;
}

.discoveryScroller {
  flex: 1;
  min-block-size: 0;
  overflow-y: auto;
  padding: 0 16px 16px;
}

.themeGallery {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 1fr));
  gap: 20px;
}

.themeCard {
  display: flex;
  flex-direction: column;
  min-inline-size: 0;
  border: 1px solid var(--border-color);
  border-radius: calc(8px * var(--ui-roundness));
  background: var(--card-bg-color);
}

.themePreview {
  flex-shrink: 0;
  aspect-ratio: 16 / 9;
  display: grid;
  place-items: center;
  background: var(--bg-color);
  border-radius: inherit;
}

.themePreview button,
.themePreview img {
  display: block;
  inline-size: 100%;
  block-size: 100%;
  border-radius: inherit;
}

.themePreview button {
  padding: 0;
  border: 0;
  background: transparent;
  cursor: zoom-in;
}

.screenshotHeader {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 16px;
  margin-block-end: 16px;
}

.screenshotHeader h2 {
  flex: 1;
  min-inline-size: 0;
  margin: 0;
  overflow-wrap: anywhere;
}

.fullScreenshotStage {
  display: grid;
  place-items: center;
  block-size: max(120px, calc(90dvh - 150px));
}

.fullThemeScreenshot {
  display: block;
  inline-size: 100%;
  block-size: 100%;
  min-block-size: 0;
  object-fit: contain;
}

.screenshotNavigation {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
}

.themeScreenshot-enter-active,
.themeScreenshot-leave-active {
  transition: opacity 120ms ease;
}

.themeScreenshot-enter-from,
.themeScreenshot-leave-to {
  opacity: 0;
}

.themePreview img {
  aspect-ratio: 16 / 9;
  object-fit: contain;
}

.screenshotChoices {
  display: flex;
  flex-shrink: 0;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  padding: 8px;
}

.screenshotChoices button {
  transition: background-color 120ms ease, color 120ms ease;
  min-inline-size: 36px;
  min-block-size: 36px;
  border: 1px solid var(--border-color);
  border-radius: calc(4px * var(--ui-roundness));
  background: var(--card-bg-color);
  color: var(--primary-text-color);
  cursor: pointer;
}

.screenshotChoices button[aria-pressed='true'] {
  background: var(--accent-color);
  color: var(--text-with-accent-color);
}

.screenshotChoices button:hover {
  background: var(--side-nav-hover-color);
  color: var(--side-nav-hover-text-color);
}

.screenshotChoices button[aria-pressed='true']:hover {
  background: color-mix(in oklab, var(--accent-color) 88%, white);
  color: var(--text-with-accent-color);
}

.screenshotChoices button:focus-visible,
.themePreview button:focus-visible {
  outline: 2px solid var(--accent-color);
  outline-offset: 2px;
}

.themeDetails {
  display: flex;
  flex: 1;
  flex-direction: column;
  padding: 16px;
  overflow-wrap: anywhere;
}

.themeDetails > a {
  align-self: flex-start;
}

.themeDetails h2 {
  margin-block: 0 8px;
  font-size: 1.2em;
}

.themeDetails p {
  white-space: pre-line;
}

.themeActions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-block-start: auto;
  padding-block-start: 16px;
}

.themeActions .btn {
  min-inline-size: 0;
  block-size: auto;
  margin: 0;
  padding-inline: 10px;
  white-space: normal;
}

.loadMore {
  margin-block-start: 20px;
  margin-inline: auto;
}

.themeAutoLoadSentinel {
  block-size: 1px;
}
@media (prefers-reduced-motion: reduce) {
  .themeScreenshot-enter-active,
  .themeScreenshot-leave-active,
  .screenshotChoices button {
    transition: none;
  }
}
</style>
