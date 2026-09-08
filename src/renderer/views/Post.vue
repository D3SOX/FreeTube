<template>
  <div>
    <FtLoader v-if="isLoading" />
    <template
      v-else
    >
      <FtCard>
        <FtCommunityPost
          :data="post"
          :single-post="true"
          appearance="result"
        />
      </FtCard>
      <CommentSection
        v-if="!hideComments"
        :id="post.postId"
        :channel-name="post.author"
        :post-author-id="authorId"
        :force-state="null"
        :is-post-comments="true"
        :channel-thumbnail="post.authorThumbnails[0].url"
        :show-sort-by="backendPreference == 'local'"
        :initial-comment-count="post.commentCount"
      />
    </template>
  </div>
</template>

<script setup>
import { computed, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'

import FtCard from '../components/ft-card/ft-card.vue'
import FtCommunityPost from '../components/FtCommunityPost/FtCommunityPost.vue'
import FtLoader from '../components/FtLoader/FtLoader.vue'
import CommentSection from '../components/CommentSection/CommentSection.vue'

import store from '../store/index'

import { getInvidiousCommunityPost } from '../helpers/api/invidious'
import { getLocalCommunityPost } from '../helpers/api/local'
import { showApiErrorToast, showToast } from '../helpers/utils'
import { useTabTitle } from '../tabs/TabContext'

const { t } = useI18n()

const router = useRouter()
const route = useRoute()
const setTabTitle = useTabTitle()

const id = ref('')
const authorId = ref('')
const post = shallowRef(null)
const isLoading = ref(true)

/** @type {import('vue').ComputedRef<'invidious' | 'local'>} */
const backendPreference = computed(() => {
  return store.getters.getBackendPreference
})

/** @type {import('vue').ComputedRef<boolean>} */
const backendFallback = computed(() => {
  return store.getters.getBackendFallback
})

/** @type {import('vue').ComputedRef<boolean>} */
const hideComments = computed(() => {
  return store.getters.getHideComments
})

const subscriptionCacheReady = computed(() => {
  return store.getters.getSubscriptionCacheReady
})

async function loadPost() {
  id.value = route.params.id
  authorId.value = route.query.authorId
  post.value = null
  isLoading.value = true

  if (!process.env.SUPPORTS_LOCAL_API || backendPreference.value === 'invidious') {
    await loadDataInvidiousAsync()
  } else {
    await loadDataLocalAsync()
  }
}

function updateTitleAndRoute() {
  const titlePrefix = 'Community Post'
  const title = post.value.author ? `${titlePrefix} | ${post.value.author}` : titlePrefix
  setTabTitle(title)
  isLoading.value = false

  // If the authorId is missing from the URL we should add it,
  // that way if the user comes back to this page by pressing the back button
  // we don't have to resolve the authorId again
  if (authorId.value !== route.query.authorId) {
    router.replace({
      path: `/post/${id.value}`,
      query: {
        authorId: authorId.value
      }
    })
  }
}

async function loadDataLocalAsync() {
  try {
    post.value = await getLocalCommunityPost(id.value, authorId.value)
    authorId.value = post.value.authorId
    updateTitleAndRoute()
  } catch (error) {
    console.error(error)
    const errorMessage = t('Local API Error (Click to copy)')
    showApiErrorToast(errorMessage, error)
    if (backendPreference.value === 'local' && backendFallback.value) {
      showToast({ message: t('Falling back to Invidious API'), icon: ['fas', 'exchange-alt'] })
      await loadDataInvidiousAsync()
    } else {
      isLoading.value = false
    }
  }
}

async function loadDataInvidiousAsync() {
  try {
    post.value = await getInvidiousCommunityPost(id.value, authorId.value)
    authorId.value = post.value.authorId
    updateTitleAndRoute()
  } catch (error) {
    console.error(error)
    const errorMessage = t('Invidious API Error (Click to copy)')
    showApiErrorToast(errorMessage, error)

    if (process.env.SUPPORTS_LOCAL_API && backendPreference.value === 'invidious' && backendFallback.value) {
      showToast({ message: t('Falling back to Local API'), icon: ['fas', 'exchange-alt'] })
      await loadDataLocalAsync()
    } else {
      isLoading.value = false
    }
  }
}

// Single trigger for the initial load and any subsequent route id change.
// loadPost resets the route-derived state (id, authorId, post, isLoading)
// before loading either backend.
watch(() => route.params.id, loadPost, { immediate: true })
watch([() => route.params.id, subscriptionCacheReady], ([postId, cacheReady]) => {
  if (cacheReady) {
    store.dispatch('markSubscriptionPostAsSeen', postId)
  }
}, { immediate: true })
</script>
