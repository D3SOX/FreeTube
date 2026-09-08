<template>
  <div
    v-if="props.enabled"
    class="capacitorPhoneTabSwitcher"
  >
    <button
      ref="triggerRef"
      type="button"
      class="capacitorPhoneTabSwitcherButton"
      :aria-label="triggerLabel"
      :title="triggerLabel"
      aria-haspopup="dialog"
      :aria-expanded="open"
      aria-controls="capacitor-phone-tab-dialog"
      @click="openSwitcher"
    >
      <FtIcon
        :icon="['fas', 'layer-group']"
        aria-hidden="true"
      />
      <span
        class="capacitorPhoneTabCount"
        aria-hidden="true"
      >{{ tabs.length }}</span>
    </button>

    <Teleport to="body">
      <Transition
        name="capacitor-tabs-dialog"
        @after-leave="restoreTriggerFocus"
      >
        <div
          v-if="open"
          class="capacitorPhoneTabOverlay"
          @pointerdown.self.stop
          @click.self.stop="closeSwitcher"
          @keydown="handleDialogKeydown"
        >
          <section
            id="capacitor-phone-tab-dialog"
            ref="dialogRef"
            class="capacitorPhoneTabDialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="capacitor-phone-tab-dialog-title"
            :inert="sessionToDelete !== null || sessionToOpen !== null"
          >
            <header class="capacitorPhoneTabHeader">
              <div class="capacitorPhoneTabHeading">
                <h2 id="capacitor-phone-tab-dialog-title">
                  {{ t('Tab Organizer.Title') }}
                </h2>
                <span v-if="activeView === 'open'">
                  {{ t('Tab Organizer.Open Tab Count', { count: tabs.length }, tabs.length) }}
                </span>
                <span v-else>{{ t('Settings.Sync Settings.Tabs From Other Devices') }}</span>
              </div>
              <button
                v-if="activeView === 'open'"
                type="button"
                class="capacitorPhoneTabHeaderButton"
                :disabled="closedTabs.length === 0"
                :aria-label="t('KeyboardShortcutPrompt.Reopen Closed Tab')"
                :title="t('KeyboardShortcutPrompt.Reopen Closed Tab')"
                @click="restoreClosedTab"
              >
                <FtIcon
                  :icon="['fas', 'clock-rotate-left']"
                  aria-hidden="true"
                />
              </button>
              <button
                type="button"
                class="capacitorPhoneTabHeaderButton"
                :aria-label="t('Close')"
                :title="t('Close')"
                @click="closeSwitcher"
              >
                <FtIcon
                  :icon="['fas', 'times']"
                  aria-hidden="true"
                />
              </button>
            </header>
            <div
              v-if="showSyncedTabsView"
              class="capacitorPhoneTabViewTabs"
              role="tablist"
              :aria-label="t('Tab Organizer.Title')"
            >
              <button
                id="capacitor-phone-open-tabs-tab"
                type="button"
                class="capacitorPhoneTabViewTab"
                role="tab"
                aria-controls="capacitor-phone-open-tabs-panel"
                :aria-selected="activeView === 'open'"
                :tabindex="activeView === 'open' ? 0 : -1"
                @click="selectView('open')"
                @keydown.right.prevent="selectView('synced', true)"
              >
                {{ t('Tab Organizer.Open Tab Count', { count: tabs.length }, tabs.length) }}
              </button>
              <button
                id="capacitor-phone-synced-tabs-tab"
                type="button"
                class="capacitorPhoneTabViewTab"
                role="tab"
                aria-controls="capacitor-phone-synced-tabs-panel"
                :aria-selected="activeView === 'synced'"
                :tabindex="activeView === 'synced' ? 0 : -1"
                @click="selectView('synced')"
                @keydown.left.prevent="selectView('open', true)"
              >
                {{ t('Settings.Sync Settings.Tabs From Other Devices') }}
              </button>
            </div>
            <div
              v-if="activeView === 'open'"
              id="capacitor-phone-open-tabs-panel"
              ref="openTabsScrollRef"
              v-overlay-scrollbars
              class="capacitorPhoneTabList"
              :role="showSyncedTabsView ? 'tabpanel' : undefined"
              :aria-labelledby="showSyncedTabsView ? 'capacitor-phone-open-tabs-tab' : undefined"
            >
              <div
                ref="openTabsContentRef"
                class="capacitorPhoneOpenTabs"
                role="tablist"
                :aria-label="t('Tab Organizer.Title')"
              >
                <div
                  v-for="tab in tabs"
                  :key="tab.id"
                  class="capacitorPhoneTabRow"
                  :class="{
                    active: tab.id === activeTabId,
                    pinned: tab.isPinned,
                    unloaded: tab.isUnloaded,
                    holding: drag.tabId === tab.id && drag.ready,
                    dragging: drag.tabId === tab.id && drag.moved && !dragSettling,
                    settling: drag.tabId === tab.id && dragSettling,
                    noTransition: suppressDragTransition,
                    swiping: swipe.tabId === tab.id && swipe.dragging,
                    closing: swipe.tabId === tab.id && swipe.closing
                  }"
                  :style="tabCardStyle(tab.id)"
                  @pointerdown="startTabGesture($event, tab.id)"
                  @pointermove="moveTabGesture"
                  @pointerup="finishTabGesture"
                  @pointercancel="cancelTabGesture"
                  @touchmove="preventHoldScroll"
                  @contextmenu.prevent="handleTabContextMenu($event, tab.id)"
                >
                  <button
                    type="button"
                    class="capacitorPhoneTabTarget"
                    role="tab"
                    :data-tab-id="tab.id"
                    :aria-selected="tab.id === activeTabId"
                    :aria-label="tabAriaLabel(tab)"
                    :tabindex="tab.id === activeTabId ? 0 : -1"
                    @click="activateTab(tab.id)"
                    @keydown="handleTabTargetKeydown($event, tab.id)"
                  >
                    <CapacitorTabPreview :tab="tab" />
                    <span class="capacitorPhoneTabTitle">
                      <span dir="auto">{{ tabTitle(tab) }}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    class="capacitorPhoneTabClose"
                    :aria-label="t('Tab Organizer.Close Tab', { title: tabTitle(tab) })"
                    :title="t('Close Tab')"
                    @click="closeTab(tab.id)"
                  >
                    <FtIcon
                      :icon="['fas', 'times']"
                      aria-hidden="true"
                    />
                  </button>
                </div>
              </div>
            </div>
            <div
              v-else
              id="capacitor-phone-synced-tabs-panel"
              class="capacitorPhoneSyncedView"
              role="tabpanel"
              aria-labelledby="capacitor-phone-synced-tabs-tab"
            >
              <div
                v-overlay-scrollbars
                class="capacitorPhoneSyncedSessionTabs"
              >
                <div
                  class="capacitorPhoneSyncedSessionTabsInner"
                  role="tablist"
                  :aria-label="t('Settings.Sync Settings.Tabs From Other Devices')"
                >
                  <button
                    v-for="(session, index) in otherDeviceSessions"
                    :id="syncedSessionTabId(index)"
                    :key="`${session.syncDeviceId}:${session.sessionId}`"
                    type="button"
                    class="capacitorPhoneSyncedSessionTab"
                    role="tab"
                    :aria-controls="syncedSessionPanelId"
                    :aria-selected="activeOtherDeviceSessionKey === otherDeviceSessionKey(session)"
                    :tabindex="activeOtherDeviceSessionKey === otherDeviceSessionKey(session) ? 0 : -1"
                    @click="selectOtherDeviceSession(session)"
                    @keydown.left.prevent="selectOtherDeviceSessionAt(index - 1, true)"
                    @keydown.right.prevent="selectOtherDeviceSessionAt(index + 1, true)"
                    @keydown.home.prevent="selectOtherDeviceSessionAt(0, true)"
                    @keydown.end.prevent="selectOtherDeviceSessionAt(otherDeviceSessions.length - 1, true)"
                  >
                    <FtIcon
                      :icon="session.syncPlatform === 'mobile' ? ['fas', 'smartphone'] : ['fas', 'display']"
                      aria-hidden="true"
                    />
                    <strong>{{ formatDeviceSessionLabel(session, t) }}</strong>
                  </button>
                </div>
              </div>
              <div
                ref="syncedTabsScrollRef"
                v-overlay-scrollbars
                class="capacitorPhoneSyncedTabs"
              >
                <div
                  ref="syncedTabsContentRef"
                  class="capacitorPhoneSyncedTabsContent"
                >
                  <article
                    v-if="activeOtherDeviceSession"
                    :id="syncedSessionPanelId"
                    :key="activeOtherDeviceSessionKey"
                    class="capacitorPhoneSyncedSession"
                    role="tabpanel"
                    :aria-labelledby="activeOtherDeviceSessionTabId"
                  >
                    <header class="capacitorPhoneSyncedSessionHeader">
                      <button
                        type="button"
                        class="capacitorPhoneSyncedTabButton capacitorPhoneSyncedOpenAll"
                        @click="sessionToOpen = activeOtherDeviceSession"
                      >
                        <FtIcon
                          :icon="['fas', 'folder-open']"
                          aria-hidden="true"
                        />
                        {{ t('Settings.Sync Settings.Open All Tabs') }}
                      </button>
                      <button
                        type="button"
                        class="capacitorPhoneSyncedTabButton capacitorPhoneSyncedDelete dangerButton"
                        :aria-label="`${t('Delete')}: ${formatDeviceSessionLabel(activeOtherDeviceSession, t)}`"
                        :title="t('Delete')"
                        @click="sessionToDelete = activeOtherDeviceSession"
                      >
                        <FtIcon
                          :icon="['fas', 'trash']"
                          aria-hidden="true"
                        />
                      </button>
                    </header>
                    <div class="capacitorPhoneSyncedTabList">
                      <button
                        v-for="tab in activeOtherDeviceTabs"
                        :key="tab.id"
                        type="button"
                        class="capacitorPhoneSyncedTabButton capacitorPhoneSyncedTabTarget"
                        @click="openOtherDeviceSession({ ...activeOtherDeviceSession, tabs: [tab] })"
                      >
                        <CapacitorTabPreview :tab="tab" />
                        <span dir="auto">{{ tab.title || tab.url }}</span>
                      </button>
                    </div>
                  </article>
                </div>
              </div>
            </div>
            <button
              v-if="activeView === 'open'"
              type="button"
              class="capacitorPhoneTabFab"
              :aria-label="t('New Tab')"
              :title="t('New Tab')"
              @click="createTab"
            >
              <FtIcon
                :icon="['fas', 'plus']"
                aria-hidden="true"
              />
            </button>
            <CapacitorTabActionsMenu
              :tab="actionTab"
              :title="actionTab ? tabTitle(actionTab) : ''"
              :youtube-url="actionTabYoutubeUrl"
              :can-toggle-loaded="canToggleActionTabLoaded"
              mode="phone"
              @close="closeActionTab"
              @copy-youtube-link="copyActionTabYoutubeLink"
              @dismiss="closeTabActions"
              @duplicate="duplicateActionTab"
              @reload="reloadActionTab"
              @toggle-loaded="toggleActionTabLoaded"
              @toggle-pinned="toggleActionTabPinned"
            />
          </section>
        </div>
      </Transition>
    </Teleport>
    <FtPrompt
      v-if="sessionToOpen"
      :inert="isOpeningSession"
      card-class="capacitorPhoneSessionPrompt"
      :label="t('Settings.Sync Settings.Open All Tabs Confirmation')"
      :extra-labels="[formatDeviceSessionLabel(sessionToOpen, t)]"
      :option-names="[t('Settings.Sync Settings.Open All Tabs'), t('Cancel')]"
      :option-values="['open', 'cancel']"
      :option-icons="[['fas', 'folder-open'], ['fas', 'xmark']]"
      autosize
      @click="handleOpenSessionPrompt"
    />
    <FtPrompt
      v-if="sessionToDelete"
      card-class="capacitorPhoneSessionPrompt"
      :label="t('Delete')"
      :extra-labels="[formatDeviceSessionLabel(sessionToDelete, t)]"
      :option-names="[t('Delete'), t('Cancel')]"
      :option-values="['delete', 'cancel']"
      is-first-option-destructive
      autosize
      @click="handleDeleteSessionPrompt"
    />
  </div>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed, nextTick, onBeforeUnmount, reactive, ref, useId, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import store from '../../store/index'
import { shouldCloseSwipedTab } from '../../helpers/capacitorTabSwipe'
import { clampOverlayScrollTop, restoreOverlayScrollTop } from '../../helpers/overlayScrollbars'
import { formatDeviceSessionLabel, shouldShowOtherDeviceSessions } from '../../helpers/sync-sessions'
import { showToast } from '../../helpers/utils'
import { getCapacitorTabService } from '../../tabs/CapacitorTabService'
import { getSyncedTabPreview } from '../../tabs/tabPreview'
import FtPrompt from '../FtPrompt/FtPrompt.vue'
import { captureBeforeTabOrganizer } from '../../tabs/capacitorTabPreviews'
import CapacitorTabPreview from './CapacitorTabPreview.vue'
import { lockBodyScroll, unlockBodyScroll } from '../FtPrompt/scrollLock'
import CapacitorTabActionsMenu from './CapacitorTabActionsMenu.vue'
import { useCapacitorTabActions } from './useCapacitorTabActions'
import { getTabGridReorder } from './tabGridReorder'

const props = defineProps({
  enabled: {
    type: Boolean,
    default: process.env.IS_CAPACITOR,
  },
})
const emit = defineEmits(['request-exit'])
const { t } = useI18n()
const open = ref(false)
const activeView = ref('open')
const promptId = useId()
const syncedSessionIdPrefix = `capacitor-phone-synced-session-${useId().replaceAll(':', '')}`
const syncedSessionPanelId = `${syncedSessionIdPrefix}-panel`
const selectedOtherDeviceSessionKey = ref(null)
const sessionToDelete = ref(null)
const sessionToOpen = ref(null)
const isOpeningSession = ref(false)
const triggerRef = useTemplateRef('triggerRef')
const dialogRef = useTemplateRef('dialogRef')
const openTabsScrollRef = useTemplateRef('openTabsScrollRef')
const openTabsContentRef = useTemplateRef('openTabsContentRef')
const syncedTabsScrollRef = useTemplateRef('syncedTabsScrollRef')
const syncedTabsContentRef = useTemplateRef('syncedTabsContentRef')
const tabs = computed(() => store.getters.getTabs)
const closedTabs = computed(() => store.getters.getClosedTabs)
const activeTabId = computed(() => store.getters.getActiveTabId)
const syncEnabled = computed(() => store.getters.getSyncServerEnabled)
const syncConnected = computed(() => store.getters.getSyncServerToken !== '')
const syncSessionsEnabled = computed(() => store.getters.getSyncServerSyncSessions)
const sharedTabsEnabled = computed(() => store.getters.getSyncServerSharedTabs)
const otherDeviceSessions = computed(() => store.getters.getSyncServerOtherDeviceSessions)
const activeOtherDeviceSession = computed(() => (
  otherDeviceSessions.value.find(session => (
    otherDeviceSessionKey(session) === selectedOtherDeviceSessionKey.value
  )) ?? otherDeviceSessions.value[0] ?? null
))
const activeOtherDeviceTabs = computed(() => (
  activeOtherDeviceSession.value?.tabs.map(getSyncedTabPreview) ?? []
))
const activeOtherDeviceSessionKey = computed(() => (
  activeOtherDeviceSession.value ? otherDeviceSessionKey(activeOtherDeviceSession.value) : null
))
const activeOtherDeviceSessionTabId = computed(() => {
  const activeIndex = otherDeviceSessions.value.findIndex(session => (
    otherDeviceSessionKey(session) === activeOtherDeviceSessionKey.value
  ))
  return syncedSessionTabId(Math.max(0, activeIndex))
})
const showSyncedTabsView = computed(() => shouldShowOtherDeviceSessions({
  syncEnabled: syncEnabled.value,
  syncConnected: syncConnected.value,
  enhancedSyncEnabled: store.getters.getSyncServerPrivacyMode === 'enhanced' &&
    syncSessionsEnabled.value,
  sharedTabsEnabled: sharedTabsEnabled.value,
  sessions: otherDeviceSessions.value,
}))
const triggerLabel = computed(() => `${t('Tab Organizer.Title')}: ${t(
  'Tab Organizer.Open Tab Count',
  { count: tabs.value.length },
  tabs.value.length
)}`)
let swipeResetTimer = null
let holdTimer = null
let dropTimer = null
let dragFrame = null
let dragRects = []
let dragScrollStart = 0
let dragMaximumScrollTop = 0
let dragLayout = null
const dragOffsets = ref({})
const dragSettling = ref(false)
const suppressDragTransition = ref(false)
let contentResizeObserver = null
const viewScrollTop = { open: 0, synced: 0 }
const swipe = reactive({
  tabId: null,
  pointerId: null,
  startX: 0,
  startY: 0,
  startTime: 0,
  deltaX: 0,
  dragging: false,
  closing: false,
  suppressClick: false,
  rowWidth: 0,
})
const drag = reactive({
  tabId: null,
  pointerId: null,
  startX: 0,
  startY: 0,
  currentX: 0,
  currentY: 0,
  ready: false,
  moved: false,
})
const {
  actionTab,
  actionTabYoutubeUrl,
  activateTab: activateTabAction,
  canToggleActionTabLoaded,
  closeActionTab,
  closeTab,
  closeTabActions,
  createTab,
  copyActionTabYoutubeLink,
  duplicateActionTab,
  handleTabTargetKeydown,
  openTabActions,
  reloadActionTab,
  tabAriaLabel,
  tabTitle,
  toggleActionTabLoaded,
  toggleActionTabPinned,
} = useCapacitorTabActions({
  tabs,
  requestExit: () => {
    closeSwitcher()
    emit('request-exit')
  },
  afterCreate: closeSwitcher,
  afterActivate: closeSwitcher,
  afterClose: async () => {
    await nextTick()
    focusActiveTab()
  },
  afterDuplicate: closeSwitcher,
  beforeOpenActions: () => {
    resetTabSwipe()
    swipe.suppressClick = true
  },
  afterCloseActions: () => {
    window.setTimeout(() => {
      swipe.suppressClick = false
    }, 0)
  },
})

let openingSwitcher = false
let disposed = false
async function openSwitcher() {
  if (openingSwitcher || open.value) return
  openingSwitcher = true
  await captureBeforeTabOrganizer()
  openingSwitcher = false
  if (disposed || !props.enabled) return
  activeView.value = 'open'
  open.value = true
  if (showSyncedTabsView.value) {
    store.dispatch('refreshSyncServerDeviceNames').catch(error => {
      console.error('Failed to refresh sync device names:', error)
    })
  }
}

async function selectView(view, focus = false) {
  const outgoingScroll = activeScrollRef()
  if (outgoingScroll) viewScrollTop[activeView.value] = outgoingScroll.scrollTop
  stopObservingContent()
  activeView.value = view
  await nextTick()
  const incomingScroll = activeScrollRef()
  if (incomingScroll) restoreOverlayScrollTop(incomingScroll, viewScrollTop[view])
  observeActiveContent()
  if (!focus) return

  const id = view === 'synced'
    ? 'capacitor-phone-synced-tabs-tab'
    : 'capacitor-phone-open-tabs-tab'
  dialogRef.value?.querySelector(`#${id}`)?.focus({ preventScroll: true })
}

function activeScrollRef() {
  return activeView.value === 'open' ? openTabsScrollRef.value : syncedTabsScrollRef.value
}

function activeContentRef() {
  return activeView.value === 'open' ? openTabsContentRef.value : syncedTabsContentRef.value
}

function clampActiveContentScroll() {
  if (drag.ready) cancelTabGesture()
  const scroll = activeScrollRef()
  const content = activeContentRef()
  if (scroll && content) clampOverlayScrollTop(scroll, content)
}

function observeActiveContent() {
  stopObservingContent()
  const content = activeContentRef()
  if (!content) return

  contentResizeObserver = new ResizeObserver(clampActiveContentScroll)
  contentResizeObserver.observe(content)
  clampActiveContentScroll()
}

function stopObservingContent() {
  contentResizeObserver?.disconnect()
  contentResizeObserver = null
}

function closeSwitcher() {
  closeTabActions()
  resetTabSwipe()
  resetTabDrag()
  open.value = false
}

function restoreTriggerFocus() {
  triggerRef.value?.focus({ preventScroll: true })
}

async function restoreClosedTab() {
  if (closedTabs.value.length === 0) return

  await getCapacitorTabService().restoreClosedTab()
  closeSwitcher()
}

async function activateTab(tabId) {
  if (swipe.suppressClick) return
  await activateTabAction(tabId)
}

function otherDeviceSessionKey(session) {
  return `${session.syncDeviceId}:${session.sessionId}`
}

function syncedSessionTabId(index) {
  return `${syncedSessionIdPrefix}-tab-${index}`
}

async function selectOtherDeviceSession(session, focus = false) {
  selectedOtherDeviceSessionKey.value = otherDeviceSessionKey(session)
  await nextTick()
  clampActiveContentScroll()
  if (!focus) return

  const index = otherDeviceSessions.value.findIndex(candidate => (
    otherDeviceSessionKey(candidate) === selectedOtherDeviceSessionKey.value
  ))
  dialogRef.value?.querySelector(`#${syncedSessionTabId(index)}`)?.focus({ preventScroll: true })
}

function selectOtherDeviceSessionAt(index, focus = false) {
  const sessions = otherDeviceSessions.value
  if (sessions.length === 0) return
  const wrappedIndex = (index + sessions.length) % sessions.length
  selectOtherDeviceSession(sessions[wrappedIndex], focus)
}

async function handleOpenSessionPrompt(option) {
  if (isOpeningSession.value) return
  const session = sessionToOpen.value
  if (option !== 'open' || !session) {
    sessionToOpen.value = null
    return
  }

  isOpeningSession.value = true
  try {
    if (await store.dispatch('openSyncServerSession', session)) closeSwitcher()
  } catch (error) {
    showToast({
      message: t('Settings.Sync Settings.Sync failed', { error: error.message }),
      icon: ['fas', 'circle-exclamation'],
    })
  } finally {
    sessionToOpen.value = null
    isOpeningSession.value = false
  }
}

async function handleDeleteSessionPrompt(option) {
  const session = sessionToDelete.value
  sessionToDelete.value = null
  if (option !== 'delete' || !session) return

  try {
    if (!await store.dispatch('deleteSyncServerSession', session)) return
    await nextTick()
    if (activeView.value === 'synced') {
      dialogRef.value
        ?.querySelector(`#${activeOtherDeviceSessionTabId.value}`)
        ?.focus({ preventScroll: true })
    } else {
      focusActiveTab()
    }
  } catch (error) {
    showToast({
      message: t('Settings.Sync Settings.Sync failed', { error: error.message }),
      icon: ['fas', 'circle-exclamation'],
    })
  }
}

function tabCardStyle(tabId) {
  const offset = dragOffsets.value[tabId]
  if (offset) return { transform: `translate3d(${offset.x}px, ${offset.y}px, 0)` }
  if (swipe.tabId !== tabId) return undefined

  return {
    transform: `translateX(${swipe.deltaX}px)`,
    opacity: String(Math.max(0.25, 1 - Math.abs(swipe.deltaX) / Math.max(swipe.rowWidth, 1)))
  }
}

function startTabGesture(event, tabId) {
  if (dragSettling.value || event.button !== 0 || event.target.closest('.capacitorPhoneTabClose')) return

  resetTabDrag()
  resetTabSwipe()
  drag.tabId = tabId
  drag.pointerId = event.pointerId
  drag.startX = event.clientX
  drag.startY = event.clientY
  drag.currentX = event.clientX
  drag.currentY = event.clientY
  const target = event.target.closest('.capacitorPhoneTabTarget')
  holdTimer = window.setTimeout(() => {
    holdTimer = null
    dragRects = Array.from(openTabsContentRef.value.querySelectorAll('.capacitorPhoneTabRow')).map(row => {
      const rect = row.getBoundingClientRect()
      const id = row.querySelector('[data-tab-id]').dataset.tabId
      return {
        id,
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        isPinned: tabs.value.find(tab => tab.id === id).isPinned === true,
      }
    })
    dragScrollStart = openTabsScrollRef.value.scrollTop
    const viewport = openTabsScrollRef.value
    const contentBottom = openTabsContentRef.value.getBoundingClientRect().bottom
    dragMaximumScrollTop = Math.max(0, contentBottom - viewport.getBoundingClientRect().top +
      dragScrollStart + Number.parseFloat(getComputedStyle(viewport).paddingBottom) - viewport.clientHeight)
    drag.ready = true
    target?.setPointerCapture(event.pointerId)
    openTabActions(tabId)
  }, 400)

  const tab = tabs.value.find(candidate => candidate.id === tabId)
  if (tab?.isPinned) return

  swipe.tabId = tabId
  swipe.pointerId = event.pointerId
  swipe.startX = event.clientX
  swipe.startY = event.clientY
  swipe.startTime = performance.now()
  swipe.rowWidth = event.currentTarget.getBoundingClientRect().width
}

function moveTabGesture(event) {
  if (dragSettling.value) return
  if (drag.pointerId === event.pointerId) {
    const moved = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 8
    if (drag.ready) {
      if (moved) drag.moved = true
      if (drag.moved) {
        event.preventDefault()
        if (actionTab.value) closeTabActions()
        drag.currentX = event.clientX
        drag.currentY = event.clientY
        updateTabDrag()
        startDragAutoScroll()
      }
      return
    }
    if (moved) resetTabDrag()
  }
  moveTabSwipe(event)
}

function preventHoldScroll(event) {
  // touch-action cannot change halfway through a gesture. Cancel native
  // scrolling only after the hold, so a quick vertical swipe still scrolls.
  if (drag.ready && event.touches.length === 1) event.preventDefault()
}

function finishTabGesture(event) {
  if (dragSettling.value) return
  if (drag.pointerId === event.pointerId && drag.ready) {
    swipe.suppressClick = true
    if (drag.moved) {
      stopDragAutoScroll()
      const tabId = drag.tabId
      const targetIndex = dragLayout.targetIndex
      dragSettling.value = true
      dragOffsets.value = { ...dragOffsets.value, [tabId]: dragLayout.dropOffset }
      const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 160
      dropTimer = window.setTimeout(() => {
        dropTimer = null
        if (dragRects[targetIndex].id !== tabId) {
          getCapacitorTabService().moveTab(tabId, targetIndex)
        }
        resetTabDrag()
        scheduleSwipeReset()
      }, duration)
    } else {
      resetTabDrag()
    }
    return
  }
  resetTabDrag()
  finishTabSwipe(event)
}

function cancelTabGesture() {
  const wasHeld = drag.ready
  resetTabDrag()
  if (wasHeld) {
    swipe.suppressClick = true
    scheduleSwipeReset()
  }
  cancelTabSwipe()
}

function handleTabContextMenu(event, tabId) {
  // The hold timer already handles touch menus; right-click stays instant.
  if (drag.tabId === tabId || (event.pointerType === 'touch' && swipe.suppressClick)) return
  openTabActions(tabId)
}

function updateTabDrag() {
  const scrollDelta = openTabsScrollRef.value.scrollTop - dragScrollStart
  dragLayout = getTabGridReorder(
    dragRects, drag.tabId,
    drag.currentX - drag.startX,
    drag.currentY - drag.startY + scrollDelta
  )
  dragOffsets.value = dragLayout.offsets
}

function startDragAutoScroll() {
  if (dragFrame !== null) return
  let previousTime = performance.now()
  const scroll = (time) => {
    const viewport = openTabsScrollRef.value
    const bounds = viewport.getBoundingClientRect()
    const edge = 48
    const speed = drag.currentY < bounds.top + edge
      ? -Math.min(1, (bounds.top + edge - drag.currentY) / edge)
      : Math.max(0, Math.min(1, (drag.currentY - bounds.bottom + edge) / edge))
    const before = viewport.scrollTop
    // Transforms can extend scrollHeight. Bound scrolling by the real grid,
    // otherwise the floating card continuously creates room beneath itself.
    viewport.scrollTop = Math.max(0, Math.min(dragMaximumScrollTop,
      before + speed * Math.min(time - previousTime, 32) * 0.6))
    previousTime = time
    if (viewport.scrollTop !== before) updateTabDrag()
    dragFrame = requestAnimationFrame(scroll)
  }
  dragFrame = requestAnimationFrame(scroll)
}

function stopDragAutoScroll() {
  cancelAnimationFrame(dragFrame)
  dragFrame = null
}

function resetTabDrag() {
  const hadOffsets = Object.keys(dragOffsets.value).length > 0
  if (hadOffsets) suppressDragTransition.value = true
  stopDragAutoScroll()
  window.clearTimeout(dropTimer)
  dropTimer = null
  dragSettling.value = false
  dragOffsets.value = {}
  dragRects = []
  dragLayout = null
  window.clearTimeout(holdTimer)
  holdTimer = null
  drag.tabId = null
  drag.pointerId = null
  drag.ready = false
  drag.moved = false
  if (hadOffsets) {
    nextTick(() => {
      if (openTabsScrollRef.value && openTabsContentRef.value) {
        clampOverlayScrollTop(openTabsScrollRef.value, openTabsContentRef.value)
      }
      requestAnimationFrame(() => {
        suppressDragTransition.value = false
      })
    })
  }
}

function moveTabSwipe(event) {
  if (swipe.pointerId !== event.pointerId || swipe.closing) return

  const deltaX = event.clientX - swipe.startX
  const deltaY = event.clientY - swipe.startY
  if (!swipe.dragging) {
    if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > 8) {
      cancelTabSwipe()
      return
    }
    if (Math.abs(deltaX) < 8) return
    swipe.dragging = true
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  event.preventDefault()
  swipe.deltaX = deltaX
}

function finishTabSwipe(event) {
  if (swipe.pointerId !== event.pointerId) return
  if (!swipe.dragging) {
    resetTabSwipe()
    return
  }

  swipe.suppressClick = true
  const close = shouldCloseSwipedTab({
    distance: swipe.deltaX,
    elapsed: performance.now() - swipe.startTime,
    width: swipe.rowWidth,
  })
  if (!close) {
    swipe.dragging = false
    swipe.deltaX = 0
    scheduleSwipeReset()
    return
  }

  const tabId = swipe.tabId
  swipe.dragging = false
  swipe.closing = true
  swipe.deltaX = Math.sign(swipe.deltaX || 1) * swipe.rowWidth
  const delay = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 160
  swipeResetTimer = window.setTimeout(async () => {
    swipeResetTimer = null
    await closeTab(tabId)
    resetTabSwipe()
  }, delay)
}

function cancelTabSwipe() {
  if (swipe.tabId === null) return
  swipe.dragging = false
  swipe.deltaX = 0
  scheduleSwipeReset()
}

function scheduleSwipeReset() {
  window.clearTimeout(swipeResetTimer)
  swipeResetTimer = window.setTimeout(resetTabSwipe, 170)
}

function resetTabSwipe() {
  window.clearTimeout(swipeResetTimer)
  swipeResetTimer = null
  swipe.tabId = null
  swipe.pointerId = null
  swipe.deltaX = 0
  swipe.dragging = false
  swipe.closing = false
  swipe.suppressClick = false
  swipe.rowWidth = 0
}

function focusActiveTab() {
  dialogRef.value
    ?.querySelector('[role="tab"][aria-selected="true"]')
    ?.focus({ preventScroll: true })
}

function handleDialogKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    closeSwitcher()
    return
  }
  if (event.key !== 'Tab') return

  const focusable = Array.from(dialogRef.value?.querySelectorAll('button:not(:disabled)') ?? [])
  if (focusable.length === 0) return

  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

watch(open, async (isOpen) => {
  if (isOpen) {
    lockBodyScroll()
    store.commit('addOpenPrompt', promptId)
    await nextTick()
    const scroll = activeScrollRef()
    if (scroll) restoreOverlayScrollTop(scroll, viewScrollTop[activeView.value])
    observeActiveContent()
    focusActiveTab()
  } else {
    const scroll = activeScrollRef()
    if (scroll) viewScrollTop[activeView.value] = scroll.scrollTop
    stopObservingContent()
    store.commit('removeOpenPrompt', promptId)
    unlockBodyScroll()
  }
})

watch(showSyncedTabsView, (visible) => {
  if (!visible && activeView.value !== 'open') selectView('open')
})

watch(() => tabs.value.map(tab => `${tab.id}:${tab.isPinned}`).join(','), () => {
  if (drag.ready) cancelTabGesture()
})

watch(
  () => [tabs.value.length, ...otherDeviceSessions.value.map(session => session.tabs.length)],
  async () => {
    await nextTick()
    clampActiveContentScroll()
  }
)

onBeforeUnmount(() => {
  disposed = true
  resetTabSwipe()
  resetTabDrag()
  stopObservingContent()
  if (!open.value) return

  store.commit('removeOpenPrompt', promptId)
  unlockBodyScroll()
})
</script>

<style scoped src="./CapacitorPhoneTabSwitcher.css" />
