type ProxyWorkerResponse =
  | { type: 'progress'; progress: number }
  | { type: 'done' }
  | { type: 'error'; message: string }

export const generateProxy = (
  file: File,
  outputHandle: FileSystemFileHandle,
  height: 720 | 1080,
  onProgress: (progress: number) => void,
  signal?: AbortSignal,
): Promise<void> => new Promise((resolve, reject) => {
  const worker = new Worker(new URL('./proxy.worker.ts', import.meta.url), { type: 'module', name: 'editdatvid-proxy' })
  const finish = () => {
    signal?.removeEventListener('abort', cancel)
    worker.terminate()
  }
  const cancel = () => {
    worker.postMessage({ type: 'cancel' })
    finish()
    reject(new DOMException('Proxy generation cancelled.', 'AbortError'))
  }
  signal?.addEventListener('abort', cancel, { once: true })
  worker.onerror = (event) => {
    finish()
    reject(new Error(event.message || 'The proxy worker stopped unexpectedly.'))
  }
  worker.onmessage = (event: MessageEvent<ProxyWorkerResponse>) => {
    if (event.data.type === 'progress') onProgress(Math.max(0, Math.min(1, event.data.progress)))
    if (event.data.type === 'done') { finish(); resolve() }
    if (event.data.type === 'error') { finish(); reject(new Error(event.data.message)) }
  }
  worker.postMessage({ type: 'start', file, outputHandle, height })
})
