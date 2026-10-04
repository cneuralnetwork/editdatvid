import { ALL_FORMATS, BlobSource, Input } from 'mediabunny'
import { makeId } from '../domain/project'
import { secondsToTicks } from '../domain/time'
import type { Asset, AssetKind, MediaMetadata } from '../domain/types'

const extension = (name: string): string => name.split('.').pop()?.toLowerCase() ?? ''

export function inferAssetKind(file: File): AssetKind {
  if (file.type.startsWith('video/')) return 'video'
  if (file.type.startsWith('audio/')) return 'audio'
  if (file.type.startsWith('image/')) return 'image'
  if (['srt', 'vtt'].includes(extension(file.name))) return 'caption'
  return 'video'
}

async function probeImage(file: File): Promise<MediaMetadata> {
  const bitmap = await createImageBitmap(file)
  const metadata: MediaMetadata = {
    durationTicks: secondsToTicks(5),
    width: bitmap.width,
    height: bitmap.height,
    container: file.type || extension(file.name),
  }
  bitmap.close()
  return metadata
}

async function probeMedia(file: File): Promise<MediaMetadata> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) })
  try {
    if (!(await input.canRead())) throw new Error('The file container is not supported.')
    const [format, duration, video, audio] = await Promise.all([
      input.getFormat(),
      input.getDurationFromMetadata(),
      input.getPrimaryVideoTrack(),
      input.getPrimaryAudioTrack(),
    ])
    const metadata: MediaMetadata = {
      durationTicks: secondsToTicks(duration ?? 0),
      container: format.name,
    }
    if (video) {
      const [width, height, rotation, codec, frameRate] = await Promise.all([
        video.getDisplayWidth(),
        video.getDisplayHeight(),
        video.getRotation(),
        video.getCodec(),
        video.computeFrameRateMetrics({ targetPacketCount: 120 }).catch(() => null),
      ])
      metadata.width = width
      metadata.height = height
      metadata.rotation = rotation
      metadata.videoCodec = codec ?? undefined
      if (frameRate?.bestGuessFrameRate) {
        const guessed = frameRate.bestGuessFrameRate
        metadata.frameRate = Math.abs(guessed - 29.97) < 0.02
          ? { numerator: 30000, denominator: 1001 }
          : { numerator: Math.round(guessed * 1000), denominator: 1000 }
      }
    }
    if (audio) {
      const [sampleRate, channels, codec] = await Promise.all([
        audio.getSampleRate(), audio.getNumberOfChannels(), audio.getCodec(),
      ])
      metadata.sampleRate = sampleRate
      metadata.channels = channels
      metadata.audioCodec = codec ?? undefined
    }
    return metadata
  } finally {
    input.dispose()
  }
}

export async function fingerprintFile(file: File): Promise<string> {
  const sampleSize = Math.min(file.size, 64 * 1024)
  const first = await file.slice(0, sampleSize).arrayBuffer()
  const last = file.size > sampleSize ? await file.slice(file.size - sampleSize).arrayBuffer() : new ArrayBuffer(0)
  const combined = new Uint8Array(first.byteLength + last.byteLength)
  combined.set(new Uint8Array(first), 0)
  combined.set(new Uint8Array(last), first.byteLength)
  const digest = await crypto.subtle.digest('SHA-256', combined)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function fileToAsset(file: File): Promise<Asset> {
  const kind = inferAssetKind(file)
  const metadata = kind === 'image'
    ? await probeImage(file)
    : kind === 'caption'
      ? { durationTicks: '0', container: extension(file.name) }
      : await probeMedia(file)
  return {
    id: makeId('asset'),
    name: file.name,
    kind,
    binId: 'root',
    fingerprint: {
      name: file.name,
      size: file.size,
      lastModified: file.lastModified,
      type: file.type,
      sampleHash: await fingerprintFile(file),
    },
    metadata,
    relinkState: 'online',
    proxy: { state: 'none' },
    createdAt: new Date().toISOString(),
    label: kind === 'audio' ? '#62a878' : kind === 'image' ? '#b66c9d' : kind === 'caption' ? '#b39a5b' : '#5f78b8',
  }
}
