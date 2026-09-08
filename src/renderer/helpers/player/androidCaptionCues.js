/** Plain PiP captions retain the shared parser's nested word timing. */
export function androidCaptionCues(cues, duration) {
  const result = []
  for (const root of cues) {
    const parts = []
    function collect(cue, parentStart, parentEnd) {
      const startTime = Math.max(parentStart, cue.startTime ?? parentStart)
      const endTime = Math.min(parentEnd, cue.endTime ?? parentEnd)
      if (!(endTime > startTime)) return
      if (cue.nestedCues?.length) {
        for (const child of cue.nestedCues) collect(child, startTime, endTime)
      } else if (Number.isFinite(startTime) && Number.isFinite(endTime)) {
        parts.push({ startTime, endTime, text: cue.lineBreak ? '\n' : cue.payload ?? '' })
      }
    }
    collect(root, 0, Number.isFinite(duration) && duration > 0 ? duration : Infinity)
    const boundaries = [...new Set(parts.flatMap(part => [part.startTime, part.endTime]))].sort((a, b) => a - b)
    let previous = null
    for (let index = 0; index < boundaries.length - 1; index++) {
      const startTime = boundaries[index]
      const endTime = boundaries[index + 1]
      const text = parts.filter(part => part.startTime <= startTime && startTime < part.endTime)
        .map(part => part.text).join('')
      if (!text.trim()) continue
      if (previous?.endTime === startTime && previous.text === text) previous.endTime = endTime
      else {
        previous = { startTime, endTime, text }
        result.push(previous)
      }
    }
  }
  return result
}
