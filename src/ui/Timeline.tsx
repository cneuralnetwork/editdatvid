import { useEffect, useMemo, useRef, useState } from 'react'
import { addTicks, formatTimecode, parseTimecode, secondsToTicks, ticksToSeconds } from '../domain/time'
import type { ClipItem, EditorTool, TickString, Track } from '../domain/types'
import { editorStore, useEditorState } from '../editor/store'
import { Icon, type IconName } from './Icon'

const tools: Array<{ id: EditorTool; icon: IconName; label: string; key: string }> = [
  { id: 'selection', icon: 'selection', label: 'Selection Tool', key: 'V' },
  { id: 'track-select', icon: 'arrow-left', label: 'Track Select Forward Tool', key: 'A' },
  { id: 'ripple', icon: 'skip-forward', label: 'Ripple Edit Tool', key: 'B' },
  { id: 'rolling', icon: 'sliders', label: 'Rolling Edit Tool', key: 'N' },
  { id: 'rate', icon: 'skip-forward', label: 'Rate Stretch Tool', key: 'R' },
  { id: 'razor', icon: 'razor', label: 'Razor Tool', key: 'C' },
  { id: 'slip', icon: 'unlink', label: 'Slip Tool', key: 'Y' },
  { id: 'slide', icon: 'link', label: 'Slide Tool', key: 'U' },
  { id: 'hand', icon: 'hand', label: 'Hand Tool', key: 'H' },
  { id: 'zoom', icon: 'zoom-in', label: 'Zoom Tool', key: 'Z' },
  { id: 'type', icon: 'text', label: 'Type Tool', key: 'T' },
]

type ContextState = { x: number; y: number; at: TickString; clipId?: string; trackId?: string }

function TimecodeInput({ value, rate }: { value: TickString; rate: { numerator: number; denominator: number } }) {
  const formatted = formatTimecode(value, rate)
  const [draft, setDraft] = useState(formatted)
  const editing = useRef(false)
  useEffect(() => { if (!editing.current) setDraft(formatted) }, [formatted])
  const commit = () => {
    editing.current = false
    const parsed = parseTimecode(draft, rate)
    if (parsed) editorStore.setCurrentTime(parsed)
    else setDraft(formatted)
  }
  return <input
    className="timeline-timecode"
    value={draft}
    aria-label="Current timeline timecode"
    title="Enter timecode as hours:minutes:seconds:frames"
    spellCheck={false}
    onFocus={(event) => { editing.current = true; event.currentTarget.select() }}
    onChange={(event) => setDraft(event.target.value)}
    onBlur={commit}
    onKeyDown={(event) => {
      if (event.key === 'Enter') { event.preventDefault(); commit(); event.currentTarget.blur() }
      if (event.key === 'Escape') { setDraft(formatted); editing.current = false; event.currentTarget.blur() }
    }}
  />
}

function TrackHeader({ track }: { track: Track }) {
  return <div className={`track-header ${track.kind}`} data-track-header-id={track.id}>
    <button type="button" className={track.targeted ? 'targeted' : ''} aria-pressed={track.targeted} onClick={() => editorStore.toggleTrack(track.id, 'targeted')} title={`Target ${track.name}`}>{track.name}</button>
    <button type="button" onClick={() => editorStore.toggleTrack(track.id, 'syncLock')} className={track.syncLock ? 'active' : ''} aria-pressed={track.syncLock} aria-label={`${track.syncLock ? 'Disable' : 'Enable'} sync lock for ${track.name}`} title="Sync lock"><Icon name="link" size={12} /></button>
    <button type="button" className={track.locked ? 'active' : ''} onClick={() => editorStore.toggleTrack(track.id, 'locked')} aria-pressed={track.locked} aria-label={`${track.locked ? 'Unlock' : 'Lock'} ${track.name}`} title={track.locked ? 'Unlock track' : 'Lock track'}><Icon name={track.locked ? 'lock' : 'unlock'} size={12} /></button>
    {track.kind === 'video' && <button type="button" className={track.visible ? 'active' : ''} onClick={() => editorStore.toggleTrack(track.id, 'visible')} aria-pressed={track.visible} aria-label={`${track.visible ? 'Hide' : 'Show'} ${track.name}`} title="Toggle track output"><Icon name="eye" size={12} /></button>}
    {track.kind === 'audio' && <>
      <button type="button" className={track.muted ? 'danger active' : ''} onClick={() => editorStore.toggleTrack(track.id, 'muted')} aria-pressed={track.muted} aria-label={`Mute ${track.name}`} title="Mute">M</button>
      <button type="button" className={track.solo ? 'active' : ''} onClick={() => editorStore.toggleTrack(track.id, 'solo')} aria-pressed={track.solo} aria-label={`Solo ${track.name}`} title="Solo">S</button>
    </>}
  </div>
}

type ClipBlockProps = {
  clip: ClipItem
  track: Track
  pxPerSecond: number
  selected: boolean
  snapTime: (value: TickString, excludedIds?: string[]) => TickString
  onContextMenu: (event: React.MouseEvent, clip: ClipItem, track: Track) => void
  onZoomAt: (clientX: number, out: boolean) => void
  onBeginHand: (event: React.PointerEvent) => void
}

function ClipBlock({ clip, track, pxPerSecond, selected, snapTime, onContextMenu, onZoomAt, onBeginHand }: ClipBlockProps) {
  const state = useEditorState()
  const [dragOffset, setDragOffset] = useState(0)
  const [trimPreview, setTrimPreview] = useState<{ edge: 'start' | 'end'; x: number } | null>(null)
  const [operationPreview, setOperationPreview] = useState('')
  const left = ticksToSeconds(clip.timelineStart) * pxPerSecond
  const width = Math.max(10, ticksToSeconds(clip.timelineDuration) * pxPerSecond)

  const beginDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.stopPropagation()
    if (state.activeTool === 'hand') { onBeginHand(event); return }
    if (state.activeTool === 'zoom') { onZoomAt(event.clientX, event.altKey); return }
    if (state.activeTool === 'track-select') {
      editorStore.selectTrackForward(track.id, clip.timelineStart, event.shiftKey)
      return
    }
    if (state.activeTool === 'razor') {
      const relative = Math.max(0, Math.min(width, event.clientX - event.currentTarget.getBoundingClientRect().left))
      const at = snapTime(addTicks(clip.timelineStart, secondsToTicks(relative / pxPerSecond)))
      editorStore.setCurrentTime(at)
      editorStore.splitClipAt(clip.id, at)
      return
    }
    if (state.activeTool === 'type') {
      editorStore.addTitleClip(track.kind === 'video' ? track.id : undefined, snapTime(clip.timelineStart))
      return
    }
    editorStore.selectClip(clip.id, event.ctrlKey || event.metaKey)
    if (track.locked || state.activeTool === 'ripple' || state.activeTool === 'rolling' || state.activeTool === 'rate') return
    const startX = event.clientX
    const move = (pointer: PointerEvent) => {
      const delta = pointer.clientX - startX
      if (state.activeTool !== 'slip') setDragOffset(delta)
      setOperationPreview(state.activeTool === 'slip' ? `${delta >= 0 ? '+' : ''}${(delta / pxPerSecond).toFixed(2)}s source` : '')
    }
    const up = (pointer: PointerEvent) => {
      const deltaPx = pointer.clientX - startX
      const delta = secondsToTicks(Math.abs(deltaPx) / pxPerSecond)
      const signedDelta = deltaPx < 0 ? (-BigInt(delta)).toString() : delta
      setDragOffset(0)
      setOperationPreview('')
      if (Math.abs(deltaPx) > 1) {
        if (state.activeTool === 'slip') editorStore.slipClip(clip.id, signedDelta)
        else {
          const proposed = secondsToTicks(Math.max(0, ticksToSeconds(clip.timelineStart) + deltaPx / pxPerSecond))
          const nextStart = snapTime(proposed, state.selectedClipIds)
          if (state.activeTool === 'slide') editorStore.slideClip(clip.id, nextStart)
          else {
            const dropTarget = document.elementFromPoint(pointer.clientX, pointer.clientY)?.closest<HTMLElement>('[data-track-id]')
            editorStore.moveClip(clip.id, nextStart, dropTarget?.dataset.trackId)
          }
        }
      }
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const beginTrim = (event: React.PointerEvent, edge: 'start' | 'end') => {
    if (event.button !== 0) return
    event.stopPropagation()
    editorStore.selectClip(clip.id)
    if (track.locked) return
    const startX = event.clientX
    const move = (pointer: PointerEvent) => setTrimPreview({ edge, x: pointer.clientX - startX })
    const up = (pointer: PointerEvent) => {
      const deltaSeconds = (pointer.clientX - startX) / pxPerSecond
      const base = edge === 'start' ? ticksToSeconds(clip.timelineStart) : ticksToSeconds(addTicks(clip.timelineStart, clip.timelineDuration))
      const value = snapTime(secondsToTicks(Math.max(0, base + deltaSeconds)), [clip.id])
      if (state.activeTool === 'ripple') editorStore.rippleTrimClip(clip.id, edge, value)
      else if (state.activeTool === 'rolling') editorStore.rollingTrimClip(clip.id, edge, value)
      else if (state.activeTool === 'rate') editorStore.rateStretchClip(clip.id, edge, value)
      else editorStore.trimClip(clip.id, edge, value)
      setTrimPreview(null)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const previewLeft = trimPreview?.edge === 'start' ? trimPreview.x : 0
  const previewWidth = trimPreview ? trimPreview.edge === 'start' ? width - trimPreview.x : width + trimPreview.x : width
  return <div
    className={`timeline-clip ${selected ? 'selected' : ''} ${track.kind} ${clip.enabled === false ? 'disabled' : ''}`}
    style={{ left: left + dragOffset + previewLeft, width: Math.max(5, previewWidth), '--clip-color': clip.label } as React.CSSProperties}
    onPointerDown={beginDrag}
    onContextMenu={(event) => onContextMenu(event, clip, track)}
    onDoubleClick={(event) => { event.stopPropagation(); editorStore.selectClip(clip.id); editorStore.setActivePanel(clip.titleText !== undefined ? 'text' : 'effect-controls') }}
    onKeyDown={(event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); editorStore.selectClip(clip.id, event.ctrlKey || event.metaKey) }
      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
        const rect = event.currentTarget.getBoundingClientRect()
        onContextMenu({ preventDefault: () => undefined, stopPropagation: () => undefined, clientX: rect.left + 12, clientY: rect.top + 12 } as React.MouseEvent, clip, track)
      }
    }}
    role="button"
    tabIndex={0}
    aria-pressed={selected}
    aria-label={`${clip.name}, ${track.name}, starts ${formatTimecode(clip.timelineStart)}`}
    data-clip-id={clip.id}
  >
    <span className="trim-handle start" onPointerDown={(event) => beginTrim(event, 'start')} />
    <div className="clip-topline"><strong>{clip.name}</strong><span className="clip-flags">{clip.enabled === false && 'OFF'}{clip.linkGroupId && <Icon name="link" size={9} />}{clip.effects.keyframes && Object.keys(clip.effects.keyframes).length > 0 && <i className="keyframe-mark">◆</i>}</span></div>
    {operationPreview && <span className="operation-preview">{operationPreview}</span>}
    {track.kind === 'audio' ? <div className="clip-wave" aria-hidden="true">{Array.from({ length: Math.max(8, Math.floor(width / 7)) }, (_, index) => <i key={index} style={{ height: `${18 + ((index * 17) % 72)}%` }} />)}</div>
      : clip.titleText !== undefined ? <div className="clip-title-preview"><Icon name="text" size={14} /><span>{clip.titleText}</span></div>
        : <div className="clip-filmstrip" aria-hidden="true">{Array.from({ length: Math.max(1, Math.min(10, Math.floor(width / 54))) }, (_, index) => <span key={index}><Icon name="film" size={13} /></span>)}</div>}
    {clip.transitionIn && <span className="transition-mark in" title={clip.transitionIn} />}
    {clip.transitionOut && <span className="transition-mark out" title={clip.transitionOut} />}
    <span className="trim-handle end" onPointerDown={(event) => beginTrim(event, 'end')} />
  </div>
}

function MenuItem({ label, shortcut, disabled, checked, onClick }: { label: string; shortcut?: string; disabled?: boolean; checked?: boolean; onClick: () => void }) {
  return <button type="button" role="menuitem" disabled={disabled} onClick={onClick}><span className="context-check">{checked === undefined ? '' : checked ? '✓' : ''}</span><span>{label}</span>{shortcut && <kbd>{shortcut}</kbd>}</button>
}

export function Timeline() {
  const state = useEditorState()
  const project = state.project
  const sequence = project?.sequences[project.activeSequenceId]
  const viewportRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [context, setContext] = useState<ContextState | null>(null)
  const [speedClipId, setSpeedClipId] = useState<string | null>(null)
  const pxPerSecond = state.timelineZoom
  const displayDuration = Math.max(30, ticksToSeconds(sequence?.durationTicks ?? '0') + 10)
  const contentWidth = displayDuration * pxPerSecond
  const tracks = useMemo(() => sequence ? [
    ...sequence.tracks.filter((track) => track.kind === 'caption'),
    ...sequence.tracks.filter((track) => track.kind === 'video'),
    ...sequence.tracks.filter((track) => track.kind === 'audio'),
  ] : [], [sequence])
  const rulerStep = pxPerSecond >= 180 ? 0.5 : pxPerSecond >= 70 ? 1 : 5
  const marks = Array.from({ length: Math.ceil(displayDuration / rulerStep) + 1 }, (_, index) => index * rulerStep)

  useEffect(() => {
    if (!context) return
    menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    const close = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setContext(null) }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setContext(null) }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', key)
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', key) }
  }, [context])

  if (!project || !sequence) return null

  const timelineTimeAt = (clientX: number): TickString => {
    const rect = viewportRef.current?.getBoundingClientRect()
    const x = clientX - (rect?.left ?? 0) + (viewportRef.current?.scrollLeft ?? 0)
    return secondsToTicks(Math.max(0, x / pxPerSecond))
  }

  const snapTime = (value: TickString, excludedIds: string[] = []): TickString => {
    if (!state.snapping) return value
    const threshold = 7 / pxPerSecond
    const seconds = ticksToSeconds(value)
    const candidates = [state.currentTime, sequence.inPoint, sequence.outPoint, ...sequence.markers.map((marker) => marker.at), ...sequence.tracks.flatMap((track) => track.clips.filter((clip) => !excludedIds.includes(clip.id)).flatMap((clip) => [clip.timelineStart, addTicks(clip.timelineStart, clip.timelineDuration)]))].filter((item): item is string => Boolean(item))
    const closest = candidates.reduce<{ value: string; distance: number } | null>((best, candidate) => {
      const distance = Math.abs(ticksToSeconds(candidate) - seconds)
      return distance <= threshold && (!best || distance < best.distance) ? { value: candidate, distance } : best
    }, null)
    return closest?.value ?? value
  }

  const zoomAt = (clientX: number, out: boolean) => {
    const viewport = viewportRef.current
    if (!viewport) return
    const rect = viewport.getBoundingClientRect()
    const anchorSeconds = (clientX - rect.left + viewport.scrollLeft) / pxPerSecond
    const next = Math.max(30, Math.min(360, pxPerSecond * (out ? 0.8 : 1.25)))
    editorStore.setTimelineZoom(next)
    requestAnimationFrame(() => { viewport.scrollLeft = Math.max(0, anchorSeconds * next - (clientX - rect.left)) })
  }

  const beginHand = (event: React.PointerEvent) => {
    const viewport = viewportRef.current
    if (!viewport) return
    const startX = event.clientX
    const startY = event.clientY
    const startLeft = viewport.scrollLeft
    const startTop = viewport.scrollTop
    const move = (pointer: PointerEvent) => {
      viewport.scrollLeft = startLeft - (pointer.clientX - startX)
      viewport.scrollTop = startTop - (pointer.clientY - startY)
      if (headerRef.current) headerRef.current.scrollTop = viewport.scrollTop
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const openClipMenu = (event: React.MouseEvent, clip: ClipItem, track: Track) => {
    event.preventDefault()
    event.stopPropagation()
    if (!state.selectedClipIds.includes(clip.id)) editorStore.selectClip(clip.id)
    setContext({ x: event.clientX, y: event.clientY, at: state.currentTime, clipId: clip.id, trackId: track.id })
  }

  const beginTimelinePointer = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('.timeline-clip, .timeline-caption, .timeline-marker')) return
    const at = snapTime(timelineTimeAt(event.clientX))
    const trackId = (event.target as HTMLElement).closest<HTMLElement>('[data-track-id]')?.dataset.trackId
    const track = tracks.find((candidate) => candidate.id === trackId)
    if (state.activeTool === 'hand') { beginHand(event); return }
    if (state.activeTool === 'zoom') { zoomAt(event.clientX, event.altKey); return }
    if (state.activeTool === 'track-select' && trackId) { editorStore.selectTrackForward(trackId, at, event.shiftKey); return }
    if (state.activeTool === 'type') {
      if (track?.kind === 'video') editorStore.addTitleClip(track.id, at)
      else editorStore.setNotice({ kind: 'warning', message: 'Use the Type Tool on a video track.' })
      return
    }
    editorStore.clearSelection()
    editorStore.setCurrentTime(at)
    const move = (pointer: PointerEvent) => editorStore.setCurrentTime(snapTime(timelineTimeAt(pointer.clientX)))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const contextClip = context?.clipId ? sequence.tracks.flatMap((track) => track.clips).find((clip) => clip.id === context.clipId) : undefined
  const contextTrack = context?.trackId ? sequence.tracks.find((track) => track.id === context.trackId) : undefined
  const contextAsset = contextClip ? project.assets[contextClip.assetId] : undefined
  const speedClip = speedClipId ? sequence.tracks.flatMap((track) => track.clips).find((clip) => clip.id === speedClipId) : undefined
  const run = (action: () => void) => { setContext(null); action() }

  return <div className={`panel-body timeline-panel tool-${state.activeTool}`} onClick={() => editorStore.setActivePanel('timeline')}>
    <div className="sequence-tabs">{project.sequenceOrder.map((id) => <button type="button" key={id} className={id === project.activeSequenceId ? 'active' : ''} onClick={() => editorStore.setActiveSequence(id)}><Icon name="film" size={12} />{project.sequences[id].name}</button>)}<button type="button" className="new-sequence" onClick={() => editorStore.addSequence()} title="New sequence" aria-label="New sequence"><Icon name="plus" size={13} /></button></div>
    <div className="timeline-commandbar">
      <div className="timeline-tools" role="toolbar" aria-label="Timeline editing tools">{tools.map((tool) => <button type="button" key={tool.id} className={state.activeTool === tool.id ? 'active' : ''} aria-pressed={state.activeTool === tool.id} onClick={() => editorStore.setTool(tool.id)} title={`${tool.label} (${tool.key})`}><Icon name={tool.icon} size={14} /></button>)}</div>
      <span className="toolbar-separator" />
      <button type="button" className={state.snapping ? 'active' : ''} aria-pressed={state.snapping} onClick={() => editorStore.toggleSnapping()} title="Snap in Timeline (S)"><Icon name="snap" size={14} /></button>
      <button type="button" className={state.linkedSelection ? 'active' : ''} aria-pressed={state.linkedSelection} onClick={() => editorStore.toggleLinkedSelection()} title="Linked Selection"><Icon name={state.linkedSelection ? 'link' : 'unlink'} size={14} /></button>
      <span className="active-tool-name">{tools.find((tool) => tool.id === state.activeTool)?.label}</span>
      <TimecodeInput value={state.currentTime} rate={sequence.frameRate} />
      <div className="timeline-zoom"><button type="button" onClick={() => editorStore.setTimelineZoom(state.timelineZoom / 1.25)} title="Zoom out" aria-label="Zoom out timeline"><Icon name="zoom-out" size={13} /></button><input type="range" min="30" max="360" value={state.timelineZoom} onChange={(event) => editorStore.setTimelineZoom(Number(event.target.value))} aria-label="Timeline zoom" /><button type="button" onClick={() => editorStore.setTimelineZoom(state.timelineZoom * 1.25)} title="Zoom in" aria-label="Zoom in timeline"><Icon name="zoom-in" size={13} /></button></div>
    </div>
    <div className="timeline-grid">
      <div className="track-head-column" ref={headerRef}><div className="ruler-corner"><span>{state.snapping ? 'SNAP' : 'FREE'}</span><strong>{Math.round(state.timelineZoom)} px/s</strong></div>{tracks.map((track) => <TrackHeader key={track.id} track={track} />)}</div>
      <div
        className="timeline-scroll"
        ref={viewportRef}
        onPointerDown={beginTimelinePointer}
        onScroll={(event) => { if (headerRef.current) headerRef.current.scrollTop = event.currentTarget.scrollTop }}
        onWheel={(event) => { if (event.ctrlKey || event.metaKey) { event.preventDefault(); zoomAt(event.clientX, event.deltaY > 0) } }}
        onContextMenu={(event) => {
          if ((event.target as HTMLElement).closest('.timeline-clip')) return
          event.preventDefault()
          const trackId = (event.target as HTMLElement).closest<HTMLElement>('[data-track-id]')?.dataset.trackId
          setContext({ x: event.clientX, y: event.clientY, at: timelineTimeAt(event.clientX), trackId })
        }}
        onDragOver={(event) => { if (event.dataTransfer.types.includes('application/x-editdatvid-asset')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' } }}
        onDrop={(event) => {
          const assetId = event.dataTransfer.getData('application/x-editdatvid-asset')
          if (!assetId) return
          event.preventDefault()
          const targetTrackId = (event.target as HTMLElement).closest<HTMLElement>('[data-track-id]')?.dataset.trackId
          editorStore.setCurrentTime(timelineTimeAt(event.clientX))
          window.setTimeout(() => editorStore.insertAsset(assetId, targetTrackId), 0)
        }}
      >
        <div className="timeline-content" style={{ width: contentWidth, '--second-width': `${pxPerSecond}px` } as React.CSSProperties}>
          <div className="timeline-ruler" aria-label="Timeline ruler">{marks.map((second) => <span key={second} style={{ left: second * pxPerSecond }} className={second % (rulerStep * 5) === 0 ? 'major' : ''}><i />{second % (rulerStep * 5) === 0 && <b>{formatTimecode(secondsToTicks(second), sequence.frameRate).slice(0, 8)}</b>}</span>)}</div>
          {tracks.map((track) => <div key={track.id} className={`timeline-track ${track.kind} ${track.locked ? 'locked' : ''}`} data-track-id={track.id}>{track.clips.map((clip) => <ClipBlock key={clip.id} clip={clip} track={track} pxPerSecond={pxPerSecond} selected={state.selectedClipIds.includes(clip.id)} snapTime={snapTime} onContextMenu={openClipMenu} onZoomAt={zoomAt} onBeginHand={beginHand} />)}{track.kind === 'caption' && track.captions.map((caption) => <button type="button" key={caption.id} className="timeline-caption" style={{ left: ticksToSeconds(caption.start) * pxPerSecond, width: Math.max(30, ticksToSeconds(caption.duration) * pxPerSecond) }} onClick={(event) => { event.stopPropagation(); editorStore.setCurrentTime(caption.start); editorStore.setActivePanel('captions') }}>{caption.text}</button>)}</div>)}
          {sequence.inPoint && <span className="sequence-range in" style={{ left: ticksToSeconds(sequence.inPoint) * pxPerSecond }} title="Sequence In point" />}
          {sequence.outPoint && <span className="sequence-range out" style={{ left: ticksToSeconds(sequence.outPoint) * pxPerSecond }} title="Sequence Out point" />}
          {sequence.markers.map((marker) => <button type="button" key={marker.id} className="timeline-marker" style={{ left: ticksToSeconds(marker.at) * pxPerSecond }} onClick={(event) => { event.stopPropagation(); editorStore.setCurrentTime(marker.at) }} title={marker.name}><span /></button>)}
          <div className="playhead" style={{ left: ticksToSeconds(state.currentTime) * pxPerSecond }}><span /><i /></div>
        </div>
      </div>
    </div>

    {context && <div className="timeline-context-menu" ref={menuRef} role="menu" aria-label={contextClip ? `Clip menu for ${contextClip.name}` : 'Timeline menu'} style={{ left: Math.min(context.x, window.innerWidth - 250), top: Math.min(context.y, window.innerHeight - 390) }}>
      {contextClip ? <>
        <MenuItem label="Cut" shortcut="Ctrl+X" onClick={() => run(() => editorStore.cutSelected())} />
        <MenuItem label="Copy" shortcut="Ctrl+C" onClick={() => run(() => editorStore.copySelected())} />
        <MenuItem label="Duplicate" shortcut="Ctrl+Shift+/" onClick={() => run(() => editorStore.duplicateSelected())} />
        <hr />
        <MenuItem label="Split Clip at Playhead" shortcut="Ctrl+K" onClick={() => run(() => editorStore.splitClipAt(contextClip.id))} />
        <MenuItem label="Detach Audio" disabled={contextTrack?.kind !== 'video' || !contextAsset?.metadata.audioCodec} onClick={() => run(() => editorStore.detachAudio(contextClip.id))} />
        <MenuItem label={contextClip.linkGroupId ? 'Unlink' : 'Link'} disabled={!contextClip.linkGroupId && state.selectedClipIds.length < 2} onClick={() => run(() => contextClip.linkGroupId ? editorStore.unlinkSelected() : editorStore.linkSelected())} />
        <MenuItem label="Enable" checked={contextClip.enabled !== false} onClick={() => run(() => editorStore.toggleSelectedEnabled())} />
        <hr />
        <MenuItem label="Speed / Duration…" onClick={() => { setContext(null); setSpeedClipId(contextClip.id) }} />
        <MenuItem label="Apply Default Transition" shortcut="Ctrl+D" onClick={() => run(() => editorStore.applyTransition('in', 'cross-dissolve'))} />
        <MenuItem label="Remove Attributes" onClick={() => run(() => editorStore.removeSelectedEffects())} />
        <hr />
        <MenuItem label="Ripple Delete" shortcut="Shift+Delete" onClick={() => run(() => editorStore.deleteSelected(true))} />
        <MenuItem label="Delete" shortcut="Delete" onClick={() => run(() => editorStore.deleteSelected(false))} />
      </> : <>
        <MenuItem label="Paste" shortcut="Ctrl+V" disabled={!editorStore.canPaste()} onClick={() => run(() => editorStore.pasteClipboard(context.at))} />
        <hr />
        <MenuItem label="Add Marker" shortcut="M" onClick={() => run(() => { editorStore.setCurrentTime(context.at); editorStore.addMarker() })} />
        <MenuItem label="Add Title" onClick={() => run(() => editorStore.addTitleClip(context.trackId, context.at))} />
        <MenuItem label="Add Caption" onClick={() => run(() => { editorStore.setCurrentTime(context.at); editorStore.addCaption() })} />
        <hr />
        <MenuItem label="Set Sequence In Point" shortcut="I" onClick={() => run(() => { editorStore.setCurrentTime(context.at); window.setTimeout(() => editorStore.setSequencePoint('in'), 0) })} />
        <MenuItem label="Set Sequence Out Point" shortcut="O" onClick={() => run(() => { editorStore.setCurrentTime(context.at); window.setTimeout(() => editorStore.setSequencePoint('out'), 0) })} />
      </>}
    </div>}

    {speedClip && <SpeedDurationDialog clip={speedClip} onClose={() => setSpeedClipId(null)} />}
  </div>
}

function SpeedDurationDialog({ clip, onClose }: { clip: ClipItem; onClose: () => void }) {
  const initialDuration = Math.max(0.01, ticksToSeconds(clip.timelineDuration))
  const sourceDuration = Math.max(0.01, ticksToSeconds(clip.sourceDuration))
  const [speed, setSpeed] = useState(Math.round(clip.playbackRate * 10000) / 100)
  const [duration, setDuration] = useState(Math.round(initialDuration * 1000) / 1000)
  const apply = () => {
    const cleanDuration = Math.max(0.01, duration)
    editorStore.rateStretchClip(clip.id, 'end', addTicks(clip.timelineStart, secondsToTicks(cleanDuration)))
    if ((speed < 0) !== clip.reverse) editorStore.toggleClipFlag('reverse')
    onClose()
  }
  return <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="dialog speed-dialog" role="dialog" aria-modal="true" aria-labelledby="speed-dialog-title">
      <header><h2 id="speed-dialog-title">Clip Speed / Duration</h2><button type="button" className="icon-button" onClick={onClose} aria-label="Close"><Icon name="close" /></button></header>
      <div className="speed-dialog-body">
        <label><span>Speed</span><span className="numeric-field"><input type="number" min="-800" max="800" step="0.1" value={speed} onChange={(event) => { const next = Number(event.target.value); setSpeed(next); if (next !== 0) setDuration(Math.round(sourceDuration / Math.abs(next / 100) * 1000) / 1000) }} />%</span></label>
        <label><span>Duration</span><span className="numeric-field"><input type="number" min="0.01" step="0.01" value={duration} onChange={(event) => { const next = Math.max(0.01, Number(event.target.value)); setDuration(next); setSpeed(Math.round(sourceDuration / next * 10000) / 100) }} /> seconds</span></label>
        <p>Changing speed updates duration from the clip’s source range. Use Rate Stretch for direct timeline gestures.</p>
      </div>
      <footer><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button type="button" className="button primary" onClick={apply}>Apply</button></footer>
    </section>
  </div>
}
