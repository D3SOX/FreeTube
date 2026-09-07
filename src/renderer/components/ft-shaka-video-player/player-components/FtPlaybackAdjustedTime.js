import shaka from 'shaka-player'

import { formatDurationAsTimestamp } from '../../../helpers/utils'

export class FtPlaybackAdjustedTime extends shaka.ui.Element {
  /**
   * @param {() => boolean} getShowPlaybackRateAdjustedTimestamp
   * @param {EventTarget} events
   * @param {HTMLElement} parent
   * @param {shaka.ui.Controls} controls
   */
  constructor(getShowPlaybackRateAdjustedTimestamp, events, parent, controls) {
    super(parent, controls)

    /** @private */
    this.getShowPlaybackRateAdjustedTimestamp_ = getShowPlaybackRateAdjustedTimestamp

    /** @private */
    this.video_ = controls.getVideo()

    /** @private */
    this.timeElement_ = document.createElement('button')
    this.timeElement_.classList.add('ft-playback-adjusted-time', 'shaka-current-time')
    this.timeElement_.setAttribute('aria-hidden', 'true')
    this.parent.appendChild(this.timeElement_)

    /** @private */
    this.showProgress_ = !controls.getConfig().showRemainingTimeInPresentationTime

    this.eventManager.listen(this.controls, 'timeandseekrangeupdated', () => {
      this.updateAdjusted_()
    })
    this.eventManager.listen(this.controls, 'loading', () => {
      this.updateAdjusted_()
    })
    this.eventManager.listen(this.controls, 'trackschanged', () => {
      this.updateAdjusted_()
    })
    this.eventManager.listen(this.video_, 'ratechange', () => {
      this.updateAdjusted_()
    })
    this.eventManager.listen(this.video_, 'timeupdate', () => {
      // Native controls remain visible independently of Shaka's control timer.
      if (this.video_.nativePlayback) this.updateAdjusted_()
    })
    this.eventManager.listen(events, 'timeDisplaySettingsChanged', () => {
      this.updateAdjusted_()
    })
    this.eventManager.listen(this.timeElement_, 'click', () => {
      this.showProgress_ = !this.showProgress_
      this.updateAdjusted_()
    })

    const controlsContainer = this.controls.getControlsContainer()
    if (controlsContainer) {
      this.eventManager.listen(controlsContainer, 'click', (event) => {
        const target = event.target
        if (!(target instanceof Element)) {
          return
        }

        if (target.closest('.shaka-current-time:not(.ft-playback-adjusted-time)')) {
          this.showProgress_ = !this.showProgress_
          this.updateAdjusted_()
        }
      })
    }

    this.updateAdjusted_()
  }

  /** @private */
  updateAdjusted_() {
    const player = this.controls.getPlayer()

    if (!this.getShowPlaybackRateAdjustedTimestamp_() || !player) {
      this.hide_()
      return
    }

    const ad = this.controls.getAd?.()
    if (ad?.isLinear?.()) {
      this.hide_()
      return
    }

    if (player.isDynamic?.()) {
      this.hide_()
      return
    }

    const seekRange = player.seekRange?.()
    if (!seekRange) {
      this.hide_()
      return
    }

    const seekStart = seekRange.start
    const seekEnd = seekRange.end

    if (!Number.isFinite(seekStart) || !Number.isFinite(seekEnd) || seekEnd <= seekStart) {
      this.hide_()
      return
    }

    const playbackRate = player.getPlaybackRate?.() ?? this.video_.playbackRate

    if (!Number.isFinite(playbackRate) || Math.abs(playbackRate - 1) < 0.01) {
      this.hide_()
      return
    }

    const displayTime = Math.min(Math.max(this.video_.currentTime, seekStart), seekEnd)
    const duration = seekEnd - seekStart
    const progress = displayTime - seekStart
    const remaining = seekEnd - displayTime

    if (!Number.isFinite(duration) || duration <= 0) {
      this.hide_()
      return
    }

    const adjustedDuration = duration / playbackRate
    const adjustedPosition = (this.showProgress_ ? progress : remaining) / playbackRate

    if (!Number.isFinite(adjustedDuration) || !Number.isFinite(adjustedPosition)) {
      this.hide_()
      return
    }

    const adjustedLeft = this.buildTimeString_(Math.max(0, adjustedPosition))
    const adjustedRight = this.buildTimeString_(Math.max(0, adjustedDuration))
    const leftText = this.showProgress_ ? adjustedLeft : `-${adjustedLeft}`
    const text = `(${leftText} / ${adjustedRight})`

    if (this.timeElement_.textContent !== text) {
      this.timeElement_.textContent = text
    }

    if (this.timeElement_.classList.contains('shaka-hidden')) {
      this.timeElement_.classList.remove('shaka-hidden')
    }
  }

  /** @private */
  hide_() {
    if (this.timeElement_.textContent !== '') {
      this.timeElement_.textContent = ''
    }

    if (!this.timeElement_.classList.contains('shaka-hidden')) {
      this.timeElement_.classList.add('shaka-hidden')
    }
  }

  /**
   * @private
   * @param {number} seconds
   * @returns {string}
   */
  buildTimeString_(seconds) {
    return formatDurationAsTimestamp(Math.floor(seconds))
  }
}
