import { onBeforeUnmount, onMounted, watch } from 'vue'

const ANALYSIS_GAP_SECONDS = 1
const ANALYSIS_PLAYBACK_RATE = 4
const ANALYSER_FFT_SIZE = 4096
const AUDIBLE_PEAK_THRESHOLD_DB = -25
const BUFFER_RETENTION_SECONDS = 30
const FALLBACK_THRESHOLD_DB = -40
const HYSTERESIS_DB = 3
const MAX_CAPTURED_SEGMENT_BYTES = 4 * 1024 * 1024
const MAX_HISTORY_SAMPLES = 600
const MIN_HISTORY_SAMPLES = 60
const MIN_SILENCE_SECONDS = 0.7
const MIN_SKIP_SECONDS = 0.25
const RANGE_MERGE_GAP_SECONDS = 0.05
const SILENCE_END_PADDING_SECONDS = 0.15
const SPEECH_PEAK_THRESHOLD_DB = -35

export function createRequestPresentationTracker() {
  let presentation = 0
  const requestPresentations = new WeakMap()

  return {
    /**
     * @param {shaka.extern.RequestContext | undefined} context
     */
    beginRequest(context) {
      if (context && !requestPresentations.has(context)) {
        requestPresentations.set(context, presentation)
      }
    },
    /**
     * @param {shaka.extern.RequestContext | undefined} context
     * @returns {boolean}
     */
    isCurrent(context) {
      return Boolean(context && requestPresentations.get(context) === presentation)
    },
    reset() {
      presentation++
    },
  }
}

/**
 * Releases deduplication entries once their media is removed, allowing Shaka
 * to provide those segments again after a backward seek.
 *
 * @param {Map<string, CapturedSegment>} analysisSegments
 * @param {CapturedSegment[]} appendQueue
 * @param {number} endTime
 */
export function releaseAnalysisSegmentsBefore(analysisSegments, appendQueue, endTime) {
  for (const [key, segment] of analysisSegments) {
    if (Number.isFinite(segment.end) && segment.end <= endTime) {
      analysisSegments.delete(key)
    }
  }

  for (let index = appendQueue.length - 1; index >= 0; index--) {
    const segment = appendQueue[index]
    if (Number.isFinite(segment.end) && segment.end <= endTime) {
      appendQueue.splice(index, 1)
    }
  }
}

/**
 * @typedef {object} CapturedSegment
 * @property {ArrayBuffer} data
 * @property {number} end
 * @property {string} key
 * @property {number} start
 */

/**
 * @typedef {object} CapturedStream
 * @property {string} contentType
 * @property {ArrayBuffer | null} initData
 * @property {Map<string, CapturedSegment>} segments
 */

/**
 * Detects silence in a second, accelerated media pipeline that is fed the
 * audio segments already downloaded by Shaka. This lets the visible player
 * seek directly to a known silence endpoint without changing playback rate.
 *
 * @param {object} options
 * @param {import('vue').ComputedRef<boolean>} options.available
 * @param {import('vue').ComputedRef<boolean>} options.enabled
 * @param {import('vue').Ref<boolean>} options.isLive
 * @param {import('vue').Ref<HTMLVideoElement | null>} options.video
 */
export function useSilenceSkipping({ available, enabled, isLive, video }) {
  /** @type {AudioContext | null} */
  let analysisAudioContext = null
  /** @type {HTMLAudioElement | null} */
  let analysisAudio = null
  /** @type {MediaSource | null} */
  let analysisMediaSource = null
  /** @type {SourceBuffer | null} */
  let analysisSourceBuffer = null
  /** @type {MediaElementAudioSourceNode | null} */
  let analysisSourceNode = null
  /** @type {GainNode | null} */
  let analysisSink = null
  /** @type {AnalyserNode[]} */
  let analysers = []
  /** @type {Float32Array[]} */
  let sampleBuffers = []
  /** @type {number | null} */
  let analysisFrame = null
  /** @type {number | null} */
  let skipFrame = null
  /** @type {string | null} */
  let analysisObjectUrl = null
  /** @type {number | string | null} */
  let analysisStreamId = null
  /** @type {CapturedSegment[]} */
  let appendQueue = []
  /** @type {Map<string, CapturedSegment>} */
  const analysisSegments = new Map()
  let analysisGeneration = 0
  let analysisHasStarted = false
  let analysisPlayPending = false
  let lastRemovedTime = 0

  let destroyed = false
  let analysisIsSilent = false
  /** @type {number | null} */
  let analysisSilenceStart = null
  /** @type {number | null} */
  let lastAnalysisTime = null
  let dynamicThresholdDb = FALLBACK_THRESHOLD_DB
  let samplesUntilThresholdUpdate = 0
  const volumeHistory = []
  /** @type {Array<{start: number, end: number}>} */
  let silenceRanges = []

  /** @type {Map<number | string, CapturedStream>} */
  const capturedStreams = new Map()
  /** @type {number | string | null} */
  let latestStreamId = null
  const requestPresentationTracker = createRequestPresentationTracker()

  function shouldSkip() {
    const videoElement = video.value
    return !destroyed && enabled.value && !isLive.value && videoElement &&
      !videoElement.paused && !videoElement.ended && !videoElement.muted && videoElement.volume > 0 &&
      !videoElement.seeking
  }

  /**
   * @param {ArrayBuffer | ArrayBufferView} data
   * @returns {ArrayBuffer}
   */
  function copyBuffer(data) {
    if (data instanceof ArrayBuffer) {
      return data.slice(0)
    }

    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
  }

  /**
   * @param {{start: number, end: number}} range
   */
  function addSilenceRange(range) {
    if (range.end - range.start < MIN_SILENCE_SECONDS) {
      return
    }

    silenceRanges.push(range)
    silenceRanges.sort((a, b) => a.start - b.start)

    /** @type {Array<{start: number, end: number}>} */
    const merged = []
    for (const current of silenceRanges) {
      const previous = merged.at(-1)
      if (previous && current.start <= previous.end + RANGE_MERGE_GAP_SECONDS) {
        previous.end = Math.max(previous.end, current.end)
      } else {
        merged.push({ ...current })
      }
    }
    silenceRanges = merged
  }

  function resetAnalysisDetection() {
    analysisIsSilent = false
    analysisSilenceStart = null
    lastAnalysisTime = null
  }

  function flushPendingSilence() {
    if (analysisIsSilent && analysisSilenceStart !== null && lastAnalysisTime !== null) {
      addSilenceRange({ start: analysisSilenceStart, end: lastAnalysisTime })
    }

    analysisIsSilent = false
    analysisSilenceStart = null
  }

  function updateDynamicThreshold(volumeDb) {
    if (Number.isFinite(volumeDb)) {
      volumeHistory.push(volumeDb)
      if (volumeHistory.length > MAX_HISTORY_SAMPLES) {
        volumeHistory.shift()
      }
    }

    samplesUntilThresholdUpdate--
    if (volumeHistory.length < MIN_HISTORY_SAMPLES || samplesUntilThresholdUpdate > 0) {
      return
    }

    samplesUntilThresholdUpdate = 30
    const sortedHistory = [...volumeHistory].sort((a, b) => a - b)
    const noiseFloor = sortedHistory[Math.floor(sortedHistory.length * 0.15)]
    dynamicThresholdDb = Math.min(-30, Math.max(-60, noiseFloor + 3))
  }

  function getAudioLevels() {
    let peak = 0
    let rootMeanSquare = 0

    for (const [index, analyser] of analysers.entries()) {
      const samples = sampleBuffers[index]
      analyser.getFloatTimeDomainData(samples)

      let sumOfSquares = 0
      for (const sample of samples) {
        peak = Math.max(peak, Math.abs(sample))
        sumOfSquares += sample * sample
      }

      rootMeanSquare = Math.max(
        rootMeanSquare,
        Math.sqrt(sumOfSquares / samples.length)
      )
    }

    return {
      peakDb: peak === 0 ? -100 : 20 * Math.log10(peak),
      volumeDb: rootMeanSquare === 0 ? -100 : 20 * Math.log10(rootMeanSquare),
    }
  }

  function analyseAhead() {
    analysisFrame = null

    if (!analysisAudio || analysisAudio.paused || analysisAudio.ended || analysisAudio.seeking || analysers.length === 0) {
      flushPendingSilence()
      return
    }

    const currentTime = analysisAudio.currentTime
    if (lastAnalysisTime !== null && currentTime <= lastAnalysisTime) {
      analysisFrame = requestAnimationFrame(analyseAhead)
      return
    }

    if (lastAnalysisTime === null || currentTime - lastAnalysisTime > ANALYSIS_GAP_SECONDS) {
      flushPendingSilence()
      resetAnalysisDetection()
      lastAnalysisTime = currentTime
      analysisFrame = requestAnimationFrame(analyseAhead)
      return
    }

    const { peakDb, volumeDb } = getAudioLevels()
    updateDynamicThreshold(volumeDb)

    const containsAudiblePeak = peakDb >= AUDIBLE_PEAK_THRESHOLD_DB
    const containsSpeechPeak = peakDb >= SPEECH_PEAK_THRESHOLD_DB
    if (analysisIsSilent) {
      if (containsAudiblePeak || (containsSpeechPeak && volumeDb > dynamicThresholdDb + HYSTERESIS_DB)) {
        if (analysisSilenceStart !== null) {
          addSilenceRange({ start: analysisSilenceStart, end: currentTime })
        }
        analysisIsSilent = false
        analysisSilenceStart = null
      }
    } else if (!containsAudiblePeak && (!containsSpeechPeak || volumeDb < dynamicThresholdDb)) {
      analysisIsSilent = true
      analysisSilenceStart = lastAnalysisTime
    }

    lastAnalysisTime = currentTime
    analysisFrame = requestAnimationFrame(analyseAhead)
  }

  function scheduleAnalysis() {
    if (analysisFrame === null && analysisAudio && !analysisAudio.paused && !analysisAudio.seeking) {
      analysisFrame = requestAnimationFrame(analyseAhead)
    }
  }

  function findBufferedAnalysisTime(target) {
    if (!analysisAudio) {
      return null
    }

    for (let index = 0; index < analysisAudio.buffered.length; index++) {
      const start = analysisAudio.buffered.start(index)
      const end = analysisAudio.buffered.end(index)
      if (target < end - 0.01) {
        return Math.max(target, start + 0.01)
      }
    }

    return null
  }

  async function ensureAnalysisPlayback() {
    if (!analysisAudio || !analysisAudioContext || analysisPlayPending || !enabled.value || isLive.value) {
      return
    }

    const videoElement = video.value
    const playbackTime = videoElement?.currentTime ?? 0
    if (!analysisHasStarted || analysisAudio.currentTime + 0.5 < playbackTime) {
      const target = findBufferedAnalysisTime(playbackTime) ?? (
        !analysisMediaSource && analysisAudio.readyState >= HTMLMediaElement.HAVE_METADATA
          ? playbackTime
          : null
      )
      if (target === null) {
        return
      }

      flushPendingSilence()
      resetAnalysisDetection()
      analysisAudio.currentTime = target
      analysisHasStarted = true
    }

    if (!analysisAudio.paused) {
      analysisAudio.playbackRate = ANALYSIS_PLAYBACK_RATE
      scheduleAnalysis()
      return
    }

    analysisPlayPending = true
    try {
      await analysisAudioContext.resume()
      analysisAudio.defaultPlaybackRate = ANALYSIS_PLAYBACK_RATE
      analysisAudio.playbackRate = ANALYSIS_PLAYBACK_RATE
      await analysisAudio.play()
      scheduleAnalysis()
    } catch (error) {
      if (error?.name !== 'AbortError' && error?.name !== 'NotAllowedError') {
        console.warn('Unable to start look-ahead audio analysis for silence skipping', error)
      }
    } finally {
      analysisPlayPending = false
    }
  }

  function processAppendQueue() {
    if (!analysisSourceBuffer || analysisSourceBuffer.updating || analysisMediaSource?.readyState !== 'open') {
      return
    }

    const videoElement = video.value
    const cleanupTime = Math.min(
      analysisAudio?.currentTime ?? 0,
      videoElement?.currentTime ?? 0
    ) - BUFFER_RETENTION_SECONDS
    if (cleanupTime > lastRemovedTime + BUFFER_RETENTION_SECONDS && analysisSourceBuffer.buffered.length > 0) {
      lastRemovedTime = cleanupTime
      releaseAnalysisSegmentsBefore(analysisSegments, appendQueue, cleanupTime)
      analysisSourceBuffer.remove(0, cleanupTime)
      return
    }

    const segment = appendQueue.shift()
    if (!segment) {
      ensureAnalysisPlayback()
      return
    }

    try {
      analysisSourceBuffer.appendBuffer(segment.data)
    } catch (error) {
      if (error?.name === 'QuotaExceededError' && cleanupTime > 0) {
        appendQueue.unshift(segment)
        lastRemovedTime = cleanupTime
        releaseAnalysisSegmentsBefore(analysisSegments, appendQueue, cleanupTime)
        analysisSourceBuffer.remove(0, cleanupTime)
      } else {
        console.warn('Unable to buffer audio for silence skipping', error)
        queueMicrotask(processAppendQueue)
      }
    }
  }

  /**
   * @param {CapturedSegment} segment
   */
  function queueSegmentForAnalysis(segment) {
    if (analysisSegments.has(segment.key)) {
      return
    }

    analysisSegments.set(segment.key, segment)
    appendQueue.push(segment)
    appendQueue.sort((a, b) => a.start - b.start)
    processAppendQueue()
  }

  async function setupAnalysisGraph(generation) {
    if (!analysisAudio || generation !== analysisGeneration) {
      return
    }

    analysisAudioContext = new AudioContext()
    await analysisAudioContext.resume()
    if (!analysisAudio || generation !== analysisGeneration) {
      return
    }

    analysisSourceNode = analysisAudioContext.createMediaElementSource(analysisAudio)
    const splitter = analysisAudioContext.createChannelSplitter(2)
    analysisSink = analysisAudioContext.createGain()
    analysisSink.gain.value = 0

    analysisSourceNode.connect(splitter)
    for (let channel = 0; channel < splitter.numberOfOutputs; channel++) {
      const analyser = analysisAudioContext.createAnalyser()
      analyser.fftSize = ANALYSER_FFT_SIZE
      analyser.smoothingTimeConstant = 0
      splitter.connect(analyser, channel)
      analyser.connect(analysisSink)
      analysers.push(analyser)
      sampleBuffers.push(new Float32Array(analyser.fftSize))
    }
    analysisSink.connect(analysisAudioContext.destination)
  }

  function destroyAnalysisPipeline() {
    analysisGeneration++

    if (analysisFrame !== null) {
      cancelAnimationFrame(analysisFrame)
      analysisFrame = null
    }

    if (analysisAudio) {
      analysisAudio.removeEventListener('playing', scheduleAnalysis)
      analysisAudio.removeEventListener('canplay', ensureAnalysisPlayback)
      analysisAudio.removeEventListener('progress', ensureAnalysisPlayback)
      analysisAudio.removeEventListener('seeking', resetAnalysisDetection)
      analysisAudio.removeEventListener('seeked', ensureAnalysisPlayback)
      analysisAudio.pause()
    }
    analysisSourceBuffer?.removeEventListener('updateend', processAppendQueue)
    analysisSourceNode?.disconnect()
    analysisSink?.disconnect()
    analysisAudioContext?.close().catch(() => {})
    if (analysisAudio) {
      analysisAudio.removeAttribute('src')
      analysisAudio.load()
    }
    if (analysisObjectUrl) {
      URL.revokeObjectURL(analysisObjectUrl)
    }

    analysisAudioContext = null
    analysisAudio = null
    analysisMediaSource = null
    analysisSourceBuffer = null
    analysisSourceNode = null
    analysisSink = null
    analysisObjectUrl = null
    analysisStreamId = null
    analysers = []
    sampleBuffers = []
    appendQueue = []
    analysisSegments.clear()
    analysisHasStarted = false
    analysisPlayPending = false
    lastRemovedTime = 0
    dynamicThresholdDb = FALLBACK_THRESHOLD_DB
    samplesUntilThresholdUpdate = 0
    volumeHistory.length = 0
    resetAnalysisDetection()
  }

  /**
   * @param {number | string} streamId
   * @param {CapturedStream} stream
   */
  function setupSegmentAnalysis(streamId, stream) {
    if (!stream.initData || !MediaSource.isTypeSupported(stream.contentType)) {
      destroyAnalysisPipeline()
      return
    }

    destroyAnalysisPipeline()
    const generation = analysisGeneration
    analysisStreamId = streamId
    analysisAudio = document.createElement('audio')
    analysisAudio.preload = 'auto'
    analysisAudio.defaultPlaybackRate = ANALYSIS_PLAYBACK_RATE
    analysisAudio.playbackRate = ANALYSIS_PLAYBACK_RATE
    analysisAudio.preservesPitch = false
    analysisAudio.addEventListener('playing', scheduleAnalysis)
    analysisAudio.addEventListener('seeking', resetAnalysisDetection)
    analysisAudio.addEventListener('seeked', ensureAnalysisPlayback)

    analysisMediaSource = new MediaSource()
    analysisObjectUrl = URL.createObjectURL(analysisMediaSource)
    analysisAudio.src = analysisObjectUrl

    const initSegment = {
      data: stream.initData,
      end: Number.NEGATIVE_INFINITY,
      key: `init:${streamId}`,
      start: Number.NEGATIVE_INFINITY,
    }
    queueSegmentForAnalysis(initSegment)
    for (const segment of stream.segments.values()) {
      queueSegmentForAnalysis(segment)
    }

    analysisMediaSource.addEventListener('sourceopen', async () => {
      if (!analysisMediaSource || !analysisAudio || generation !== analysisGeneration) {
        return
      }

      try {
        analysisSourceBuffer = analysisMediaSource.addSourceBuffer(stream.contentType)
        analysisSourceBuffer.addEventListener('updateend', processAppendQueue)
        await setupAnalysisGraph(generation)
        processAppendQueue()
      } catch (error) {
        console.warn('Unable to create look-ahead audio analysis for silence skipping', error)
        if (generation === analysisGeneration) {
          destroyAnalysisPipeline()
        }
      }
    }, { once: true })
  }

  async function setupLocalFileAnalysis() {
    const videoElement = video.value
    const source = videoElement?.currentSrc
    if (!source || !source.startsWith('downloadmedia:')) {
      return
    }

    destroyAnalysisPipeline()
    const generation = analysisGeneration
    analysisAudio = document.createElement('audio')
    analysisAudio.preload = 'auto'
    analysisAudio.defaultPlaybackRate = ANALYSIS_PLAYBACK_RATE
    analysisAudio.playbackRate = ANALYSIS_PLAYBACK_RATE
    analysisAudio.preservesPitch = false
    analysisAudio.src = source
    analysisAudio.addEventListener('playing', scheduleAnalysis)
    analysisAudio.addEventListener('canplay', ensureAnalysisPlayback)
    analysisAudio.addEventListener('progress', ensureAnalysisPlayback)
    analysisAudio.addEventListener('seeking', resetAnalysisDetection)
    analysisAudio.addEventListener('seeked', ensureAnalysisPlayback)

    try {
      await setupAnalysisGraph(generation)
      await ensureAnalysisPlayback()
    } catch (error) {
      console.warn('Unable to analyse downloaded audio for silence skipping', error)
      if (generation === analysisGeneration) {
        destroyAnalysisPipeline()
      }
    }
  }

  function startAnalysisPipeline() {
    if (video.value?.nativePlayback) return
    if (!enabled.value || isLive.value || destroyed) {
      return
    }

    if (latestStreamId !== null) {
      const stream = capturedStreams.get(latestStreamId)
      if (stream?.initData) {
        if (analysisStreamId !== latestStreamId) {
          setupSegmentAnalysis(latestStreamId, stream)
        } else {
          ensureAnalysisPlayback()
        }
        return
      }
    }

    if (!analysisAudio) {
      setupLocalFileAnalysis()
    }
  }

  function skipKnownSilence() {
    skipFrame = null
    if (!shouldSkip()) {
      return
    }

    const videoElement = video.value
    const currentTime = videoElement.currentTime
    const range = silenceRanges.find(({ start, end }) => start <= currentTime && end > currentTime)
    if (range) {
      const target = range.end - SILENCE_END_PADDING_SECONDS
      if (target - currentTime >= MIN_SKIP_SECONDS) {
        videoElement.currentTime = target
        return
      }
    }

    skipFrame = requestAnimationFrame(skipKnownSilence)
  }

  function updateSkipState() {
    if (video.value?.nativePlayback) return
    if (shouldSkip()) {
      if (skipFrame === null) {
        skipFrame = requestAnimationFrame(skipKnownSilence)
      }
      startAnalysisPipeline()
      ensureAnalysisPlayback()
    } else if (skipFrame !== null) {
      cancelAnimationFrame(skipFrame)
      skipFrame = null
    }
  }

  function syncAnalysisAfterSeek() {
    flushPendingSilence()
    analysisAudio?.pause()
    analysisHasStarted = false
    resetAnalysisDetection()
    updateSkipState()
  }

  function pruneCapturedSegments(stream) {
    const currentTime = video.value?.currentTime ?? 0
    for (const [key, segment] of stream.segments) {
      if (segment.end < currentTime - BUFFER_RETENTION_SECONDS) {
        stream.segments.delete(key)
      }
    }

    let capturedBytes = [...stream.segments.values()]
      .reduce((total, segment) => total + segment.data.byteLength, 0)
    if (capturedBytes <= MAX_CAPTURED_SEGMENT_BYTES) {
      return
    }

    const oldestSegments = [...stream.segments.values()].sort((a, b) => a.end - b.end)
    for (const segment of oldestSegments) {
      stream.segments.delete(segment.key)
      capturedBytes -= segment.data.byteLength
      if (capturedBytes <= MAX_CAPTURED_SEGMENT_BYTES) {
        break
      }
    }
  }

  /**
   * Marks a request with the presentation that started it. The same request
   * context is passed to Shaka's response filters, including across retries.
   *
   * @param {shaka.extern.RequestContext | undefined} context
   */
  function handleSegmentRequest(context) {
    requestPresentationTracker.beginRequest(context)
  }

  /**
   * Records Shaka's audio responses so they can also be decoded by the
   * look-ahead media pipeline.
   *
   * @param {shaka.extern.Response} response
   * @param {shaka.extern.RequestContext | undefined} context
   */
  function handleSegmentResponse(response, context) {
    if (!requestPresentationTracker.isCurrent(context)) {
      return
    }

    const shakaStream = context?.stream
    if (!shakaStream || shakaStream.type !== 'audio' || shakaStream.encrypted || !response.data) {
      return
    }

    const streamId = shakaStream.id
    if (streamId === undefined || streamId === null) {
      return
    }

    const contentType = shakaStream.codecs
      ? `${shakaStream.mimeType}; codecs="${shakaStream.codecs}"`
      : shakaStream.mimeType
    let stream = capturedStreams.get(streamId)
    if (!stream) {
      stream = { contentType, initData: null, segments: new Map() }
      capturedStreams.set(streamId, stream)
    } else {
      stream.contentType = contentType
    }

    if (!context.segment) {
      stream.initData = copyBuffer(response.data)
      if (enabled.value && latestStreamId === streamId && analysisStreamId !== streamId) {
        setupSegmentAnalysis(streamId, stream)
      }
      return
    }

    if (!available.value && !enabled.value) {
      return
    }

    const { startTime: start, endTime: end } = context.segment
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return
    }

    const key = `${streamId}:${start}:${end}`
    let segment = stream.segments.get(key)
    if (!segment) {
      segment = { data: copyBuffer(response.data), end, key, start }
      stream.segments.set(key, segment)
      pruneCapturedSegments(stream)
    }

    if (enabled.value && analysisStreamId === streamId) {
      queueSegmentForAnalysis(segment)
    }

    latestStreamId = streamId
    for (const [otherStreamId, otherStream] of capturedStreams) {
      if (otherStreamId !== streamId) {
        otherStream.segments.clear()
      }
    }

    if (enabled.value && analysisStreamId !== streamId && stream.initData) {
      silenceRanges = []
      setupSegmentAnalysis(streamId, stream)
    }
  }

  function updateEnabledState() {
    if (video.value?.nativePlayback) {
      video.value.nativePlayback.setSkipSilence(enabled.value && !isLive.value)
        .catch(error => console.warn('Unable to update native silence skipping', error))
      return
    }
    if (!enabled.value || isLive.value) {
      destroyAnalysisPipeline()
      silenceRanges = []
    } else {
      startAnalysisPipeline()
    }
    updateSkipState()
  }

  function reset() {
    requestPresentationTracker.reset()
    destroyAnalysisPipeline()
    capturedStreams.clear()
    latestStreamId = null
    silenceRanges = []
  }

  watch([enabled, isLive], updateEnabledState)

  onMounted(() => {
    video.value?.addEventListener('play', updateSkipState)
    video.value?.addEventListener('pause', updateSkipState)
    video.value?.addEventListener('volumechange', updateSkipState)
    video.value?.addEventListener('seeking', updateSkipState)
    video.value?.addEventListener('seeked', syncAnalysisAfterSeek)
    video.value?.addEventListener('loadedmetadata', startAnalysisPipeline)
    updateEnabledState()
  })

  onBeforeUnmount(() => {
    destroyed = true
    video.value?.removeEventListener('play', updateSkipState)
    video.value?.removeEventListener('pause', updateSkipState)
    video.value?.removeEventListener('volumechange', updateSkipState)
    video.value?.removeEventListener('seeking', updateSkipState)
    video.value?.removeEventListener('seeked', syncAnalysisAfterSeek)
    video.value?.removeEventListener('loadedmetadata', startAnalysisPipeline)
    if (skipFrame !== null) {
      cancelAnimationFrame(skipFrame)
    }
    reset()
  })

  return { handleSegmentRequest, handleSegmentResponse, reset }
}
