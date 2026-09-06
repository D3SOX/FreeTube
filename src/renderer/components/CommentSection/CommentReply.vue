<template>
  <div
    :id="`comment${threadIndex}-${node.index}`"
    class="commentReplyBranch"
    :class="{
      commentReplyBranchRoot: rootLevel,
      highlightedCommentBranch: reply.id === highlightedCommentId
    }"
  >
    <component
      :is="canToggleParent ? 'button' : 'span'"
      class="commentReplyConnector"
      :class="{ commentReplyConnectorToggle: canToggleParent }"
      :type="canToggleParent ? 'button' : undefined"
      :aria-hidden="canToggleParent ? undefined : true"
      :aria-label="canToggleParent ? parentToggleLabel : undefined"
      :tabindex="canToggleParent ? -1 : undefined"
      @click="canToggleParent && emit('toggle-parent')"
      @keydown.space.stop
      @keyup.space.stop
    />
    <button
      v-if="hasReplyChildren && !filtering"
      type="button"
      class="commentThreadLineToggle commentReplyLineToggle"
      :aria-label="replyToggleLabel"
      :aria-expanded="showReplyChildren"
      @click="toggleReplyChildren"
      @keydown.space.stop
      @keyup.space.stop
    />
    <div
      class="comment commentReplyContent"
      :class="{ highlightedComment: reply.id === highlightedCommentId }"
    >
      <p
        v-if="reply.id === highlightedCommentId"
        class="highlightedCommentBadge"
      >
        {{ $t('Comments.Highlighted reply') }}
      </p>
      <span
        v-if="hasReplyChildren"
        class="commentReplyChildStem"
        aria-hidden="true"
      />
      <component
        :is="enableChannelLinks ? 'router-link' : 'div'"
        :to="`/channel/${reply.authorLink}`"
        tabindex="-1"
      >
        <div
          v-if="!reply.authorThumb || (hideCommentPhotos && !reply.isOwner)"
          class="commentThumbnailHidden"
          dir="auto"
        >
          {{ reply.author.substring(1, 2) }}
        </div>
        <FtRetryImage
          v-else
          :src="reply.authorThumb"
          class="commentThumbnail"
        />
      </component>
      <p
        v-if="isPersonallyPinned"
        class="commentPinned commentPersonalPin"
      >
        <FtIcon
          :icon="['fas', 'thumbtack']"
          aria-hidden="true"
        />
        {{ $t('Comments.Pinned by you') }}
      </p>
      <p class="commentAuthorWrapper">
        <component
          :is="enableChannelLinks ? 'router-link' : 'span'"
          class="commentAuthor"
          dir="auto"
          :class="{ commentOwner: reply.isOwner }"
          :to="`/channel/${reply.authorLink}`"
        >
          <template
            v-for="(segment, segmentIndex) in authorSearchSegments"
            :key="segmentIndex"
          >
            <mark v-if="segment.highlighted">{{ segment.text }}</mark>
            <template v-else>
              {{ segment.text }}
            </template>
          </template>
        </component>
        <img
          v-if="reply.isMember"
          :src="reply.memberIconUrl"
          class="commentMemberIcon"
          alt=""
        >
        <img
          v-if="subscribedChannelIds.has(reply.authorId)"
          :title="$t('Comments.Subscribed')"
          :aria-label="$t('Comments.Subscribed')"
          class="commentSubscribedIcon"
          alt=""
        >
        <span class="commentDate">
          {{ formatCommentTime(reply) }}
          <template v-if="reply.isEdited">
            {{ $t("Comments.Edited") }}
          </template>
        </span>
        <button
          type="button"
          class="commentPinButton"
          :class="{ active: isPersonallyPinned }"
          :title="personalPinActionLabel"
          :aria-label="personalPinActionLabel"
          :aria-pressed="isPersonallyPinned"
          @click="emit('toggle-personal-pin', reply.id)"
        >
          <FtIcon
            :icon="['fas', isPersonallyPinned ? 'thumbtack-slash' : 'thumbtack']"
          />
        </button>
        <button
          type="button"
          class="commentCopyLink"
          :title="$t('Video.Copy YouTube Link')"
          :aria-label="$t('Video.Copy YouTube Link')"
          @click="emit('copy-youtube-link', reply.id)"
        >
          <FtIcon :icon="['fas', 'link']" />
        </button>
      </p>
      <FtTimestampCatcher
        class="commentText"
        :input-html="reply.showTranslated && reply.translatedLanguage === translationLanguage
          ? reply.translatedText
          : reply.text"
        :highlight="highlight"
        @timestamp-event="emit('timestamp-event', $event)"
      />
      <CommentTranslationButton
        v-if="translationEnabled && reply.translationText"
        :comment="reply"
        :loading="loadingTranslationIds.has(reply.id)"
        :target-language="translationLanguage"
        :target-language-name="translationLanguageName"
        :ignored-languages="commentTranslationIgnoredLanguages"
        @translate-comment="emit('translate-comment', $event)"
        @translation-unavailable="emit('translation-unavailable', $event)"
      />
      <p class="commentLikeCount">
        <template v-if="!hideCommentLikes">
          <FtIcon :icon="['fas', 'thumbs-up']" />
          {{ formatViewCount(reply.likes, shortenViewCounts) }}
        </template>
        <span
          v-if="reply.isHearted"
          class="commentHeartBadge"
        >
          <img
            :src="channelThumbnail"
            :title="$t('Comments.Hearted')"
            :aria-label="$t('Comments.Hearted')"
            class="commentHeartBadgeImg"
            alt=""
          >
          <FtIcon
            :icon="['fas', 'heart']"
            class="commentHeartBadgeWhite"
          />
          <FtIcon
            :icon="['fas', 'heart']"
            class="commentHeartBadgeRed"
          />
        </span>
      </p>
    </div>
    <div
      v-if="hasReplyChildren"
      class="commentReplyChildren"
    >
      <template v-if="showReplyChildren">
        <CommentReply
          v-for="child in node.children"
          :key="child.reply.id"
          :node="child"
          :thread-index="threadIndex"
          :enable-channel-links="enableChannelLinks"
          :hide-comment-likes="hideCommentLikes"
          :hide-comment-photos="hideCommentPhotos"
          :subscribed-channel-ids="subscribedChannelIds"
          :channel-thumbnail="channelThumbnail"
          :loading-reply-ids="loadingReplyIds"
          :loading-translation-ids="loadingTranslationIds"
          :translation-enabled="translationEnabled"
          :translation-language="translationLanguage"
          :translation-language-name="translationLanguageName"
          :comment-translation-ignored-languages="commentTranslationIgnoredLanguages"
          :highlighted-comment-id="highlightedCommentId"
          :highlight="highlight"
          :personal-pinned-comment-ids="personalPinnedCommentIds"
          :filtering="filtering"
          :shorten-view-counts="shortenViewCounts"
          :parent-toggle-label="replyToggleLabel"
          :can-toggle-parent="!filtering"
          @toggle-parent="toggleReplyChildren"
          @replies-toggled="emit('replies-toggled')"
          @copy-youtube-link="emit('copy-youtube-link', $event)"
          @get-more-replies="emit('get-more-replies', $event)"
          @toggle-personal-pin="emit('toggle-personal-pin', $event)"
          @timestamp-event="emit('timestamp-event', $event)"
          @translate-comment="emit('translate-comment', $event)"
          @translation-unavailable="emit('translation-unavailable', $event)"
        />
        <div
          v-if="!filtering && (loadingReplyIds.has(reply.id) || (reply.dataType === 'local' && reply.hasReplyToken))"
          class="commentReplyContinuation"
        >
          <button
            type="button"
            class="commentReplyContinuationButton"
            :disabled="loadingReplyIds.has(reply.id)"
            @click="emit('get-more-replies', reply.id)"
          >
            <FtSpinner
              v-if="loadingReplyIds.has(reply.id)"
              inline
              size="18px"
              border-width="2px"
              :label="$t('Comments.Getting comment replies, please wait')"
            />
            <template v-else>
              <span>{{ $t("Comments.Show More Replies") }}</span>
              <FtIcon
                :icon="['fas', 'angle-down']"
                aria-hidden="true"
              />
            </template>
          </button>
        </div>
      </template>
      <div
        v-if="!filtering"
        class="commentReplyContinuation"
      >
        <button
          type="button"
          class="commentReplyContinuationButton"
          :aria-expanded="showReplyChildren"
          @click="toggleReplyChildren"
          @keydown.space.stop
          @keyup.space.stop
        >
          <span>{{ replyToggleLabel }}</span>
          <FtIcon
            :icon="['fas', showReplyChildren ? 'angle-up' : 'angle-down']"
            aria-hidden="true"
          />
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import FtTimestampCatcher from '../FtTimestampCatcher.vue'
import CommentTranslationButton from './CommentTranslationButton.vue'
import FtRetryImage from '../FtRetryImage.vue'
import FtSpinner from '../FtSpinner/FtSpinner.vue'
import { useRelativeTimeClock } from '../../composables/useRelativeTimeClock'
import { formatViewCount, getRelativeTimeFromDate } from '../../helpers/utils'
import { getCommentReplyCount } from '../../helpers/comment-replies'

const { t } = useI18n()

const props = defineProps({
  node: {
    type: Object,
    required: true
  },
  threadIndex: {
    type: Number,
    required: true
  },
  rootLevel: {
    type: Boolean,
    default: false
  },
  parentToggleLabel: {
    type: String,
    required: true
  },
  canToggleParent: {
    type: Boolean,
    required: true
  },
  enableChannelLinks: {
    type: Boolean,
    required: true
  },
  hideCommentLikes: {
    type: Boolean,
    required: true
  },
  hideCommentPhotos: {
    type: Boolean,
    required: true
  },
  subscribedChannelIds: {
    type: Set,
    required: true
  },
  channelThumbnail: {
    type: String,
    required: true
  },
  loadingReplyIds: {
    type: Set,
    required: true
  },
  loadingTranslationIds: {
    type: Set,
    required: true
  },
  translationEnabled: {
    type: Boolean,
    required: true
  },
  translationLanguage: {
    type: String,
    required: true
  },
  translationLanguageName: {
    type: String,
    required: true
  },
  commentTranslationIgnoredLanguages: {
    type: Array,
    required: true
  },
  highlightedCommentId: {
    type: String,
    default: null
  },
  highlight: {
    type: String,
    default: ''
  },
  personalPinnedCommentIds: {
    type: Set,
    required: true
  },
  filtering: {
    type: Boolean,
    required: true
  },
  shortenViewCounts: {
    type: Boolean,
    required: true
  }
})

const relativeTimeNow = useRelativeTimeClock()

function formatCommentTime(comment) {
  return comment.published
    ? getRelativeTimeFromDate(comment.published, false, true, relativeTimeNow.value)
    : comment.time
}

const reply = props.node.reply
const childrenCollapsed = ref(false)
const hasReplyChildren = computed(() => {
  return props.node.children.length > 0 ||
    (!props.filtering && (
      (reply.dataType === 'local' && reply.hasReplyToken) ||
      props.loadingReplyIds.has(reply.id)
    ))
})
const showReplyChildren = computed(() => hasReplyChildren.value && (!childrenCollapsed.value || props.filtering))
const replyToggleLabel = computed(() => {
  const replyCount = getCommentReplyCount(reply)
  return showReplyChildren.value
    ? t('Comments.Hide {replyCount} replies', { replyCount }, replyCount)
    : t('Comments.Reply Count', { replyCount }, replyCount)
})

function toggleReplyChildren() {
  childrenCollapsed.value = !childrenCollapsed.value
  emit('replies-toggled')
}
const isPersonallyPinned = computed(() => props.personalPinnedCommentIds.has(reply.id))
const personalPinActionLabel = computed(() => {
  return isPersonallyPinned.value
    ? t('Comments.Unpin comment by author', { author: reply.author })
    : t('Comments.Pin comment by author', { author: reply.author })
})
const authorSearchSegments = computed(() => {
  const query = props.highlight
  if (query === '') {
    return [{ text: reply.author, highlighted: false }]
  }

  const normalizedAuthor = reply.author.toLocaleLowerCase()
  const segments = []
  let start = 0
  let matchIndex = normalizedAuthor.indexOf(query)

  while (matchIndex !== -1) {
    if (matchIndex > start) {
      segments.push({ text: reply.author.slice(start, matchIndex), highlighted: false })
    }
    segments.push({
      text: reply.author.slice(matchIndex, matchIndex + query.length),
      highlighted: true
    })
    start = matchIndex + query.length
    matchIndex = normalizedAuthor.indexOf(query, start)
  }

  if (start < reply.author.length) {
    segments.push({ text: reply.author.slice(start), highlighted: false })
  }

  return segments
})

const emit = defineEmits([
  'toggle-parent',
  'replies-toggled',
  'copy-youtube-link',
  'get-more-replies',
  'timestamp-event',
  'toggle-personal-pin',
  'translate-comment',
  'translation-unavailable'
])
</script>

<style scoped src="./CommentSection.css" />
<style scoped src="./CommentReply.css" />
