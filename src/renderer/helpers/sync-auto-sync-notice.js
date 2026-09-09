const STORAGE_KEY = 'opentubex.sync-auto-sync-notice'

// Evaluate eligibility only on the first launch containing this notice. A new
// installation must not become eligible once it saves its first app version.
export function shouldShowAutoSyncNotice(lastUsedVersion, settings, storage) {
  try {
    storage ??= localStorage
    const state = storage.getItem(STORAGE_KEY)
    if (state === 'done') return false
    const eligible = Boolean(lastUsedVersion) && settings.syncServerEnabled &&
      Boolean(settings.syncServerToken) && settings.syncServerAutoSync === false &&
      !settings.syncServerResumeAutoSync
    if (!eligible) {
      storage.setItem(STORAGE_KEY, 'done')
      return false
    }
    storage.setItem(STORAGE_KEY, 'pending')
    return true
  } catch (error) {
    console.error('Failed to read the automatic sync notice state', error)
    return false
  }
}

export function dismissAutoSyncNotice(storage) {
  try {
    storage ??= localStorage
    storage.setItem(STORAGE_KEY, 'done')
  } catch (error) {
    console.error('Failed to dismiss the automatic sync notice', error)
  }
}

// Keep the lock until the notice is handled. Closing or reloading its renderer
// releases the lock automatically, leaving an undismissed notice for next time.
export async function showAutoSyncNoticeOnce(showNotice) {
  const show = () => {
    // Another window may have dismissed it since startup checked eligibility.
    if (localStorage.getItem(STORAGE_KEY) === 'done') return
    return new Promise(resolve => showNotice(resolve))
  }
  try {
    if (navigator.locks) {
      await navigator.locks.request(STORAGE_KEY, { ifAvailable: true }, lock => {
        if (lock) return show()
      })
    } else {
      await show()
    }
  } catch (error) {
    console.error('Failed to show the automatic sync notice', error)
  }
}
