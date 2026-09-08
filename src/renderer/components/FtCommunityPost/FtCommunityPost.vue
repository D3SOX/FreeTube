<template>
  <div
    class="ft-list-post ft-list-item outside"
    :appearance="appearance"
    :class="{ list: listType === 'list', grid: listType === 'grid' }"
  >
    <div
      class="author-div"
    >
      <template
        v-if="authorThumbnail"
      >
        <component
          :is="enableChannelLinks ? 'router-link' : 'div'"
          v-if="authorId"
          :to="`/channel/${authorId}`"
          class="authorThumbnailLink"
          tabindex="-1"
          aria-hidden="true"
        >
          <img
            :src="authorThumbnail"
            class="communityThumbnail"
            alt=""
          >
        </component>
        <img
          v-else
          :src="authorThumbnail"
          class="communityThumbnail"
          alt=""
        >
      </template>
      <p
        class="authorName"
        dir="auto"
      >
        <FtNewContentDot v-if="showNewSubscriptionFeedIndicator" />
        <router-link
          v-if="authorId && enableChannelLinks"
          :to="`/channel/${authorId}`"
          class="authorNameLink"
        >
          {{ author }}
        </router-link>
        <template
          v-else
        >
          {{ author }}
        </template>
      </p>
      <p
        class="publishedText"
      >
        {{ publishedText }}
      </p>
    </div>
    <p
      v-safer-html="postText"
      class="postText"
      dir="auto"
    />
    <swiper-container
      v-if="postType === 'multiImage' && postContent.content.length > 0"
      ref="swiperContainerRef"
      :init="false"
      class="sliderContainer"
    >
      <swiper-slide
        v-for="(img, index) in postContent.content"
        :key="index"
        lazy="true"
      >
        <img
          :src="getBestQualityImage(img, { preserveYouTubeCrop: true })"
          class="communityImage"
          alt=""
          loading="lazy"
          @error="removeImagePreloader"
        >
      </swiper-slide>
    </swiper-container>
    <div
      v-if="postType === 'image' && postContent.content.length > 0"
    >
      <img
        :src="getBestQualityImage(postContent.content)"
        class="communityImage"
        alt=""
      >
    </div>
    <div
      v-if="postType === 'video'"
    >
      <FtListVideo
        v-if="!hideVideo"
        :data="data.postContent.content"
        appearance=""
        force-list-type="grid"
      />
      <p
        v-else
        class="hiddenVideo"
      >
        {{ '[' + $t('Channel.Posts.Video hidden by OpenTubeX') + ']' }}
      </p>
    </div>
    <div
      v-if="postType === 'poll' || postType === 'quiz'"
    >
      <FtCommunityPoll :data="postContent" />
    </div>
    <div
      v-if="postType === 'playlist'"
      class="playlistWrapper"
    >
      <FtListPlaylist
        :data="postContent.content"
        :appearance="appearance"
      />
    </div>
    <div
      class="bottomSection"
    >
      <span
        class="likeCount"
        :title="$t('Global.Counts.Like Count', {count: formattedVoteCount}, voteCount)"
        :aria-label="$t('Global.Counts.Like Count', {count: formattedVoteCount}, voteCount)"
      >
        <FtIcon
          class="thumbs-up-icon"
          :icon="['fas', 'thumbs-up']"
          aria-hidden="true"
        /> {{ formattedVoteCount }}</span>
      <router-link
        v-if="!singlePost"
        :to="{
          path: `/post/${postId}`,
          query: authorId ? { authorId } : undefined
        }"
        class="commentsLink"
        :aria-label="$t('Channel.Posts.View Full Post')"
      >
        <span
          v-if="!hideComments"
          class="commentCount"
          :title="$t('Global.Counts.Comment Count', {count: formattedCommentCount}, commentCount)"
          :aria-label="$t('Global.Counts.Comment Count', {count: formattedCommentCount}, commentCount)"
        >
          <FtIcon
            class="comment-count-icon"
            :icon="['fas', 'comment']"
            aria-hidden="true"
          /> {{ formattedCommentCount }}</span>
      </router-link>
      <FtShareButton
        v-if="!hideSharingActions"
        :id="postId"
        share-target-type="Post"
        class="shareButton"
        :size="18"
      />
      <FtIconButton
        v-if="hideSubscriptionFeedTypeOption"
        :icon="['fas', 'ellipsis-v']"
        :title="$t('Video.More Options')"
        theme="base-no-default"
        :size="18"
        :use-shadow="false"
        dropdown-position-x="right"
        :dropdown-options="[hideSubscriptionFeedTypeOption]"
        @click="hideSubscriptionFeedType"
      />
    </div>
  </div>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import autolinker from 'autolinker'
import { computed, onActivated, onMounted, useTemplateRef } from 'vue'

import FtListVideo from '../FtListVideo/FtListVideo.vue'
import FtListPlaylist from '../FtListPlaylist/FtListPlaylist.vue'
import FtCommunityPoll from '../FtCommunityPoll/FtCommunityPoll.vue'
import FtNewContentDot from '../FtNewContentDot/FtNewContentDot.vue'
import FtShareButton from '../FtShareButton/FtShareButton.vue'
import FtIconButton from '../FtIconButton/FtIconButton.vue'
import { useHideSubscriptionFeedType } from '../../composables/useHideSubscriptionFeedType'
import { vSaferHtml } from '../../directives/vSaferHtml.js'

import store from '../../store/index'

import {
  createWebURL,
  formatNumber,
  getRelativeTimeFromDate,
} from '../../helpers/utils'
import { youtubeImageUrlToInvidious } from '../../helpers/api/invidious'
import { useRelativeTimeClock } from '../../composables/useRelativeTimeClock'
import { loadSwiperModules } from './swiperLoader'

const props = defineProps({
  data: {
    type: Object,
    required: true
  },
  appearance: {
    type: String,
    required: true
  },
  hideForbiddenTitles: {
    type: Boolean,
    default: true
  },
  singlePost: {
    type: Boolean,
    default: false
  },
})

const relativeTimeNow = useRelativeTimeClock()
const { hideSubscriptionFeedType, hideSubscriptionFeedTypeOption } = useHideSubscriptionFeedType(() => props.data.authorId, true)

/** @type {import('vue').ComputedRef<'grid' | 'list'>} */
const listType = computed(() => {
  return store.getters.getListType
})

/** @type {import('vue').ComputedRef<string[]>} */
const forbiddenTitles = computed(() => {
  if (!props.hideForbiddenTitles) { return [] }
  return store.getters.getForbiddenTitlesParsed
})

const hideVideo = computed(() => {
  return forbiddenTitles.value.some((text) => props.data.postContent.content.title?.toLowerCase().includes(text))
})

/** @type {import('vue').ComputedRef<boolean>} */
const hideSharingActions = computed(() => store.getters.getHideSharingActions)

const showNewSubscriptionFeedIndicator = computed(() => {
  return store.getters.getShowNewSubscriptionFeedIndicators &&
    props.data.isNewInSubscriptionFeed === true &&
    props.data.hideNewSubscriptionFeedIndicator !== true
})

/** @type {import('vue').ComputedRef<'local' | 'invidious'>} */
const backendPreference = computed(() => {
  return store.getters.getBackendPreference
})

/** @type {import('vue').ComputedRef<boolean>} */
const hideComments = computed(() => {
  return store.getters.getHideComments
})

let postType = ''
let postText = ''
let postId = ''
let authorThumbnail = ''
let postContent = ''
let author = ''
let authorId = ''
let voteCount = 0
/** @type {number?} */
let commentCount = null

parseCommunityData()

const formattedCommentCount = computed(() => {
  if (commentCount != null) {
    return formatNumber(commentCount)
  }

  return ''
})

const formattedVoteCount = computed(() => {
  return formatNumber(voteCount)
})

const publishedText = computed(() => {
  if (props.data.publishedTime) {
    return getRelativeTimeFromDate(props.data.publishedTime, false, true, relativeTimeNow.value)
  }

  return ''
})

function parseCommunityData() {
  if ('backstagePostThreadRenderer' in props.data) {
    postText = 'Shared post'
    postType = 'text'

    authorThumbnail = 'https://yt3.ggpht.com/ytc/AAUvwnjm-0qglHJkAHqLFsCQQO97G7cCNDuDLldsrn25Lg=s88-c-k-c0x00ffffff-no-rj'

    if (!process.env.SUPPORTS_LOCAL_API || backendPreference.value === 'invidious') {
      authorThumbnail = youtubeImageUrlToInvidious(authorThumbnail)
    }

    return
  }

  postText = autolinker.link(props.data.postText)
  postContent = props.data.postContent
  postId = props.data.postId
  voteCount = props.data.voteCount
  commentCount = props.data.commentCount
  postType = props.data.postContent?.type ?? 'text'
  author = props.data.author
  authorId = props.data.authorId

  authorThumbnail = getBestQualityImage(props.data.authorThumbnails)

  if (!process.env.SUPPORTS_LOCAL_API || backendPreference.value === 'invidious') {
    authorThumbnail = youtubeImageUrlToInvidious(authorThumbnail)
  } else if (authorThumbnail.startsWith('//')) {
    authorThumbnail = 'https:' + authorThumbnail
  }
}

/**
 * @param {{ width: number, height: number, url: string }[]} imageArray
 * @param {{ preserveYouTubeCrop?: boolean }} [options]
 */
function getBestQualityImage(imageArray, options = {}) {
  const imageArrayCopy = Array.from(imageArray)
  imageArrayCopy.sort((a, b) => {
    return Number.parseInt(b.width) - Number.parseInt(a.width)
  })

  const url = imageArrayCopy[0]?.url ?? ''

  // Multi-image carousels match YouTube's square CDN crops. Single-image
  // posts show the full frame (YouTube omits fcrop64 for those).
  if (options.preserveYouTubeCrop) {
    return url
  }

  return url.replace(/-c-fcrop64=[^-]+/i, '')
}

/**
 * Swiper only removes its lazy preloader after an image load event. Failed
 * requests can therefore leave it visible indefinitely.
 *
 * @param {Event} event
 */
function removeImagePreloader(event) {
  const image = event.currentTarget
  if (!(image instanceof HTMLElement)) {
    return
  }

  const slide = image.closest('swiper-slide')
  const preloader = slide?.querySelector('.swiper-lazy-preloader') ??
    slide?.shadowRoot?.querySelector('.swiper-lazy-preloader')
  preloader?.remove()
}

const swiperContainerRef = useTemplateRef('swiperContainerRef')
let swiperInitializationPromise = null

async function initializeSwiper() {
  const existingSwiper = swiperContainerRef.value?.swiper
  if (swiperInitializationPromise || (existingSwiper && !existingSwiper.destroyed)) {
    return
  }

  swiperInitializationPromise = loadSwiperModules()

  try {
    const { A11y, Navigation, Pagination } = await swiperInitializationPromise
    /** @type {import('swiper/element').SwiperContainer|null} */
    const swiperContainer = swiperContainerRef.value
    if (!swiperContainer?.isConnected || (swiperContainer.swiper && !swiperContainer.swiper.destroyed)) {
      return
    }

    const swiperOptions = {
      modules: [A11y, Navigation, Pagination],

      injectStylesUrls: [
        // This file is created with the copy webpack plugin in the web and renderer webpack configs.
        // If you add more modules, please remember to add their CSS files to the list in webpack config files.
        createWebURL(`/swiper-${process.env.SWIPER_VERSION}.css`)
      ],

      a11y: true,
      navigation: true,
      pagination: {
        enabled: true,
        clickable: true
      },
      slidesPerView: 1
    }

    Object.assign(swiperContainer, swiperOptions)
    swiperContainer.initialize()
  } catch (error) {
    console.error('Failed to initialize community post carousel', error)
  } finally {
    swiperInitializationPromise = null
  }
}

if (postType === 'multiImage' && postContent.content.length > 0) {
  onMounted(initializeSwiper)
  onActivated(initializeSwiper)
}

const enableChannelLinks = computed(() => !store.getters.getDisableChannelLinks)
</script>

<style scoped src="./FtCommunityPost.scss" lang="scss" />
