import { useEffect, useMemo, useState } from 'react'
import { addTicks, formatTimecode, ticksToSeconds } from '../../domain/time'
import { editorStore, useEditorState } from '../../editor/store'
import { Icon } from '../Icon'

const effectGroups = [
  { name: 'Video Transitions', items: ['Cross Dissolve', 'Dip to Black', 'Directional Wipe'] },
  { name: 'Video Effects', items: ['Crop', 'Gaussian Blur', 'Sharpen', 'Chroma Key', 'Basic Correction'] },
  { name: 'Audio Transitions', items: ['Constant Power'] },
  { name: 'Audio Effects', items: ['Volume', 'Pan'] },
]

export function EffectsPanel() {
  const [query, setQuery] = useState('')
  const state = useEditorState()
  const selected = state.selectedClipIds.length > 0
  const groups = useMemo(() => effectGroups.map((group) => ({ ...group, items: group.items.filter((item) => item.toLowerCase().includes(query.toLowerCase())) })).filter((group) => group.items.length), [query])
  const apply = (name: string) => {
    if (!selected) { editorStore.setNotice({ kind: 'warning', message: 'Select a timeline clip before applying an effect.' }); return }
    if (name === 'Cross Dissolve') editorStore.applyTransition('in', 'cross-dissolve')
    else if (name === 'Dip to Black') editorStore.applyTransition('in', 'dip-black')
    else if (name === 'Directional Wipe') editorStore.applyTransition('in', 'wipe')
    else if (name === 'Gaussian Blur') editorStore.setClipEffect('blur', 8)
    else if (name === 'Sharpen') editorStore.setClipEffect('sharpen', 35)
    else if (name === 'Chroma Key') editorStore.setClipEffect('chromaKey.enabled', true)
    else editorStore.setActivePanel('effect-controls')
  }
  return <div className="panel-body effects-panel"><label className="search-field"><Icon name="search" size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search effects" /></label><div className="effect-tree">{groups.map((group) => <details key={group.name} open><summary><Icon name="chevron-down" size={10} />{group.name}</summary>{group.items.map((item) => <button key={item} onDoubleClick={() => apply(item)} onClick={() => apply(item)}><span className="effect-glyph">fx</span>{item}</button>)}</details>)}</div></div>
}

export function HistoryPanel() {
  const state = useEditorState()
  return <div className="panel-body history-panel"><div className="history-actions"><button onClick={() => editorStore.undo()} disabled={!editorStore.canUndo()}><Icon name="undo" />Undo</button><button onClick={() => editorStore.redo()} disabled={!editorStore.canRedo()}><Icon name="redo" />Redo</button></div><ol>{state.commandLog.map((command, index) => <li key={command.id} className={index === 0 ? 'current' : ''}><span>{command.type}</span><time>{new Date(command.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></li>)}{!state.commandLog.length && <li className="history-empty">Edits will appear here.</li>}</ol></div>
}

export function InfoPanel() {
  const state = useEditorState()
  const sequence = state.project?.sequences[state.project.activeSequenceId]
  const clip = sequence?.tracks.flatMap((track) => track.clips).find((item) => state.selectedClipIds.includes(item.id))
  if (!sequence) return <div className="panel-body" />
  return <div className="panel-body info-panel"><div className="info-header"><strong>{clip?.name ?? sequence.name}</strong><span>{clip ? 'Clip' : 'Sequence'}</span></div><dl><div><dt>Start</dt><dd>{formatTimecode(clip?.timelineStart ?? '0', sequence.frameRate)}</dd></div><div><dt>End</dt><dd>{formatTimecode(clip ? addTicks(clip.timelineStart, clip.timelineDuration) : sequence.durationTicks, sequence.frameRate)}</dd></div><div><dt>Duration</dt><dd>{formatTimecode(clip?.timelineDuration ?? sequence.durationTicks, sequence.frameRate)}</dd></div><div><dt>Frame size</dt><dd>{sequence.width} × {sequence.height}</dd></div><div><dt>Timebase</dt><dd>{(sequence.frameRate.numerator / sequence.frameRate.denominator).toFixed(sequence.frameRate.denominator === 1 ? 0 : 3)} fps</dd></div><div><dt>Color</dt><dd>Rec. 709 SDR</dd></div></dl></div>
}

export function AudioMixerPanel() {
  const state = useEditorState()
  const sequence = state.project?.sequences[state.project.activeSequenceId]
  const tracks = sequence?.tracks.filter((track) => track.kind === 'audio') ?? []
  return <div className="panel-body mixer-panel"><div className="mixer-strips">{tracks.map((track) => <div key={track.id} className="mixer-strip"><div className="meter-pair"><span style={{ height: state.isPlaying && !track.muted ? `${28 + ((track.order * 17 + Date.now() / 100) % 52)}%` : '3%' }} /><span style={{ height: state.isPlaying && !track.muted ? `${34 + ((track.order * 13 + Date.now() / 120) % 44)}%` : '3%' }} /></div><MixerFader value={track.gainDb ?? 0} label={`${track.name} level`} onCommit={(value) => editorStore.setTrackMix(track.id, value)} /><div className="mixer-buttons"><button className={track.solo ? 'active' : ''} onClick={() => editorStore.toggleTrack(track.id, 'solo')}>S</button><button className={track.muted ? 'active danger' : ''} onClick={() => editorStore.toggleTrack(track.id, 'muted')}>M</button></div><strong>{track.name}</strong></div>)}<div className="mixer-strip master"><div className="meter-pair"><span style={{ height: state.isPlaying ? '68%' : '3%' }} /><span style={{ height: state.isPlaying ? '61%' : '3%' }} /></div><MixerFader value={sequence?.masterGainDb ?? 0} label="Master level" onCommit={(value) => editorStore.setMasterGain(value)} /><div className="mixer-buttons"><button onClick={() => editorStore.setMasterGain(0)}>0</button></div><strong>Mix</strong></div></div></div>
}

function MixerFader({ value, label, onCommit }: { value: number; label: string; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return <input className="vertical-fader" type="range" min="-60" max="12" value={draft} onChange={(event) => setDraft(Number(event.target.value))} onPointerUp={() => onCommit(draft)} onKeyUp={() => onCommit(draft)} aria-label={label} />
}

export function MediaBrowserPanel() {
  const [folder, setFolder] = useState<string>('No folder linked')
  const linkFolder = async () => {
    const picker = (window as typeof window & { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker
    if (!picker) { editorStore.setNotice({ kind: 'warning', message: 'Directory access is unavailable in this browser.' }); return }
    try { setFolder((await picker()).name) } catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) editorStore.setNotice({ kind: 'error', message: 'Could not open that folder.' }) }
  }
  return <div className="panel-body media-browser-panel"><div className="browser-path"><Icon name="folder-open" /><span>{folder}</span></div><button className="panel-wide-action" onClick={() => void linkFolder()}><Icon name="folder-open" />Browse a local media folder</button><div className="panel-empty-copy"><Icon name="bin" size={22} /><strong>Direct local browsing</strong><span>Choose a folder to inspect files without uploading them.</span></div></div>
}

export function ScopesPanel() {
  const state = useEditorState()
  const points = useMemo(() => Array.from({ length: 70 }, (_, index) => `${index * 2.8},${50 + Math.sin(index * 0.7) * 18 + Math.cos(index * 0.21) * 20}`).join(' '), [])
  return <div className="panel-body scopes-panel"><div className="scopes-head"><span>Luma waveform</span><span>{state.isPlaying ? 'Live' : 'Paused'}</span></div><svg viewBox="0 0 196 100" preserveAspectRatio="none" aria-label="Luma waveform scope"><path className="scope-guides" d="M0 25h196M0 50h196M0 75h196M49 0v100M98 0v100M147 0v100" /><polyline points={points} /></svg><span className="scope-note">Preview scope · Rec. 709</span></div>
}

export function StoragePanel() {
  return <div className="panel-body storage-panel"><p>Cache management is available from Project Settings. Clearing cache never deletes source media.</p><button className="panel-wide-action" onClick={() => editorStore.setNotice({ kind: 'info', message: 'Open File > Project Settings to manage local cache.' })}><Icon name="settings" />Project storage settings</button></div>
}
