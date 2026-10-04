import { useEffect, useMemo, useRef, useState } from 'react'
import type { ExportFormat, ExportPreset, MediaCapabilityReport } from '../domain/types'
import { secondsToTicks, ticksToSeconds } from '../domain/time'
import { editorStore, useEditorState } from '../editor/store'
import { exportImageSequence, exportSequence } from '../media/exporter'
import { mediaRegistry } from '../media/registry'
import { Icon } from './Icon'
import { ProgramMonitor } from './panels/MonitorPanels'
import { downloadBlob, formatBytes, pickMediaFiles, safeFileName } from './utils'

export function ImportMode() {
  const state = useEditorState()
  const [dragging, setDragging] = useState(false)
  const [generateProxies, setGenerateProxies] = useState(true)
  const project = state.project!
  const assets = Object.values(project.assets)
  const addFiles = async (files: File[], handles?: FileSystemFileHandle[]) => {
    const imported = await editorStore.importFiles(files, handles)
    if (generateProxies) {
      for (const asset of imported.filter((item) => item.kind === 'video' && (item.metadata.height ?? 0) >= 2160)) {
        await editorStore.generateProxy(asset.id, 720)
      }
    }
  }
  const importMedia = async () => {
    try {
      const picked = await pickMediaFiles()
      await addFiles(picked.files, picked.handles)
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) editorStore.setNotice({ kind: 'error', message: 'Media import was not completed.' })
    }
  }
  return <div className={`import-mode ${dragging ? 'dragging' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); void addFiles(Array.from(event.dataTransfer.files)) }}>
    <aside className="import-locations"><h2>Import</h2><nav><span className="active"><Icon name="folder-open" />Local files</span><button onClick={() => void importMedia()}><Icon name="film" />Choose media</button></nav><div className="import-note"><span className="local-only-mark" /><p>Files are linked in place. No copy is made unless you generate a proxy.</p></div></aside>
    <section className="import-browser">
      <header><div><h1>Select media</h1><p>{assets.length ? `${assets.length} local ${assets.length === 1 ? 'item' : 'items'} in this project` : 'Start with video, audio, images, or captions'}</p></div><button className="button primary" onClick={() => void importMedia()}><Icon name="plus" />Choose files</button></header>
      {assets.length ? <div className="import-grid">{assets.map((asset) => <button key={asset.id} onClick={() => editorStore.selectAsset(asset.id)} onDoubleClick={() => { editorStore.insertAsset(asset.id); editorStore.setMode('edit') }}><span className="import-preview">{asset.kind === 'video' && mediaRegistry.getUrl(asset.id) ? <video src={mediaRegistry.getUrl(asset.id)} preload="metadata" muted /> : <Icon name={asset.kind === 'audio' ? 'waveform' : asset.kind === 'image' ? 'image' : asset.kind === 'caption' ? 'captions' : 'film'} size={28} />}</span><strong>{asset.name}</strong><small>{asset.metadata.width ? `${asset.metadata.width} × ${asset.metadata.height}` : asset.kind}</small></button>)}</div> : <button className="import-dropzone" onClick={() => void importMedia()}><span className="import-drop-shape"><Icon name="download" size={28} /></span><strong>Drop media anywhere</strong><span>or choose files from this computer</span></button>}
    </section>
    <aside className="import-settings"><h2>Import settings</h2><div className="setting-summary"><span>Destination sequence</span><strong>{project.sequences[project.activeSequenceId].name}</strong><small>1920 × 1080 · 30 fps · Rec. 709</small></div><label><span>Copy media</span><input type="checkbox" disabled title="EditDatVid links original files by design." /></label><label><span>Generate 720p proxies for 4K</span><input type="checkbox" checked={generateProxies} onChange={(event) => setGenerateProxies(event.target.checked)} /></label><button className="button primary import-finish" disabled={!assets.length} onClick={() => { if (state.selectedAssetIds[0]) editorStore.insertAsset(state.selectedAssetIds[0]); editorStore.setMode('edit') }}>Move to timeline</button></aside>
    {dragging && <div className="import-drag-overlay"><Icon name="download" size={34} /><strong>Release to link media</strong><span>Nothing will be uploaded</span></div>}
  </div>
}

const formats: Array<{ id: ExportFormat; label: string; description: string; extension: string }> = [
  { id: 'mp4-h264', label: 'H.264', description: 'MP4 · AVC + AAC', extension: 'mp4' },
  { id: 'webm-vp9', label: 'WebM', description: 'VP9 + Opus', extension: 'webm' },
  { id: 'wav', label: 'Waveform Audio', description: 'PCM · Uncompressed', extension: 'wav' },
  { id: 'mp3', label: 'MP3', description: 'Audio only', extension: 'mp3' },
  { id: 'png-sequence', label: 'PNG sequence', description: 'Lossless image frames', extension: 'png' },
  { id: 'jpeg-sequence', label: 'JPEG sequence', description: 'Compressed image frames', extension: 'jpg' },
]

const isFormatSupported = (format: ExportFormat, report: MediaCapabilityReport | null): boolean => {
  if (!report) return false
  if (format === 'mp4-h264') return Boolean(report.encoders.h264 && report.encoders.aac)
  if (format === 'webm-vp9') return Boolean(report.encoders.vp9 && report.encoders.opus)
  if (format === 'mp3') return Boolean(report.encoders.mp3)
  if (format === 'png-sequence' || format === 'jpeg-sequence') return report.fileSystemAccess
  return true
}

const missingFormatCapability = (format: ExportFormat, report: MediaCapabilityReport | null): string => {
  if (!report) return 'Browser capabilities are still being detected.'
  const missing: string[] = []
  if (format === 'mp4-h264') {
    if (!report.encoders.h264) missing.push('H.264 video encoder')
    if (!report.encoders.aac) missing.push('AAC audio encoder')
  }
  if (format === 'webm-vp9') {
    if (!report.encoders.vp9) missing.push('VP9 video encoder')
    if (!report.encoders.opus) missing.push('Opus audio encoder')
  }
  if (format === 'mp3' && !report.encoders.mp3) missing.push('MP3 audio encoder')
  if ((format === 'png-sequence' || format === 'jpeg-sequence') && !report.fileSystemAccess) missing.push('directory write access')
  return missing.length ? `Missing: ${missing.join(' and ')}.` : 'Supported by this browser.'
}

export function ExportMode({ capabilities }: { capabilities: MediaCapabilityReport | null }) {
  const state = useEditorState()
  const project = state.project!
  const sequence = project.sequences[project.activeSequenceId]
  const [format, setFormat] = useState<ExportFormat>(() => isFormatSupported('mp4-h264', capabilities) ? 'mp4-h264' : 'webm-vp9')
  const [outputName, setOutputName] = useState(`${project.name} - ${sequence.name}`)
  const [width, setWidth] = useState(sequence.width)
  const [height, setHeight] = useState(sequence.height)
  const [bitrate, setBitrate] = useState(12)
  const aborters = useRef(new Map<string, AbortController>())
  const frameRate = sequence.frameRate.numerator / sequence.frameRate.denominator
  const durationFrames = Math.max(1, Math.ceil(ticksToSeconds(sequence.durationTicks) * frameRate))
  const currentFrame = Math.min(durationFrames, Math.round(ticksToSeconds(state.currentTime) * frameRate))
  const selectedFormat = formats.find((item) => item.id === format)!
  const estimatedBytes = Math.max(1, Number(BigInt(sequence.durationTicks)) / Number(BigInt('254016000000'))) * bitrate * 125_000

  useEffect(() => {
    if (capabilities && !isFormatSupported(format, capabilities)) {
      setFormat(formats.find((item) => isFormatSupported(item.id, capabilities))?.id ?? 'wav')
    }
  }, [capabilities, format])

  const startExport = async () => {
    if (!isFormatSupported(format, capabilities)) {
      editorStore.setNotice({ kind: 'error', message: `${selectedFormat.label} is unavailable. ${missingFormatCapability(format, capabilities)}` })
      return
    }
    const availableStorage = (capabilities?.quota ?? 0) - (capabilities?.usage ?? 0)
    if (capabilities?.quota && estimatedBytes > availableStorage) {
      editorStore.setNotice({ kind: 'warning', message: `This export is estimated at ${formatBytes(estimatedBytes)}, but only ${formatBytes(availableStorage)} of browser-managed space is available. Free local cache space or lower the bitrate.` })
      return
    }
    const preset: ExportPreset = {
      id: `custom-${format}`, name: `${selectedFormat.label} · Match Source`, format, width, height,
      frameRate: sequence.frameRate, videoBitrate: bitrate * 1_000_000, audioBitrate: 192_000, sampleRate: 48_000, channels: 2,
    }
    const job = editorStore.queueExport(preset, safeFileName(outputName))
    if (!job) return
    const aborter = new AbortController()
    aborters.current.set(job.id, aborter)
    try {
      const snapshot = structuredClone(project)
      const snapshotSequence = snapshot.sequences[sequence.id]
      if (format === 'png-sequence' || format === 'jpeg-sequence') {
        const picker = (window as typeof window & { showDirectoryPicker?: (options?: unknown) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker
        if (!picker) throw new Error('A destination folder picker is required for image sequences.')
        const directory = await picker({ mode: 'readwrite', id: 'editdatvid-image-sequence' })
        await exportImageSequence(snapshot, snapshotSequence, preset, directory, (progress) => editorStore.updateExportJob(job.id, progress), aborter.signal)
        editorStore.updateExportJob(job.id, { status: 'completed', progress: 1, completedAt: new Date().toISOString() })
      } else {
        const result = await exportSequence(snapshot, snapshotSequence, preset, (progress) => editorStore.updateExportJob(job.id, progress), aborter.signal)
        editorStore.updateExportJob(job.id, { status: 'writing', progress: 1 })
        downloadBlob(result.blob, `${safeFileName(outputName)}.${result.extension}`)
        editorStore.updateExportJob(job.id, { status: 'completed', progress: 1, completedAt: new Date().toISOString() })
      }
      editorStore.setNotice({ kind: 'success', message: `${outputName} finished locally.` })
    } catch (error) {
      if (error instanceof DOMException && (error.name === 'AbortError' || error.name === 'NotAllowedError')) editorStore.updateExportJob(job.id, { status: 'cancelled' })
      else {
        const message = error instanceof Error ? error.message : 'Export failed.'
        editorStore.updateExportJob(job.id, { status: 'failed', error: message })
        editorStore.setNotice({ kind: 'error', message })
      }
    } finally {
      aborters.current.delete(job.id)
    }
  }

  const cancel = (id: string) => { aborters.current.get(id)?.abort(); editorStore.updateExportJob(id, { status: 'cancelled' }) }

  return <div className="export-mode">
    <section className="export-preview-pane">
      <div className="export-preview"><ProgramMonitor /></div>
      <div className="export-range"><span>Source: Entire sequence</span><span>{sequence.width} × {sequence.height} · {(sequence.frameRate.numerator / sequence.frameRate.denominator).toFixed(2)} fps</span></div>
      <div className="export-mini-timeline"><input type="range" min="0" max={durationFrames} step="1" value={currentFrame} aria-label="Export preview playhead" onChange={(event) => editorStore.setCurrentTime(secondsToTicks(Number(event.target.value) / frameRate))} /></div>
    </section>
    <section className="export-settings-pane">
      <header><div><h1>Export</h1><p>Render and encode entirely on this device.</p></div><span className="local-render-label"><span />Local render</span></header>
      <label className="export-name"><span>File name</span><input value={outputName} onChange={(event) => setOutputName(event.target.value)} /></label>
      <div className="export-format-list"><span className="export-section-title">Format</span>{formats.map((item) => {
        const supported = isFormatSupported(item.id, capabilities)
        return <button key={item.id} className={format === item.id ? 'selected' : ''} disabled={!supported} onClick={() => setFormat(item.id)} title={supported ? item.description : missingFormatCapability(item.id, capabilities)}><span className="format-radio" /><div><strong>{item.label}</strong><small>{item.description}</small></div>{supported ? format === item.id && <Icon name="check" /> : <span className="format-unavailable">Unavailable</span>}</button>
      })}</div>
      <details className="export-detail" open><summary>Video</summary><div><label><span>Frame size</span><select value={`${width}x${height}`} onChange={(event) => { const [w, h] = event.target.value.split('x').map(Number); setWidth(w); setHeight(h) }}><option value={`${sequence.width}x${sequence.height}`}>Match Source ({sequence.width} × {sequence.height})</option><option value="1920x1080">1920 × 1080</option><option value="1280x720">1280 × 720</option><option value="1080x1920">1080 × 1920</option></select></label><label><span>Target bitrate</span><div className="bitrate-field"><input type="range" min="2" max="40" value={bitrate} onChange={(event) => setBitrate(Number(event.target.value))} /><output>{bitrate} Mbps</output></div></label><label><span>Color space</span><output>Rec. 709 SDR</output></label></div></details>
      <details className="export-detail" open><summary>Audio</summary><div><label><span>Sample rate</span><output>48,000 Hz</output></label><label><span>Channels</span><output>Stereo</output></label><label><span>Bitrate</span><output>192 kbps</output></label></div></details>
      <div className="export-summary"><div><span>Estimated size</span><strong>{format.startsWith('png') || format.startsWith('jpeg') ? 'Folder sequence' : formatBytes(estimatedBytes)}</strong></div><div><span>Processing</span><strong>{capabilities?.crossOriginIsolated ? 'Isolated · hardware where available' : 'Browser encoder'}</strong></div></div>
      <button className="button primary export-button" disabled={!isFormatSupported(format, capabilities) || !outputName.trim()} onClick={() => void startExport()}><Icon name="download" />Export to this device</button>
    </section>
    <aside className="export-queue"><header><h2>Queue</h2><span>{state.exportJobs.length}</span></header>{state.exportJobs.length ? state.exportJobs.map((job) => <div key={job.id} className={`export-job ${job.status}`}><div className="job-head"><strong>{job.outputName}</strong><span>{job.status}</span></div><div className="job-progress"><span style={{ width: `${job.progress * 100}%` }} /></div><div className="job-meta"><span>{Math.round(job.progress * 100)}% · {job.renderedFrames}/{job.totalFrames} frames</span>{['queued', 'analyzing', 'rendering', 'muxing', 'writing'].includes(job.status) && <button onClick={() => cancel(job.id)}>Cancel</button>}</div>{job.error && <p>{job.error}</p>}</div>) : <div className="queue-empty"><Icon name="download" size={22} /><strong>No exports queued</strong><span>Completed files download directly to this device.</span></div>}</aside>
  </div>
}
