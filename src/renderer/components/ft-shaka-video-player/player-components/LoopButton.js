import shaka from 'shaka-player'

import { scheduleOverflowMenuScrollClamp } from './overflowMenu'

/**
 * @typedef {{
 *   isEnabled: () => boolean,
 *   isVisible?: (location: 'controls' | 'context' | 'overflow') => boolean,
 *   subscribe?: (callback: () => void) => () => void,
 *   toggle: () => void,
 * }} LoopButtonContext
 */

/** @type {WeakMap<shaka.ui.Controls, LoopButtonContext>} */
const loopButtonContexts = new WeakMap()

/**
 * @param {shaka.ui.Controls} controls
 * @param {LoopButtonContext} context
 * @returns {() => void}
 */
export function setLoopButtonContext(controls, context) {
  loopButtonContexts.set(controls, context)
  return () => {
    if (loopButtonContexts.get(controls) === context) {
      loopButtonContexts.delete(controls)
    }
  }
}

export class LoopButton extends shaka.ui.Element {
  /**
   * @param {HTMLElement} parent
   * @param {shaka.ui.Controls} controls
   */
  constructor(parent, controls) {
    super(parent, controls)

    /** @private */
    this.context_ = loopButtonContexts.get(controls) ?? null

    /** @private @type {'controls' | 'context' | 'overflow'} */
    this.location_ = parent.classList.contains('shaka-overflow-menu')
      ? 'overflow'
      : parent.classList.contains('shaka-context-menu') ? 'context' : 'controls'

    /** @private */
    this.stopStateWatch_ = this.context_?.subscribe?.(() => this.updateState_()) ?? null

    /** @private */
    this.loopEnabled_ = this.isLoopEnabled_()

    /** @private */
    this.loopVisible_ = this.isLoopVisible_()

    /** @private */
    this.loopObserver_ = new MutationObserver(() => this.updateState_())
    // HTMLMediaElement.loop reflects the attribute, including changes from
    // shortcuts and other controls. A-B repeat uses the context subscription.
    this.loopObserver_.observe(controls.getLocalVideo(), { attributes: true, attributeFilter: ['loop'] })

    /** @private */
    this.button_ = document.createElement('button')
    this.button_.classList.add('loop-button', 'shaka-no-propagation', 'shaka-tooltip')

    /** @private */
    this.icon_ = new shaka.ui.Icon(this.button_, shaka.ui.Enums.MaterialDesignSVGIcons.LOOP)

    const label = document.createElement('label')
    label.classList.add(
      'shaka-overflow-button-label',
      'shaka-overflow-menu-only',
      'shaka-simple-overflow-button-label-inline'
    )

    /** @private */
    this.nameSpan_ = document.createElement('span')
    label.appendChild(this.nameSpan_)

    /** @private */
    this.currentState_ = document.createElement('span')
    this.currentState_.classList.add('shaka-current-selection-span')
    label.appendChild(this.currentState_)

    this.button_.appendChild(label)
    this.parent.appendChild(this.button_)

    this.eventManager.listen(this.button_, 'click', () => {
      if (this.context_) {
        this.context_.toggle()
      } else {
        this.video.loop = !this.video.loop
      }
      this.loopEnabled_ = this.isLoopEnabled_()
      this.updateLocalisedStrings_()
    })

    this.eventManager.listenMulti(this.controls, ['contextmenu', 'submenuopen', 'submenuclose'], () => {
      this.updateLocalisedStrings_()
    })

    if (this.isSubMenu) {
      this.eventManager.listen(this.controls, 'submenuopen', () => {
        this.updateVisibility_()
      })

      this.eventManager.listen(this.controls, 'submenuclose', () => {
        this.updateVisibility_()
      })
    }

    this.eventManager.listen(this.localization, shaka.ui.Localization.LOCALE_CHANGED, () => {
      this.updateLocalisedStrings_()
    })

    this.eventManager.listen(this.localization, shaka.ui.Localization.LOCALE_UPDATED, () => {
      this.updateLocalisedStrings_()
    })

    this.eventManager.listenMulti(this.player, ['unloading', 'loaded', 'manifestupdated'], () => {
      this.updateVisibility_()
    })

    this.eventManager.listen(this.video, 'durationchange', () => {
      this.updateVisibility_()
    })

    this.updateVisibility_()
    this.updateLocalisedStrings_()
  }

  release() {
    this.loopObserver_.disconnect()
    this.stopStateWatch_?.()
    super.release()
  }

  /**
   * @returns {boolean}
   * @private
   */
  isLoopEnabled_() {
    return this.context_?.isEnabled() ?? this.video.loop
  }

  /**
   * @returns {boolean}
   * @private
   */
  isLoopVisible_() {
    return !this.player.isLive() && !this.isSubMenuOpened &&
      (this.context_?.isVisible?.(this.location_) ?? true)
  }

  /** @private */
  updateState_() {
    const loopEnabled = this.isLoopEnabled_()
    if (this.loopEnabled_ !== loopEnabled) {
      this.loopEnabled_ = loopEnabled
      this.updateLocalisedStrings_()
    }

    this.updateVisibility_()
  }

  /** @private */
  updateLocalisedStrings_() {
    this.nameSpan_.textContent = this.localization.resolve('LOOP')
    this.currentState_.textContent = this.localization.resolve(this.loopEnabled_ ? 'ON' : 'OFF')
    this.icon_.use(this.loopEnabled_
      ? shaka.ui.Enums.MaterialDesignSVGIcons.UNLOOP
      : shaka.ui.Enums.MaterialDesignSVGIcons.LOOP)
    this.button_.ariaLabel = this.localization.resolve(this.loopEnabled_ ? 'EXIT_LOOP_MODE' : 'ENTER_LOOP_MODE')
    this.button_.ariaPressed = this.loopEnabled_ ? 'true' : 'false'
  }

  /** @private */
  updateVisibility_() {
    const loopVisible = this.isLoopVisible_()
    this.button_.classList.toggle('shaka-hidden', !loopVisible)

    if (this.loopVisible_ && !loopVisible && !this.player.isLive() && !this.isSubMenuOpened) {
      scheduleOverflowMenuScrollClamp(this.parent)
    }
    this.loopVisible_ = loopVisible
  }
}
