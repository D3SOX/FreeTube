import { isAppHidden } from '../appVisibility.js'
const RESUME_WINDOW_MS = 5000
let lastVisibleAt = Number.NEGATIVE_INFINITY

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!isAppHidden()) lastVisibleAt = Date.now()
  })
}

function errorText(error) {
  if (typeof error === 'string') return error
  if (typeof error?.message === 'string') return error.message
  return String(error)
}

function stripUrlDetails(value) {
  return value.replaceAll(/https?:\/\/[^\s)]+/gi, match => {
    try {
      return new URL(match).origin
    } catch {
      return '<url>'
    }
  })
}

export function sanitizeRequestErrorMessage(error) {
  return stripUrlDetails(errorText(error))
    .replaceAll(/\bauthorization\s*:\s*[^\r\n]*/gi, 'Authorization: <redacted>')
    .replaceAll(/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 <redacted>')
    .replaceAll(/\b(?:cookie|set-cookie)\s*:\s*[^\r\n]*/gi, 'Cookie: <redacted>')
    .replaceAll(
      /\b(access[_-]?token|refresh[_-]?token|id[_-]?token|token|api[_-]?key|client[_-]?secret|password|secret)["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;&}]+)/gi,
      '$1=<redacted>'
    )
    .replaceAll(/\brequest\s+body\s*[:=]\s*[^\r\n]*/gi, 'request body=<redacted>')
    .slice(0, 500)
}

export function classifyRequestFailure(error) {
  const name = String(error?.name ?? '')
  const code = String(error?.code ?? '')
  const message = errorText(error)
  const signature = `${name} ${code} ${message}`.toLowerCase()

  if (name === 'AbortError' || /cancel|aborted|err_canceled/.test(signature)) return 'cancellation'
  if (
    /foregroundservicestartnotallowed|backgroundservicestartnotallowed|(?:foreground|background) service.*(?:not allowed|restrict)|background execution.*(?:not allowed|restrict)/.test(signature)
  ) return 'background restriction'
  if (
    (Number.isInteger(error?.status) && error.status >= 100 && error.status <= 599) ||
    /\bhttp\s+\d{3}\b|\bstatus(?: code)?[: ]+\d{3}\b/.test(signature)
  ) return 'http'
  if (/ssl|tls|certificate|certpath|handshake/.test(signature)) return 'tls'
  if (error instanceof SyntaxError || /json|parse|parsing|unexpected token/.test(signature)) return 'parsing'
  if (
    /unknownhost|unable to resolve host|gai|addrinfo|eai_|\b(?:enotfound|etimedout|econnreset|econnrefused|enetunreach|ehostunreach)\b|dns|network|socket|timeout|timed out|connect|failed to fetch|load failed/.test(signature)
  ) {
    return 'network'
  }
  return 'api'
}

export function classifyRequestLifecycle(visibilityState, visibleAt, now = Date.now()) {
  if (visibilityState === 'hidden') return 'background'
  if (now - visibleAt <= RESUME_WINDOW_MS) return 'resume'
  return 'foreground'
}

export function getRequestLifecycle() {
  const visibilityState = isAppHidden() ? 'hidden' : 'visible'
  return classifyRequestLifecycle(visibilityState, lastVisibleAt)
}

export function buildRequestDiagnostic(error, { category, backend, lifecycle = getRequestLifecycle() }) {
  const code = typeof error?.code === 'string' && error.code.length > 0
    ? error.code
    : typeof error?.name === 'string' && error.name !== 'Error'
      ? error.name
      : null

  return {
    category,
    backend,
    lifecycle,
    failure: classifyRequestFailure(error),
    ...(code === null ? {} : { code }),
    message: sanitizeRequestErrorMessage(error),
  }
}

export function formatRequestDiagnostic(diagnostic) {
  return [
    `request=${diagnostic.category}`,
    `backend=${diagnostic.backend}`,
    `lifecycle=${diagnostic.lifecycle}`,
    `failure=${diagnostic.failure}`,
    diagnostic.code ? `code=${diagnostic.code}` : null,
    `message=${diagnostic.message}`,
  ].filter(Boolean).join('; ')
}
