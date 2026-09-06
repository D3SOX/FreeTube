<template>
  <Teleport
    :to="fullscreenTarget || 'body'"
    :disabled="fullscreenTarget === null"
  >
    <Transition name="context-menu">
      <div
        v-if="isOpen"
        ref="menuRef"
        class="contextMenu"
        :class="{ submenusOpenStart, compactTabMenu: tabColorMenu != null }"
        :style="menuStyle"
        role="menu"
        :aria-label="t('Context Menu.Context Menu')"
        @contextmenu.prevent
        @pointerdown.stop
      >
        <div
          v-if="tabColorMenu"
          class="tabMenuHeader"
          role="none"
        >
          <div
            class="tabQuickActions"
            role="group"
            :aria-label="t('Context Menu.Context Menu')"
          >
            <button
              v-for="item in tabQuickActions"
              :key="item.actionId"
              class="menuItem iconButton"
              :class="{ disabled: !item.enabled, closeAction: item.labelKey === 'Close Tab' || item.labelKey === 'Context Menu.Close Multiple Tabs' }"
              type="button"
              role="menuitem"
              :aria-label="localizedLabel(item)"
              :title="localizedLabel(item)"
              :disabled="!item.enabled"
              @pointerdown.prevent
              @click="execute(item)"
            >
              <FtContextMenuItemIcon
                :item="item"
                :icon="getItemIcon(item)"
              />
            </button>
          </div>
          <div
            class="tabColorPalette"
            role="group"
            :aria-label="localizedLabel(tabColorMenu)"
          >
            <button
              v-for="item in tabColorMenu.submenu"
              :key="item.actionId"
              class="menuItem iconButton colorButton"
              type="button"
              role="menuitemradio"
              :aria-label="localizedLabel(item)"
              :title="localizedLabel(item)"
              :aria-checked="item.checked"
              :disabled="!item.enabled"
              @pointerdown.prevent
              @click="execute(item)"
            >
              <FtContextMenuItemIcon
                :item="item.label === 'Default' ? item : { ...item, groupColor: item.label.toLowerCase() }"
                :icon="getItemIcon(item)"
                :icon-class="getItemIconClass(item)"
              />
            </button>
          </div>
        </div>
        <div
          v-overlay-scrollbars
          class="menuScroll"
          role="none"
          @scroll="positionOpenSubmenu"
        >
          <div
            class="menuContent"
            role="none"
          >
            <template
              v-for="(item, index) in menuRows"
              :key="item.actionId ?? `separator-${index}`"
            >
              <div
                v-if="item.type === 'separator'"
                class="separator"
                role="separator"
              />
              <div
                v-else-if="item.submenu"
                class="submenuContainer"
                @pointerenter="positionSubmenu"
                @focusin="positionSubmenu"
              >
                <button
                  class="menuItem"
                  :class="{ disabled: !item.enabled }"
                  type="button"
                  role="menuitem"
                  :disabled="!item.enabled"
                  aria-haspopup="menu"
                  @pointerdown.prevent
                >
                  <FtContextMenuItemIcon
                    :item="item"
                    :icon="getItemIcon(item)"
                    :icon-class="getItemIconClass(item)"
                  />
                  <span>{{ localizedLabel(item) }}</span>
                  <span
                    class="submenuArrow"
                    aria-hidden="true"
                  />
                </button>
                <div
                  class="submenu"
                  role="menu"
                >
                  <!-- Presentational scrollport: keeps the hover bridge on .submenu
                   from becoming scrollable overflow -->
                  <div
                    v-overlay-scrollbars
                    class="submenuScroll"
                    role="none"
                  >
                    <div
                      class="menuContent"
                      role="none"
                    >
                      <template
                        v-for="(child, childIndex) in item.submenu"
                        :key="child.actionId ?? `separator-${childIndex}`"
                      >
                        <div
                          v-if="child.type === 'separator'"
                          class="separator"
                          role="separator"
                        />
                        <button
                          v-else
                          class="menuItem"
                          :class="{ disabled: !child.enabled }"
                          type="button"
                          :role="child.type === 'radio' ? 'menuitemradio' : 'menuitem'"
                          :aria-checked="child.type === 'radio' ? child.checked : undefined"
                          :disabled="!child.enabled"
                          @pointerdown.prevent
                          @click="execute(child)"
                        >
                          <FtContextMenuItemIcon
                            :item="child"
                            :icon="getItemIcon(child, item.label)"
                            :icon-class="getItemIconClass(child)"
                          />
                          <span>{{ localizedLabel(child) }}</span>
                        </button>
                      </template>
                    </div>
                  </div>
                </div>
              </div>
              <button
                v-else
                class="menuItem"
                :class="{ disabled: !item.enabled }"
                type="button"
                :role="item.type === 'radio' ? 'menuitemradio' : 'menuitem'"
                :aria-checked="item.type === 'radio' ? item.checked : undefined"
                :disabled="!item.enabled"
                @pointerdown.prevent
                @click="execute(item)"
              >
                <FtContextMenuItemIcon
                  :item="item"
                  :icon="getItemIcon(item)"
                  :icon-class="getItemIconClass(item)"
                />
                <span>{{ localizedLabel(item) }}</span>
              </button>
            </template>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

import store from '../../store/index'
import { clampOverlayScrollTop, restoreOverlayScrollTop } from '../../helpers/overlayScrollbars'
import FtContextMenuItemIcon from './FtContextMenuItemIcon.vue'

const { t } = useI18n()
const menuRef = useTemplateRef('menuRef')
const fullscreenTarget = ref(null)
const isOpen = ref(false)
const items = ref([])
const sessionId = ref(null)
const position = ref({ x: 0, y: 0 })
const submenusOpenStart = ref(false)
const verticalTabLayout = ref(false)
let openRequest = 0
let scrollResizeObserver = null
let previousFocus = null

const menuStyle = computed(() => ({
  left: `${position.value.x}px`,
  top: `${position.value.y}px`
}))

/**
 * Entries with a refreshing label follow the refresh state while the menu is
 * open, as the refresh can end (or be started elsewhere) in the meantime.
 */
const displayedItems = computed(() => {
  if (!store.getters.getSubscriptionFeedRefreshInProgress) {
    return items.value
  }

  return items.value.map(item => item.refreshingLabel
    ? {
        ...item,
        label: item.refreshingLabel,
        labelKey: item.refreshingLabelKey,
        labelParameters: item.refreshingLabelParameters
      }
    : item)
})

// Keep the action payloads intact; only the desktop tab menu's presentation changes.
const tabColorMenu = computed(() => displayedItems.value.find(item => item.labelKey === 'Context Menu.Tab Color'))
const quickActionKeys = [
  ['Reload Tab', 'Reload Tabs'],
  ['Duplicate Tab', 'Duplicate Multiple Tabs'],
  ['Pin Tab', 'Pin Tabs', 'Unpin Tab', 'Unpin Tabs'],
  ['Close Tab', 'Close Multiple Tabs']
].map(keys => keys.map(key => key === 'Close Tab' ? key : `Context Menu.${key}`))
const tabQuickActions = computed(() => tabColorMenu.value
  ? quickActionKeys.map(keys => displayedItems.value.find(item => keys.includes(item.labelKey))).filter(Boolean)
  : [])
const menuRows = computed(() => {
  if (!tabColorMenu.value) return displayedItems.value

  const rows = displayedItems.value.filter(item => item !== tabColorMenu.value && !tabQuickActions.value.includes(item))
  return rows.filter((item, index) => item.type !== 'separator' || (
    index > 0 && index < rows.length - 1 && rows[index - 1].type !== 'separator'
  ))
})

function updateFullscreenTarget() {
  fullscreenTarget.value = document.fullscreenElement
}

const itemIcons = {
  'Cancel Refresh': ['fas', 'xmark'],
  'Close Tab': ['fas', 'xmark'],
  'Close Tabs': ['fas', 'rectangle-xmark'],
  'Collapse Group': ['fas', 'compress'],
  'Copy Image': ['fas', 'images'],
  'Copy Image Address': ['fas', 'link'],
  'Copy Invidious Link': ['fas', 'link'],
  'Copy Link': ['fas', 'link'],
  'Copy YouTube Link': ['fab', 'youtube'],
  'Copy YouTube Links': ['fab', 'youtube'],
  Copy: ['fas', 'copy'],
  Cut: ['fas', 'scissors'],
  Default: ['fas', 'circle'],
  'Duplicate Tab': ['fas', 'clone'],
  'Load Tab': ['fas', 'download'],
  'Load Tabs': ['fas', 'download'],
  'Mark All as Seen': ['fas', 'check'],
  'Move Tab': ['fas', 'exchange-alt'],
  'Move Tab to Group': ['fas', 'layer-group'],
  'Move Tab to Window': ['fas', 'display'],
  'Move Tabs': ['fas', 'exchange-alt'],
  'Move Tabs to Group': ['fas', 'layer-group'],
  'Move Tabs to Window': ['fas', 'display'],
  'New Tab': ['fas', 'plus'],
  'New Window': ['fas', 'clone'],
  'Open in a New Tab': ['fas', 'arrow-up-right-from-square'],
  'Open in a New Window': ['fas', 'external-link-alt'],
  'Other Tabs': ['fas', 'times-circle'],
  Paste: ['fas', 'paste'],
  'Pin Tab': ['fas', 'thumbtack'],
  'Pin Tabs': ['fas', 'thumbtack'],
  'Reload All Feeds': ['fas', 'sync'],
  'Reload Live': ['fas', 'sync'],
  'Reload Posts': ['fas', 'sync'],
  'Reload Shorts': ['fas', 'sync'],
  'Reload Tab': ['fas', 'sync'],
  'Reload Tabs': ['fas', 'sync'],
  'Reload Videos': ['fas', 'sync'],
  'Reopen Closed Tab': ['fas', 'clock-rotate-left'],
  'Save Image As…': ['fas', 'file-image'],
  'Select All': ['fas', 'check'],
  'Tab Color': ['fas', 'palette'],
  'To the Bottom': ['fas', 'arrow-down'],
  'To the Left': ['fas', 'arrow-left'],
  'To the Right': ['fas', 'arrow-right'],
  'To the Top': ['fas', 'arrow-up'],
  'Unload Tab': ['fas', 'right-from-bracket'],
  'Unload Tabs': ['fas', 'right-from-bracket'],
  'Unpin Tab': ['fas', 'thumbtack-slash'],
  'Unpin Tabs': ['fas', 'thumbtack-slash']
}

const colorLabels = new Set(['Default', 'Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Purple', 'Pink'])

function getItemIcon(item, parentLabel = '') {
  if (colorLabels.has(item.label)) return ['fas', 'circle']
  if (item.label === 'To Beginning') return ['fas', verticalTabLayout.value ? 'arrow-up' : 'arrow-left']
  if (item.label === 'To End') return ['fas', verticalTabLayout.value ? 'arrow-down' : 'arrow-right']
  if (/^Close \d+ Tabs$/.test(item.label)) return ['fas', 'rectangle-xmark']
  if (/^Duplicate \d+ Tabs$/.test(item.label)) return ['fas', 'clone']
  if (/^Search /.test(item.label)) return ['fas', 'search']
  if (/is too long for search/.test(item.label)) return ['fas', 'circle-exclamation']
  if (parentLabel === 'Move Tab to Window' || parentLabel === 'Move Tabs to Window') return ['fas', 'display']
  if (parentLabel === 'Move Tab to Group' || parentLabel === 'Move Tabs to Group') {
    if (item.label === 'Manage Tab Groups…') return ['fas', 'edit']
    if (item.label === 'Ungrouped') return ['fas', 'link-slash']
    return ['fas', 'layer-group']
  }
  return itemIcons[item.label] ?? ['fas', 'circle']
}

function getItemIconClass(item) {
  if (item.label === 'Move Tab to Group' || item.label === 'Move Tabs to Group') {
    return 'groupMenuIcon'
  }
  return colorLabels.has(item.label)
    ? ['colorIcon', `color-${item.label.toLowerCase()}`]
    : undefined
}

function resolveItemFavicons(menuItems) {
  for (const item of menuItems) {
    if (typeof item.faviconSource === 'string') {
      const source = item.faviconSource
      window.ftElectron.resolveFavicon(source).then(icon => {
        if (item.faviconSource === source && icon) item.icon = icon
      }).catch(() => {})
    }
    if (Array.isArray(item.submenu)) resolveItemFavicons(item.submenu)
  }
}

function getSelectionText(target) {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    const start = target.selectionStart ?? 0
    const end = target.selectionEnd ?? start
    return target.value.slice(start, end)
  }

  return window.getSelection()?.toString() ?? ''
}

function getContextParameters(event) {
  const target = event.target instanceof Element ? event.target : null
  const editable = target?.closest('input, textarea, [contenteditable="true"]')
  const link = target?.closest('a[href]')
  const media = target?.closest('img, video')
  const selectionText = getSelectionText(editable ?? target)
  const isEditable = editable != null && !editable.matches(':disabled, [readonly]')

  return {
    x: event.clientX,
    y: event.clientY,
    pageURL: window.location.href,
    linkURL: link?.href ?? '',
    linkText: link?.textContent?.trim() ?? '',
    srcURL: media?.currentSrc ?? media?.src ?? '',
    mediaType: media instanceof HTMLImageElement ? 'image' : media instanceof HTMLVideoElement ? 'video' : 'none',
    selectionText,
    isEditable,
    editFlags: {
      canCut: isEditable && selectionText.length > 0,
      canCopy: selectionText.length > 0,
      canPaste: isEditable,
      canSelectAll: editable != null
    }
  }
}

async function open(event) {
  if (event.defaultPrevented) return

  event.preventDefault()
  const request = ++openRequest
  const result = await window.ftElectron.contextMenu.open(getContextParameters(event))
  if (request !== openRequest || result.items.length === 0) return

  items.value = result.items
  resolveItemFavicons(items.value)
  sessionId.value = result.sessionId
  position.value = { x: event.clientX, y: event.clientY }
  submenusOpenStart.value = event.clientX > window.innerWidth / 2
  verticalTabLayout.value = document.querySelector('.app')?.classList.contains('verticalTabs') === true
  previousFocus = document.activeElement
  isOpen.value = true
  await nextTick()
  if (request !== openRequest || !menuRef.value) return

  scrollResizeObserver?.disconnect()
  const scrollports = [...menuRef.value.querySelectorAll('.menuScroll, .submenuScroll')]
  scrollResizeObserver = new ResizeObserver(() => {
    for (const scroller of scrollports) {
      clampOverlayScrollTop(scroller, scroller.querySelector(':scope > .menuContent'))
    }
    positionOpenSubmenu()
  })
  for (const scroller of scrollports) {
    restoreOverlayScrollTop(scroller, 0)
    scrollResizeObserver.observe(scroller)
    scrollResizeObserver.observe(scroller.querySelector(':scope > .menuContent'))
  }

  const menuWidth = menuRef.value.offsetWidth
  const menuHeight = menuRef.value.offsetHeight
  const x = document.body.dir === 'rtl'
    ? event.clientX - menuWidth
    : event.clientX
  position.value = {
    x: Math.max(8, Math.min(x, window.innerWidth - menuWidth - 8)),
    y: Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8))
  }
}

function close(event) {
  if (event?.target instanceof Element && event.target.closest('.contextMenu')) return
  if (menuRef.value?.contains(document.activeElement)) previousFocus?.focus({ preventScroll: true })
  openRequest++
  scrollResizeObserver?.disconnect()
  isOpen.value = false
}

function positionSubmenu(eventOrContainer) {
  const container = eventOrContainer instanceof HTMLElement
    ? eventOrContainer
    : eventOrContainer.currentTarget
  if (!(container instanceof HTMLElement)) return

  const submenu = container.querySelector(':scope > .submenu')
  if (!(submenu instanceof HTMLElement)) return

  const containerRect = container.getBoundingClientRect()
  const submenuWidth = submenu.offsetWidth
  const submenuHeight = submenu.offsetHeight
  const viewportMargin = 8
  const opensAtStart = submenusOpenStart.value
  const preferredLeft = opensAtStart
    ? containerRect.left - submenuWidth + 2
    : containerRect.right - 2
  const alternateLeft = opensAtStart
    ? containerRect.right - 2
    : containerRect.left - submenuWidth + 2
  const fitsHorizontally = left => left >= viewportMargin &&
    left + submenuWidth <= window.innerWidth - viewportMargin
  const left = fitsHorizontally(preferredLeft) || !fitsHorizontally(alternateLeft)
    ? preferredLeft
    : alternateLeft
  const clampedLeft = Math.max(
    viewportMargin,
    Math.min(left, window.innerWidth - submenuWidth - viewportMargin)
  )
  const top = Math.max(
    viewportMargin,
    Math.min(containerRect.top - 5, window.innerHeight - submenuHeight - viewportMargin)
  )

  const opensToStart = left === alternateLeft ? !opensAtStart : opensAtStart
  container.classList.toggle('submenuOpenStart', opensToStart)
  container.classList.toggle('submenuOpenEnd', !opensToStart)
  container.style.setProperty('--submenu-left', `${clampedLeft}px`)
  container.style.setProperty('--submenu-top', `${top}px`)
}

function positionOpenSubmenu() {
  const container = menuRef.value?.querySelector(
    '.submenuContainer:hover, .submenuContainer:focus-within'
  )
  if (container instanceof HTMLElement) positionSubmenu(container)
}

async function execute(item) {
  if (!item.enabled || !item.actionId || sessionId.value == null) return

  const currentSessionId = sessionId.value
  close()
  await window.ftElectron.contextMenu.execute(currentSessionId, item.actionId)
}

function localizedLabel(item) {
  if (!item.labelKey) return item.label

  const parameters = item.labelParameters ?? {}

  if (typeof parameters.count === 'number') {
    // eslint-disable-next-line @intlify/vue-i18n/no-dynamic-keys
    return t(item.labelKey, parameters, parameters.count)
  }

  // eslint-disable-next-line @intlify/vue-i18n/no-dynamic-keys
  return t(item.labelKey, parameters)
}

function handleKeydown(event) {
  if (!isOpen.value) return
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
    previousFocus?.focus({ preventScroll: true })
    return
  }
  if (!tabColorMenu.value || !['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return

  event.preventDefault()
  event.stopPropagation()
  const focused = document.activeElement
  const submenu = focused?.closest('.submenu')
  const rtl = document.body.dir === 'rtl'
  const forward = event.key === (rtl ? 'ArrowLeft' : 'ArrowRight')
  const backward = event.key === (rtl ? 'ArrowRight' : 'ArrowLeft')
  if (submenu && backward) {
    submenu.parentElement.querySelector(':scope > button').focus()
    return
  }
  if (forward && focused?.getAttribute('aria-haspopup') === 'menu') {
    focused.parentElement.querySelector('.submenu button:enabled')?.focus()
    return
  }
  const row = focused?.closest('.tabQuickActions, .tabColorPalette')
  const scope = (forward || backward) && row ? row : submenu ?? menuRef.value
  const buttons = [...scope.querySelectorAll('button:enabled')].filter(button => (
    scope !== menuRef.value || !button.closest('.submenu')
  ))
  const index = buttons.indexOf(focused)
  const step = event.key === 'ArrowUp' || backward ? -1 : 1
  const nextIndex = event.key === 'Home'
    ? 0
    : event.key === 'End'
      ? buttons.length - 1
      : index < 0 ? (step > 0 ? 0 : buttons.length - 1) : (index + step + buttons.length) % buttons.length
  buttons[nextIndex]?.focus()
}

onMounted(() => {
  document.addEventListener('contextmenu', open)
  document.addEventListener('pointerdown', close, true)
  document.addEventListener('fullscreenchange', updateFullscreenTarget)
  window.addEventListener('blur', close)
  window.addEventListener('resize', close)
  window.addEventListener('keydown', handleKeydown, true)
  updateFullscreenTarget()
})

onBeforeUnmount(() => {
  scrollResizeObserver?.disconnect()
  document.removeEventListener('contextmenu', open)
  document.removeEventListener('pointerdown', close, true)
  document.removeEventListener('fullscreenchange', updateFullscreenTarget)
  window.removeEventListener('blur', close)
  window.removeEventListener('resize', close)
  window.removeEventListener('keydown', handleKeydown, true)
})
</script>

<style scoped src="./FtContextMenu.css" />
