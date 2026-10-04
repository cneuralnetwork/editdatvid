import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { addTicks, formatTimecode, secondsToTicks, ticksToSeconds } from '../../domain/time'
import type { Asset, ClipItem, Sequence, Track } from '../../domain/types'
import { editorStore, useEditorState } from '../../editor/store'
import { mediaRegistry } from '../../media/registry'
import { Icon } from '../Icon'

function MonitorTransport({ source = false }: { source?: boolean }) {
  const state = useEditorState()
  const sequence = state.project?.sequences[state.project.activeSequenceId]
  const rate = sequence?.frameRate ?? { numerator: 30, denominator: 1 }
  const frameTicks = BigInt('254016000000') * BigInt(rate.denominator) / BigInt(rate.numerator)
  return <div className="monitor-transport">
    <span className="monitor-timecode">{formatTimecode(state.currentTime, rate)}</span>
    <div className="transport-controls">
      <button title="Previous frame" onClick={() => editorStore.setCurrentTime((BigInt(state.currentTime) - frameTicks < 0n ? 0n : BigInt(state.currentTime) - frameTicks).toString())}><Icon name="skip-back" /></button>
      <button className="play-control" title={state.isPlaying ? 'Pause (Space)' : 'Play (Space)'} aria-pressed={state.isPlaying} onClick={() => editorStore.togglePlayback()}><Icon name={state.isPlaying ? 'pause' : 'play'} /></button>
      <button title="Next frame" onClick={() => editorStore.setCurrentTime((BigInt(state.currentTime) + frameTicks).toString())}><Icon name="skip-forward" /></button>
      {!source && <button title="Add marker (M)" onClick={() => editorStore.addMarker()}><Icon name="marker" /></button>}
    </div>
    <span className="monitor-resolution">{source ? 'Source' : state.previewQuality === 'auto' ? '1/2' : state.previewQuality}</span>
  </div>
}

function EmptyMonitor({ title }: { title: string }) {
  return <div className="empty-monitor"><div className="empty-monitor-frame"><span /><span /><span /><span /></div><strong>{title}</strong><span>Select media in the Project panel</span></div>
}

export function SourceMonitor() {
  const state = useEditorState()
  const asset = state.selectedAssetIds[0] ? state.project?.assets[state.selectedAssetIds[0]] : undefined
  const url = asset ? mediaRegistry.getUrl(asset.id) : undefined
  return <div className="panel-body monitor-panel">
    <div className="monitor-stage">
      {!asset || !url ? <EmptyMonitor title={asset ? 'Media offline' : 'No source selected'} />
        : asset.kind === 'image' ? <img src={url} alt={asset.name} />
          : asset.kind === 'caption' ? <div className="caption-source"><Icon name="captions" size={30} /><span>{asset.name}</span></div>
            : asset.kind === 'audio' ? <audio src={url} controls />
              : <video src={url} preload="metadata" />}
    </div>
    <MonitorTransport source />
  </div>
}

type TimelineLayer = { clip: ClipItem; track: Track }
type MotionValues = ClipItem['effects']['motion']
type MotionPreview = { clipId: string; motion: MotionValues }

const clipIsActive = (clip: ClipItem, time: string): boolean => clip.enabled !== false
  && BigInt(time) >= BigInt(clip.timelineStart)
  && BigInt(time) < BigInt(addTicks(clip.timelineStart, clip.timelineDuration))

const sourceTimeForClip = (clip: ClipItem, timelineTime: string): number => {
  if (clip.freezeFrame) return ticksToSeconds(clip.sourceIn)
  const elapsed = Math.max(0, ticksToSeconds((BigInt(timelineTime) - BigInt(clip.timelineStart)).toString())) * clip.playbackRate
  const sourceIn = ticksToSeconds(clip.sourceIn)
  const sourceDuration = ticksToSeconds(clip.sourceDuration)
  return sourceIn + (clip.reverse ? Math.max(0, sourceDuration - elapsed) : elapsed)
}

const visualStyleForClip = (clip: ClipItem, zIndex: number, displayScale: number, motionOverride?: MotionValues): CSSProperties => {
  const motion = motionOverride ?? clip.effects.motion
  return {
  zIndex,
  opacity: clip.effects.opacity / 100,
  transform: `translate(${motion.positionX * displayScale}px, ${motion.positionY * displayScale}px) scale(${motion.scale / 100}) rotate(${motion.rotation}deg)`,
  transformOrigin: `${motion.anchorX}% ${motion.anchorY}%`,
  filter: `brightness(${100 + clip.effects.color.exposure * 12}%) contrast(${100 + clip.effects.color.contrast}%) saturate(${clip.effects.color.saturation}%) blur(${clip.effects.blur}px)`,
  clipPath: `inset(${clip.effects.crop.top}% ${clip.effects.crop.right}% ${clip.effects.crop.bottom}% ${clip.effects.crop.left}%)`,
  mixBlendMode: clip.effects.blendMode,
  }
}

const syncMediaTime = (media: HTMLMediaElement, requestedTime: number): void => {
  if (!Number.isFinite(requestedTime) || media.readyState === 0) return
  const maximum = Number.isFinite(media.duration) ? Math.max(0, media.duration - 0.001) : requestedTime
  const next = Math.max(0, Math.min(requestedTime, maximum))
  if (Math.abs(media.currentTime - next) > 0.035) media.currentTime = next
}

function VisualLayer({ layer, asset, url, timelineTime, playing, globalRate, zIndex, displayScale, motionOverride, selected, onSelect }: {
  layer: TimelineLayer
  asset?: Asset
  url?: string
  timelineTime: string
  playing: boolean
  globalRate: number
  zIndex: number
  displayScale: number
  motionOverride?: MotionValues
  selected: boolean
  onSelect: (clipId: string) => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const { clip } = layer
  const sourceTime = sourceTimeForClip(clip, timelineTime)
  const style = visualStyleForClip(clip, zIndex, displayScale, motionOverride)
  const selectLayer = (event: React.PointerEvent<HTMLElement>) => {
    event.stopPropagation()
    onSelect(clip.id)
  }
  const openLayerEditor = (event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation()
    onSelect(clip.id)
    editorStore.setActivePanel(clip.titleText !== undefined ? 'text' : 'effect-controls')
  }

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (!playing || globalRate < 0 || clip.reverse || clip.freezeFrame || Math.abs(video.currentTime - sourceTime) > 0.18) syncMediaTime(video, sourceTime)
  }, [sourceTime, playing, globalRate, clip.reverse, clip.freezeFrame])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const canPlayForward = playing && globalRate > 0 && !clip.reverse && !clip.freezeFrame
    if (!canPlayForward) {
      video.pause()
      return
    }
    video.playbackRate = Math.max(0.25, Math.min(4, clip.playbackRate * globalRate))
    void video.play().catch(() => undefined)
    return () => video.pause()
  }, [playing, globalRate, clip.id, clip.playbackRate, clip.reverse, clip.freezeFrame, url])

  useEffect(() => {
    const video = videoRef.current
    return () => {
      if (!video) return
      video.pause()
      video.removeAttribute('src')
      video.load()
    }
  }, [])

  if (clip.titleText !== undefined) return <div className={`program-title ${selected ? 'selected' : ''}`} data-clip-id={clip.id} style={{ zIndex, background: 'transparent' }}><span data-program-content-id={clip.id} onPointerDown={selectLayer} onDoubleClick={openLayerEditor} style={{ ...style, zIndex: 'auto', background: 'transparent' }}>{clip.titleText}</span></div>
  if (!asset || !url) return <div className="program-layer-offline" style={{ zIndex }}>Media offline: {clip.name}</div>
  if (asset.kind === 'image') return <img className={`program-media-layer ${selected ? 'selected' : ''}`} data-clip-id={clip.id} data-program-content-id={clip.id} onPointerDown={selectLayer} onDoubleClick={openLayerEditor} src={url} alt="" style={style} />
  return <video className={`program-media-layer ${selected ? 'selected' : ''}`} data-clip-id={clip.id} data-program-content-id={clip.id} onPointerDown={selectLayer} onDoubleClick={openLayerEditor} ref={videoRef} src={url} muted playsInline preload="auto" style={style} onLoadedMetadata={(event) => syncMediaTime(event.currentTarget, sourceTime)} />
}

function AudioLayer({ layer, url, timelineTime, playing, globalRate, masterGainDb }: {
  layer: TimelineLayer
  url?: string
  timelineTime: string
  playing: boolean
  globalRate: number
  masterGainDb: number
}) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const { clip, track } = layer
  const sourceTime = sourceTimeForClip(clip, timelineTime)
  const volume = Math.max(0, Math.min(1, 10 ** ((clip.effects.audio.gainDb + (track.gainDb ?? 0) + masterGainDb) / 20)))

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.volume = volume
    if (!playing || globalRate < 0 || clip.reverse || clip.freezeFrame || Math.abs(audio.currentTime - sourceTime) > 0.18) syncMediaTime(audio, sourceTime)
  }, [sourceTime, playing, globalRate, clip.reverse, clip.freezeFrame, volume])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const canPlayForward = playing && globalRate > 0 && !clip.reverse && !clip.freezeFrame
    if (!canPlayForward) {
      audio.pause()
      return
    }
    audio.playbackRate = Math.max(0.25, Math.min(4, clip.playbackRate * globalRate))
    void audio.play().catch(() => undefined)
    return () => audio.pause()
  }, [playing, globalRate, clip.id, clip.playbackRate, clip.reverse, clip.freezeFrame, url])

  useEffect(() => {
    const audio = audioRef.current
    return () => {
      if (!audio) return
      audio.pause()
      if (audio.readyState > 0) audio.currentTime = 0
      audio.removeAttribute('src')
      audio.load()
    }
  }, [])

  if (!url) return null
  return <audio className="program-audio-layer" data-clip-id={clip.id} ref={audioRef} src={url} preload="auto" onLoadedMetadata={(event) => syncMediaTime(event.currentTarget, sourceTime)} />
}

function useSequenceClock(sequence: Sequence | undefined, playing: boolean, playbackRate: number): void {
  const animationRef = useRef<number | null>(null)

  useEffect(() => {
    if (!sequence || !playing || playbackRate === 0) return
    let previous = performance.now()
    let exactTime = BigInt(editorStore.getSnapshot().currentTime)
    const sequenceEnd = BigInt(sequence.durationTicks)
    const update = (now: number) => {
      const snapshot = editorStore.getSnapshot()
      if (!snapshot.isPlaying || snapshot.playbackRate === 0) return
      const elapsedSeconds = Math.max(0, (now - previous) / 1000)
      previous = now
      const delta = BigInt(secondsToTicks(elapsedSeconds * Math.abs(snapshot.playbackRate)))
      exactTime = snapshot.playbackRate < 0 ? exactTime - delta : exactTime + delta
      if (snapshot.playbackRate < 0 && exactTime <= 0n) {
        editorStore.setCurrentTime('0')
        editorStore.setPlaying(false)
        return
      }
      if (snapshot.playbackRate > 0 && exactTime >= sequenceEnd) {
        editorStore.setCurrentTime(sequence.durationTicks)
        editorStore.setPlaying(false)
        return
      }
      editorStore.setCurrentTime(exactTime.toString())
      animationRef.current = requestAnimationFrame(update)
    }
    animationRef.current = requestAnimationFrame(update)
    return () => {
      if (animationRef.current !== null) cancelAnimationFrame(animationRef.current)
      animationRef.current = null
    }
  }, [sequence?.id, sequence?.durationTicks, playing, playbackRate])
}

function ProgramTransformOverlay({ clip, frameRef, motion, displayScale, onPreview, onCommit }: {
  clip: ClipItem
  frameRef: React.RefObject<HTMLDivElement | null>
  motion: MotionValues
  displayScale: number
  onPreview: (motion: MotionValues | null) => void
  onCommit: (motion: MotionValues) => void
}) {
  const [baseSize, setBaseSize] = useState({ width: 160, height: 90 })

  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    const findContent = () => Array.from(frame.querySelectorAll<HTMLElement>('[data-program-content-id]')).find((element) => element.dataset.programContentId === clip.id)
    const update = () => {
      const content = findContent()
      if (!content) return
      const width = Math.max(20, content.offsetWidth)
      const height = Math.max(20, content.offsetHeight)
      setBaseSize((current) => current.width === width && current.height === height ? current : { width, height })
    }
    const observer = new ResizeObserver(update)
    observer.observe(frame)
    const content = findContent()
    if (content) observer.observe(content)
    const animation = requestAnimationFrame(update)
    return () => { cancelAnimationFrame(animation); observer.disconnect() }
  }, [clip.id, clip.titleText, frameRef])

  const beginGesture = (event: React.PointerEvent<HTMLElement>, mode: 'move' | 'scale' | 'rotate') => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    editorStore.setPlaying(false)
    const frame = frameRef.current
    if (!frame) return
    const frameRect = frame.getBoundingClientRect()
    const start = { ...motion }
    const centerX = frameRect.left + frameRect.width / 2 + start.positionX * displayScale
    const centerY = frameRect.top + frameRect.height / 2 + start.positionY * displayScale
    const startDistance = Math.max(1, Math.hypot(event.clientX - centerX, event.clientY - centerY))
    const startAngle = Math.atan2(event.clientY - centerY, event.clientX - centerX) * 180 / Math.PI
    const startX = event.clientX
    const startY = event.clientY
    let latest = start
    let changed = false
    const move = (pointer: PointerEvent) => {
      changed = true
      if (mode === 'move') {
        const sourceScale = Math.max(0.001, displayScale)
        latest = {
          ...start,
          positionX: Math.round((start.positionX + (pointer.clientX - startX) / sourceScale) * 10) / 10,
          positionY: Math.round((start.positionY + (pointer.clientY - startY) / sourceScale) * 10) / 10,
        }
      } else if (mode === 'scale') {
        const distance = Math.hypot(pointer.clientX - centerX, pointer.clientY - centerY)
        latest = { ...start, scale: Math.max(1, Math.min(800, Math.round(start.scale * distance / startDistance * 10) / 10)) }
      } else {
        const angle = Math.atan2(pointer.clientY - centerY, pointer.clientX - centerX) * 180 / Math.PI
        const rawRotation = start.rotation + angle - startAngle
        latest = { ...start, rotation: pointer.shiftKey ? Math.round(rawRotation / 15) * 15 : Math.round(rawRotation * 10) / 10 }
      }
      onPreview(latest)
    }
    const finish = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      if (changed) onCommit(latest)
      else onPreview(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }

  const nudge = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const amount = event.shiftKey ? 10 : 1
    const delta = event.key === 'ArrowLeft' ? [-amount, 0] : event.key === 'ArrowRight' ? [amount, 0] : event.key === 'ArrowUp' ? [0, -amount] : event.key === 'ArrowDown' ? [0, amount] : null
    if (!delta) return
    event.preventDefault()
    onCommit({ ...motion, positionX: motion.positionX + delta[0], positionY: motion.positionY + delta[1] })
  }

  const boxStyle: CSSProperties = {
    width: Math.max(8, baseSize.width * motion.scale / 100),
    height: Math.max(8, baseSize.height * motion.scale / 100),
    transform: `translate(-50%, -50%) translate(${motion.positionX * displayScale}px, ${motion.positionY * displayScale}px) rotate(${motion.rotation}deg)`,
    transformOrigin: `${motion.anchorX}% ${motion.anchorY}%`,
  }

  return <div className={`program-transform-box ${clip.titleText === undefined ? 'full-frame' : ''}`} data-testid="program-transform-box" data-clip-id={clip.id} role="group" aria-label={`Transform ${clip.name}`} tabIndex={0} style={boxStyle} onPointerDown={(event) => beginGesture(event, 'move')} onKeyDown={nudge}>
    <span className="program-transform-name">{clip.titleText !== undefined ? 'Text' : 'Motion'}</span>
    {['nw', 'ne', 'se', 'sw'].map((corner) => <button type="button" key={corner} className={`program-transform-handle ${corner}`} aria-label={`Resize ${clip.name} from ${corner.toUpperCase()}`} onPointerDown={(event) => beginGesture(event, 'scale')} />)}
    <span className="program-rotation-stem" aria-hidden="true" />
    <button type="button" className="program-rotation-handle" aria-label={`Rotate ${clip.name}`} onPointerDown={(event) => beginGesture(event, 'rotate')} />
  </div>
}

export function ProgramMonitor() {
  const state = useEditorState()
  const sequence = state.project?.sequences[state.project.activeSequenceId]
  const [fit, setFit] = useState<'fit' | '50%' | '100%'>('fit')
  const frameRef = useRef<HTMLDivElement>(null)
  const [displayScale, setDisplayScale] = useState(1)
  const [motionPreview, setMotionPreview] = useState<MotionPreview | null>(null)

  useSequenceClock(sequence, state.isPlaying, state.playbackRate)

  useEffect(() => {
    const frame = frameRef.current
    if (!frame || !sequence) return
    const update = () => {
      const next = Math.max(0.001, frame.clientWidth / sequence.width)
      setDisplayScale((current) => Math.abs(current - next) < 0.0001 ? current : next)
    }
    const observer = new ResizeObserver(update)
    observer.observe(frame)
    update()
    return () => observer.disconnect()
  }, [sequence?.id, sequence?.width, fit])

  const visualLayers = useMemo<TimelineLayer[]>(() => sequence?.tracks
    .filter((track) => track.kind === 'video' && track.visible)
    .sort((a, b) => a.order - b.order)
    .flatMap((track) => track.clips.filter((clip) => clipIsActive(clip, state.currentTime)).map((clip) => ({ clip, track }))) ?? [], [sequence, state.currentTime])

  const audioLayers = useMemo<TimelineLayer[]>(() => {
    if (!sequence) return []
    const soloActive = sequence.tracks.some((track) => track.kind === 'audio' && track.solo)
    return sequence.tracks
      .filter((track) => track.kind === 'audio' && !track.muted && (!soloActive || track.solo))
      .sort((a, b) => a.order - b.order)
      .flatMap((track) => track.clips.filter((clip) => clipIsActive(clip, state.currentTime)).map((clip) => ({ clip, track })))
  }, [sequence, state.currentTime])

  const activeCaption = useMemo(() => sequence?.tracks.flatMap((track) => track.captions).find((caption) => BigInt(state.currentTime) >= BigInt(caption.start) && BigInt(state.currentTime) < BigInt(addTicks(caption.start, caption.duration))), [sequence, state.currentTime])
  const selectedVisual = [...visualLayers].reverse().find((layer) => state.selectedClipIds.includes(layer.clip.id))
  const selectedMotion = selectedVisual && motionPreview?.clipId === selectedVisual.clip.id ? motionPreview.motion : selectedVisual?.clip.effects.motion

  const zoomStyle = fit === 'fit' ? undefined : { width: fit, maxWidth: 'none' }
  const toggleFullscreen = async () => {
    if (document.fullscreenElement) await document.exitFullscreen()
    else await frameRef.current?.requestFullscreen()
  }

  return <div className="panel-body monitor-panel program-monitor" data-playing={state.isPlaying} data-playback-rate={state.playbackRate} data-current-time={state.currentTime}>
    <div className="monitor-toolbar"><button onClick={() => setFit(fit === 'fit' ? '50%' : fit === '50%' ? '100%' : 'fit')} title="Cycle monitor zoom">{fit}<Icon name="chevron-down" size={10} /></button><span className="monitor-direct-status">{selectedVisual ? `${selectedVisual.clip.name} · drag to move · corners resize` : 'Click picture or text to transform'}</span><span className="monitor-toolbar-end"><span>{sequence ? `${sequence.width} × ${sequence.height}` : 'No sequence'}</span><button onClick={() => void toggleFullscreen()} title="Full-screen Program Monitor" aria-label="Full-screen Program Monitor"><Icon name="maximize" size={12} /></button></span></div>
    <div className="monitor-stage" onDoubleClick={() => editorStore.setActivePanel('program')}>
      <div className="program-frame" ref={frameRef} style={zoomStyle} onPointerDown={(event) => { if (event.target === event.currentTarget) editorStore.clearSelection() }}>
        {visualLayers.length === 0 && <EmptyMonitor title="No picture at playhead" />}
        {visualLayers.map((layer, index) => {
          const asset = state.project?.assets[layer.clip.assetId]
          return <VisualLayer key={layer.clip.id} layer={layer} asset={asset} url={asset ? mediaRegistry.getUrl(asset.id) : undefined} timelineTime={state.currentTime} playing={state.isPlaying} globalRate={state.playbackRate} zIndex={index + 1} displayScale={displayScale} motionOverride={motionPreview?.clipId === layer.clip.id ? motionPreview.motion : undefined} selected={state.selectedClipIds.includes(layer.clip.id)} onSelect={(clipId) => editorStore.selectClip(clipId)} />
        })}
        {audioLayers.map((layer) => {
          const asset = state.project?.assets[layer.clip.assetId]
          return <AudioLayer key={layer.clip.id} layer={layer} url={asset ? mediaRegistry.getUrl(asset.id) : undefined} timelineTime={state.currentTime} playing={state.isPlaying} globalRate={state.playbackRate} masterGainDb={sequence?.masterGainDb ?? 0} />
        })}
        {selectedVisual && selectedMotion && !selectedVisual.track.locked && <ProgramTransformOverlay clip={selectedVisual.clip} frameRef={frameRef} motion={selectedMotion} displayScale={displayScale} onPreview={(motion) => setMotionPreview(motion ? { clipId: selectedVisual.clip.id, motion } : null)} onCommit={(motion) => { setMotionPreview(null); editorStore.setClipMotion(selectedVisual.clip.id, motion) }} />}
        {activeCaption && <div className={`program-caption ${activeCaption.position}`} style={{ color: activeCaption.style.color, background: activeCaption.style.background, fontSize: `${Math.max(16, activeCaption.style.fontSize / 2)}px` }}>{activeCaption.text}</div>}
        <div className="safe-margins" aria-hidden="true"><span /><span /></div>
      </div>
    </div>
    <MonitorTransport />
  </div>
}
