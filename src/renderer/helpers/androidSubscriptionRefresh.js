import { registerPlugin } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'
import { createSubscriptionRefreshStartController } from './androidSubscriptionRefreshData'

const SubscriptionRefresh = process.env.IS_CAPACITOR
  ? registerPlugin('SubscriptionRefresh')
  : null

const startController = createSubscriptionRefreshStartController()

export async function requestAndroidSubscriptionRefreshNotificationPermission() {
  try {
    let current = await LocalNotifications.checkPermissions()
    if (current.display === 'prompt' || current.display === 'prompt-with-rationale') {
      current = await LocalNotifications.requestPermissions()
    }
    return current.display === 'denied'
  } catch (error) {
    console.error('Failed to request subscription refresh notification permission', error)
    return false
  }
}

export async function startAndroidSubscriptionRefresh(refreshId, title, cancelLabel) {
  if (!SubscriptionRefresh) return { acquired: true, notificationsDenied: false }

  let notificationsDenied = false
  const start = startController.begin(refreshId, () => (
    requestAndroidSubscriptionRefreshNotificationPermission()
      .then(denied => {
        notificationsDenied = denied
        return SubscriptionRefresh.start({ title, cancelLabel })
      })
      .then(({ token, acquired }) => acquired ? token : null)
      .catch(error => {
        console.error('Failed to start Android subscription refresh work', error)
        return null
      })
  ))
  if (start === null) return { acquired: false, notificationsDenied: false }

  const token = await start
  return { acquired: token !== null, notificationsDenied }
}

export function updateAndroidSubscriptionRefresh(refreshId, progress) {
  const start = startController.current(refreshId)
  if (!start) return

  start.then(token => {
    if (!startController.isCurrent(refreshId, start) || token === null) return
    return SubscriptionRefresh.update({ token, progress: Math.round(progress) })
  }).catch(error => {
    console.error('Failed to update Android subscription refresh work', error)
  })
}

export function finishAndroidSubscriptionRefresh(refreshId) {
  const start = startController.finish(refreshId)
  if (!start) return

  return start.then(token => token === null ? null : SubscriptionRefresh.finish({ token })).catch(error => {
    console.error('Failed to finish Android subscription refresh work', error)
  })
}

export function configureAndroidSubscriptionRefresh(configuration) {
  if (!SubscriptionRefresh) return Promise.resolve()
  return SubscriptionRefresh.configure({ configuration })
}

export async function isAndroidSubscriptionRefreshActive() {
  if (!SubscriptionRefresh) return false
  const { active } = await SubscriptionRefresh.isActive()
  return active === true
}

export async function getNextAndroidSubscriptionRefreshResult() {
  if (!SubscriptionRefresh) return null
  const { result } = await SubscriptionRefresh.nextPendingResult()
  return result ?? null
}

export async function acknowledgeAndroidSubscriptionRefreshResult(id) {
  if (!SubscriptionRefresh) return
  const { removed } = await SubscriptionRefresh.acknowledgePendingResult({ id })
  if (!removed) throw new Error('Unable to acknowledge pending subscription refresh data')
}

export async function addAndroidSubscriptionRefreshCancelledListener(listener) {
  if (!SubscriptionRefresh) return () => {}
  const handle = await SubscriptionRefresh.addListener('cancelled', listener)
  return () => handle.remove()
}

export async function withAndroidSubscriptionRefreshBatch(refresh, notification) {
  if (!SubscriptionRefresh) return refresh()
  try {
    // Ask while the activity is available, before the batch can outlive it.
    await requestAndroidSubscriptionRefreshNotificationPermission()
    const { acquired } = await SubscriptionRefresh.beginBatch(notification)
    if (!acquired) return
  } catch (error) {
    console.error('Failed to begin Android subscription refresh batch', error)
    return
  }
  try {
    return await refresh()
  } finally {
    await SubscriptionRefresh.endBatch()
  }
}
