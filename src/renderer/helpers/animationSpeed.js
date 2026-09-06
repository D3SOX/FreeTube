const DEFAULT_ANIMATION_SPEED = 100
const MIN_ANIMATION_SPEED = 25
const MAX_ANIMATION_SPEED = 200

let animationPlaybackRate = 1

/**
 * Applies the configured playback rate to animations which are currently
 * attached to the document.
 */
function updateActiveAnimations() {
  document.getAnimations({ subtree: true })
    .filter(animation => !isAnimationSpeedManaged(animation.effect?.target))
    .forEach(animation => {
      applyAnimationSpeed(animation)
    })
}

/**
 * Some animations already incorporate the configured speed in their duration
 * or visualize a separate wall-clock timer, so their playback rate must stay
 * unchanged.
 *
 * @param {EventTarget | null | undefined} target
 * @returns {boolean}
 */
function isAnimationSpeedManaged(target) {
  return target instanceof Element && (
    target.matches('.feed-enter-active, .feed-move') ||
    target.closest('[data-animation-speed-managed], .timeout-indicator') !== null
  )
}

function updateTargetAnimations(event) {
  // CSS already runs at this rate. Avoid querying animations (and flushing
  // pending styles) for every hover transition at the default setting.
  if (animationPlaybackRate === 1) { return }

  queueMicrotask(() => {
    if (isAnimationSpeedManaged(event.target)) { return }
    if (!(event.target instanceof Element)) { return }

    event.target.getAnimations({ subtree: false }).forEach(animation => {
      applyAnimationSpeed(animation)
    })
  })
}

document.addEventListener('animationstart', updateTargetAnimations, true)
document.addEventListener('transitionrun', updateTargetAnimations, true)

/**
 * @param {number} value percentage of the default animation speed
 */
export function setAnimationSpeed(value) {
  animationPlaybackRate = getAnimationSpeedMultiplier(value)
  updateActiveAnimations()
}

/**
 * @param {number} value percentage of the default animation speed
 * @returns {number}
 */
export function getAnimationSpeedMultiplier(value) {
  const speed = Number.isFinite(value) && value > 0
    ? Math.min(Math.max(value, MIN_ANIMATION_SPEED), MAX_ANIMATION_SPEED)
    : DEFAULT_ANIMATION_SPEED

  return speed / DEFAULT_ANIMATION_SPEED
}

/**
 * Applies the configured speed to an animation created through the Web
 * Animations API and returns it for convenient assignment.
 *
 * @param {Animation} animation
 * @returns {Animation}
 */
export function applyAnimationSpeed(animation) {
  animation.updatePlaybackRate(animationPlaybackRate)
  return animation
}
