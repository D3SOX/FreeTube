import { computed, nextTick, ref, watch } from 'vue'

import { restoreOverlayScrollTop } from '../helpers/overlayScrollbars'

/**
 * Pages an in-memory list, or retains earlier pages for a Load more view.
 *
 * @template T
 * @param {import('vue').Ref<T[]>} items
 * @param {object} options
 * @param {number} options.pageSize
 * @param {boolean} [options.append]
 * @param {import('vue').WatchSource | import('vue').WatchSource[]} [options.resetOn]
 * @param {import('vue').Ref<HTMLElement | null>} [options.scrollTarget]
 */
export function useListPagination(items, { pageSize, append = false, resetOn, scrollTarget }) {
  const page = ref(0)
  const lastPage = computed(() => Math.max(0, Math.ceil(items.value.length / pageSize) - 1))
  const displayedItems = computed(() => items.value.slice(
    append ? 0 : page.value * pageSize,
    (page.value + 1) * pageSize
  ))
  const hasMore = computed(() => page.value < lastPage.value)

  watch(lastPage, (last) => { page.value = Math.min(page.value, last) })
  if (resetOn) watch(resetOn, reset)
  if (scrollTarget && !append) watch(page, restoreScroll)

  async function restoreScroll() {
    if (!scrollTarget) return
    await nextTick()
    if (scrollTarget.value) restoreOverlayScrollTop(scrollTarget.value, 0)
  }

  function reset() {
    // A new query is a new view even when it stays on the first page.
    if (append || page.value === 0) {
      restoreScroll()
    }
    page.value = 0
  }

  return { page, lastPage, displayedItems, hasMore, reset, restoreScroll }
}
