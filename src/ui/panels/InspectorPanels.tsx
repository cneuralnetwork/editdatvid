import { useEffect, useMemo, useState } from 'react'
import type { ClipItem } from '../../domain/types'
import { editorStore, useEditorState } from '../../editor/store'
import { serializeCaptions } from '../../media/captions'
import { Icon } from '../Icon'
import { downloadBlob, safeFileName } from '../utils'

function InspectorSection({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return <section className="inspector-section">
    <button className="inspector-section-head" onClick={() => setOpen(!open)} aria-expanded={open}><Icon name="chevron-down" size={11} className={open ? '' : 'collapsed'} /><span>{title}</span></button>
    {open && <div className="inspector-section-body">{children}</div>}
  </section>
}

function EffectSlider({ label, value, min, max, step = 1, suffix = '', path }: { label: string; value: number; min: number; max: number; step?: number; suffix?: string; path: string }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = () => { if (draft !== value) editorStore.setClipEffect(path, draft) }
  return <label className="effect-control-row">
    <span>{label}</span>
    <input type="range" min={min} max={max} step={step} value={draft} onChange={(event) => setDraft(Number(event.target.value))} onPointerUp={commit} onKeyUp={commit} />
    <span className="effect-number"><input type="number" min={min} max={max} step={step} value={draft} onChange={(event) => setDraft(Number(event.target.value))} onBlur={commit} />{suffix}</span>
  </label>
}

function SpeedSlider({ value }: { value: number }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return <label className="effect-control-row"><span>Speed</span><input type="range" min={10} max={800} value={draft} onChange={(event) => setDraft(Number(event.target.value))} onPointerUp={() => editorStore.setClipPlaybackRate(draft)} /><span className="effect-number"><input type="number" min={10} max={800} value={draft} onChange={(event) => setDraft(Number(event.target.value))} onBlur={() => editorStore.setClipPlaybackRate(draft)} />%</span></label>
}

const useSelectedClip = (): ClipItem | undefined => {
  const state = useEditorState()
  const sequence = state.project?.sequences[state.project.activeSequenceId]
  return sequence?.tracks.flatMap((track) => track.clips).find((clip) => state.selectedClipIds.includes(clip.id))
}

function NoClip() {
  return <div className="panel-empty-copy"><Icon name="selection" size={23} /><strong>No clip selected</strong><span>Select a timeline clip to edit its properties.</span></div>
}

export function EffectControlsPanel() {
  const clip = useSelectedClip()
  if (!clip) return <div className="panel-body"><NoClip /></div>
  const fx = clip.effects
  return <div className="panel-body inspector-panel">
    <div className="inspector-clip-head"><span className="clip-label-swatch" style={{ background: clip.label }} /><strong>{clip.name}</strong><button title="Reset all effects" onClick={() => {
      editorStore.setClipEffect('motion.positionX', 0); editorStore.setClipEffect('motion.positionY', 0); editorStore.setClipEffect('motion.scale', 100); editorStore.setClipEffect('motion.rotation', 0); editorStore.setClipEffect('opacity', 100)
    }}><Icon name="redo" size={13} /></button></div>
    <InspectorSection title="Motion">
      <EffectSlider label="Position X" value={fx.motion.positionX} min={-1920} max={1920} path="motion.positionX" />
      <EffectSlider label="Position Y" value={fx.motion.positionY} min={-1080} max={1080} path="motion.positionY" />
      <EffectSlider label="Scale" value={fx.motion.scale} min={0} max={400} step={0.1} suffix="%" path="motion.scale" />
      <EffectSlider label="Rotation" value={fx.motion.rotation} min={-180} max={180} step={0.1} suffix="°" path="motion.rotation" />
    </InspectorSection>
    <InspectorSection title="Opacity">
      <EffectSlider label="Opacity" value={fx.opacity} min={0} max={100} suffix="%" path="opacity" />
      <label className="effect-select-row"><span>Blend mode</span><select value={fx.blendMode} onChange={(event) => editorStore.setClipEffect('blendMode', event.target.value)}><option value="normal">Normal</option><option value="multiply">Multiply</option><option value="screen">Screen</option><option value="overlay">Overlay</option></select></label>
    </InspectorSection>
    <InspectorSection title="Crop" defaultOpen={false}>
      <EffectSlider label="Left" value={fx.crop.left} min={0} max={100} suffix="%" path="crop.left" />
      <EffectSlider label="Right" value={fx.crop.right} min={0} max={100} suffix="%" path="crop.right" />
      <EffectSlider label="Top" value={fx.crop.top} min={0} max={100} suffix="%" path="crop.top" />
      <EffectSlider label="Bottom" value={fx.crop.bottom} min={0} max={100} suffix="%" path="crop.bottom" />
    </InspectorSection>
    <InspectorSection title="Time remapping" defaultOpen={false}>
      <SpeedSlider value={clip.playbackRate * 100} />
      <label className="switch-row"><span>Reverse</span><button role="switch" aria-checked={clip.reverse} className={clip.reverse ? 'on' : ''} onClick={() => editorStore.toggleClipFlag('reverse')}><span /></button></label>
      <label className="switch-row"><span>Freeze frame</span><button role="switch" aria-checked={clip.freezeFrame} className={clip.freezeFrame ? 'on' : ''} onClick={() => editorStore.toggleClipFlag('freezeFrame')}><span /></button></label>
    </InspectorSection>
    <InspectorSection title="Audio">
      <EffectSlider label="Level" value={fx.audio.gainDb} min={-96} max={12} step={0.1} suffix=" dB" path="audio.gainDb" />
      <EffectSlider label="Pan" value={fx.audio.pan} min={-100} max={100} path="audio.pan" />
    </InspectorSection>
  </div>
}

export function PropertiesPanel() {
  const state = useEditorState()
  const clip = useSelectedClip()
  const asset = state.selectedAssetIds[0] ? state.project?.assets[state.selectedAssetIds[0]] : undefined
  if (!clip && !asset) return <div className="panel-body"><NoClip /></div>
  if (clip) return <div className="panel-body inspector-panel properties-panel">
    <div className="properties-title"><span className="clip-label-swatch" style={{ background: clip.label }} /><div><strong>{clip.name}</strong><small>Timeline clip</small></div></div>
    <InspectorSection title="Transform"><EffectSlider label="Scale" value={clip.effects.motion.scale} min={0} max={400} suffix="%" path="motion.scale" /><EffectSlider label="Rotation" value={clip.effects.motion.rotation} min={-180} max={180} suffix="°" path="motion.rotation" /></InspectorSection>
    <InspectorSection title="Appearance"><EffectSlider label="Opacity" value={clip.effects.opacity} min={0} max={100} suffix="%" path="opacity" /></InspectorSection>
    <InspectorSection title="Audio"><EffectSlider label="Volume" value={clip.effects.audio.gainDb} min={-96} max={12} step={0.1} suffix=" dB" path="audio.gainDb" /></InspectorSection>
  </div>
  return <div className="panel-body inspector-panel"><div className="properties-title"><span className="asset-icon"><Icon name={asset!.kind === 'audio' ? 'waveform' : asset!.kind === 'image' ? 'image' : 'film'} /></span><div><strong>{asset!.name}</strong><small>Project asset</small></div></div><MetadataTable asset={asset!} />{asset!.kind === 'video' && <InspectorSection title="Proxy"><div className="proxy-control"><div><span>Editing proxy</span><strong>{asset!.proxy.state === 'ready' ? `${asset!.proxy.height}p WebM` : asset!.proxy.state === 'generating' ? `${Math.round((asset!.proxy.progress ?? 0) * 100)}%` : asset!.proxy.state}</strong></div>{asset!.proxy.state === 'ready' ? <button className="button compact" onClick={() => editorStore.toggleProxy(asset!.id)}>{asset!.proxy.useForPreview === false ? 'Use proxy' : 'Use original'}</button> : <button className="button compact" disabled={asset!.proxy.state === 'generating'} onClick={() => void editorStore.generateProxy(asset!.id, (asset!.metadata.height ?? 0) > 2160 ? 1080 : 720)}>Generate proxy</button>}{asset!.proxy.error && <p>{asset!.proxy.error}</p>}</div></InspectorSection>}</div>
}

function MetadataTable({ asset }: { asset: NonNullable<ReturnType<typeof useAsset>> }) {
  const rows = [
    ['Type', asset.kind], ['Container', asset.metadata.container ?? 'Unknown'], ['Video codec', asset.metadata.videoCodec ?? '—'], ['Audio codec', asset.metadata.audioCodec ?? '—'],
    ['Frame size', asset.metadata.width ? `${asset.metadata.width} × ${asset.metadata.height}` : '—'], ['Sample rate', asset.metadata.sampleRate ? `${asset.metadata.sampleRate} Hz` : '—'], ['File size', `${(asset.fingerprint.size / 1_048_576).toFixed(1)} MB`], ['Local status', asset.relinkState], ['Proxy', asset.proxy.state === 'ready' ? `${asset.proxy.height}p ${asset.proxy.useForPreview === false ? 'off' : 'active'}` : asset.proxy.state],
  ]
  return <dl className="metadata-table">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
}

function useAsset() {
  const state = useEditorState()
  return state.selectedAssetIds[0] ? state.project?.assets[state.selectedAssetIds[0]] : undefined
}

export function MetadataPanel() {
  const asset = useAsset()
  return <div className="panel-body inspector-panel">{asset ? <><div className="metadata-file"><Icon name={asset.kind === 'audio' ? 'waveform' : asset.kind === 'image' ? 'image' : 'film'} /><strong>{asset.name}</strong></div><MetadataTable asset={asset} /></> : <div className="panel-empty-copy"><Icon name="film" size={22} /><strong>No metadata</strong><span>Select a project asset.</span></div>}</div>
}

export function ColorPanel() {
  const clip = useSelectedClip()
  if (!clip) return <div className="panel-body"><NoClip /></div>
  const color = clip.effects.color
  return <div className="panel-body inspector-panel color-panel">
    <div className="color-wheel" aria-label="Color wheel preview"><span /><span /></div>
    <InspectorSection title="Basic correction">
      <EffectSlider label="Exposure" value={color.exposure} min={-5} max={5} step={0.1} path="color.exposure" />
      <EffectSlider label="Contrast" value={color.contrast} min={-100} max={100} path="color.contrast" />
      <EffectSlider label="Highlights" value={color.highlights} min={-100} max={100} path="color.highlights" />
      <EffectSlider label="Shadows" value={color.shadows} min={-100} max={100} path="color.shadows" />
      <EffectSlider label="Temperature" value={color.temperature} min={-100} max={100} path="color.temperature" />
      <EffectSlider label="Tint" value={color.tint} min={-100} max={100} path="color.tint" />
      <EffectSlider label="Saturation" value={color.saturation} min={0} max={200} suffix="%" path="color.saturation" />
    </InspectorSection>
    <InspectorSection title="Creative detail" defaultOpen={false}><EffectSlider label="Blur" value={clip.effects.blur} min={0} max={40} step={0.1} suffix=" px" path="blur" /><EffectSlider label="Sharpen" value={clip.effects.sharpen} min={0} max={100} path="sharpen" /></InspectorSection>
    <InspectorSection title="Chroma key" defaultOpen={false}><label className="switch-row"><span>Enable key</span><button role="switch" aria-checked={clip.effects.chromaKey.enabled} className={clip.effects.chromaKey.enabled ? 'on' : ''} onClick={() => editorStore.setClipEffect('chromaKey.enabled', !clip.effects.chromaKey.enabled)}><span /></button></label><EffectSlider label="Similarity" value={clip.effects.chromaKey.similarity} min={0} max={100} suffix="%" path="chromaKey.similarity" /><EffectSlider label="Smoothness" value={clip.effects.chromaKey.smoothness} min={0} max={100} suffix="%" path="chromaKey.smoothness" /></InspectorSection>
  </div>
}

export function TextPanel() {
  const state = useEditorState()
  const sequence = state.project?.sequences[state.project.activeSequenceId]
  const captions = sequence?.tracks.flatMap((track) => track.captions) ?? []
  const clip = useSelectedClip()
  const [titleDraft, setTitleDraft] = useState(clip?.titleText ?? '')
  useEffect(() => setTitleDraft(clip?.titleText ?? ''), [clip?.id, clip?.titleText])
  return <div className="panel-body text-panel">
    <button className="panel-wide-action" onClick={() => editorStore.addTitleClip()}><Icon name="plus" />Add title at playhead</button>
    {clip?.titleText !== undefined && <label className="title-text-editor"><span>Title text</span><textarea value={titleDraft} onChange={(event) => setTitleDraft(event.target.value)} onBlur={() => { if (titleDraft !== clip.titleText) editorStore.setTitleText(clip.id, titleDraft) }} /></label>}
    <div className="text-style-sample">Aa<span>Local system fonts</span></div>
    <button className="panel-wide-action secondary" onClick={() => editorStore.addCaption()}><Icon name="captions" />Add caption at playhead</button>
    <div className="caption-list compact">{captions.map((caption) => <button key={caption.id} onClick={() => editorStore.setCurrentTime(caption.start)}><Icon name="text" /><span>{caption.text}</span></button>)}</div>
  </div>
}

export function CaptionsPanel() {
  const state = useEditorState()
  const sequence = state.project?.sequences[state.project.activeSequenceId]
  const captions = sequence?.tracks.flatMap((track) => track.captions) ?? []
  const exportCaptions = (format: 'srt' | 'vtt') => {
    if (!captions.length || !sequence) return
    downloadBlob(new Blob([serializeCaptions(captions, format)], { type: format === 'srt' ? 'application/x-subrip' : 'text/vtt' }), `${safeFileName(sequence.name)}.${format}`)
  }
  return <div className="panel-body captions-panel">
    <div className="caption-toolbar"><button className="button compact" onClick={() => editorStore.addCaption()}><Icon name="plus" />New caption</button><div className="caption-toolbar-actions"><span>{captions.length} segments</span><button disabled={!captions.length} onClick={() => exportCaptions('srt')}>SRT</button><button disabled={!captions.length} onClick={() => exportCaptions('vtt')}>VTT</button></div></div>
    <div className="caption-list">{captions.map((caption, index) => <label key={caption.id}><span>{String(index + 1).padStart(2, '0')}</span><textarea value={caption.text} onChange={(event) => editorStore.updateCaption(caption.id, event.target.value)} onFocus={() => editorStore.setCurrentTime(caption.start)} /></label>)}{!captions.length && <div className="panel-empty-copy"><Icon name="captions" size={22} /><strong>No captions</strong><span>Add a segment at the playhead or import SRT/VTT in the Project panel.</span></div>}</div>
  </div>
}

export function EssentialSoundPanel() {
  const clip = useSelectedClip()
  return <div className="panel-body sound-panel">{clip ? <><p>Tag the selected clip, then shape its level in Effect Controls.</p><div className="sound-types"><button onClick={() => editorStore.setClipEffect('audio.gainDb', -3)}><Icon name="volume" />Dialogue</button><button onClick={() => editorStore.setClipEffect('audio.gainDb', -12)}><Icon name="waveform" />Music</button><button onClick={() => editorStore.setClipEffect('audio.gainDb', -6)}><Icon name="audio" />SFX</button></div><button className="panel-wide-action" onClick={() => editorStore.setClipEffect('audio.gainDb', 0)}>Reset loudness</button></> : <NoClip />}</div>
}
