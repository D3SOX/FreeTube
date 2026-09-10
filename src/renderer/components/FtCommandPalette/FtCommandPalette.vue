<template>
  <Teleport :to="teleportTarget">
    <div
      class="commandPaletteBackdrop"
      @pointerdown.self.stop
      @click.self.stop="close"
      @keydown.esc="close"
    >
      <section
        class="commandPalette"
        role="dialog"
        aria-modal="true"
        :aria-label="t('CommandPalette.Title')"
        @keydown="handleDialogKeydown"
      >
        <header class="commandPaletteHeader">
          <label class="commandPaletteSearch">
            <FtIcon
              :icon="['fas', 'magnifying-glass']"
              aria-hidden="true"
            />
            <input
              ref="inputRef"
              v-model="query"
              type="search"
              role="combobox"
              autocomplete="off"
              :placeholder="t('CommandPalette.Search Placeholder')"
              :aria-label="t('CommandPalette.Search Label')"
              aria-autocomplete="list"
              aria-haspopup="listbox"
              :aria-expanded="displayedCommands.length > 0"
              :aria-controls="listId"
              :aria-activedescendant="activeOptionId"
              :aria-describedby="statusId"
              @keydown.down.prevent="moveSelection(1)"
              @keydown.up.prevent="moveSelection(-1)"
              @keydown.home.prevent="selectBoundary(0)"
              @keydown.end.prevent="selectBoundary(displayedCommands.length - 1)"
              @keydown.enter.prevent="runSelectedCommand"
            >
          </label>
          <button
            ref="closeButtonRef"
            type="button"
            class="commandPaletteClose"
            :aria-label="t('Close')"
            :title="t('Close')"
            @click="close"
          >
            <FtIcon
              :icon="['fas', 'xmark']"
              aria-hidden="true"
            />
          </button>
        </header>

        <div
          ref="resultsRef"
          v-overlay-scrollbars
          class="commandPaletteResults"
        >
          <div
            :id="listId"
            ref="resultsContentRef"
            class="commandPaletteResultsContent"
            role="listbox"
            :aria-label="t('CommandPalette.Results')"
          >
            <template v-if="displayedCommands.length > 0">
              <div
                v-for="group in groupedCommands"
                :key="group.name"
                class="commandPaletteGroup"
                role="group"
                :aria-label="group.name"
              >
                <h3 aria-hidden="true">
                  {{ group.name }}
                </h3>
                <div
                  v-for="command in group.commands"
                  :id="optionId(command)"
                  :key="command.id"
                  class="commandPaletteOption"
                  :class="{
                    selected: command.id === selectedCommand?.id,
                    disabled: command.disabledReason
                  }"
                  role="option"
                  tabindex="-1"
                  :aria-selected="command.id === selectedCommand?.id"
                  :aria-disabled="command.disabledReason ? 'true' : undefined"
                  @pointermove="selectCommand(command)"
                  @click="runCommand(command)"
                  @keydown.enter.prevent="runCommand(command)"
                >
                  <FtProfileIcon
                    v-if="command.profile"
                    class="commandPaletteOptionProfileIcon"
                    :profile="command.profile"
                    :fallback="command.profileFallback"
                    aria-hidden="true"
                  />
                  <FtRetryImage
                    v-else-if="hasUsableIconUrl(command)"
                    class="commandPaletteOptionIconImage"
                    :src="command.iconUrl"
                    alt=""
                    draggable="false"
                    @error="handleIconError(command.iconUrl)"
                  />
                  <FtIcon
                    v-else-if="command.icon"
                    class="commandPaletteOptionIcon"
                    :icon="command.icon"
                    aria-hidden="true"
                  />
                  <span class="commandPaletteOptionText">
                    <span>
                      <template
                        v-for="(segment, index) in highlightedLabel(command)"
                        :key="`${segment.highlighted}-${index}`"
                      >
                        <strong
                          v-if="segment.highlighted"
                          class="commandPaletteOptionMatch"
                        >{{ segment.text }}</strong>
                        <template v-else>{{ segment.text }}</template>
                      </template>
                    </span>
                    <small v-if="command.disabledReason">{{ command.disabledReason }}</small>
                    <small v-else-if="command.detail">{{ command.detail }}</small>
                  </span>
                  <kbd v-if="showShortcuts && command.shortcut">{{ getLocalizedShortcut(command.shortcut) }}</kbd>
                </div>
              </div>
            </template>
            <p
              v-else
              class="commandPaletteEmpty"
            >
              {{ t('CommandPalette.No Results') }}
            </p>
          </div>
        </div>

        <footer
          v-if="showShortcuts"
          class="commandPaletteFooter"
          aria-hidden="true"
        >
          <span><kbd>{{ t('CommandPalette.Keys.Up') }}</kbd><kbd>{{ t('CommandPalette.Keys.Down') }}</kbd> {{ t('CommandPalette.Move') }}</span>
          <span><kbd>{{ t('Keys.enter') }}</kbd> {{ t('CommandPalette.Run') }}</span>
          <span><kbd>{{ t('CommandPalette.Keys.Escape') }}</kbd> {{ t('Close') }}</span>
        </footer>
        <p
          :id="statusId"
          class="visuallyHidden"
          aria-live="polite"
        >
          {{ resultStatus }}
        </p>
      </section>
    </div>
  </Teleport>
</template>

<script setup>
import FtRetryImage from '../FtRetryImage.vue'
import { FtIcon } from '@opentubex/icons'
import { computed, nextTick, onBeforeMount, onBeforeUnmount, onMounted, ref, useId, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { filterCommandPaletteCommands, highlightCommandText } from '../../helpers/commandPalette'
import { clampOverlayScrollTop, restoreOverlayScrollTop } from '../../helpers/overlayScrollbars'
import { getLocalizedShortcut } from '../../helpers/utils'
import store from '../../store/index'
import FtProfileIcon from '../FtProfileIcon/FtProfileIcon.vue'
import { lockBodyScroll, unlockBodyScroll } from '../FtPrompt/scrollLock'

const props = defineProps({
  commands: {
    type: Array,
    required: true
  },
  showShortcuts: {
    type: Boolean,
    default: true
  }
})

const emit = defineEmits(['close'])
const { locale, t } = useI18n()
const promptId = `command-palette-${useId().replaceAll(':', '')}`
const listId = `command-palette-list-${useId().replaceAll(':', '')}`
const statusId = `command-palette-status-${useId().replaceAll(':', '')}`
const teleportTarget = document.fullscreenElement ?? '.app'
const query = ref('')
const selectedIndex = ref(0)
const inputRef = useTemplateRef('inputRef')
const closeButtonRef = useTemplateRef('closeButtonRef')
const resultsRef = useTemplateRef('resultsRef')
const resultsContentRef = useTemplateRef('resultsContentRef')
const failedIconUrls = ref(new Set())
let lastActiveElement = null
let resultsResizeObserver = null

const filteredCommands = computed(() => {
  const matches = filterCommandPaletteCommands(props.commands, query.value, locale.value)
  return query.value.trim() === ''
    ? matches.filter(command => (
        !command.searchOnly && (!command.contextual || !command.disabledReason)
      ))
    : matches
})

const groupedCommands = computed(() => {
  const groups = []
  for (const command of filteredCommands.value) {
    let group = groups.find(candidate => candidate.name === command.group)
    if (!group) {
      group = { name: command.group, commands: [] }
      groups.push(group)
    }
    group.commands.push(command)
  }
  return groups
})
const displayedCommands = computed(() => (
  groupedCommands.value.flatMap(group => group.commands)
))
const selectedCommand = computed(() => displayedCommands.value[selectedIndex.value] ?? null)
const activeOptionId = computed(() => selectedCommand.value ? optionId(selectedCommand.value) : undefined)
const resultStatus = computed(() => t(
  'CommandPalette.Result Count',
  { count: displayedCommands.value.length },
  displayedCommands.value.length
))

onBeforeMount(lockBodyScroll)

onMounted(() => {
  lastActiveElement = document.activeElement
  store.commit('addOpenPrompt', promptId)
  nextTick(() => inputRef.value?.focus())

  if (typeof ResizeObserver === 'function') {
    resultsResizeObserver = new ResizeObserver(clampResultsScroll)
    if (resultsRef.value) resultsResizeObserver.observe(resultsRef.value)
    if (resultsContentRef.value) resultsResizeObserver.observe(resultsContentRef.value)
  }
})

onBeforeUnmount(() => {
  resultsResizeObserver?.disconnect()
  store.commit('removeOpenPrompt', promptId)
  unlockBodyScroll()
  nextTick(() => {
    if (document.activeElement === document.body) lastActiveElement?.focus()
  })
})

watch([query, () => props.commands], async () => {
  selectedIndex.value = 0
  await nextTick()
  if (resultsRef.value) restoreOverlayScrollTop(resultsRef.value, 0)
  clampResultsScroll()
})

watch(selectedIndex, scrollSelectionIntoView)

function optionId(command) {
  return `${listId}-${command.id.replaceAll(/[^a-zA-Z0-9_-]/g, '-')}`
}

function highlightedLabel(command) {
  return highlightCommandText(command.label, query.value, locale.value)
}

function hasUsableIconUrl(command) {
  return command.iconUrl && !failedIconUrls.value.has(command.iconUrl)
}

function handleIconError(iconUrl) {
  failedIconUrls.value = new Set([...failedIconUrls.value, iconUrl])
}

function close() {
  emit('close')
}

function moveSelection(direction) {
  const length = displayedCommands.value.length
  if (length === 0) return
  selectedIndex.value = (selectedIndex.value + direction + length) % length
}

function selectBoundary(index) {
  if (displayedCommands.value.length > 0) selectedIndex.value = index
}

function selectCommand(command) {
  const index = displayedCommands.value.findIndex(candidate => candidate.id === command.id)
  if (index !== -1) selectedIndex.value = index
}

function runSelectedCommand() {
  if (selectedCommand.value) runCommand(selectedCommand.value)
}

function runCommand(command) {
  if (command.disabledReason) return
  close()
  command.run()
}

function scrollSelectionIntoView() {
  nextTick(() => {
    if (!selectedCommand.value) return
    document.getElementById(optionId(selectedCommand.value))?.scrollIntoView({ block: 'nearest' })
  })
}

function clampResultsScroll() {
  if (resultsRef.value && resultsContentRef.value) {
    clampOverlayScrollTop(resultsRef.value, resultsContentRef.value)
  }
}

function handleDialogKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    close()
    return
  }
  if (event.key !== 'Tab') return

  const focusTargets = [inputRef.value, closeButtonRef.value].filter(Boolean)
  const currentIndex = focusTargets.indexOf(document.activeElement)
  const direction = event.shiftKey ? -1 : 1
  const nextIndex = (currentIndex + direction + focusTargets.length) % focusTargets.length
  event.preventDefault()
  focusTargets[nextIndex]?.focus()
}
</script>

<style scoped src="./FtCommandPalette.css" />
