import {
  ALL_FORMATS,
  AudioBufferSink,
  AudioBufferSource,
  BlobSource,
  BufferTarget,
  CanvasSource,
  Input,
  Mp3OutputFormat,
  Mp4OutputFormat,
  Output,
  Quality,
  WavOutputFormat,
  WebMOutputFormat,
  type AudioCodec,
} from 'mediabunny'
import { addTicks, ticksToSeconds } from '../domain/time'
import type { Asset, ClipItem, ExportJobStatus, ExportPreset, ProjectDocumentV1, Sequence } from '../domain/types'
import { mediaRegistry } from './registry'

export interface ExportProgress {
  status: ExportJobStatus
  progress: number
  renderedFrames: number
  totalFrames: number
  elapsedMs: number
  etaMs?: number
}

export interface ExportResult {
  blob: Blob
  extension: string
  mimeType: string
}

type PreparedVisual = { kind: 'video'; element: HTMLVideoElement } | { kind: 'image'; bitmap: ImageBitmap }

const nextPaint = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

async function prepareVisual(asset: Asset): Promise<PreparedVisual | null> {
  const runtime = mediaRegistry.get(asset.id)
  if (!runtime) return null
  if (asset.kind === 'image') return { kind: 'image', bitmap: await createImageBitmap(runtime.file) }
  if (asset.kind !== 'video') return null
  const element = document.createElement('video')
  element.src = mediaRegistry.getOriginalUrl(asset.id) ?? runtime.url
  element.muted = true
  element.preload = 'auto'
  element.playsInline = true
  await new Promise<void>((resolve, reject) => {
    element.onloadedmetadata = () => resolve()
    element.onerror = () => reject(new Error(`Could not decode ${asset.name}.`))
  })
  return { kind: 'video', element }
}

async function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
  const safe = Math.max(0, Math.min(Math.max(0, video.duration - 0.001), time))
  if (Math.abs(video.currentTime - safe) < 0.02 && video.readyState >= 2) return
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => { cleanup(); reject(new Error('A source frame took too long to decode.')) }, 12_000)
    const cleanup = () => { window.clearTimeout(timeout); video.removeEventListener('seeked', done); video.removeEventListener('error', failed) }
    const done = () => { cleanup(); resolve() }
    const failed = () => { cleanup(); reject(new Error('A source frame could not be decoded.')) }
    video.addEventListener('seeked', done, { once: true })
    video.addEventListener('error', failed, { once: true })
    video.currentTime = safe
  })
}

function drawContained(ctx: CanvasRenderingContext2D, source: CanvasImageSource, sourceWidth: number, sourceHeight: number, width: number, height: number): void {
  const scale = Math.min(width / sourceWidth, height / sourceHeight)
  const drawWidth = sourceWidth * scale
  const drawHeight = sourceHeight * scale
  ctx.drawImage(source, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight)
}

function activeVisuals(sequence: Sequence, atSeconds: number): ClipItem[] {
  return sequence.tracks
    .filter((track) => track.kind === 'video' && track.visible)
    .sort((a, b) => a.order - b.order)
    .flatMap((track) => track.clips)
    .filter((clip) => clip.enabled !== false && atSeconds >= ticksToSeconds(clip.timelineStart) && atSeconds < ticksToSeconds(addTicks(clip.timelineStart, clip.timelineDuration)))
}

function transitionOpacity(clip: ClipItem, atSeconds: number): number {
  const local = atSeconds - ticksToSeconds(clip.timelineStart)
  const duration = ticksToSeconds(clip.timelineDuration)
  const transitionDuration = Math.min(1, duration / 2)
  let opacity = clip.effects.opacity / 100
  if (clip.transitionIn && local < transitionDuration) opacity *= local / transitionDuration
  if (clip.transitionOut && duration - local < transitionDuration) opacity *= (duration - local) / transitionDuration
  return Math.max(0, Math.min(1, opacity))
}

async function drawFrame(ctx: CanvasRenderingContext2D, project: ProjectDocumentV1, sequence: Sequence, visuals: Map<string, PreparedVisual | null>, atSeconds: number, width: number, height: number): Promise<void> {
  ctx.save()
  ctx.fillStyle = '#050505'
  ctx.fillRect(0, 0, width, height)
  for (const clip of activeVisuals(sequence, atSeconds)) {
    if (clip.titleText !== undefined) {
      ctx.save()
      ctx.globalAlpha = transitionOpacity(clip, atSeconds)
      ctx.translate(width / 2 + clip.effects.motion.positionX, height / 2 + clip.effects.motion.positionY)
      ctx.rotate(clip.effects.motion.rotation * Math.PI / 180)
      ctx.scale(clip.effects.motion.scale / 100, clip.effects.motion.scale / 100)
      ctx.font = `650 ${Math.max(32, Math.round(width * 0.055))}px system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = '#ffffff'
      ctx.fillText(clip.titleText, 0, 0, width * 0.82)
      ctx.restore()
      continue
    }
    const asset = project.assets[clip.assetId]
    const prepared = visuals.get(clip.assetId)
    if (!asset || !prepared) continue
    const localTime = (atSeconds - ticksToSeconds(clip.timelineStart)) * clip.playbackRate
    const sourceTime = clip.freezeFrame ? ticksToSeconds(clip.sourceIn) : ticksToSeconds(clip.sourceIn) + (clip.reverse ? ticksToSeconds(clip.sourceDuration) - localTime : localTime)
    if (prepared.kind === 'video') await seekVideo(prepared.element, sourceTime)
    ctx.save()
    ctx.globalAlpha = transitionOpacity(clip, atSeconds)
    ctx.translate(width / 2 + clip.effects.motion.positionX, height / 2 + clip.effects.motion.positionY)
    ctx.rotate(clip.effects.motion.rotation * Math.PI / 180)
    ctx.scale(clip.effects.motion.scale / 100, clip.effects.motion.scale / 100)
    ctx.translate(-width / 2, -height / 2)
    ctx.filter = `brightness(${100 + clip.effects.color.exposure * 12}%) contrast(${100 + clip.effects.color.contrast}%) saturate(${clip.effects.color.saturation}%) blur(${clip.effects.blur}px)`
    const source = prepared.kind === 'video' ? prepared.element : prepared.bitmap
    const sourceWidth = prepared.kind === 'video' ? prepared.element.videoWidth : prepared.bitmap.width
    const sourceHeight = prepared.kind === 'video' ? prepared.element.videoHeight : prepared.bitmap.height
    drawContained(ctx, source, sourceWidth, sourceHeight, width, height)
    ctx.restore()
  }
  const caption = sequence.tracks.flatMap((track) => track.captions).find((item) => atSeconds >= ticksToSeconds(item.start) && atSeconds < ticksToSeconds(addTicks(item.start, item.duration)))
  if (caption) {
    const fontSize = Math.max(24, Math.round(caption.style.fontSize * width / 1920))
    ctx.font = `600 ${fontSize}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const metrics = ctx.measureText(caption.text)
    const x = width / 2
    const y = caption.position === 'top' ? height * 0.15 : caption.position === 'center' ? height * 0.5 : height * 0.84
    ctx.fillStyle = caption.style.background
    ctx.fillRect(x - metrics.width / 2 - 18, y - fontSize * 0.75, metrics.width + 36, fontSize * 1.5)
    ctx.fillStyle = caption.style.color
    ctx.fillText(caption.text, x, y)
  }
  ctx.restore()
}

async function mixAudio(project: ProjectDocumentV1, sequence: Sequence, sampleRate: number, signal: AbortSignal): Promise<AudioBuffer | null> {
  const duration = ticksToSeconds(sequence.durationTicks)
  const length = Math.ceil(duration * sampleRate)
  if (length <= 0) return null
  const output = new AudioBuffer({ length, sampleRate, numberOfChannels: 2 })
  const left = output.getChannelData(0)
  const right = output.getChannelData(1)
  const masterGain = 10 ** ((sequence.masterGainDb ?? 0) / 20)
  const audioTracks = sequence.tracks.filter((track) => track.kind === 'audio' && !track.muted && (track.solo || !sequence.tracks.some((candidate) => candidate.kind === 'audio' && candidate.solo)))
  let wrote = false
  for (const track of audioTracks) {
    for (const clip of track.clips) {
      if (clip.enabled === false) continue
      if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError')
      const runtime = mediaRegistry.get(clip.assetId)
      if (!runtime) continue
      const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(runtime.file) })
      try {
        const audioTrack = await input.getPrimaryAudioTrack()
        if (!audioTrack || !(await audioTrack.canDecode())) continue
        const sink = new AudioBufferSink(audioTrack)
        const sourceStart = ticksToSeconds(clip.sourceIn)
        const sourceEnd = sourceStart + ticksToSeconds(clip.sourceDuration)
        const timelineStart = ticksToSeconds(clip.timelineStart)
        const gain = 10 ** ((clip.effects.audio.gainDb + (track.gainDb ?? 0)) / 20) * masterGain
        const pan = Math.max(-1, Math.min(1, (clip.effects.audio.pan + (track.pan ?? 0)) / 100))
        const leftGain = gain * (pan <= 0 ? 1 : 1 - pan)
        const rightGain = gain * (pan >= 0 ? 1 : 1 + pan)
        for await (const wrapped of sink.buffers(sourceStart, sourceEnd)) {
          const sourceBuffer = wrapped.buffer
          const relativeStart = Math.max(0, wrapped.timestamp - sourceStart)
          const destinationStart = Math.floor((timelineStart + relativeStart / clip.playbackRate) * sampleRate)
          const outputFrames = Math.ceil(sourceBuffer.length / clip.playbackRate)
          for (let outIndex = 0; outIndex < outputFrames; outIndex += 1) {
            const destination = destinationStart + outIndex
            if (destination < 0 || destination >= length) continue
            const sourceIndex = Math.min(sourceBuffer.length - 1, Math.floor(outIndex * clip.playbackRate))
            const sourceLeft = sourceBuffer.getChannelData(0)[sourceIndex] ?? 0
            const sourceRight = sourceBuffer.numberOfChannels > 1 ? sourceBuffer.getChannelData(1)[sourceIndex] ?? sourceLeft : sourceLeft
            left[destination] = Math.max(-1, Math.min(1, left[destination] + sourceLeft * leftGain))
            right[destination] = Math.max(-1, Math.min(1, right[destination] + sourceRight * rightGain))
          }
          wrote = true
        }
      } finally {
        input.dispose()
      }
    }
  }
  return wrote ? output : null
}

function emitProgress(onProgress: (progress: ExportProgress) => void, status: ExportJobStatus, renderedFrames: number, totalFrames: number, started: number): void {
  const elapsedMs = performance.now() - started
  const progress = totalFrames ? renderedFrames / totalFrames : 0
  onProgress({ status, progress, renderedFrames, totalFrames, elapsedMs, etaMs: progress > 0 ? elapsedMs * (1 - progress) / progress : undefined })
}

export async function exportSequence(project: ProjectDocumentV1, sequence: Sequence, preset: ExportPreset, onProgress: (progress: ExportProgress) => void, signal: AbortSignal): Promise<ExportResult> {
  const started = performance.now()
  const duration = ticksToSeconds(sequence.durationTicks)
  const fps = preset.frameRate.numerator / preset.frameRate.denominator
  const totalFrames = Math.max(1, Math.ceil(duration * fps))
  emitProgress(onProgress, 'analyzing', 0, totalFrames, started)

  const audioOnly = preset.format === 'wav' || preset.format === 'mp3'
  const mix = await mixAudio(project, sequence, preset.sampleRate, signal)
  if (audioOnly) {
    if (!mix) throw new Error('The active sequence has no decodable audio.')
    const target = new BufferTarget()
    const format = preset.format === 'wav' ? new WavOutputFormat() : new Mp3OutputFormat()
    const output = new Output({ format, target })
    const codec: AudioCodec = preset.format === 'wav' ? 'pcm-s16' : 'mp3'
    const audioSource = new AudioBufferSource({ codec, quality: new Quality('high') })
    output.addAudioTrack(audioSource)
    await output.start()
    emitProgress(onProgress, 'rendering', 0, 1, started)
    await audioSource.add(mix)
    emitProgress(onProgress, 'muxing', 1, 1, started)
    await output.finalize()
    if (!target.buffer) throw new Error('The encoder returned no output.')
    const extension = preset.format === 'wav' ? 'wav' : 'mp3'
    const mimeType = preset.format === 'wav' ? 'audio/wav' : 'audio/mpeg'
    return { blob: new Blob([target.buffer], { type: mimeType }), extension, mimeType }
  }

  if (preset.format === 'png-sequence' || preset.format === 'jpeg-sequence') throw new Error('Image sequences require a destination folder and are started from the image-sequence action.')

  const canvas = document.createElement('canvas')
  canvas.width = preset.width
  canvas.height = preset.height
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) throw new Error('Canvas rendering is unavailable.')
  const visualAssets = new Set(sequence.tracks.filter((track) => track.kind === 'video').flatMap((track) => track.clips.map((clip) => clip.assetId)))
  const visuals = new Map<string, PreparedVisual | null>()
  for (const assetId of visualAssets) if (project.assets[assetId]) visuals.set(assetId, await prepareVisual(project.assets[assetId]))

  const target = new BufferTarget()
  const format = preset.format === 'mp4-h264' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat()
  const output = new Output({ format, target })
  const videoSource = new CanvasSource(canvas, {
    codec: preset.format === 'mp4-h264' ? 'avc' : 'vp9',
    quality: new Quality('high'),
    keyFrameInterval: 2,
  })
  output.addVideoTrack(videoSource, { frameRate: fps })
  const audioSource = mix ? new AudioBufferSource({ codec: preset.format === 'mp4-h264' ? 'aac' : 'opus', quality: new Quality('high') }) : null
  if (audioSource) output.addAudioTrack(audioSource)
  await output.start()

  for (let frame = 0; frame < totalFrames; frame += 1) {
    if (signal.aborted) { await output.cancel(); throw new DOMException('Export cancelled', 'AbortError') }
    const timestamp = frame / fps
    await drawFrame(ctx, project, sequence, visuals, timestamp, preset.width, preset.height)
    await videoSource.add(timestamp, 1 / fps, { keyFrame: frame % Math.max(1, Math.round(fps * 2)) === 0 })
    if (frame % 2 === 0 || frame === totalFrames - 1) emitProgress(onProgress, 'rendering', frame + 1, totalFrames, started)
    if (frame % 8 === 0) await nextPaint()
  }
  if (audioSource && mix) await audioSource.add(mix)
  emitProgress(onProgress, 'muxing', totalFrames, totalFrames, started)
  await output.finalize()
  for (const prepared of visuals.values()) if (prepared?.kind === 'image') prepared.bitmap.close()
  if (!target.buffer) throw new Error('The encoder returned no output.')
  const mimeType = preset.format === 'mp4-h264' ? 'video/mp4' : 'video/webm'
  return { blob: new Blob([target.buffer], { type: mimeType }), extension: preset.format === 'mp4-h264' ? 'mp4' : 'webm', mimeType }
}

export async function exportImageSequence(project: ProjectDocumentV1, sequence: Sequence, preset: ExportPreset, directory: FileSystemDirectoryHandle, onProgress: (progress: ExportProgress) => void, signal: AbortSignal): Promise<void> {
  const started = performance.now()
  const fps = preset.frameRate.numerator / preset.frameRate.denominator
  const totalFrames = Math.max(1, Math.ceil(ticksToSeconds(sequence.durationTicks) * fps))
  const canvas = document.createElement('canvas')
  canvas.width = preset.width
  canvas.height = preset.height
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) throw new Error('Canvas rendering is unavailable.')
  const visuals = new Map<string, PreparedVisual | null>()
  for (const assetId of new Set(sequence.tracks.filter((track) => track.kind === 'video').flatMap((track) => track.clips.map((clip) => clip.assetId)))) {
    if (project.assets[assetId]) visuals.set(assetId, await prepareVisual(project.assets[assetId]))
  }
  const imageType = preset.format === 'png-sequence' ? 'image/png' : 'image/jpeg'
  const extension = preset.format === 'png-sequence' ? 'png' : 'jpg'
  for (let frame = 0; frame < totalFrames; frame += 1) {
    if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError')
    await drawFrame(ctx, project, sequence, visuals, frame / fps, preset.width, preset.height)
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Could not encode image frame.')), imageType, 0.94))
    const handle = await directory.getFileHandle(`frame_${String(frame + 1).padStart(7, '0')}.${extension}`, { create: true })
    const writable = await handle.createWritable()
    await writable.write(blob)
    await writable.close()
    emitProgress(onProgress, 'writing', frame + 1, totalFrames, started)
    if (frame % 4 === 0) await nextPaint()
  }
  for (const prepared of visuals.values()) if (prepared?.kind === 'image') prepared.bitmap.close()
}
