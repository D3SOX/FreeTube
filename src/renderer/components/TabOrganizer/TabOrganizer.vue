<template>
  <Teleport :to="teleportTarget">
    <div
      class="tabOrganizerBackdrop"
      @pointerdown.self.stop
      @click.self.stop="close"
      @keydown.esc="close"
    >
      <section
        ref="dialogRef"
        class="tabOrganizer"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        :inert="sessionToDelete !== null || sessionToOpen !== null"
        @keydown="handleDialogKeydown"
      >
        <header class="tabOrganizerHeader">
          <div>
            <h2 :id="titleId">
              {{ t('Tab Organizer.Title') }}
            </h2>
            <span>{{ t('Tab Organizer.Open Tab Count', { count: tabs.length }, tabs.length) }}</span>
          </div>
          <button
            type="button"
            class="iconButton"
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

        <div class="tabOrganizerControls">
          <div class="selectionControls">
            <span aria-live="polite">
              {{ t('Tab Organizer.Selected Count', { count: selectedTabs.length }, selectedTabs.length) }}
            </span>
            <button
              type="button"
              :disabled="tabs.length === 0"
              @click="toggleAllTabsSelection"
            >
              <FtIcon
                :icon="['fas', hasSelectedTabs ? 'xmark' : 'check']"
                aria-hidden="true"
              />
              {{ hasSelectedTabs ? t('Tab Organizer.Select None') : t('Tab Organizer.Select All') }}
            </button>
            <FtSelect
              v-if="moveTargets.length > 0"
              class="compactSelect"
              :placeholder="t('Tab Organizer.Move To Window')"
              :value="selectedWindowTarget"
              :select-names="windowSelectNames"
              :select-values="windowSelectValues"
              :disabled="selectedTabs.length === 0"
              :show-icon="false"
              @change="moveSelectedTabsToWindow"
            />
          </div>
          <div class="bulkActions">
            <button
              type="button"
              :disabled="!canPinSelectedTabs"
              @click="setSelectedPinned(true)"
            >
              <FtIcon
                :icon="['fas', 'thumbtack']"
                aria-hidden="true"
              />
              {{ t('Tab Organizer.Pin') }}
            </button>
            <button
              type="button"
              :disabled="!canUnpinSelectedTabs"
              @click="setSelectedPinned(false)"
            >
              <FtIcon
                :icon="['fas', 'thumbtack-slash']"
                aria-hidden="true"
              />
              {{ t('Tab Organizer.Unpin') }}
            </button>
            <button
              type="button"
              :disabled="!canLoadSelectedTabs"
              @click="runAction('load', selectedTabIdsArray)"
            >
              <FtIcon
                :icon="['fas', 'download']"
                aria-hidden="true"
              />
              {{ t('Tab Organizer.Load') }}
            </button>
            <button
              type="button"
              :disabled="!canUnloadSelectedTabs"
              @click="runAction('unload', selectedTabIdsArray)"
            >
              <FtIcon
                :icon="['fas', 'right-from-bracket']"
                aria-hidden="true"
              />
              {{ t('Tab Organizer.Unload') }}
            </button>
            <button
              type="button"
              class="dangerButton"
              :disabled="selectedTabs.length === 0"
              @click="runAction('close', selectedTabIdsArray)"
            >
              <FtIcon
                :icon="['fas', 'rectangle-xmark']"
                aria-hidden="true"
              />
              {{ t('Close') }}
            </button>
            <FtSelect
              class="compactSelect bulkActionSelect"
              :placeholder="t('Tab Organizer.Move To Group')"
              :value="selectedGroupTarget"
              :select-names="groupSelectNames"
              :select-values="groupSelectValues"
              :option-colors="groupSelectColors"
              :option-icons="groupSelectIcons"
              :disabled="selectedTabs.length === 0"
              :show-icon="false"
              @change="moveSelectedTabsToGroup"
            />
            <label class="tabOrganizerSearch">
              <FtIcon
                class="searchIcon"
                :icon="['fas', 'magnifying-glass']"
                aria-hidden="true"
              />
              <input
                ref="searchRef"
                v-model="query"
                type="search"
                autocomplete="off"
                :placeholder="t('Tab Organizer.Search Label')"
                :aria-label="t('Tab Organizer.Search Label')"
              >
            </label>
          </div>
          <form
            class="newGroupForm"
            @submit.prevent="createGroup"
          >
            <label>
              <span class="controlLabel">{{ t('Tab Organizer.Group Name') }}</span>
              <input
                v-model="newGroupName"
                class="groupNameInput"
                type="text"
                maxlength="80"
                :placeholder="t('Tab Organizer.Group Name')"
              >
            </label>
            <FtSelect
              class="compactSelect colorSelect"
              :placeholder="t('Tab Organizer.Color')"
              :value="newGroupColor"
              :select-names="colorSelectNames"
              :select-values="colorSelectValues"
              :option-colors="colorSelectColors"
              :show-icon="false"
              @change="newGroupColor = $event"
            />
            <button
              type="submit"
              :disabled="newGroupName.trim().length === 0"
            >
              <FtIcon
                :icon="['fas', 'plus']"
                aria-hidden="true"
              />
              {{ t('Tab Organizer.Create Group') }}
            </button>
          </form>
        </div>

        <div
          ref="scrollRef"
          v-overlay-scrollbars
          class="tabOrganizerScroll"
        >
          <div
            ref="scrollContentRef"
            class="tabOrganizerScrollContent"
          >
            <section
              v-for="section in displayedSections"
              :key="section.id ?? 'ungrouped'"
              class="tabGroup"
              :class="{ dropTarget: draggedTabIds.length > 0 && dragTargetGroupId === section.id }"
              @dragenter.prevent="dragTargetGroupId = section.id"
              @dragover.prevent="handleTabDragOver"
              @dragleave="handleGroupDragLeave($event, section.id)"
              @drop.prevent="dropTabsOnGroup(section.id)"
            >
              <header class="tabGroupHeader">
                <FtCheckboxList
                  class="tabSelection groupSelection"
                  :model-value="section.allTabs.length > 0 && section.allTabs.every(tab => selectedTabIds.has(tab.id)) ? ['group'] : []"
                  :labels="[`${t('Tab Organizer.Select All')}: ${section.name}`]"
                  :values="['group']"
                  :disabled="section.allTabs.length === 0"
                  @update:model-value="toggleGroupSelection(section, $event.includes('group'))"
                />
                <button
                  v-if="section.id"
                  type="button"
                  class="collapseButton"
                  :aria-label="section.isCollapsed ? t('Tab Organizer.Expand Group') : t('Tab Organizer.Collapse Group')"
                  :aria-expanded="!section.isCollapsed || normalizedQuery.length > 0"
                  @click="toggleGroup(section)"
                >
                  <FtIcon
                    :icon="['fas', section.isCollapsed ? 'chevron-right' : 'angle-down']"
                    aria-hidden="true"
                  />
                </button>
                <div
                  v-if="section.id"
                  class="groupIconEditor"
                  @focusout="handleIconPickerFocusOut($event, section.id)"
                  @keydown.esc="closeIconPicker"
                >
                  <button
                    type="button"
                    class="groupIconButton"
                    :aria-label="t('Tab Organizer.Group Icon')"
                    :title="t('Tab Organizer.Group Icon')"
                    :aria-expanded="editingIconGroupId === section.id"
                    @click="toggleIconPicker(section.id)"
                  >
                    <FtIcon
                      :icon="['fas', normalizeTabGroupIcon(section.icon)]"
                      aria-hidden="true"
                    />
                  </button>
                  <div
                    v-if="editingIconGroupId === section.id"
                    class="groupIconPicker"
                    role="group"
                    :aria-label="t('Tab Organizer.Group Icon')"
                  >
                    <button
                      v-for="(icon, index) in groupIconValues"
                      :key="icon"
                      type="button"
                      :aria-pressed="normalizeTabGroupIcon(section.icon) === icon"
                      :aria-label="groupIconNames[index]"
                      :title="groupIconNames[index]"
                      @click="updateGroupIcon(section.id, icon)"
                    >
                      <FtIcon
                        :icon="['fas', icon]"
                        aria-hidden="true"
                      />
                    </button>
                  </div>
                </div>
                <div
                  v-if="section.id"
                  class="groupColorEditor"
                  @focusout="handleColorPickerFocusOut($event, section.id)"
                >
                  <button
                    type="button"
                    class="groupColorButton"
                    :aria-label="t('Tab Organizer.Change Group Color', { name: section.name })"
                    :title="t('Tab Organizer.Change Group Color', { name: section.name })"
                    :aria-expanded="editingColorGroupId === section.id"
                    @click="toggleColorPicker(section.id)"
                  >
                    <span
                      class="groupColor"
                      :class="{ noColor: !section.color }"
                      :style="section.color ? { '--group-color': getTabAccentColor(section.color) } : null"
                      aria-hidden="true"
                    />
                  </button>
                  <div
                    v-if="editingColorGroupId === section.id"
                    class="groupColorPicker"
                    role="listbox"
                    :aria-label="t('Tab Organizer.Change Group Color', { name: section.name })"
                  >
                    <button
                      v-for="color in editableGroupColors"
                      :key="color.value || 'none'"
                      type="button"
                      role="option"
                      :aria-selected="(section.color ?? '') === color.value"
                      :aria-label="color.label"
                      :title="color.label"
                      @click="updateGroupColor(section.id, color.value)"
                    >
                      <span
                        class="groupColor"
                        :class="{ noColor: color.value === '' }"
                        :style="color.value ? { '--group-color': color.color } : null"
                        aria-hidden="true"
                      />
                    </button>
                  </div>
                </div>
                <template v-if="section.id && editingNameGroupId === section.id">
                  <input
                    v-model="editingGroupName"
                    class="groupRenameInput"
                    type="text"
                    maxlength="80"
                    :aria-label="t('Tab Organizer.Group Name')"
                    :data-group-name-input="section.id"
                    @blur="finishGroupRename(section.id)"
                    @keydown.enter.prevent="finishGroupRename(section.id)"
                    @keydown.escape.stop.prevent="cancelGroupRename"
                  >
                </template>
                <h3 v-else>
                  <button
                    v-if="section.id"
                    type="button"
                    class="groupNameButton"
                    :aria-label="t('Tab Organizer.Rename Group', { name: section.name })"
                    :title="t('Tab Organizer.Rename Group', { name: section.name })"
                    @click="startGroupRename(section)"
                  >
                    <span>{{ section.name }}</span>
                    <FtIcon
                      :icon="['fas', 'edit']"
                      aria-hidden="true"
                    />
                  </button>
                  <template v-else>
                    {{ section.name }}
                  </template>
                </h3>
                <span class="tabGroupCount">
                  {{ t('Tab Organizer.Tab Count', { count: section.tabs.length }, section.tabs.length) }}
                </span>
                <div
                  v-if="section.id"
                  class="groupActions"
                >
                  <button
                    v-if="section.allTabs.length > 0"
                    type="button"
                    :disabled="section.allTabs.every(tab => tab.isUnloaded)"
                    @click="runAction('unload', section.allTabs.map(tab => tab.id))"
                  >
                    <FtIcon
                      :icon="['fas', 'right-from-bracket']"
                      aria-hidden="true"
                    />
                    {{ t('Tab Organizer.Unload All') }}
                  </button>
                  <FtSelect
                    v-if="section.allTabs.length > 0 && moveTargets.length > 0"
                    class="compactSelect groupWindowSelect"
                    :placeholder="t('Tab Organizer.Move To Window')"
                    value=""
                    :select-names="groupWindowSelectNames"
                    :select-values="windowSelectValues"
                    :show-icon="false"
                    @change="moveGroupToWindow(section, $event)"
                  />
                  <button
                    v-if="section.allTabs.length > 0"
                    type="button"
                    class="dangerButton"
                    @click="runAction('close', section.allTabs.map(tab => tab.id))"
                  >
                    <FtIcon
                      :icon="['fas', 'rectangle-xmark']"
                      aria-hidden="true"
                    />
                    {{ t('Tab Organizer.Close All') }}
                  </button>
                  <button
                    type="button"
                    @click="deleteGroup(section.id)"
                  >
                    <FtIcon
                      :icon="['fas', 'link-slash']"
                      aria-hidden="true"
                    />
                    {{ t('Tab Organizer.Ungroup') }}
                  </button>
                </div>
              </header>
              <ul v-if="!section.isCollapsed || normalizedQuery.length > 0">
                <li
                  v-for="tab in section.tabs"
                  :key="tab.id"
                  class="tabOrganizerRow"
                  :class="{
                    active: tab.id === activeTabId,
                    dragging: draggedTabIds.includes(tab.id)
                  }"
                  draggable="true"
                  @dragstart="startTabDrag($event, tab.id)"
                  @dragend="finishTabDrag"
                >
                  <span
                    class="dragHandle"
                    :title="t('Tab Organizer.Drag Tab')"
                    aria-hidden="true"
                  >
                    <FtIcon :icon="['fas', 'grip']" />
                  </span>
                  <FtCheckboxList
                    class="tabSelection"
                    :model-value="selectedTabIds.has(tab.id) ? [tab.id] : []"
                    :labels="[t('Tab Organizer.Select Tab', { title: formatTabTitle(tab.title) })]"
                    :values="[tab.id]"
                    @click.capture="handleTabSelectionClick($event, tab.id)"
                    @update:model-value="toggleTabSelection(tab.id, $event.includes(tab.id))"
                  />
                  <span class="tabIcon">
                    <FtRetryImage
                      v-if="usableTabAvatarUrl(tab)"
                      :src="usableTabAvatarUrl(tab)"
                      alt=""
                      draggable="false"
                      @error="handleTabAvatarError(tab)"
                    />
                    <FtIcon
                      v-else
                      :icon="getTabPageIcon(tab) || ['fas', 'display']"
                      aria-hidden="true"
                    />
                  </span>
                  <button
                    type="button"
                    class="tabIdentity"
                    @click="activateTab(tab.id)"
                  >
                    <span>{{ formatTabTitle(tab.title) }}</span>
                    <small>{{ tab.route.fullPath || tab.url }}</small>
                  </button>
                  <div class="tabIndicators">
                    <span v-if="tab.id === activeTabId">{{ t('Tab Organizer.Active') }}</span>
                    <span v-if="tab.isPinned">{{ t('Tab Organizer.Pinned') }}</span>
                    <span v-if="tab.isUnloaded">{{ t('Tab Organizer.Unloaded') }}</span>
                    <span v-if="tab.isPlaying">{{ t('Tab Organizer.Playing') }}</span>
                  </div>
                  <button
                    type="button"
                    class="iconButton"
                    :aria-label="t('Tab Organizer.Close Tab', { title: formatTabTitle(tab.title) })"
                    :title="t('Close')"
                    @click="runAction('close', [tab.id])"
                  >
                    <FtIcon
                      :icon="['fas', 'xmark']"
                      aria-hidden="true"
                    />
                  </button>
                </li>
              </ul>
            </section>

            <p
              v-if="visibleTabs.length === 0 && visibleOtherDeviceSessions.length === 0"
              class="emptyMessage"
            >
              {{ t('Tab Organizer.No Open Results') }}
            </p>

            <section
              v-if="showSyncedTabs && (normalizedQuery.length === 0 || visibleOtherDeviceSessions.length > 0)"
              class="syncedTabsSection"
            >
              <header class="syncedTabsHeader">
                <h3>
                  <FtIcon
                    class="syncedTabsIcon"
                    :icon="['fas', 'layer-group']"
                    aria-hidden="true"
                  />
                  {{ t('Settings.Sync Settings.Tabs From Other Devices') }}
                </h3>
              </header>
              <div
                class="syncedSessionTabs"
                role="tablist"
                :aria-label="t('Settings.Sync Settings.Tabs From Other Devices')"
              >
                <button
                  v-for="(session, index) in visibleOtherDeviceSessions"
                  :id="syncedSessionTabId(index)"
                  :key="`${session.syncDeviceId}:${session.sessionId}`"
                  type="button"
                  class="syncedSessionTab"
                  :class="{ selected: activeOtherDeviceSessionKey === otherDeviceSessionKey(session) }"
                  role="tab"
                  :aria-controls="syncedSessionPanelId"
                  :aria-selected="activeOtherDeviceSessionKey === otherDeviceSessionKey(session)"
                  :tabindex="activeOtherDeviceSessionKey === otherDeviceSessionKey(session) ? 0 : -1"
                  @click="selectOtherDeviceSession(session)"
                  @keydown.left.prevent="selectOtherDeviceSessionAt(index - 1, true)"
                  @keydown.right.prevent="selectOtherDeviceSessionAt(index + 1, true)"
                  @keydown.home.prevent="selectOtherDeviceSessionAt(0, true)"
                  @keydown.end.prevent="selectOtherDeviceSessionAt(visibleOtherDeviceSessions.length - 1, true)"
                >
                  <span class="syncedSessionIcon">
                    <FtIcon
                      :icon="session.syncPlatform === 'mobile' ? ['fas', 'smartphone'] : ['fas', 'display']"
                      aria-hidden="true"
                    />
                  </span>
                  <strong>{{ formatDeviceSessionLabel(session, t) }}</strong>
                </button>
              </div>
              <div class="syncedSessionPanels">
                <article
                  v-if="activeOtherDeviceSession"
                  :id="syncedSessionPanelId"
                  :key="activeOtherDeviceSessionKey"
                  class="syncedSessionCard"
                  role="tabpanel"
                  :aria-labelledby="activeOtherDeviceSessionTabId"
                >
                  <header class="syncedSessionHeader">
                    <div class="syncedSessionActions">
                      <button
                        type="button"
                        class="syncedSessionActionButton"
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
                        class="syncedSessionActionButton iconButton dangerButton"
                        :aria-label="`${t('Delete')}: ${formatDeviceSessionLabel(activeOtherDeviceSession, t)}`"
                        :title="t('Delete')"
                        @click="sessionToDelete = activeOtherDeviceSession"
                      >
                        <FtIcon
                          :icon="['fas', 'trash']"
                          aria-hidden="true"
                        />
                      </button>
                    </div>
                  </header>
                  <ul class="syncedTabList">
                    <li
                      v-for="tab in activeOtherDeviceSession.visibleTabs"
                      :key="tab.id"
                    >
                      <button
                        type="button"
                        class="syncedTabTarget"
                        @click="openOtherDeviceSession({ ...activeOtherDeviceSession, tabs: [tab] })"
                      >
                        <span class="tabIcon">
                          <FtRetryImage
                            v-if="usableTabAvatarUrl(syncedTabPreview(tab))"
                            :src="usableTabAvatarUrl(syncedTabPreview(tab))"
                            alt=""
                            @error="handleTabAvatarError(syncedTabPreview(tab))"
                          />
                          <FtIcon
                            v-else
                            :icon="getTabPageIcon(syncedTabPreview(tab)) || ['fas', 'display']"
                            aria-hidden="true"
                          />
                        </span>
                        <span class="syncedTabIdentity">
                          <span dir="auto">{{ formatTabTitle(tab.title || getSyncTabRoute(tab.url)) }}</span>
                          <small>{{ getSyncTabRoute(tab.url) }}</small>
                        </span>
                        <FtIcon
                          class="syncedTabOpenIcon"
                          :icon="['fas', 'arrow-up-right-from-square']"
                          aria-hidden="true"
                        />
                      </button>
                    </li>
                  </ul>
                </article>
              </div>
            </section>

            <section class="recentlyClosed">
              <header>
                <h3>{{ t('Tab Organizer.Recently Closed') }}</h3>
                <button
                  type="button"
                  class="dangerButton"
                  :disabled="closedTabs.length === 0"
                  @click="clearClosedTabs"
                >
                  <FtIcon
                    :icon="['fas', 'trash']"
                    aria-hidden="true"
                  />
                  {{ t('Tab Organizer.Clear') }}
                </button>
              </header>
              <ul v-if="visibleClosedTabs.length > 0">
                <li
                  v-for="tab in visibleClosedTabs"
                  :key="tab.id"
                  class="tabOrganizerRow closedTabRow"
                >
                  <span class="tabIcon">
                    <FtIcon
                      :icon="getTabPageIcon(tab) || ['fas', 'display']"
                      aria-hidden="true"
                    />
                  </span>
                  <div class="tabIdentity">
                    <span>{{ formatTabTitle(tab.title) }}</span>
                    <small>{{ tab.route.fullPath || tab.url }}</small>
                  </div>
                  <button
                    type="button"
                    @click="restoreClosedTab(tab.id)"
                  >
                    <FtIcon
                      :icon="['fas', 'clock-rotate-left']"
                      aria-hidden="true"
                    />
                    {{ t('Restore') }}
                  </button>
                </li>
              </ul>
              <p
                v-else
                class="emptyMessage"
              >
                {{ t('Tab Organizer.No Closed Results') }}
              </p>
            </section>
          </div>
        </div>
      </section>
    </div>
  </Teleport>
  <FtPrompt
    v-if="sessionToOpen"
    :busy="isOpeningSession"
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
    :label="t('Delete')"
    :extra-labels="[formatDeviceSessionLabel(sessionToDelete, t)]"
    :option-names="[t('Delete'), t('Cancel')]"
    :option-values="['delete', 'cancel']"
    is-first-option-destructive
    autosize
    @click="handleDeleteSessionPrompt"
  />
</template>

<script setup>
import FtRetryImage from '../FtRetryImage.vue'
import { FtIcon } from '@opentubex/icons'
import { computed, nextTick, onBeforeMount, onBeforeUnmount, onMounted, ref, useId, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { TAB_GROUP_ICONS, normalizeTabGroupIcon } from '../../../tabGroupIcons'
import { getTabAccentColor } from '../../constants/tabColors'
import { clampOverlayScrollTop, restoreOverlayScrollTop } from '../../helpers/overlayScrollbars'
import { formatDeviceSessionLabel, getSyncTabRoute, shouldShowOtherDeviceSessions } from '../../helpers/sync-sessions'
import { showToast } from '../../helpers/utils'
import store from '../../store/index'
import { getSyncedTabPreview as syncedTabPreview, getTabAvatarUrl, getTabPageIcon } from '../../tabs/tabPreview'
import { formatTabTitle } from '../../tabs/tabTitle'
import FtCheckboxList from '../FtCheckboxList/FtCheckboxList.vue'
import FtPrompt from '../FtPrompt/FtPrompt.vue'
import { lockBodyScroll, unlockBodyScroll } from '../FtPrompt/scrollLock'
import FtSelect from '../FtSelect/FtSelect.vue'

const emit = defineEmits(['close'])
const { locale, t } = useI18n()
const groupIconValues = TAB_GROUP_ICONS
const groupIconNames = computed(() => [
  t('Tab Organizer.Title'),
  t('Tab Organizer.Icon Labels.Folder'),
  t('Tab Organizer.Icon Labels.Bookmark'),
  t('Tab Organizer.Icon Labels.Favorites'),
  t('Tab Organizer.Icon Labels.Videos'),
  t('Tab Organizer.Icon Labels.Gaming'),
  t('Tab Organizer.Icon Labels.Research'),
  t('Tab Organizer.Icon Labels.Art'),
  t('Tab Organizer.Icon Labels.Travel')
])
const titleId = `tab-organizer-title-${useId().replaceAll(':', '')}`
const promptId = `tab-organizer-${useId().replaceAll(':', '')}`
const syncedSessionIdPrefix = `tab-organizer-synced-session-${useId().replaceAll(':', '')}`
const syncedSessionPanelId = `${syncedSessionIdPrefix}-panel`
const teleportTarget = document.fullscreenElement ?? '.app'
const query = ref('')
const newGroupName = ref('')
const newGroupColor = ref('')
const selectedGroupTarget = ref('')
const selectedWindowTarget = ref('')
const moveTargets = ref([])
const draggedTabIds = ref([])
const dragTargetGroupId = ref(undefined)
const editingNameGroupId = ref(null)
const editingGroupName = ref('')
const editingColorGroupId = ref(null)
const editingIconGroupId = ref(null)
const failedTabAvatarUrls = ref({})
const sessionToDelete = ref(null)
const sessionToOpen = ref(null)
const isOpeningSession = ref(false)
const selectedOtherDeviceSessionKey = ref(null)
const dialogRef = useTemplateRef('dialogRef')
const searchRef = useTemplateRef('searchRef')
const scrollRef = useTemplateRef('scrollRef')
const scrollContentRef = useTemplateRef('scrollContentRef')
let lastActiveElement = null
let resizeObserver = null
let selectionAnchorId = null

const tabs = computed(() => store.getters.getTabs)
const groups = computed(() => store.getters.getTabGroups)
const closedTabs = computed(() => store.getters.getClosedTabs)
const activeTabId = computed(() => store.getters.getActiveTabId)
const selectedTabIds = computed(() => new Set(store.getters.getSelectedTabIds))
const selectedTabIdsArray = computed(() => [...selectedTabIds.value])
const selectedTabs = computed(() => tabs.value.filter(tab => selectedTabIds.value.has(tab.id)))
const hasSelectedTabs = computed(() => selectedTabs.value.length > 0)
const canPinSelectedTabs = computed(() => selectedTabs.value.some(tab => !tab.isPinned))
const canUnpinSelectedTabs = computed(() => selectedTabs.value.some(tab => tab.isPinned))
const canLoadSelectedTabs = computed(() => selectedTabs.value.some(tab => tab.isUnloaded))
const canUnloadSelectedTabs = computed(() => selectedTabs.value.some(tab => !tab.isUnloaded))
const localizedTabColors = computed(() => [
  { value: 'red', label: t('Settings.Theme Settings.Main Color Theme.Red') },
  { value: 'orange', label: t('Settings.Theme Settings.Main Color Theme.Orange') },
  { value: 'yellow', label: t('Settings.Theme Settings.Main Color Theme.Yellow') },
  { value: 'green', label: t('Settings.Theme Settings.Main Color Theme.Green') },
  { value: 'blue', label: t('Settings.Theme Settings.Main Color Theme.Blue') },
  { value: 'purple', label: t('Context Menu.Purple') },
  { value: 'pink', label: t('Settings.Theme Settings.Main Color Theme.Pink') }
])
const editableGroupColors = computed(() => [
  { value: '', label: t('Tab Organizer.No Color'), color: null },
  ...localizedTabColors.value.map(color => ({
    ...color,
    color: getTabAccentColor(color.value)
  }))
])
const colorSelectNames = computed(() => editableGroupColors.value.map(color => color.label))
const colorSelectValues = computed(() => editableGroupColors.value.map(color => color.value))
const colorSelectColors = computed(() => editableGroupColors.value.map(color => color.color))
const groupSelectNames = computed(() => [
  t('Tab Organizer.Choose Group'),
  t('Tab Organizer.Ungrouped'),
  ...groups.value.map(group => group.name)
])
const groupSelectValues = computed(() => ['', 'ungrouped', ...groups.value.map(group => group.id)])
const groupSelectColors = computed(() => [
  undefined,
  undefined,
  ...groups.value.map(group => group.color ? getTabAccentColor(group.color) : null)
])
const groupSelectIcons = computed(() => [
  null,
  ['fas', 'link-slash'],
  ...groups.value.map(group => ['fas', normalizeTabGroupIcon(group.icon)])
])
const windowSelectNames = computed(() => [
  t('Tab Organizer.Choose Window'),
  ...moveTargets.value.map(target => target.label)
])
const groupWindowSelectNames = computed(() => [
  t('Tab Organizer.Move To Window'),
  ...moveTargets.value.map(target => target.label)
])
const windowSelectValues = computed(() => [
  '',
  ...moveTargets.value.map(target => String(target.windowId))
])
const normalizedQuery = computed(() => query.value.trim().toLocaleLowerCase(locale.value))
const visibleTabs = computed(() => tabs.value.filter(matchesSearch))
const visibleClosedTabs = computed(() => closedTabs.value.filter(matchesSearch))
const otherDeviceSessions = computed(() => store.getters.getSyncServerOtherDeviceSessions)
const showSyncedTabs = computed(() => shouldShowOtherDeviceSessions({
  syncEnabled: store.getters.getSyncServerEnabled,
  syncConnected: store.getters.getSyncServerToken !== '',
  enhancedSyncEnabled: store.getters.getSyncServerPrivacyMode === 'enhanced' &&
    store.getters.getSyncServerSyncSessions,
  sharedTabsEnabled: store.getters.getSyncServerSharedTabs,
  sessions: otherDeviceSessions.value,
}))
const visibleOtherDeviceSessions = computed(() => otherDeviceSessions.value
  .map(session => ({ ...session, visibleTabs: session.tabs.filter(matchesSearch) }))
  .filter(session => session.visibleTabs.length > 0))
const activeOtherDeviceSession = computed(() => (
  visibleOtherDeviceSessions.value.find(session => (
    otherDeviceSessionKey(session) === selectedOtherDeviceSessionKey.value
  )) ?? visibleOtherDeviceSessions.value[0] ?? null
))
const activeOtherDeviceSessionKey = computed(() => (
  activeOtherDeviceSession.value ? otherDeviceSessionKey(activeOtherDeviceSession.value) : null
))
const activeOtherDeviceSessionTabId = computed(() => {
  const activeIndex = visibleOtherDeviceSessions.value.findIndex(session => (
    otherDeviceSessionKey(session) === activeOtherDeviceSessionKey.value
  ))
  return syncedSessionTabId(Math.max(0, activeIndex))
})

const displayedSections = computed(() => {
  const sections = groups.value.map(group => ({
    ...group,
    allTabs: tabs.value.filter(tab => tab.groupId === group.id),
    tabs: visibleTabs.value.filter(tab => tab.groupId === group.id)
  }))
  sections.push({
    id: null,
    name: t('Tab Organizer.Ungrouped'),
    color: null,
    isCollapsed: false,
    allTabs: tabs.value.filter(tab => tab.groupId == null),
    tabs: visibleTabs.value.filter(tab => tab.groupId == null)
  })
  return normalizedQuery.value.length > 0
    ? sections.filter(section => section.tabs.length > 0)
    : sections
})

onBeforeMount(lockBodyScroll)

onMounted(async () => {
  lastActiveElement = document.activeElement
  store.commit('addOpenPrompt', promptId)
  if (showSyncedTabs.value) {
    store.dispatch('refreshSyncServerDeviceNames').catch(error => {
      console.error('Failed to refresh sync device names:', error)
    })
  }
  await window.ftElectron.tabs.setShortcutsBlocked(true).catch(error => {
    console.error('Failed to block shortcuts for the tab organizer:', error)
  })
  moveTargets.value = await window.ftElectron.tabs.getMoveTargets().catch(error => {
    console.error('Failed to load tab organizer move targets:', error)
    return []
  })
  await nextTick()
  searchRef.value?.focus()

  if (typeof ResizeObserver === 'function') {
    resizeObserver = new ResizeObserver(clampScroll)
    if (scrollRef.value) resizeObserver.observe(scrollRef.value)
    if (scrollContentRef.value) resizeObserver.observe(scrollContentRef.value)
  }
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  store.commit('removeOpenPrompt', promptId)
  window.ftElectron.tabs.setShortcutsBlocked(false).catch(() => {})
  unlockBodyScroll()
  nextTick(() => {
    if (document.activeElement === document.body) lastActiveElement?.focus()
  })
})

watch([query, groups, tabs, closedTabs, otherDeviceSessions], async () => {
  await nextTick()
  if (scrollRef.value && normalizedQuery.value.length > 0) {
    restoreOverlayScrollTop(scrollRef.value, 0)
  }
  clampScroll()
})

function matchesSearch(tab) {
  const needle = normalizedQuery.value
  if (needle.length === 0) return true
  const haystack = [tab.title, tab.url, tab.route?.fullPath, JSON.stringify(tab.route?.params), JSON.stringify(tab.route?.query)]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase(locale.value)
  return haystack.includes(needle)
}

function usableTabAvatarUrl(tab) {
  const avatarUrl = getTabAvatarUrl(tab)
  return failedTabAvatarUrls.value[tab.id] === avatarUrl ? null : avatarUrl
}

function handleTabAvatarError(tab) {
  failedTabAvatarUrls.value = {
    ...failedTabAvatarUrls.value,
    [tab.id]: getTabAvatarUrl(tab)
  }
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
  clampScroll()
  if (!focus) return

  const index = visibleOtherDeviceSessions.value.findIndex(candidate => (
    otherDeviceSessionKey(candidate) === selectedOtherDeviceSessionKey.value
  ))
  dialogRef.value?.querySelector(`#${syncedSessionTabId(index)}`)?.focus({ preventScroll: true })
}

function selectOtherDeviceSessionAt(index, focus = false) {
  const sessions = visibleOtherDeviceSessions.value
  if (sessions.length === 0) return
  const wrappedIndex = (index + sessions.length) % sessions.length
  selectOtherDeviceSession(sessions[wrappedIndex], focus)
}

async function openOtherDeviceSession(session) {
  await store.dispatch('openSyncServerSession', session)
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
    await openOtherDeviceSession(session)
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
    await store.dispatch('deleteSyncServerSession', session)
  } catch (error) {
    showToast({
      message: t('Settings.Sync Settings.Sync failed', { error: error.message }),
      icon: ['fas', 'circle-exclamation'],
    })
  }
}

function close() {
  emit('close')
}

function activateTab(tabId) {
  store.dispatch('activateTab', tabId)
}

function toggleGroupSelection(section, checked) {
  const next = new Set(selectedTabIds.value)
  for (const tab of section.allTabs) {
    if (checked) next.add(tab.id)
    else next.delete(tab.id)
  }
  store.dispatch('setTabSelection', [...next])
}

function toggleTabSelection(tabId, checked) {
  const next = new Set(selectedTabIds.value)
  if (checked) next.add(tabId)
  else next.delete(tabId)
  store.dispatch('setTabSelection', [...next])
}

function handleTabSelectionClick(event, tabId) {
  if (!event.shiftKey) {
    selectionAnchorId = tabId
    return
  }

  const displayedTabIds = displayedSections.value.flatMap(section => (
    !section.isCollapsed || normalizedQuery.value.length > 0
      ? section.tabs.map(tab => tab.id)
      : []
  ))
  const anchorIndex = displayedTabIds.indexOf(selectionAnchorId)
  const targetIndex = displayedTabIds.indexOf(tabId)
  if (anchorIndex === -1 || targetIndex === -1) {
    selectionAnchorId = tabId
    return
  }

  event.preventDefault()
  event.stopPropagation()
  event.currentTarget.querySelector('input[type="checkbox"]')?.focus()
  const [start, end] = [anchorIndex, targetIndex].sort((a, b) => a - b)
  store.dispatch('setTabSelection', displayedTabIds.slice(start, end + 1))
}

function toggleAllTabsSelection() {
  selectionAnchorId = null
  store.dispatch('setTabSelection', hasSelectedTabs.value ? [] : visibleTabs.value.map(tab => tab.id))
}

function setSelectedPinned(isPinned) {
  for (const tab of selectedTabs.value) {
    store.dispatch('setTabPinned', { tabId: tab.id, isPinned })
  }
}

async function runAction(action, tabIds) {
  if (tabIds.length === 0) return
  await store.dispatch('runTabOrganizerAction', { action, tabIds })
}

async function createGroup() {
  const group = await store.dispatch('createTabGroup', {
    name: newGroupName.value,
    color: newGroupColor.value || null
  })
  if (!group) return

  if (selectedTabIdsArray.value.length > 0) {
    await store.dispatch('setTabsGroup', {
      tabIds: selectedTabIdsArray.value,
      groupId: group.id
    })
  }
  newGroupName.value = ''
  newGroupColor.value = ''
}

async function moveSelectedTabsToGroup(groupId) {
  selectedGroupTarget.value = groupId
  if (groupId.length === 0) return
  await store.dispatch('setTabsGroup', {
    tabIds: selectedTabIdsArray.value,
    groupId: groupId === 'ungrouped' ? null : groupId
  })
  selectedGroupTarget.value = ''
}

function toggleGroup(group) {
  store.dispatch('updateTabGroup', {
    groupId: group.id,
    changes: { isCollapsed: !group.isCollapsed }
  })
}

function deleteGroup(groupId) {
  store.dispatch('deleteTabGroup', groupId)
}

async function moveGroupToWindow(group, value) {
  const targetWindowId = Number.parseInt(value, 10)
  if (!Number.isInteger(targetWindowId)) return
  await window.ftElectron.tabs.moveToWindow(group.allTabs.map(tab => tab.id), targetWindowId)
}

async function moveSelectedTabsToWindow(value) {
  selectedWindowTarget.value = value
  const targetWindowId = Number.parseInt(value, 10)
  if (!Number.isInteger(targetWindowId)) return
  await window.ftElectron.tabs.moveToWindow(selectedTabIdsArray.value, targetWindowId)
  selectedWindowTarget.value = ''
}

async function startGroupRename(group) {
  editingIconGroupId.value = null
  editingColorGroupId.value = null
  editingNameGroupId.value = group.id
  editingGroupName.value = group.name
  await nextTick()
  const input = dialogRef.value?.querySelector(`[data-group-name-input="${CSS.escape(group.id)}"]`)
  input?.focus()
  input?.select()
}

async function finishGroupRename(groupId) {
  if (editingNameGroupId.value !== groupId) return
  const name = editingGroupName.value.trim()
  editingNameGroupId.value = null
  editingGroupName.value = ''
  if (name.length === 0) return
  await store.dispatch('updateTabGroup', {
    groupId,
    changes: { name }
  })
}

function cancelGroupRename() {
  editingNameGroupId.value = null
  editingGroupName.value = ''
}

function toggleIconPicker(groupId) {
  cancelGroupRename()
  editingColorGroupId.value = null
  editingIconGroupId.value = editingIconGroupId.value === groupId ? null : groupId
}

function closeIconPicker(event) {
  if (editingIconGroupId.value === null) return
  event.stopPropagation()
  event.preventDefault()
  editingIconGroupId.value = null
  event.currentTarget.querySelector('.groupIconButton')?.focus()
}

async function updateGroupIcon(groupId, icon) {
  dialogRef.value?.querySelector('.groupIconEditor:focus-within .groupIconButton')?.focus()
  editingIconGroupId.value = null
  await store.dispatch('updateTabGroup', { groupId, changes: { icon } })
}

function handleIconPickerFocusOut(event, groupId) {
  if (event.currentTarget.contains(event.relatedTarget)) return
  if (editingIconGroupId.value === groupId) editingIconGroupId.value = null
}

function toggleColorPicker(groupId) {
  editingIconGroupId.value = null
  cancelGroupRename()
  editingColorGroupId.value = editingColorGroupId.value === groupId ? null : groupId
}

async function updateGroupColor(groupId, color) {
  editingColorGroupId.value = null
  await store.dispatch('updateTabGroup', {
    groupId,
    changes: { color: color || null }
  })
}

function handleColorPickerFocusOut(event, groupId) {
  if (event.currentTarget.contains(event.relatedTarget)) return
  if (editingColorGroupId.value === groupId) editingColorGroupId.value = null
}

function restoreClosedTab(tabId) {
  store.dispatch('restoreClosedTab', tabId)
}

function clearClosedTabs() {
  store.dispatch('clearClosedTabs')
}

function startTabDrag(event, tabId) {
  draggedTabIds.value = selectedTabIds.value.has(tabId)
    ? selectedTabIdsArray.value
    : [tabId]
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('application/x-opentubex-tabs', draggedTabIds.value.join(','))
}

function handleTabDragOver(event) {
  event.dataTransfer.dropEffect = 'move'
}

function handleGroupDragLeave(event, groupId) {
  if (event.currentTarget.contains(event.relatedTarget)) return
  if (dragTargetGroupId.value === groupId) dragTargetGroupId.value = undefined
}

async function dropTabsOnGroup(groupId) {
  const tabIds = [...draggedTabIds.value]
  finishTabDrag()
  if (tabIds.length === 0) return
  await store.dispatch('setTabsGroup', { tabIds, groupId })
}

function finishTabDrag() {
  draggedTabIds.value = []
  dragTargetGroupId.value = undefined
}

function clampScroll() {
  if (scrollRef.value && scrollContentRef.value) {
    clampOverlayScrollTop(scrollRef.value, scrollContentRef.value)
  }
}

function handleDialogKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
    return
  }
  if (event.key !== 'Tab') return

  const focusTargets = Array.from(dialogRef.value?.querySelectorAll(
    'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])'
  ) ?? []).filter(element => element.offsetParent !== null)
  if (focusTargets.length === 0) return

  const first = focusTargets[0]
  const last = focusTargets.at(-1)
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}
</script>

<style scoped src="./TabOrganizer.css" />
