/**
 * Sync server error types and the predicates that classify them.
 *
 * Kept in its own module so the classification logic can be unit tested; the
 * main sync-server helper pulls in webpack-resolved imports that a plain Node
 * test runner cannot load.
 */

export class SyncServerError extends Error {
  constructor(message, status = null) {
    super(message)
    this.name = 'SyncServerError'
    this.status = status
  }
}

export class SyncServerCancelledError extends Error {
  constructor() {
    super('Sync cancelled')
    this.name = 'SyncServerCancelledError'
  }
}

export class SyncServerDataLossError extends Error {
  constructor(collection, deleted, previous, items) {
    super(
      `Sync stopped because it would delete ${deleted} of ${previous} previously synced ${collection} items`
    )
    this.name = 'SyncServerDataLossError'
    this.collection = collection
    this.deleted = deleted
    this.previous = previous
    this.items = items
  }
}

export const SYNC_SERVER_SESSION_EXPIRED_MESSAGE =
  'Sync server session expired. Sign in again to resume syncing.'

/**
 * Whether an error means the stored token is no longer accepted.
 *
 * Only 401 qualifies. The server answers 403 for wrong credentials and for
 * resources owned by someone else, and 404 for plenty of ordinary misses, so
 * treating those as an expired session would sign people out for unrelated
 * reasons.
 * @param {unknown} error
 */
export function isSessionExpiredError(error) {
  return error instanceof SyncServerError && error.status === 401
}

/**
 * Whether authentication is recovering the same expired sync session.
 * @param {object} session
 * @param {boolean} session.expired
 * @param {string} session.savedServerUrl
 * @param {string} session.savedUsername
 * @param {string} session.serverUrl
 * @param {string} session.username
 */
export function isExpiredSessionReauthentication({
  expired,
  savedServerUrl,
  savedUsername,
  serverUrl,
  username,
}) {
  return expired &&
    serverUrl === savedServerUrl &&
    username === savedUsername
}
