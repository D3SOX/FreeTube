const MAX_BYTES = 32 * 1024 * 1024

/**
 * Reads native extractor byte ranges from SABR's separately requested segments.
 * Initialization is shared by concurrent index and init requests, including a
 * native retry that starts partway through a previously requested segment.
 */
export function createAndroidSabrRangeReader({ owner, formats, readInitialization, readSegment, getReferences }) {
  const initializations = new Map()
  async function initialize(index) {
    if (!initializations.has(index)) {
      const pending = readInitialization(index).catch(error => {
        initializations.delete(index)
        throw error
      })
      initializations.set(index, pending)
    }
    return initializations.get(index)
  }

  return async ({ uri, position, length }) => {
    // Older WebViews parse custom schemes as opaque paths, without a host.
    // These resources have one fixed grammar and never contain query strings.
    const resource = /^otxsabr:\/\/([a-z0-9-]+)\/(\d+)$/.exec(uri)
    const index = Number(resource?.[2])
    if (resource?.[1] !== owner || !Number.isSafeInteger(index) || !formats[index]) {
      throw new Error('Unknown native SABR resource')
    }
    if (!Number.isSafeInteger(position) || position < 0 ||
      !Number.isSafeInteger(length) || length < -1 || length > MAX_BYTES ||
      (length >= 0 && !Number.isSafeInteger(position + length))) {
      throw new Error('Invalid native SABR range')
    }
    if (length === 0) return new Uint8Array()
    const initialization = await initialize(index)
    if (position < initialization.byteLength &&
      (length === -1 || position + length <= initialization.byteLength)) {
      return initialization.slice(position, length === -1 ? undefined : position + length)
    }

    const references = await getReferences(index)
    const parts = []
    let offset = position
    let remaining = length === -1 ? Infinity : length
    let size = 0
    if (offset < initialization.byteLength) {
      const part = initialization.subarray(offset)
      parts.push(part)
      offset += part.byteLength
      remaining -= part.byteLength
      size += part.byteLength
    }
    for (const reference of references) {
      const start = reference.startByte
      const end = reference.endByte
      if (end !== null && end < offset) continue
      if (start > offset) throw new Error('SABR byte range contains a gap')
      const bytes = await readSegment(index, reference)
      const skip = offset - start
      if (skip >= bytes.byteLength) throw new Error('SABR segment is shorter than its index')
      const part = bytes.subarray(skip, Math.min(bytes.byteLength, skip + remaining))
      size += part.byteLength
      if (size > MAX_BYTES) throw new Error('Native SABR range exceeds the size limit')
      parts.push(part)
      offset += part.byteLength
      remaining -= part.byteLength
      if (remaining === 0 || length === -1) break
    }
    if (parts.length === 0 || (length !== -1 && remaining > 0)) {
      throw new Error('SABR byte range is outside the resource')
    }
    const result = new Uint8Array(size)
    let writeOffset = 0
    for (const part of parts) {
      result.set(part, writeOffset)
      writeOffset += part.byteLength
    }
    return result
  }
}
