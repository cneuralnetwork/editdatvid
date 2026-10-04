import type { MediaCapabilityReport } from '../domain/types'

type EncoderConstructor = {
  isConfigSupported(config: Record<string, unknown>): Promise<{ supported?: boolean }>
}

const supported = async (ctor: EncoderConstructor | undefined, config: Record<string, unknown>): Promise<boolean> => {
  if (!ctor) return false
  try {
    return Boolean((await ctor.isConfigSupported(config)).supported)
  } catch {
    return false
  }
}

export async function detectCapabilities(): Promise<MediaCapabilityReport> {
  const nav = navigator as Navigator & { storage?: StorageManager }
  const estimate = await nav.storage?.estimate?.().catch(() => ({ usage: 0, quota: 0 }))
  const persistentStorage = await nav.storage?.persisted?.().catch(() => false) ?? false
  const videoEncoder = globalThis.VideoEncoder as unknown as EncoderConstructor | undefined
  const videoDecoder = globalThis.VideoDecoder as unknown as EncoderConstructor | undefined
  const audioEncoder = globalThis.AudioEncoder as unknown as EncoderConstructor | undefined
  const audioDecoder = globalThis.AudioDecoder as unknown as EncoderConstructor | undefined
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : null

  const [h264Enc, vp9Enc, aacEnc, opusEnc, mp3Enc, h264Dec, vp9Dec, aacDec, opusDec] = await Promise.all([
    supported(videoEncoder, { codec: 'avc1.42001f', width: 1920, height: 1080, bitrate: 8_000_000, framerate: 30 }),
    supported(videoEncoder, { codec: 'vp09.00.10.08', width: 1920, height: 1080, bitrate: 8_000_000, framerate: 30 }),
    supported(audioEncoder, { codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 }),
    supported(audioEncoder, { codec: 'opus', sampleRate: 48000, numberOfChannels: 2, bitrate: 160000 }),
    supported(audioEncoder, { codec: 'mp3', sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 }),
    supported(videoDecoder, { codec: 'avc1.42001f', codedWidth: 1920, codedHeight: 1080 }),
    supported(videoDecoder, { codec: 'vp09.00.10.08', codedWidth: 1920, codedHeight: 1080 }),
    supported(audioDecoder, { codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2 }),
    supported(audioDecoder, { codec: 'opus', sampleRate: 48000, numberOfChannels: 2 }),
  ])

  return {
    secureContext: window.isSecureContext,
    crossOriginIsolated: window.crossOriginIsolated,
    webCodecs: typeof VideoDecoder !== 'undefined',
    audioEncoder: typeof AudioEncoder !== 'undefined',
    videoEncoder: typeof VideoEncoder !== 'undefined',
    offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
    webgl2: Boolean(canvas?.getContext('webgl2')),
    audioWorklet: typeof AudioWorkletNode !== 'undefined',
    opfs: Boolean(nav.storage?.getDirectory),
    fileSystemAccess: 'showOpenFilePicker' in window,
    persistentStorage,
    usage: estimate?.usage ?? 0,
    quota: estimate?.quota ?? 0,
    encoders: { h264: h264Enc, vp9: vp9Enc, aac: aacEnc, opus: opusEnc, mp3: mp3Enc, wav: true },
    decoders: { h264: h264Dec, vp9: vp9Dec, aac: aacDec, opus: opusDec },
  }
}

export async function requestPersistentStorage(): Promise<boolean> {
  return await navigator.storage?.persist?.().catch(() => false) ?? false
}
