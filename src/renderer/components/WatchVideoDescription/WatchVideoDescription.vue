<template>
  <FtCard
    v-if="shownDescription.length > 0 || tags.length > 0 || games.length > 0"
    ref="descriptionCard"
    :class="{
      videoDescription: true,
      short: !isExpanded,
      alwaysExpanded
    }"
  >
    <FtIconButton
      v-if="shownDescription.length > 0 && !previewOnly"
      ref="descriptionCopyButton"
      class="descriptionCopyButton"
      :title="t('Description.Copy Description')"
      :icon="['fas', 'copy']"
      theme="base"
      @click="copyDescription"
    />
    <span
      v-if="showControls && !isExpanded && !alwaysExpanded"
      ref="expandDescriptionControl"
      :class="{
        descriptionStatus: true,
        avoidCopyButton: copyButtonOverlapsExpandControl
      }"
      role="button"
      tabindex="0"
      @click="expandDescription"
      @keydown.enter.space.prevent="expandDescription"
    >
      {{ $t("Description.Expand Description") }}
    </span>
    <div
      ref="descriptionScroll"
      v-overlay-scrollbars="!alwaysExpanded"
      class="descriptionScroll"
      :class="{ descriptionFadeTop }"
      @scroll="updateDescriptionFadeState"
    >
      <FtTimestampCatcher
        ref="descriptionContainer"
        class="description"
        :input-html="processedShownDescription"
        :role="previewOnly ? 'button' : null"
        :tabindex="previewOnly ? 0 : null"
        :link-tab-index="linkTabIndex"
        @keydown.enter.space="previewOnly && ( $event.preventDefault(), expandDescription() )"
        @timestamp-event="onTimestamp"
        @click="expandDescriptionWithClick"
      />
      <bdi
        v-if="license && isExpanded"
        class="license"
      >
        {{ license }}
      </bdi>
      <template v-if="games.length > 0 && isExpanded">
        <h3 class="gamesHeading">
          {{ $t("Description.Games") }}
        </h3>
        <ul class="gameList">
          <li
            v-for="(game, index) in shownGames"
            :key="game.channelId ?? index"
          >
            <component
              :is="game.channelId ? 'RouterLink' : 'div'"
              :to="`/channel/${game.channelId}`"
              :tabindex="game.channelId ? linkTabIndex : null"
              class="game"
            >
              <img
                v-if="game.thumbnail"
                :src="game.thumbnail"
                class="gameBoxArt"
                alt=""
                loading="lazy"
              >
              <span class="gameText">
                <bdi class="gameTitle">{{ game.title }}</bdi>
                <bdi
                  v-if="game.subtitle"
                  class="gameSubtitle"
                >{{ game.subtitle }}</bdi>
              </span>
            </component>
          </li>
        </ul>
      </template>
      <div
        v-if="tags.length > 0 && isExpanded"
        class="videoTags"
      >
        <strong>{{ t('Description.Video Tags') }}</strong>
        <ul class="videoTagList">
          <li
            v-for="tag in tags"
            :key="tag"
            class="videoTag"
            dir="auto"
          >
            <router-link
              v-if="!hideSearchBar"
              class="videoTagLink"
              :title="$t('Channel.About.Tags.Search for', { tag })"
              :to="{
                path: `/search/${encodeURIComponent(tag)}`,
                query: searchSettings
              }"
              :tabindex="linkTabIndex"
            >
              {{ tag }}
            </router-link>
            <span
              v-else
              class="videoTagLink"
            >
              {{ tag }}
            </span>
          </li>
        </ul>
      </div>
      <span
        v-if="showControls && isExpanded && !alwaysExpanded"
        class="descriptionStatus"
        role="button"
        tabindex="0"
        @click="collapseDescription"
        @keydown.enter.space.prevent="collapseDescription"
      >
        {{ $t("Description.Collapse Description") }}
      </span>
    </div>
  </FtCard>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref, computed, nextTick, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import FtCard from '../ft-card/ft-card.vue'
import FtIconButton from '../FtIconButton/FtIconButton.vue'
import FtTimestampCatcher from '../FtTimestampCatcher.vue'

import { linkifyDescription, linkifyHashtagsAndHandles } from '../../helpers/descriptionLinks'
import { copyToClipboard } from '../../helpers/utils'
import { useTabContext } from '../../tabs/TabContext'

import store from '../../store/index'

const props = defineProps({
  description: {
    type: String,
    default: ''
  },
  descriptionHtml: {
    type: String,
    default: ''
  },
  tags: {
    type: Array,
    default: () => [],
  },
  license: {
    type: String,
    default: null,
  },
  /** @type {import('vue').PropType<import('../../helpers/video-games').LocalVideoGame[]>} */
  games: {
    type: Array,
    default: () => [],
  },
  previewOnly: { type: Boolean, default: false },
  alwaysExpanded: {
    type: Boolean,
    default: false,
  }
})

const emit = defineEmits(['timestamp-event', 'expand'])
const { t } = useI18n()

let shownDescription = ''
let descriptionText = props.description
const descriptionScroll = useTemplateRef('descriptionScroll')
const descriptionContainer = useTemplateRef('descriptionContainer')
const descriptionCard = useTemplateRef('descriptionCard')
const descriptionCopyButton = useTemplateRef('descriptionCopyButton')
const expandDescriptionControl = useTemplateRef('expandDescriptionControl')
const showFullDescription = ref(false)
const showControls = ref(false)
const descriptionFadeTop = ref(false)
const copyButtonOverlapsExpandControl = ref(false)
// a video can have games but no description, and there is nothing to expand or collapse then,
// so treat it as expanded. `measureDescription` can't do it, it bails out on a zero height element.
const isExpanded = computed(() => props.alwaysExpanded || shownDescription === '' || showFullDescription.value)

if (props.descriptionHtml !== '') {
  const parsed = parseDescriptionHtml(props.descriptionHtml)

  // the invidious API returns emtpy html elements when the description is empty
  // so we need to parse it to see if there is any meaningful text in the html
  // or if it's just empty html elements e.g. `<p></p>`

  const testDiv = document.createElement('div')
  testDiv.innerHTML = parsed

  if (!/^\s*$/.test(testDiv.innerText)) {
    descriptionText ||= testDiv.innerText
    shownDescription = linkifyHashtagsAndHandles(parsed)
  }
} else {
  if (!/^\s*$/.test(props.description)) {
    shownDescription = linkifyDescription(props.description)
  }
}

const processedShownDescription = computed(() => {
  if (shownDescription === '') { return shownDescription }

  return processDescriptionHtml(shownDescription, linkTabIndex.value)
})

const linkTabIndex = computed(() => {
  return isExpanded.value ? '0' : '-1'
})

// drop the channel ids when channel links are disabled, so that the games render as plain text
const shownGames = computed(() => {
  if (!store.getters.getDisableChannelLinks) {
    return props.games
  }

  return props.games.map(game => ({ ...game, channelId: undefined }))
})

/**
 * @param {number} timestamp
 */
function onTimestamp(timestamp) {
  emit('timestamp-event', timestamp)
}

async function copyDescription() {
  await copyToClipboard(descriptionText, {
    messageOnSuccess: t('Description.Description Copied')
  })
}

/**
 @param {PointerEvent} e
 */
function expandDescriptionWithClick(e) {
  // Ignore link clicks
  if (props.alwaysExpanded || e.target.tagName === 'A') { return }

  expandDescription()
}

/**
 * Enables user to view entire contents of description
 */
function expandDescription() {
  if (props.previewOnly) { emit('expand'); return }
  showFullDescription.value = true
}

/**
 * Enables user to collapse contents of description
 */
function collapseDescription() {
  descriptionScroll.value.scrollTop = 0
  showFullDescription.value = false
}

const { tabId: injectedTabId, isTabPresented } = useTabContext()
const tabId = injectedTabId ?? 'web'

const hideSearchBar = computed(() => store.getters.getHideSearchBar)
const searchSettings = computed(() => store.getters.getSearchSettings(tabId))

let hasMeasured = false

/**
 * Returns true when description content does not overflow description container
 * Useful for hiding description expansion/contraction controls
 */
function isShortDescription() {
  const descriptionElem = descriptionContainer.value?.$el
  return descriptionElem?.clientHeight >= descriptionElem?.scrollHeight
}

// To verify whether or not the description is too short for displaying
// description controls, we need to check the description's dimensions.
// A tab can mount while it isn't the one on screen (background preload, session
// restore), in which case it is `display: none` and every dimension reads 0,
// which would misdetect the description as short and leave it permanently
// expanded with no collapse control. Only measure once the element has a real
// layout, retrying when the tab is first presented.
function measureDescription() {
  if (hasMeasured || props.alwaysExpanded) {
    return
  }

  const descriptionElem = descriptionContainer.value?.$el
  if (!descriptionElem || (descriptionElem.clientHeight === 0 && descriptionElem.scrollHeight === 0)) {
    return
  }

  showFullDescription.value = isShortDescription()
  showControls.value = !showFullDescription.value
  hasMeasured = true

  nextTick(updateDescriptionLayout)
}

function updateExpandControlPosition() {
  const copyButtonElement = descriptionCopyButton.value?.$el
  const expandControlElement = expandDescriptionControl.value

  if (!copyButtonElement || !expandControlElement) {
    copyButtonOverlapsExpandControl.value = false
    return
  }

  const copyButtonRect = copyButtonElement.getBoundingClientRect()
  const expandControlRect = expandControlElement.getBoundingClientRect()
  const collisionOffset = copyButtonOverlapsExpandControl.value
    ? (getComputedStyle(expandControlElement).direction === 'rtl' ? -40 : 40)
    : 0
  copyButtonOverlapsExpandControl.value = (
    expandControlRect.top < copyButtonRect.bottom &&
    expandControlRect.bottom > copyButtonRect.top &&
    expandControlRect.left + collisionOffset < copyButtonRect.right &&
    expandControlRect.right + collisionOffset > copyButtonRect.left
  )
}

function updateDescriptionLayout() {
  updateDescriptionFadeState()
  updateExpandControlPosition()
}

let descriptionResizeObserver = null

onMounted(() => {
  measureDescription()

  descriptionResizeObserver = new ResizeObserver(updateDescriptionLayout)
  if (descriptionScroll.value) {
    descriptionResizeObserver.observe(descriptionScroll.value)
  }

  const descriptionCardElement = descriptionCard.value?.$el
  if (descriptionCardElement) {
    descriptionResizeObserver.observe(descriptionCardElement)
  }

  nextTick(updateDescriptionLayout)
})

onBeforeUnmount(() => descriptionResizeObserver?.disconnect())

watch(isExpanded, () => nextTick(updateDescriptionLayout))

watch(() => props.alwaysExpanded, (alwaysExpanded, wasAlwaysExpanded) => {
  if (!alwaysExpanded && wasAlwaysExpanded) {
    nextTick(measureDescription)
  }
})

if (isTabPresented) {
  watch(isTabPresented, (presented) => {
    if (presented) {
      nextTick(measureDescription)
    }
  })
}

function updateDescriptionFadeState() {
  descriptionFadeTop.value = (descriptionScroll.value?.scrollTop ?? 0) > 1
}

/**
 * @param {string} descriptionText
 * @returns {string}
 */
function parseDescriptionHtml(descriptionText) {
  return descriptionText
    .replaceAll('target="_blank"', '')
    .replaceAll(/\/redirect.+?(?=q=)/g, '')
    .replaceAll('q=', '')
    .replaceAll(/rel="nofollow\snoopener"/g, '')
    .replaceAll(/class=.+?(?=")./g, '')
    .replaceAll(/id=.+?(?=")./g, '')
    .replaceAll(/data-target-new-window=.+?(?=")./g, '')
    .replaceAll(/data-url=.+?(?=")./g, '')
    .replaceAll(/data-sessionlink=.+?(?=")./g, '')
    .replaceAll('&amp;', '&')
    .replaceAll('%3A', ':')
    .replaceAll('%2F', '/')
    .replaceAll(/&v.+?(?=")/g, '')
    .replaceAll(/&redirect-token.+?(?=")/g, '')
    .replaceAll(/&redir_token.+?(?=")/g, '')
    .replaceAll('href="/', 'href="https://www.youtube.com/')
    .replaceAll('href="/hashtag/', 'href="https://wwww.youtube.com/hashtag/')
    .replaceAll('yt.www.watch.player.seekTo', 'changeDuration')
}

/**
 * @param {string} descriptionText
 * @param {string} tabIndex
 * @returns {string}
 */
function processDescriptionHtml(descriptionText, tabIndex) {
  return descriptionText
    .replaceAll('<a', `<a tabindex="${tabIndex}"`)
}
</script>

<style scoped src="./WatchVideoDescription.css" />
