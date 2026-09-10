import variant from '@jitl/quickjs-singlefile-browser-release-sync'
import { newQuickJSWASMModuleFromVariant } from 'quickjs-emscripten-core'

let modulePromise

/**
 * Interpret player code in a fresh WASM realm. No host objects or functions are
 * exposed, including worker globals, network access and Electron APIs.
 * @param {string} code
 * @param {{timeoutMs?: number, memoryLimitBytes?: number}} [limits]
 * @returns {Promise<unknown>}
 */
export async function evaluatePlayerCode(code, { timeoutMs = 5000, memoryLimitBytes = 64 * 1024 * 1024 } = {}) {
  modulePromise ??= newQuickJSWASMModuleFromVariant(variant)
  const quickjs = await modulePromise
  const runtime = quickjs.newRuntime()
  runtime.setMemoryLimit(memoryLimitBytes)
  runtime.setMaxStackSize(1024 * 1024)
  const deadline = Date.now() + timeoutMs
  runtime.setInterruptHandler(() => Date.now() >= deadline)
  let context
  try {
    context = runtime.newContext()
    // youtubei.js supplies a function body, including its final return statement.
    const result = context.unwrapResult(context.evalCode(`(function () {\n${code}\n})()`))
    try {
      return context.dump(result)
    } finally {
      result.dispose()
    }
  } finally {
    context?.dispose()
    runtime.dispose()
  }
}
