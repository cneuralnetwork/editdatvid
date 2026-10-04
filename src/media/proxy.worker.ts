/// <reference lib="webworker" />
import { ALL_FORMATS, BlobSource, Conversion, Input, Output, Quality, StreamTarget, WebMOutputFormat } from 'mediabunny'

type ProxyRequest =
  | { type: 'start'; file: File; outputHandle: FileSystemFileHandle; height: 720 | 1080 }
  | { type: 'cancel' }

type ProxyResponse =
  | { type: 'progress'; progress: number }
  | { type: 'done' }
  | { type: 'error'; message: string }

const scope = self as DedicatedWorkerGlobalScope
let active: Conversion | null = null

scope.onmessage = async (event: MessageEvent<ProxyRequest>) => {
  if (event.data.type === 'cancel') {
    await active?.cancel()
    return
  }
  const { file, outputHandle, height } = event.data
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) })
  try {
    const writable = await outputHandle.createWritable()
    const output = new Output({ format: new WebMOutputFormat(), target: new StreamTarget(writable) })
    active = await Conversion.init({
      input,
      output,
      tracks: 'primary',
      video: {
        height,
        codec: 'vp9',
        quality: new Quality('medium'),
        keyFrameInterval: 1,
        hardwareAcceleration: 'no-preference',
        forceTranscode: true,
      },
      audio: { codec: 'opus', sampleRate: 48_000, quality: new Quality('medium') },
      showWarnings: false,
    })
    if (!active.isValid) {
      const reasons = Array.from(new Set(active.discardedTracks.map((item) => item.reason))).join(', ')
      throw new Error(`Proxy conversion is unsupported${reasons ? `: ${reasons.replaceAll('_', ' ')}` : ''}.`)
    }
    active.onProgress = (progress) => scope.postMessage({ type: 'progress', progress } satisfies ProxyResponse)
    await active.execute()
    scope.postMessage({ type: 'done' } satisfies ProxyResponse)
  } catch (error) {
    scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Proxy generation failed.' } satisfies ProxyResponse)
  } finally {
    input.dispose()
    active = null
  }
}
