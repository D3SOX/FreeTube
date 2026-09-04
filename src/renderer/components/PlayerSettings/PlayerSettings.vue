<template>
  <FtSettingsSection
    v-bind="$attrs"
    :title="t('Settings.Player Settings.Player Settings')"
  >
    <div class="switchColumnGrid playerSwitchGrid">
      <div class="switchColumn">
        <FtToggleSwitch
          :label="t('Settings.Player Settings.Turn on Subtitles by Default')"
          :compact="true"
          :default-value="enableSubtitlesByDefault"
          setting-key="enableSubtitlesByDefault"
          @change="updateEnableSubtitlesByDefault"
        />
        <FtToggleSwitch
          v-if="!IS_CAPACITOR"
          :label="t('Settings.Player Settings.Scroll Volume Over Video Player')"
          :compact="true"
          :disabled="videoSkipMouseScroll"
          :default-value="videoVolumeMouseScroll"
          setting-key="videoVolumeMouseScroll"
          @change="updateVideoVolumeMouseScroll"
        />
        <FtToggleSwitch
          v-if="!IS_CAPACITOR"
          :label="t('Settings.Player Settings.Remember Volume')"
          :compact="true"
          :default-value="rememberVolume"
          setting-key="rememberVolume"
          @change="updateRememberVolume"
        />
        <FtToggleSwitch
          :label="t('Settings.Player Settings.Show Skip Silence Toggle')"
          :compact="true"
          :default-value="showSkipSilenceButton"
          setting-key="showSkipSilenceButton"
          :tooltip="t('Tooltips.Player Settings.Show Skip Silence Toggle')"
          @change="updateShowSkipSilenceButton"
        />
        <FtToggleSwitch
          :label="t('Settings.Player Settings.Enable Skip Silence by Default')"
          :compact="true"
          :disabled="!showSkipSilenceButton"
          :default-value="enableSkipSilenceByDefault"
          setting-key="enableSkipSilenceByDefault"
          :tooltip="t('Tooltips.Player Settings.Enable Skip Silence by Default')"
          @change="updateEnableSkipSilenceByDefault"
        />
        <FtToggleSwitch
          :label="t('Settings.Player Settings.Enable Video Zoom')"
          :compact="true"
          :default-value="enableVideoZoom"
          setting-key="enableVideoZoom"
          :tooltip="t('Tooltips.Player Settings.Enable Video Zoom')"
          @change="updateEnableVideoZoom"
        />
        <FtToggleSwitch
          :label="t('Settings.Player Settings.Hold to Double Playback Speed')"
          :compact="true"
          :default-value="holdToDoublePlaybackSpeed"
          setting-key="holdToDoublePlaybackSpeed"
          :tooltip="t('Tooltips.Player Settings.Hold to Double Playback Speed')"
          @change="updateHoldToDoublePlaybackSpeed"
        />
        <FtToggleSwitch
          :label="t('Settings.Player Settings.Scroll Playback Rate Over Video Player')"
          :compact="true"
          :default-value="videoPlaybackRateMouseScroll"
          setting-key="videoPlaybackRateMouseScroll"
          :tooltip="t('Tooltips.Player Settings.Scroll Playback Rate Over Video Player')"
          @change="updateVideoPlaybackRateMouseScroll"
        />
        <FtToggleSwitch
          :label="t('Settings.Player Settings.Skip by Scrolling Over Video Player')"
          :compact="true"
          :disabled="videoVolumeMouseScroll"
          :default-value="videoSkipMouseScroll"
          setting-key="videoSkipMouseScroll"
          :tooltip="t('Tooltips.Player Settings.Skip by Scrolling Over Video Player')"
          @change="updateVideoSkipMouseScroll"
        />
        <FtToggleSwitch
          :label="t('Settings.Player Settings.Multiply Seek Interval by Playback Rate')"
          :compact="true"
          :default-value="seekIntervalMultiplyByPlaybackRate"
          setting-key="seekIntervalMultiplyByPlaybackRate"
          :tooltip="t('Tooltips.Player Settings.Multiply Seek Interval by Playback Rate')"
          @change="updateSeekIntervalMultiplyByPlaybackRate"
        />
        <FtToggleSwitch
          :label="t('Global.Ambient Mode')"
          :compact="true"
          :default-value="ambientMode"
          setting-key="ambientMode"
          :tooltip="t('Tooltips.Player Settings.Ambient Mode')"
          @change="updateAmbientMode"
        />
        <FtToggleSwitch
          :label="t('Settings.Player Settings.Music Visualizer')"
          :compact="true"
          :default-value="musicVisualizer"
          setting-key="musicVisualizer"
          @change="updateMusicVisualizer"
        />
      </div>
      <div class="switchColumn">
        <FtToggleSwitch
          :label="t('Settings.Player Settings.Play Next Video')"
          :compact="true"
          :disabled="hideRecommendedVideos"
          :default-value="playNextVideo"
          setting-key="playNextVideo"
          @change="updatePlayNextVideo"
        />
        <FtToggleSwitch
          :label="t('Settings.Player Settings.Autoplay Playlists')"
          :compact="true"
          :default-value="autoplayPlaylists"
          setting-key="autoplayPlaylists"
          @change="updateAutoplayPlaylists"
        />
        <FtToggleSwitch
          :label="t('Settings.Player Settings.Autoplay Videos')"
          :compact="true"
          :default-value="autoplayVideos"
          setting-key="autoplayVideos"
          @change="updateAutoplayVideos"
        />
        <FtToggleSwitch
          :label="t('Settings.Player Settings.Use YouTube-style Shorts')"
          :compact="true"
          :default-value="useCustomShortsPlayer"
          setting-key="useCustomShortsPlayer"
          :tooltip="t('Tooltips.Player Settings.Use YouTube-style Shorts')"
          @change="updateUseCustomShortsPlayer"
        />
        <FtToggleSwitch
          :label="t('Settings.Player Settings.Loop Shorts')"
          :compact="true"
          :disabled="!useCustomShortsPlayer"
          :default-value="loopShorts"
          setting-key="loopShorts"
          :tooltip="t('Tooltips.Player Settings.Loop Shorts')"
          @change="updateLoopShorts"
        />
        <FtToggleSwitch
          :label="t('Settings.Player Settings.Automatically Open Chapters')"
          :compact="true"
          :default-value="autoOpenChapters"
          setting-key="autoOpenChapters"
          @change="updateAutoOpenChapters"
        />
        <FtToggleSwitch
          v-if="!IS_CAPACITOR"
          :label="t('Settings.Player Settings.Display Play Button In Video Player')"
          :compact="true"
          :default-value="displayVideoPlayButton"
          setting-key="displayVideoPlayButton"
          @change="updateDisplayVideoPlayButton"
        />
        <FtToggleSwitch
          v-if="!IS_CAPACITOR"
          :label="t('Settings.Player Settings.Use Document Picture-in-Picture')"
          :compact="true"
          :default-value="documentPictureInPictureEnabled"
          setting-key="documentPictureInPictureEnabled"
          :tooltip="t('Tooltips.Player Settings.Use Document Picture-in-Picture')"
          @change="updateDocumentPictureInPictureEnabled"
        />
        <FtToggleSwitch
          :label="t('Settings.Player Settings.Enter Fullscreen on Display Rotate')"
          :compact="true"
          :default-value="enterFullscreenOnDisplayRotate"
          setting-key="enterFullscreenOnDisplayRotate"
          @change="updateEnterFullscreenOnDisplayRotate"
        />
        <FtToggleSwitch
          v-if="IS_CAPACITOR"
          :label="t('Settings.Player Settings.Rotate Wide Videos to Landscape in Fullscreen')"
          :compact="true"
          :default-value="rotateFullscreenToLandscape"
          setting-key="rotateFullscreenToLandscape"
          @change="updateRotateFullscreenToLandscape"
        />
        <FtToggleSwitch
          v-if="IS_CAPACITOR"
          :label="t('Settings.Player Settings.Swipe Up or Down to Enter or Exit Fullscreen')"
          :compact="true"
          :default-value="enableMobileFullscreenSwipe"
          setting-key="enableMobileFullscreenSwipe"
          @change="updateEnableMobileFullscreenSwipe"
        />
        <FtToggleSwitch
          v-if="IS_CAPACITOR"
          :label="t('Settings.Player Settings.Continue Playback When Screen Is Locked')"
          :compact="true"
          :default-value="continuePlaybackWhenScreenIsLocked"
          setting-key="continuePlaybackWhenScreenIsLocked"
          :tooltip="t('Tooltips.Player Settings.Continue Playback When Screen Is Locked')"
          @change="updateContinuePlaybackWhenScreenIsLocked"
        />
        <FtToggleSwitch
          v-if="IS_CAPACITOR"
          :label="t('Settings.Player Settings.Swipe Gestures.Fullscreen Brightness')"
          :compact="true"
          :default-value="store.getters.getMobileFullscreenBrightness"
          setting-key="mobileFullscreenBrightness"
          @change="store.dispatch('updateMobileFullscreenBrightness', $event)"
        />
        <FtToggleSwitch
          :label="t('Settings.Player Settings.Show Playback Rate Adjusted Timestamp')"
          :compact="true"
          :default-value="showPlaybackRateAdjustedTimestamp"
          setting-key="showPlaybackRateAdjustedTimestamp"
          :tooltip="t('Tooltips.Player Settings.Show Playback Rate Adjusted Timestamp')"
          @change="updateShowPlaybackRateAdjustedTimestamp"
        />
        <FtToggleSwitch
          :label="t('Settings.Player Settings.Scroll Mini Player.When Scrolling Down')"
          :compact="true"
          :default-value="scrollMiniPlayerEnabled"
          setting-key="scrollMiniPlayerEnabled"
          @change="updateScrollMiniPlayerEnabled"
        />
        <FtToggleSwitch
          v-if="USING_ELECTRON || IS_CAPACITOR"
          :label="t('Settings.Player Settings.Scroll Mini Player.On All Tabs')"
          :compact="true"
          :default-value="scrollMiniPlayerOnAllTabs"
          :disabled="autoPictureInPictureTriggers.includes('tab')"
          setting-key="scrollMiniPlayerOnAllTabs"
          @change="updateScrollMiniPlayerOnAllTabs"
        />
      </div>
    </div>
    <FtFlexBox
      v-if="IS_CAPACITOR"
      class="autoPictureInPictureSettings"
    >
      <FtToggleSwitch
        :label="t('Settings.Player Settings.Auto Picture in Picture.Auto Picture in Picture')"
        :compact="true"
        :default-value="androidAutoPictureInPicture"
        setting-key="androidAutoPictureInPicture"
        @change="updateAndroidAutoPictureInPicture"
      />
    </FtFlexBox>
    <FtFlexBox
      v-else
      class="autoPictureInPictureSettings"
    >
      <FtCheckboxList
        v-model="autoPictureInPictureTriggers"
        :title="t('Settings.Player Settings.Auto Picture in Picture.Auto Picture in Picture')"
        :labels="autoPictureInPictureTriggerLabels"
        :values="AUTO_PIP_TRIGGER_VALUES"
        :disabled-values="supportsAutoPictureInPictureMinimize ? [] : ['minimize']"
        setting-key="autoPictureInPictureTriggers"
        :tooltips="supportsAutoPictureInPictureMinimize ? {} : { minimize: t('Settings.Player Settings.Auto Picture in Picture.Wayland Minimize Unsupported') }"
      />
    </FtFlexBox>
    <FtFlexBox class="playerSelectGrid">
      <template v-if="IS_CAPACITOR">
        <FtSelect
          :placeholder="t('Settings.Player Settings.Swipe Gestures.Left')"
          :value="store.getters.getMobileLeftSwipeAction"
          setting-key="mobileLeftSwipeAction"
          :select-names="mobileSwipeActionNames"
          :select-values="MOBILE_SWIPE_ACTION_VALUES"
          :tooltip="t('Settings.Player Settings.Swipe Gestures.Hint')"
          :icon="MOBILE_SWIPE_ACTION_ICONS[store.getters.getMobileLeftSwipeAction]"
          @change="store.dispatch('updateMobileLeftSwipeAction', $event)"
        />
        <FtSelect
          :placeholder="t('Settings.Player Settings.Swipe Gestures.Right')"
          :value="store.getters.getMobileRightSwipeAction"
          setting-key="mobileRightSwipeAction"
          :select-names="mobileSwipeActionNames"
          :select-values="MOBILE_SWIPE_ACTION_VALUES"
          :tooltip="t('Settings.Player Settings.Swipe Gestures.Hint')"
          :icon="MOBILE_SWIPE_ACTION_ICONS[store.getters.getMobileRightSwipeAction]"
          @change="store.dispatch('updateMobileRightSwipeAction', $event)"
        />
      </template>
      <FtSelect
        :placeholder="t('Settings.Player Settings.Default Viewing Mode.Default Viewing Mode')"
        :value="defaultViewingMode"
        setting-key="defaultViewingMode"
        :select-names="viewingModeNames"
        :select-values="viewingModeValues"
        :tooltip="t('Settings.Player Settings.Default Viewing Mode.Tooltip')"
        :icon="['fas', 'expand']"
        @change="updateDefaultViewingMode"
      />
      <FtSelect
        :placeholder="t('Settings.Player Settings.Default Video Format.Default Video Format')"
        :value="defaultVideoFormat"
        setting-key="defaultVideoFormat"
        :select-names="formatNames"
        :select-values="FORMAT_VALUES"
        :tooltip="t('Tooltips.Player Settings.Default Video Format')"
        :icon="['fas', 'file-video']"
        @change="updateDefaultVideoFormat"
      />
      <FtSelect
        :placeholder="t('Settings.Player Settings.Default Quality.Default Quality')"
        :value="defaultQuality"
        setting-key="defaultQuality"
        :select-names="qualityNames"
        :select-values="qualityValues"
        :icon="['fas', 'photo-film']"
        @change="updateDefaultQuality"
      />
      <FtSelect
        :placeholder="t('Settings.Player Settings.Video Playback Rate Interval')"
        :value="videoPlaybackRateIntervalString"
        setting-key="videoPlaybackRateInterval"
        :select-names="PLAYBACK_RATE_INTERVAL_VALUES"
        :select-values="PLAYBACK_RATE_INTERVAL_VALUES"
        :icon="['fas', 'gauge']"
        @change="updateVideoPlaybackRateInterval"
      />
    </FtFlexBox>
    <FtSliderGrid>
      <FtSlider
        :label="t('Settings.Player Settings.Next Video Interval')"
        :default-value="defaultInterval"
        setting-key="defaultInterval"
        :min-value="0"
        :max-value="60"
        :step="1"
        value-extension="s"
        @change="updateDefaultInterval"
      />
      <FtSlider
        :label="t('Settings.Player Settings.Autoplay Interruption Timer')"
        :default-value="defaultAutoplayInterruptionIntervalHours"
        setting-key="defaultAutoplayInterruptionIntervalHours"
        :min-value="1"
        :max-value="12"
        :step="1"
        value-extension="h"
        @change="updateDefaultAutoplayInterruptionIntervalHours"
      />
      <FtSlider
        :label="t('Settings.Player Settings.Fast-Forward / Rewind Interval')"
        :default-value="defaultSkipInterval"
        setting-key="defaultSkipInterval"
        :min-value="1"
        :max-value="70"
        :step="1"
        value-extension="s"
        @change="updateDefaultSkipInterval"
      />
      <FtSlider
        v-if="!IS_CAPACITOR"
        :label="t('Settings.Player Settings.Default Volume')"
        :default-value="defaultVolume"
        setting-key="defaultVolume"
        :min-value="0"
        :max-value="100"
        :step="1"
        value-extension="%"
        :disabled="rememberVolume"
        :tooltip="rememberVolume ? t('Tooltips.Player Settings.Default Volume') : ''"
        @change="updateDefaultVolume"
      />
      <FtSlider
        :label="t('Settings.Player Settings.Default Playback Rate')"
        :default-value="defaultPlayback"
        setting-key="defaultPlayback"
        :min-value="videoPlaybackRateInterval"
        :max-value="maxVideoPlaybackRate"
        :step="videoPlaybackRateInterval"
        value-extension="x"
        @change="updateDefaultPlayback"
      />
      <FtSlider
        :label="t('Settings.Player Settings.Max Video Playback Rate')"
        :default-value="maxVideoPlaybackRate"
        setting-key="maxVideoPlaybackRate"
        :min-value="2"
        :max-value="10"
        :step="1"
        value-extension="x"
        @change="updateMaxVideoPlaybackRate"
      />
    </FtSliderGrid>
    <br>
    <FtFlexBox>
      <FtToggleSwitch
        :label="t('Settings.Player Settings.Use Quick Playback Speed Bar')"
        :compact="true"
        :default-value="useQuickPlaybackSpeedBar"
        setting-key="useQuickPlaybackSpeedBar"
        :tooltip="t('Tooltips.Player Settings.Use Quick Playback Speed Bar')"
        @change="updateUseQuickPlaybackSpeedBar"
      />
      <div class="settingButtonWithSync">
        <FtButton
          :label="t('Settings.Player Settings.Customize Quick Playback Speed Bar')"
          :icon="['fas', 'sliders-h']"
          :disabled="!useQuickPlaybackSpeedBar"
          @click="showQuickPlaybackSpeedBarManager = true"
        />
        <FtSyncedSettingIndicator setting-key="quickPlaybackSpeedBarOptions" />
      </div>
    </FtFlexBox>
    <br>
    <FtFlexBox>
      <FtToggleSwitch
        :label="t('Settings.Player Settings.Screenshot.Enable')"
        :default-value="enableScreenshot"
        setting-key="enableScreenshot"
        @change="updateEnableScreenshot"
      />
    </FtFlexBox>
    <div v-if="enableScreenshot">
      <FtFlexBox>
        <FtSelect
          :placeholder="t('Settings.Player Settings.Screenshot.Mode')"
          :value="screenshotMode"
          setting-key="screenshotMode"
          :select-names="screenshotModeNames"
          :select-values="screenshotModeValues"
          :icon="['fas', 'expand']"
          @change="handleUpdateScreenshotMode"
        />
      </FtFlexBox>
      <FtFlexBox v-if="screenshotMode !== 'clipboard'">
        <FtSelect
          :placeholder="t('Settings.Player Settings.Screenshot.Format Label')"
          :value="screenshotFormat"
          setting-key="screenshotFormat"
          :select-names="SCREENSHOT_FORMAT_NAMES"
          :select-values="SCREENSHOT_FORMAT_VALUES"
          :icon="['fas', 'file-image']"
          @change="handleUpdateScreenshotFormat"
        />
        <FtSlider
          :label="t('Settings.Player Settings.Screenshot.Quality Label')"
          :default-value="screenshotQuality"
          setting-key="screenshotQuality"
          :min-value="0"
          :max-value="100"
          :step="1"
          value-extension="%"
          :disabled="screenshotFormat === 'png'"
          @change="updateScreenshotQuality"
        />
      </FtFlexBox>
      <FtFlexBox
        v-if="(USING_ELECTRON || IS_CAPACITOR) && screenshotMode === 'default_folder'"
        class="screenshotFolderContainer"
      >
        <p class="screenshotFolderLabel">
          {{ t('Settings.Player Settings.Screenshot.Folder Label') }}
        </p>
        <FtInput
          class="screenshotFolderPath"
          :placeholder="screenshotFolder"
          :show-action-button="false"
          :show-label="false"
          :disabled="true"
        />
        <FtButton
          :label="t('Settings.Player Settings.Screenshot.Folder Button')"
          :icon="['fas', 'folder-open']"
          class="screenshotFolderButton"
          @click="chooseScreenshotFolder"
        />
      </FtFlexBox>
      <FtFlexBox
        v-if="screenshotMode !== 'clipboard'"
        class="screenshotFolderContainer"
      >
        <p class="screenshotFilenamePatternTitle labelRow">
          {{ t('Settings.Player Settings.Screenshot.File Name Label') }}
          <FtTooltip
            class="selectTooltip"
            position="bottom"
            :tooltip="t('Settings.Player Settings.Screenshot.File Name Tooltip')"
          />
        </p>
        <FtInput
          class="screenshotFilenamePatternInput"
          placeholder=""
          :value="screenshotFilenamePattern"
          :show-action-button="false"
          :show-label="false"
          @input="handleScreenshotFilenamePatternChanged"
        />
        <FtInput
          class="screenshotFilenamePatternExample"
          :placeholder="screenshotFilenameExample"
          :show-action-button="false"
          :show-label="false"
          :disabled="true"
        />
      </FtFlexBox>
      <br>
    </div>
    <FtSettingsSubpage
      :open="showQuickPlaybackSpeedBarManager"
      :title="t('Settings.Player Settings.Quick Playback Speed Bar Manager')"
      :icon="['fas', 'gauge-high']"
      grow-with-content
      @close="showQuickPlaybackSpeedBarManager = false"
    >
      <div class="quickPlaybackSpeedToolbar">
        <FtFlexBox class="quickPlaybackSpeedToolbarActions">
          <FtButton
            :label="t('Settings.Player Settings.Add Playback Speed')"
            :icon="['fas', 'plus']"
            :disabled="quickPlaybackSpeedBarEntries.length >= QUICK_PLAYBACK_SPEED_LIMIT"
            @click="addQuickPlaybackSpeed"
          />
          <FtButton
            :label="t('Settings.Player Settings.Reset Quick Playback Speed Bar')"
            :icon="['fas', 'undo']"
            :disabled="!hasModifiedQuickPlaybackSpeedBarOptions"
            @click="resetQuickPlaybackSpeedBarOptions"
          />
        </FtFlexBox>
      </div>
      <div class="quickPlaybackSpeedList">
        <div
          v-for="(option, index) in quickPlaybackSpeedBarEntries"
          :key="option.id"
          class="quickPlaybackSpeedEntry"
          :class="{
            dragging: draggedQuickPlaybackSpeedId === option.id,
            settling: isQuickPlaybackSpeedDragSettling,
            suppressTransition: suppressQuickPlaybackSpeedDragTransitions
          }"
          :data-quick-playback-speed-index="index"
          :data-quick-playback-speed-id="option.id"
          :style="getQuickPlaybackSpeedEntryStyle(option.id)"
        >
          <button
            class="quickPlaybackSpeedDragHandle"
            type="button"
            :title="t('Settings.Player Settings.Reorder Playback Speed')"
            :aria-label="t('Settings.Player Settings.Reorder Playback Speed')"
            @pointerdown.prevent="startQuickPlaybackSpeedDrag(index, $event)"
          >
            <FtIcon :icon="['fas', 'bars']" />
          </button>
          <div class="quickPlaybackSpeedFields">
            <div
              v-if="editingQuickPlaybackSpeedNameId !== option.id"
              class="quickPlaybackSpeedNameRow"
            >
              <span class="quickPlaybackSpeedName">
                {{ getQuickPlaybackSpeedDisplayName(option) }}
              </span>
              <button
                class="quickPlaybackSpeedIconButton"
                type="button"
                :title="t('Settings.Player Settings.Edit Playback Speed Name')"
                :aria-label="t('Settings.Player Settings.Edit Playback Speed Name')"
                @click="editingQuickPlaybackSpeedNameId = option.id"
              >
                <FtIcon :icon="['fas', 'edit']" />
              </button>
            </div>
            <div
              v-else
              class="quickPlaybackSpeedNameEditRow"
            >
              <FtInput
                class="quickPlaybackSpeedNameInput"
                :placeholder="getAutomaticQuickPlaybackSpeedName(option.speed)"
                :value="option.name"
                :show-action-button="false"
                :show-label="false"
                @input="(value) => updateQuickPlaybackSpeedName(option.id, value)"
              />
              <button
                class="quickPlaybackSpeedIconButton"
                type="button"
                :title="t('Settings.Player Settings.Use Automatic Playback Speed Name')"
                :aria-label="t('Settings.Player Settings.Use Automatic Playback Speed Name')"
                @click="resetQuickPlaybackSpeedName(option.id)"
              >
                <FtIcon :icon="['fas', 'undo']" />
              </button>
            </div>
          </div>
          <input
            class="quickPlaybackSpeedInput"
            type="number"
            min="0.01"
            step="0.01"
            :aria-label="t('Settings.Player Settings.Playback Speed')"
            :value="option.speed"
            @change="(event) => updateQuickPlaybackSpeed(option.id, event.target.value)"
          >
          <button
            class="quickPlaybackSpeedIconButton delete"
            type="button"
            :disabled="quickPlaybackSpeedBarEntries.length <= 1"
            :title="t('Delete')"
            :aria-label="t('Delete')"
            @click="deleteQuickPlaybackSpeed(option.id)"
          >
            <FtIcon :icon="['fas', 'trash']" />
          </button>
        </div>
      </div>
    </FtSettingsSubpage>
  </FtSettingsSection>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import FtSettingsSection from '../FtSettingsSection/FtSettingsSection.vue'
import FtSelect from '../FtSelect/FtSelect.vue'
import FtToggleSwitch from '../FtToggleSwitch/FtToggleSwitch.vue'
import FtCheckboxList from '../FtCheckboxList/FtCheckboxList.vue'
import FtSlider from '../FtSlider/FtSlider.vue'
import FtSliderGrid from '../FtSliderGrid/FtSliderGrid.vue'
import FtFlexBox from '../ft-flex-box/ft-flex-box.vue'
import FtButton from '../FtButton/FtButton.vue'
import FtSyncedSettingIndicator from '../FtSyncedSettingIndicator/FtSyncedSettingIndicator.vue'
import FtInput from '../FtInput/FtInput.vue'
import FtTooltip from '../FtTooltip/FtTooltip.vue'
import FtSettingsSubpage from '../FtSettingsSubpage/FtSettingsSubpage.vue'

import store from '../../store/index'
import { chooseAndroidDirectory } from '../../helpers/androidStorage'
import { showToast } from '../../helpers/utils'
import { DEFAULT_QUICK_PLAYBACK_SPEED_BAR_OPTIONS } from '../../../constants'
import { initializePlatformInfo, supportsAutoPictureInPictureMinimize } from '../../helpers/platform'
import { AUTO_QUALITY_FALLBACK, playbackEngineSupportsAutoQuality } from '../../helpers/player/autoQuality'

defineOptions({ inheritAttrs: false })

const { t } = useI18n()

const QUICK_PLAYBACK_SPEED_DRAG_THRESHOLD_PX = 5
const QUICK_PLAYBACK_SPEED_SETTLE_DURATION_MS = 180
const QUICK_PLAYBACK_SPEED_LIMIT = 14

/** @type {boolean} */
const USING_ELECTRON = process.env.IS_ELECTRON
const IS_CAPACITOR = process.env.IS_CAPACITOR
const MOBILE_SWIPE_ACTION_VALUES = ['disabled', 'brightness', 'volume', 'speed']
const MOBILE_SWIPE_ACTION_ICONS = {
  disabled: ['fas', 'xmark'],
  brightness: ['fas', 'sun'],
  volume: ['fas', 'volume-high'],
  speed: ['fas', 'gauge-high'],
}
const mobileSwipeActionNames = computed(() => [
  t('Settings.Player Settings.Swipe Gestures.Disabled'),
  t('Settings.Player Settings.Swipe Gestures.Brightness'),
  t('Settings.Player Settings.Swipe Gestures.Volume'),
  t('Settings.Player Settings.Playback Speed'),
])

/** @type {import('vue').ComputedRef<boolean>} */
const enableSubtitlesByDefault = computed(() => store.getters.getEnableSubtitlesByDefault)

/**
 * @param {boolean} value
 */
function updateEnableSubtitlesByDefault(value) {
  store.dispatch('updateEnableSubtitlesByDefault', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const videoVolumeMouseScroll = computed(() => store.getters.getVideoVolumeMouseScroll)

/**
 * @param {boolean} value
 */
function updateVideoVolumeMouseScroll(value) {
  store.dispatch('updateVideoVolumeMouseScroll', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const rememberVolume = computed(() => store.getters.getRememberVolume)

/**
 * @param {boolean} value
 */
function updateRememberVolume(value) {
  store.dispatch('updateRememberVolume', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const showSkipSilenceButton = computed(() => store.getters.getShowSkipSilenceButton)

/**
 * @param {boolean} value
 */
function updateShowSkipSilenceButton(value) {
  store.dispatch('updateShowSkipSilenceButton', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const enableSkipSilenceByDefault = computed(() => store.getters.getEnableSkipSilenceByDefault)

/**
 * @param {boolean} value
 */
function updateEnableSkipSilenceByDefault(value) {
  store.dispatch('updateEnableSkipSilenceByDefault', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const enableVideoZoom = computed(() => store.getters.getEnableVideoZoom)

/**
 * @param {boolean} value
 */
function updateEnableVideoZoom(value) {
  store.dispatch('updateEnableVideoZoom', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const holdToDoublePlaybackSpeed = computed(() => store.getters.getHoldToDoublePlaybackSpeed)

/**
 * @param {boolean} value
 */
function updateHoldToDoublePlaybackSpeed(value) {
  store.dispatch('updateHoldToDoublePlaybackSpeed', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const videoPlaybackRateMouseScroll = computed(() => store.getters.getVideoPlaybackRateMouseScroll)

/**
 * @param {boolean} value
 */
function updateVideoPlaybackRateMouseScroll(value) {
  store.dispatch('updateVideoPlaybackRateMouseScroll', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const videoSkipMouseScroll = computed(() => store.getters.getVideoSkipMouseScroll)

/**
 * @param {boolean} value
 */
function updateVideoSkipMouseScroll(value) {
  store.dispatch('updateVideoSkipMouseScroll', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const seekIntervalMultiplyByPlaybackRate = computed(() => store.getters.getSeekIntervalMultiplyByPlaybackRate)

/**
 * @param {boolean} value
 */
function updateSeekIntervalMultiplyByPlaybackRate(value) {
  store.dispatch('updateSeekIntervalMultiplyByPlaybackRate', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const playNextVideo = computed(() => store.getters.getPlayNextVideo)

/**
 * @param {boolean} value
 */
function updatePlayNextVideo(value) {
  store.dispatch('updatePlayNextVideo', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const hideRecommendedVideos = computed(() => store.getters.getHideRecommendedVideos)

/** @type {import('vue').ComputedRef<boolean>} */
const autoplayPlaylists = computed(() => store.getters.getAutoplayPlaylists)

/**
 * @param {boolean} value
 */
function updateAutoplayPlaylists(value) {
  store.dispatch('updateAutoplayPlaylists', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const autoplayVideos = computed(() => store.getters.getAutoplayVideos)

/**
 * @param {boolean} value
 */
function updateAutoplayVideos(value) {
  store.dispatch('updateAutoplayVideos', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const useCustomShortsPlayer = computed(() => store.getters.getUseCustomShortsPlayer)

/**
 * @param {boolean} value
 */
function updateUseCustomShortsPlayer(value) {
  store.dispatch('updateUseCustomShortsPlayer', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const loopShorts = computed(() => store.getters.getLoopShorts)

/**
 * @param {boolean} value
 */
function updateLoopShorts(value) {
  store.dispatch('updateLoopShorts', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const autoOpenChapters = computed(() => store.getters.getAutoOpenChapters)

/**
 * @param {boolean} value
 */
function updateAutoOpenChapters(value) {
  store.dispatch('updateAutoOpenChapters', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const displayVideoPlayButton = computed(() => store.getters.getDisplayVideoPlayButton)

/**
 * @param {boolean} value
 */
function updateDisplayVideoPlayButton(value) {
  store.dispatch('updateDisplayVideoPlayButton', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const ambientMode = computed(() => store.getters.getAmbientMode)

/**
 * @param {boolean} value
 */
function updateAmbientMode(value) {
  store.dispatch('updateAmbientMode', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const musicVisualizer = computed(() => store.getters.getMusicVisualizer)

/**
 * @param {boolean} value
 */
function updateMusicVisualizer(value) {
  store.dispatch('updateMusicVisualizer', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const enterFullscreenOnDisplayRotate = computed(() => store.getters.getEnterFullscreenOnDisplayRotate)

/**
 * @param {boolean} value
 */
function updateEnterFullscreenOnDisplayRotate(value) {
  store.dispatch('updateEnterFullscreenOnDisplayRotate', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const rotateFullscreenToLandscape = computed(() => store.getters.getRotateFullscreenToLandscape)

/**
 * @param {boolean} value
 */
function updateRotateFullscreenToLandscape(value) {
  store.dispatch('updateRotateFullscreenToLandscape', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const enableMobileFullscreenSwipe = computed(() => store.getters.getEnableMobileFullscreenSwipe)

/**
 * @param {boolean} value
 */
function updateEnableMobileFullscreenSwipe(value) {
  store.dispatch('updateEnableMobileFullscreenSwipe', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const continuePlaybackWhenScreenIsLocked = computed(() => store.getters.getContinuePlaybackWhenScreenIsLocked)

/** @param {boolean} value */
function updateContinuePlaybackWhenScreenIsLocked(value) {
  store.dispatch('updateContinuePlaybackWhenScreenIsLocked', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const showPlaybackRateAdjustedTimestamp = computed(() => store.getters.getShowPlaybackRateAdjustedTimestamp)

/**
 * @param {boolean} value
 */
function updateShowPlaybackRateAdjustedTimestamp(value) {
  store.dispatch('updateShowPlaybackRateAdjustedTimestamp', value)
}

/** @type {import('vue').ComputedRef<string>} */
const externalPlayer = computed(() => store.getters.getExternalPlayer)

const defaultViewingMode = computed(() => {
  /** @type {'default' | 'theatre' | 'fullwindow' | 'fullscreen' | 'pip' | 'external_player'} */
  const defaultViewingMode = store.getters.getDefaultViewingMode

  if ((defaultViewingMode === 'external_player' && (!process.env.IS_ELECTRON || externalPlayer.value === '')) ||
    (!process.env.IS_ELECTRON && (defaultViewingMode === 'fullscreen' || defaultViewingMode === 'pip'))) {
    return 'default'
  }

  return defaultViewingMode
})

const viewingModeNames = computed(() => {
  const viewingModeNames = [
    t('Settings.General Settings.Thumbnail Preference.Default'),
    t('Settings.Player Settings.Default Viewing Mode.Theater'),
    t('Video.Player.Full Window'),
    t('Settings.Player Settings.Default Viewing Mode.Full Window (Always On)'),

    ...process.env.IS_ELECTRON
      ? [
          t('Settings.Player Settings.Default Viewing Mode.Full Screen'),
          t('Settings.Player Settings.Default Viewing Mode.Full Screen (Always On)'),
          t('Settings.Player Settings.Default Viewing Mode.Picture in Picture')
        ]
      : []
  ]

  if (process.env.IS_ELECTRON && externalPlayer.value !== '') {
    viewingModeNames.push(
      t('Settings.Player Settings.Default Viewing Mode.External Player', { externalPlayerName: externalPlayer.value })
    )
  }

  return viewingModeNames
})

const viewingModeValues = computed(() => {
  const viewingModeValues = [
    'default',
    'theatre',
    'fullwindow',
    'fullwindow_always_on',

    ...process.env.IS_ELECTRON
      ? [
          'fullscreen',
          'fullscreen_always_on',
          'pip',
        ]
      : []
  ]

  if (process.env.IS_ELECTRON && externalPlayer.value !== '') {
    viewingModeValues.push('external_player')
  }

  return viewingModeValues
})

/**
 * @param {'default' | 'theatre' | 'fullwindow' | 'fullscreen' | 'pip' | 'external_player'} value
 */
function updateDefaultViewingMode(value) {
  store.dispatch('updateDefaultViewingMode', value)
}

const AUTO_PIP_TRIGGER_VALUES = ['tab', 'minimize', 'blur']

initializePlatformInfo()

const autoPictureInPictureTriggerLabels = computed(() => [
  t('Settings.Player Settings.Auto Picture in Picture.On Tab Change'),
  t('Settings.Player Settings.Auto Picture in Picture.On Window Minimize'),
  t('Settings.Player Settings.Auto Picture in Picture.On Window Hide')
])

/** @type {import('vue').WritableComputedRef<string[]>} */
const autoPictureInPictureTriggers = computed({
  get: () => store.getters.getAutoPictureInPictureTriggers,
  set: (value) => store.dispatch('updateAutoPictureInPictureTriggers', value)
})

const androidAutoPictureInPicture = computed(() => store.getters.getAndroidAutoPictureInPicture)

function updateAndroidAutoPictureInPicture(value) {
  store.dispatch('updateAndroidAutoPictureInPicture', value)
}

const documentPictureInPictureEnabled = computed(() => {
  return store.getters.getDocumentPictureInPictureEnabled
})

/** @param {boolean} value */
function updateDocumentPictureInPictureEnabled(value) {
  store.dispatch('updateDocumentPictureInPictureEnabled', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const scrollMiniPlayerEnabled = computed(() => store.getters.getScrollMiniPlayerEnabled)

/** @type {import('vue').ComputedRef<boolean>} */
const scrollMiniPlayerOnAllTabs = computed(() => store.getters.getScrollMiniPlayerOnAllTabs)

/**
 * @param {boolean} value
 */
function updateScrollMiniPlayerEnabled(value) {
  store.dispatch('updateScrollMiniPlayerEnabled', value)
}

/**
 * @param {boolean} value
 */
function updateScrollMiniPlayerOnAllTabs(value) {
  store.dispatch('updateScrollMiniPlayerOnAllTabs', value)
}

const FORMAT_VALUES = ['dash', 'legacy', 'audio']

const formatNames = computed(() => [
  t('Settings.Player Settings.Default Video Format.Dash Formats'),
  t('Settings.Player Settings.Default Video Format.Legacy Formats'),
  t('Settings.Player Settings.Default Video Format.Audio Formats')
])

/** @type {import('vue').ComputedRef<'dash' | 'audio' |' legacy'>} */
const defaultVideoFormat = computed(() => store.getters.getDefaultVideoFormat)

/**
 * @param {'dash' | 'legacy' | 'audio'} value
 */
function updateDefaultVideoFormat(value) {
  store.dispatch('updateDefaultVideoFormat', value)
}

const RESOLUTION_VALUES = ['2160', '1440', '1080', '720', '480', '360', '240', '144']

/**
 * Auto quality is broken with SABR, so it is only offered for the
 * stream extraction methods that don't use it.
 * @type {import('vue').ComputedRef<boolean>}
 */
const autoQualityAvailable = computed(() => {
  return playbackEngineSupportsAutoQuality(store.getters.getVideoPlaybackEngine)
})

const qualityValues = computed(() => {
  return autoQualityAvailable.value ? [...RESOLUTION_VALUES, 'auto'] : RESOLUTION_VALUES
})

const qualityNames = computed(() => [
  t('Settings.Player Settings.Default Quality.4k'),
  t('Settings.Player Settings.Default Quality.1440p'),
  t('Settings.Player Settings.Default Quality.1080p'),
  t('Settings.Player Settings.Default Quality.720p'),
  t('Settings.Player Settings.Default Quality.480p'),
  t('Settings.Player Settings.Default Quality.360p'),
  t('Settings.Player Settings.Default Quality.240p'),
  t('Settings.Player Settings.Default Quality.144p'),

  ...(autoQualityAvailable.value ? [t('Settings.Player Settings.Default Quality.Auto')] : [])
])

/** @type {import('vue').ComputedRef<'2160' | '1440' | '1080' | '720' | '480' | '360' | '240' | '144' | 'auto'>} */
const defaultQuality = computed(() => {
  const value = store.getters.getDefaultQuality

  if (value === 'auto' && !autoQualityAvailable.value) { return AUTO_QUALITY_FALLBACK }

  return value
})

/**
 * @param {'2160' | '1440' | '1080' | '720' | '480' | '360' | '240' | '144' | 'auto'} value
 */
function updateDefaultQuality(value) {
  store.dispatch('updateDefaultQuality', value)
}

const PLAYBACK_RATE_INTERVAL_VALUES = ['0.1', '0.25', '0.5', '1']

/** @type {import('vue').ComputedRef<number>} */
const videoPlaybackRateInterval = computed(() => store.getters.getVideoPlaybackRateInterval)

/** @type {import('vue').ComputedRef<string>} */
const videoPlaybackRateIntervalString = computed(() => store.getters.getVideoPlaybackRateInterval.toString())

/**
 * @param {string} value
 */
function updateVideoPlaybackRateInterval(value) {
  store.dispatch('updateVideoPlaybackRateInterval', parseFloat(value))
}

/** @type {import('vue').ComputedRef<number>} */
const defaultInterval = computed(() => store.getters.getDefaultInterval)

/**
 * @param {number} value
 */
function updateDefaultInterval(value) {
  store.dispatch('updateDefaultInterval', value)
}

/** @type {import('vue').ComputedRef<number>} */
const defaultAutoplayInterruptionIntervalHours = computed(() => {
  return store.getters.getDefaultAutoplayInterruptionIntervalHours
})

/**
 * @param {number} value
 */
function updateDefaultAutoplayInterruptionIntervalHours(value) {
  store.dispatch('updateDefaultAutoplayInterruptionIntervalHours', value)
}

/** @type {import('vue').ComputedRef<number>} */
const defaultSkipInterval = computed(() => store.getters.getDefaultSkipInterval)

/**
 * @param {number} value
 */
function updateDefaultSkipInterval(value) {
  store.dispatch('updateDefaultSkipInterval', value)
}

/** @type {import('vue').ComputedRef<number>} */
const defaultVolume = computed(() => Math.round(store.getters.getDefaultVolume * 100))

/**
 * @param {number} value
 */
function updateDefaultVolume(value) {
  store.dispatch('updateDefaultVolume', value / 100)
}

/** @type {import('vue').ComputedRef<number>} */
const defaultPlayback = computed(() => store.getters.getDefaultPlayback)

/**
 * @param {number} value
 */
function updateDefaultPlayback(value) {
  store.dispatch('updateDefaultPlayback', value)
}

/** @type {import('vue').ComputedRef<number>} */
const maxVideoPlaybackRate = computed(() => store.getters.getMaxVideoPlaybackRate)

/**
 * @param {number} value
 */
function updateMaxVideoPlaybackRate(value) {
  store.dispatch('updateMaxVideoPlaybackRate', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const useQuickPlaybackSpeedBar = computed(() => store.getters.getUseQuickPlaybackSpeedBar)

/**
 * @param {boolean} value
 */
function updateUseQuickPlaybackSpeedBar(value) {
  store.dispatch('updateUseQuickPlaybackSpeedBar', value)
}

/** @type {import('vue').Ref<boolean>} */
const showQuickPlaybackSpeedBarManager = ref(false)

/** @type {import('vue').Ref<string | null>} */
const editingQuickPlaybackSpeedNameId = ref(null)

/** @type {import('vue').Ref<string | null>} */
const draggedQuickPlaybackSpeedId = ref(null)

/** @type {import('vue').Ref<Record<string, number>>} */
const quickPlaybackSpeedDragOffsets = ref({})

/** @type {import('vue').Ref<boolean>} */
const isQuickPlaybackSpeedDragSettling = ref(false)

/** @type {import('vue').Ref<boolean>} */
const suppressQuickPlaybackSpeedDragTransitions = ref(false)

/** @type {ReturnType<typeof window.setTimeout> | null} */
let quickPlaybackSpeedSettleTimeoutId = null

/** @type {null | {id: string, sourceIndex: number, targetIndex: number, pointerStartY: number, rects: Array<{id: string, top: number, height: number}>, gap: number, started: boolean, moved: boolean, draggedOffset: number}} */
let quickPlaybackSpeedDragSession = null

/** @type {import('vue').ComputedRef<string>} */
const quickPlaybackSpeedBarOptions = computed(() => store.getters.getQuickPlaybackSpeedBarOptions)

/** @type {import('vue').ComputedRef<Array<{id: string, speed: number, name: string}>>} */
const quickPlaybackSpeedBarEntries = computed(() => {
  return parseQuickPlaybackSpeedBarOptions(quickPlaybackSpeedBarOptions.value)
})

/** @type {import('vue').ComputedRef<boolean>} */
const hasModifiedQuickPlaybackSpeedBarOptions = computed(() => {
  return quickPlaybackSpeedBarEntries.value.length !== DEFAULT_QUICK_PLAYBACK_SPEED_BAR_OPTIONS.length ||
    quickPlaybackSpeedBarEntries.value.some((option, index) => {
      const defaultOption = DEFAULT_QUICK_PLAYBACK_SPEED_BAR_OPTIONS[index]
      return option.speed !== defaultOption.speed || option.name.trim() !== defaultOption.name
    })
})

/**
 * @param {string} value
 * @returns {Array<{id: string, speed: number, name: string}>}
 */
function parseQuickPlaybackSpeedBarOptions(value) {
  try {
    const parsedOptions = JSON.parse(value || '[]')

    if (!Array.isArray(parsedOptions)) {
      return getDefaultQuickPlaybackSpeedBarEntries()
    }

    const options = parsedOptions
      .map((option, index) => {
        const speed = Number.parseFloat(option?.speed)

        return {
          id: typeof option?.id === 'string' && option.id !== '' ? option.id : createQuickPlaybackSpeedOptionId(),
          speed,
          name: typeof option?.name === 'string' ? option.name : '',
        }
      })
      .filter((option) => Number.isFinite(option.speed) && option.speed > 0)

    return options.length > 0 ? options : getDefaultQuickPlaybackSpeedBarEntries()
  } catch (error) {
    console.error('Failed to parse quick playback speed bar options:', error)
    return getDefaultQuickPlaybackSpeedBarEntries()
  }
}

/**
 * @returns {Array<{id: string, speed: number, name: string}>}
 */
function getDefaultQuickPlaybackSpeedBarEntries() {
  return DEFAULT_QUICK_PLAYBACK_SPEED_BAR_OPTIONS.map((option, index) => ({
    id: `default-${index}`,
    ...option,
  }))
}

/**
 * @param {Array<{id?: string, speed: number, name: string}>} options
 */
function saveQuickPlaybackSpeedBarOptions(options) {
  const normalizedOptions = options
    .map((option) => ({
      id: typeof option.id === 'string' && option.id !== '' ? option.id : createQuickPlaybackSpeedOptionId(),
      speed: normalizeQuickPlaybackSpeed(option.speed),
      name: option.name.trim(),
    }))
    .filter((option) => option.speed > 0)
    .slice(0, QUICK_PLAYBACK_SPEED_LIMIT)

  return store.dispatch(
    'updateQuickPlaybackSpeedBarOptions',
    JSON.stringify(normalizedOptions.length > 0 ? normalizedOptions : [{ id: createQuickPlaybackSpeedOptionId(), speed: 1, name: '' }])
  )
}

/**
 * @returns {string}
 */
function createQuickPlaybackSpeedOptionId() {
  return `speed-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/**
 * @param {number|string} speed
 * @returns {number}
 */
function normalizeQuickPlaybackSpeed(speed) {
  const parsedSpeed = Number.parseFloat(speed)

  if (!Number.isFinite(parsedSpeed) || parsedSpeed <= 0) {
    return 1
  }

  return Number.parseFloat(parsedSpeed.toFixed(2))
}

/**
 * @param {{speed: number, name: string}} option
 * @returns {string}
 */
function getQuickPlaybackSpeedDisplayName(option) {
  return option.name.trim() || getAutomaticQuickPlaybackSpeedName(option.speed)
}

/**
 * @param {number} speed
 * @returns {string}
 */
function getAutomaticQuickPlaybackSpeedName(speed) {
  if (Math.abs(speed - 1) < 0.01) {
    return t('Video.Player.Normal')
  }

  if (speed < 1) {
    return `${Math.round(speed * 100)}%`
  }

  return `${speed}x`
}

function addQuickPlaybackSpeed() {
  const options = getEditableQuickPlaybackSpeedBarOptions()

  if (options.length >= QUICK_PLAYBACK_SPEED_LIMIT) {
    return
  }

  const lastSpeed = options.length > 0 ? options[options.length - 1].speed : 1
  options.push({
    id: createQuickPlaybackSpeedOptionId(),
    speed: normalizeQuickPlaybackSpeed(lastSpeed + videoPlaybackRateInterval.value),
    name: '',
  })
  saveQuickPlaybackSpeedBarOptions(options)
}

function resetQuickPlaybackSpeedBarOptions() {
  saveQuickPlaybackSpeedBarOptions(DEFAULT_QUICK_PLAYBACK_SPEED_BAR_OPTIONS)
  editingQuickPlaybackSpeedNameId.value = null
}

/**
 * @param {string} id
 * @param {string} name
 */
function updateQuickPlaybackSpeedName(id, name) {
  const options = getEditableQuickPlaybackSpeedBarOptions()
  const option = options.find((option) => option.id === id)

  if (!option) {
    return
  }

  option.name = name
  saveQuickPlaybackSpeedBarOptions(options)
}

/**
 * @param {string} id
 */
function resetQuickPlaybackSpeedName(id) {
  updateQuickPlaybackSpeedName(id, '')
  editingQuickPlaybackSpeedNameId.value = null
}

/**
 * @param {string} id
 * @param {string} speed
 */
function updateQuickPlaybackSpeed(id, speed) {
  const options = getEditableQuickPlaybackSpeedBarOptions()
  const option = options.find((option) => option.id === id)

  if (!option) {
    return
  }

  option.speed = normalizeQuickPlaybackSpeed(speed)
  saveQuickPlaybackSpeedBarOptions(options)
}

/**
 * @param {string} id
 */
function deleteQuickPlaybackSpeed(id) {
  const options = getEditableQuickPlaybackSpeedBarOptions()

  if (options.length <= 1) {
    return
  }

  const index = options.findIndex((option) => option.id === id)

  if (index === -1) {
    return
  }

  options.splice(index, 1)
  saveQuickPlaybackSpeedBarOptions(options)

  if (editingQuickPlaybackSpeedNameId.value === id) {
    editingQuickPlaybackSpeedNameId.value = null
  }
}

/**
 * @param {string} id
 * @returns {Record<string, string>|undefined}
 */
function getQuickPlaybackSpeedEntryStyle(id) {
  const offset = quickPlaybackSpeedDragOffsets.value[id] || 0
  return offset !== 0 ? { transform: `translate3d(0, ${offset}px, 0)` } : undefined
}

/**
 * @returns {Array<{id: string, speed: number, name: string}>}
 */
function getEditableQuickPlaybackSpeedBarOptions() {
  return quickPlaybackSpeedBarEntries.value.map((option) => ({
    id: option.id,
    speed: option.speed,
    name: option.name,
  }))
}

/**
 * @param {number} index
 * @param {PointerEvent} event
 */
function startQuickPlaybackSpeedDrag(index, event) {
  const rows = Array.from(document.querySelectorAll('[data-quick-playback-speed-id]'))
    .filter((element) => element instanceof HTMLElement)
  const sourceElement = rows[index]

  if (!(sourceElement instanceof HTMLElement)) {
    return
  }

  finishQuickPlaybackSpeedDragSettle(true)

  const rects = rows.map((element) => {
    const rect = element.getBoundingClientRect()
    return {
      id: element.dataset.quickPlaybackSpeedId ?? '',
      top: rect.top,
      height: rect.height,
    }
  })
  let gap = 0

  if (rects.length > 1) {
    gap = rects[1].top - (rects[0].top + rects[0].height)
  }

  quickPlaybackSpeedDragSession = {
    id: sourceElement.dataset.quickPlaybackSpeedId ?? '',
    sourceIndex: index,
    targetIndex: index,
    pointerStartY: event.clientY,
    rects,
    gap,
    started: false,
    moved: false,
    draggedOffset: 0,
  }

  event.currentTarget.setPointerCapture?.(event.pointerId)
  window.addEventListener('pointermove', handleQuickPlaybackSpeedDragMove)
  window.addEventListener('pointerup', stopQuickPlaybackSpeedDrag)
  window.addEventListener('pointercancel', stopQuickPlaybackSpeedDrag)
}

/**
 * @param {PointerEvent} event
 */
function handleQuickPlaybackSpeedDragMove(event) {
  if (!quickPlaybackSpeedDragSession) {
    return
  }

  const dy = event.clientY - quickPlaybackSpeedDragSession.pointerStartY

  if (!quickPlaybackSpeedDragSession.started) {
    if (Math.abs(dy) < QUICK_PLAYBACK_SPEED_DRAG_THRESHOLD_PX) {
      return
    }

    quickPlaybackSpeedDragSession.started = true
    draggedQuickPlaybackSpeedId.value = quickPlaybackSpeedDragSession.id
  }

  quickPlaybackSpeedDragSession.moved = true
  event.preventDefault()

  const { rects, sourceIndex, gap } = quickPlaybackSpeedDragSession
  const sourceRect = rects[sourceIndex]
  const lastRect = rects[rects.length - 1]
  const newTop = Math.max(
    rects[0].top - sourceRect.height / 2,
    Math.min(lastRect.top + lastRect.height - sourceRect.height / 2, sourceRect.top + dy)
  )
  const draggedOffset = newTop - sourceRect.top
  const draggedCenter = newTop + sourceRect.height / 2
  let targetIndex = sourceIndex

  for (let i = 0; i < rects.length; i++) {
    if (i === sourceIndex) {
      continue
    }

    const center = rects[i].top + rects[i].height / 2
    if (i < sourceIndex && draggedCenter < center) {
      targetIndex = Math.min(targetIndex, i)
    } else if (i > sourceIndex && draggedCenter > center) {
      targetIndex = Math.max(targetIndex, i)
    }
  }

  quickPlaybackSpeedDragSession.targetIndex = targetIndex
  quickPlaybackSpeedDragSession.draggedOffset = draggedOffset
  quickPlaybackSpeedDragOffsets.value = computeQuickPlaybackSpeedDragOffsets(
    rects,
    sourceIndex,
    targetIndex,
    gap,
    draggedOffset
  )
}

/**
 * @param {Array<{id: string, top: number, height: number}>} rects
 * @param {number} sourceIndex
 * @param {number} targetIndex
 * @param {number} gap
 * @param {number} draggedOffset
 * @returns {Record<string, number>}
 */
function computeQuickPlaybackSpeedDragOffsets(rects, sourceIndex, targetIndex, gap, draggedOffset) {
  const offsets = {}

  if (sourceIndex === targetIndex) {
    offsets[rects[sourceIndex].id] = draggedOffset
    return offsets
  }

  const order = rects.map((_, index) => index)
  const [source] = order.splice(sourceIndex, 1)
  order.splice(targetIndex, 0, source)

  let cursor = rects[0].top
  for (const index of order) {
    const rect = rects[index]
    if (index === sourceIndex) {
      offsets[rect.id] = draggedOffset
    } else {
      const delta = cursor - rect.top
      if (delta !== 0) {
        offsets[rect.id] = delta
      }
    }
    cursor += rect.height + gap
  }

  return offsets
}

/**
 * @param {Array<{id: string, top: number, height: number}>} rects
 * @param {number} sourceIndex
 * @param {number} targetIndex
 * @param {number} gap
 * @param {number} draggedOffset
 * @returns {Record<string, number>}
 */
function computeFinalQuickPlaybackSpeedDragOffsets(rects, sourceIndex, targetIndex, gap, draggedOffset) {
  if (sourceIndex === targetIndex) {
    return {}
  }

  const offsets = computeQuickPlaybackSpeedDragOffsets(rects, sourceIndex, targetIndex, gap, draggedOffset)
  const order = rects.map((_, index) => index)
  const [source] = order.splice(sourceIndex, 1)
  order.splice(targetIndex, 0, source)

  let cursor = rects[0].top
  for (const index of order) {
    if (index === sourceIndex) {
      offsets[rects[index].id] = cursor - rects[index].top
      break
    }
    cursor += rects[index].height + gap
  }

  return offsets
}

function stopQuickPlaybackSpeedDrag() {
  cleanupQuickPlaybackSpeedDragListeners()

  if (!quickPlaybackSpeedDragSession) {
    return
  }

  const { id, sourceIndex, targetIndex, started, rects, gap, draggedOffset } = quickPlaybackSpeedDragSession

  if (!started) {
    quickPlaybackSpeedDragSession = null
    return
  }

  quickPlaybackSpeedDragOffsets.value = computeFinalQuickPlaybackSpeedDragOffsets(
    rects,
    sourceIndex,
    targetIndex,
    gap,
    draggedOffset
  )
  draggedQuickPlaybackSpeedId.value = null
  isQuickPlaybackSpeedDragSettling.value = true

  quickPlaybackSpeedSettleTimeoutId = window.setTimeout(() => {
    quickPlaybackSpeedSettleTimeoutId = null
    commitQuickPlaybackSpeedReorder(id, sourceIndex, targetIndex)
  }, QUICK_PLAYBACK_SPEED_SETTLE_DURATION_MS)

  quickPlaybackSpeedDragSession = null
}

function cleanupQuickPlaybackSpeedDragListeners() {
  window.removeEventListener('pointermove', handleQuickPlaybackSpeedDragMove)
  window.removeEventListener('pointerup', stopQuickPlaybackSpeedDrag)
  window.removeEventListener('pointercancel', stopQuickPlaybackSpeedDrag)
}

/**
 * @param {string} id
 * @param {number} sourceIndex
 * @param {number} targetIndex
 */
async function commitQuickPlaybackSpeedReorder(id, sourceIndex, targetIndex) {
  if (sourceIndex !== targetIndex) {
    const options = getEditableQuickPlaybackSpeedBarOptions()
    const currentIndex = options.findIndex((option) => option.id === id)

    if (currentIndex !== -1) {
      const [option] = options.splice(currentIndex, 1)
      options.splice(targetIndex, 0, option)
      suppressQuickPlaybackSpeedDragTransitions.value = true
      await saveQuickPlaybackSpeedBarOptions(options)
    }
  }

  quickPlaybackSpeedDragOffsets.value = {}
  isQuickPlaybackSpeedDragSettling.value = false

  nextTick(() => {
    requestAnimationFrame(() => {
      suppressQuickPlaybackSpeedDragTransitions.value = false
    })
  })
}

/**
 * @param {boolean} [immediate=false]
 */
function finishQuickPlaybackSpeedDragSettle(immediate = false) {
  if (quickPlaybackSpeedSettleTimeoutId !== null) {
    window.clearTimeout(quickPlaybackSpeedSettleTimeoutId)
    quickPlaybackSpeedSettleTimeoutId = null
  }

  if (immediate) {
    suppressQuickPlaybackSpeedDragTransitions.value = true
  }

  quickPlaybackSpeedDragOffsets.value = {}
  draggedQuickPlaybackSpeedId.value = null
  isQuickPlaybackSpeedDragSettling.value = false
  quickPlaybackSpeedDragSession = null

  if (immediate) {
    nextTick(() => {
      requestAnimationFrame(() => {
        suppressQuickPlaybackSpeedDragTransitions.value = false
      })
    })
  }
}

onBeforeUnmount(() => {
  cleanupQuickPlaybackSpeedDragListeners()
  finishQuickPlaybackSpeedDragSettle(true)
})

/** @type {import('vue').ComputedRef<boolean>} */
const enableScreenshot = computed(() => store.getters.getEnableScreenshot)

/**
 * @param {boolean} value
 */
function updateEnableScreenshot(value) {
  store.dispatch('updateEnableScreenshot', value)
}

const SCREENSHOT_FORMAT_NAMES = ['PNG', 'JPEG', 'WebP']
const SCREENSHOT_FORMAT_VALUES = ['png', 'jpeg', 'webp']

/** @type {import('vue').ComputedRef<'png' | 'jpeg' | 'webp'>} */
const screenshotFormat = computed(() => store.getters.getScreenshotFormat)

/**
 * @param {'png' | 'jpeg' | 'webp'} format
 */
async function handleUpdateScreenshotFormat(format) {
  await store.dispatch('updateScreenshotFormat', format)
  getScreenshotFilenameExample(screenshotFilenamePattern.value)
}

const screenshotModeNames = computed(() => [
  t('Settings.Player Settings.Screenshot.Modes.Ask Path'),
  ...(process.env.IS_ELECTRON || process.env.IS_CAPACITOR) ? [t('Settings.Player Settings.Screenshot.Modes.Save To Folder')] : [],
  t('Settings.Player Settings.Screenshot.Modes.Clipboard'),
])
const screenshotModeValues = computed(() => [
  'prompt_folder',
  ...(process.env.IS_ELECTRON || process.env.IS_CAPACITOR) ? ['default_folder'] : [],
  'clipboard'
])

/** @type {import('vue').ComputedRef<'prompt_folder' | 'default_folder' | 'clipboard'>} */
const screenshotMode = computed(() => store.getters.getScreenshotMode)

/**
 * @param {'prompt_folder' | 'default_folder' | 'clipboard'} mode
 */
async function handleUpdateScreenshotMode(mode) {
  await store.dispatch('updateScreenshotMode', mode)
}

/** @type {import('vue').ComputedRef<number>} */
const screenshotQuality = computed(() => store.getters.getScreenshotQuality)

/**
 * @param {number} value
 */
function updateScreenshotQuality(value) {
  store.dispatch('updateScreenshotQuality', value)
}

/** @type {import('vue').ComputedRef<string>} */
const screenshotFolder = computed(() => store.getters.getScreenshotFolderPath)

async function chooseScreenshotFolder() {
  if (process.env.IS_ELECTRON) {
    window.ftElectron.chooseDefaultFolder()
  } else if (process.env.IS_CAPACITOR) {
    try {
      const path = await chooseAndroidDirectory()
      if (path) await store.dispatch('updateScreenshotFolderPath', path)
    } catch (error) {
      showToast({ message: t('Screenshot Error', { error }), icon: ['fas', 'circle-exclamation'] })
    }
  }
}

/** @type {import('vue').ComputedRef<string>} */
const screenshotFilenamePattern = computed(() => store.getters.getScreenshotFilenamePattern)

onMounted(() => {
  getScreenshotFilenameExample(screenshotFilenamePattern.value)
})

const SCREENSHOT_DEFAULT_PATTERN = '%Y%M%D-%H%N%S'

/**
 * @param {string} input
 */
async function handleScreenshotFilenamePatternChanged(input) {
  const pattern = input.trim()

  if (!await getScreenshotFilenameExample(pattern)) {
    return
  }

  store.dispatch('updateScreenshotFilenamePattern', pattern || SCREENSHOT_DEFAULT_PATTERN)
}

const screenshotFilenameExample = ref('')

/**
 * @param {string} pattern
 */
async function getScreenshotFilenameExample(pattern) {
  try {
    const filename = await store.dispatch('parseScreenshotCustomFileName', {
      pattern: pattern || SCREENSHOT_DEFAULT_PATTERN,
      date: new Date(),
      playerTime: 123.456,
      videoId: 'dQw4w9WgXcQ'
    })

    screenshotFilenameExample.value = `${filename}.${screenshotFormat.value}`
    return true
  } catch (err) {
    screenshotFilenameExample.value = `❗ ${err.message}`
    return false
  }
}
</script>

<style scoped src="./PlayerSettings.css" />
