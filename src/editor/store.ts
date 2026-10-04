import { produce } from 'immer'
import { useSyncExternalStore } from 'react'
import { assetToClip, createProject, createSequence, defaultEffects, makeId, recalculateSequenceDuration } from '../domain/project'
import { addTicks, clampTicks, secondsToTicks, snapToFrame, subtractTicks, ticks } from '../domain/time'
import type {
  AssetId,
  Asset,
  CaptionItem,
  ClipId,
  ClipItem,
  EditorCommand,
  EditorState,
  EditorTool,
  ExportJob,
  ExportPreset,
  ProjectDocumentV1,
  Sequence,
  TickString,
  TrackKind,
  WorkspaceMode,
} from '../domain/types'
import { mediaRegistry } from '../media/registry'
import { parseCaptionFile } from '../media/captions'
import { fileToAsset, fingerprintFile } from '../media/probe'
import { generateProxy } from '../media/proxy'
import { projectRepository } from '../storage/repository'

type Listener = () => void
type MutableState = EditorState

const initialState = (): EditorState => ({
  project: null,
  mode: 'edit',
  activeTool: 'selection',
  previewQuality: 'auto',
  currentTime: '0',
  selectedClipIds: [],
  selectedAssetIds: [],
  activePanel: 'project',
  isPlaying: false,
  playbackRate: 1,
  snapping: true,
  linkedSelection: true,
  timelineZoom: 90,
  exportJobs: [],
  commandLog: [],
  dirty: false,
})

const cloneProject = (project: ProjectDocumentV1): ProjectDocumentV1 => structuredClone(project)

export class EditorStore {
  private state: EditorState = initialState()
  private listeners = new Set<Listener>()
  private past: ProjectDocumentV1[] = []
  private future: ProjectDocumentV1[] = []
  private autosaveTimer: number | null = null
  private clipClipboard: Array<{ clip: ClipItem; trackKind: TrackKind; trackOrder: number }> = []

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): EditorState => this.state

  private emit(): void {
    for (const listener of this.listeners) listener()
  }

  private set(mutator: (draft: MutableState) => void): void {
    this.state = produce(this.state, mutator)
    this.emit()
  }

  private commit(type: string, affectedEntities: string[], mutator: (project: ProjectDocumentV1) => void): void {
    if (!this.state.project) return
    this.past.push(cloneProject(this.state.project))
    if (this.past.length > 100) this.past.shift()
    this.future = []
    const command: EditorCommand = {
      id: makeId('cmd'),
      type,
      payload: {},
      transactionId: makeId('tx'),
      affectedEntities,
      createdAt: new Date().toISOString(),
    }
    this.set((draft) => {
      if (!draft.project) return
      mutator(draft.project)
      draft.project.updatedAt = new Date().toISOString()
      draft.commandLog.unshift(command)
      draft.commandLog = draft.commandLog.slice(0, 80)
      draft.dirty = true
    })
    this.scheduleAutosave()
  }

  create(name: string): ProjectDocumentV1 {
    const project = createProject(name)
    this.past = []
    this.future = []
    this.clipClipboard = []
    mediaRegistry.clear()
    this.set((draft) => {
      Object.assign(draft, initialState())
      draft.project = project
      draft.notice = { kind: 'info', message: 'Project lives on this device. Export an .edvproj file for backup.' }
    })
    void projectRepository.saveProject(project, false)
    return project
  }

  async open(project: ProjectDocumentV1): Promise<void> {
    this.past = []
    this.future = []
    this.clipClipboard = []
    mediaRegistry.clear()
    this.set((draft) => {
      Object.assign(draft, initialState())
      draft.project = project
      draft.notice = { kind: 'info', message: 'Checking linked media…' }
    })
    await this.restoreLinkedMedia()
  }

  close(): void {
    void this.flushAutosave()
    mediaRegistry.clear()
    this.past = []
    this.future = []
    this.clipClipboard = []
    this.state = initialState()
    this.emit()
  }

  setMode(mode: WorkspaceMode): void { this.set((draft) => { draft.mode = mode }) }
  setTool(tool: EditorTool): void { this.set((draft) => { draft.activeTool = tool }) }
  setActivePanel(panel: string): void { this.set((draft) => { draft.activePanel = panel }) }
  setPreviewQuality(quality: EditorState['previewQuality']): void { this.set((draft) => { draft.previewQuality = quality }) }
  setWorkspaceLayout(flexLayout: unknown): void {
    this.set((draft) => {
      if (!draft.project) return
      draft.project.workspace = { flexLayout, activePanel: draft.activePanel, savedAt: new Date().toISOString() }
      draft.dirty = true
    })
    this.scheduleAutosave()
  }
  setTimelineZoom(zoom: number): void { this.set((draft) => { draft.timelineZoom = Math.max(30, Math.min(360, zoom)) }) }
  setNotice(notice?: EditorState['notice']): void { this.set((draft) => { draft.notice = notice }) }
  toggleSnapping(): void { this.set((draft) => { draft.snapping = !draft.snapping }) }
  toggleLinkedSelection(): void { this.set((draft) => { draft.linkedSelection = !draft.linkedSelection }) }
  setPlaybackRate(rate: number): void { this.set((draft) => { draft.playbackRate = rate }) }

  setCurrentTime(value: TickString): void {
    const sequence = this.getActiveSequence()
    if (!sequence) return
    const next = this.state.snapping ? snapToFrame(value, sequence.frameRate) : value
    this.set((draft) => { draft.currentTime = clampTicks(next, '0', sequence.durationTicks) })
  }

  setPlaying(playing: boolean): void { this.set((draft) => { draft.isPlaying = playing }) }
  togglePlayback(): void { this.set((draft) => { draft.isPlaying = !draft.isPlaying }) }

  selectAsset(assetId: AssetId, additive = false): void {
    this.set((draft) => {
      draft.selectedAssetIds = additive
        ? draft.selectedAssetIds.includes(assetId) ? draft.selectedAssetIds.filter((id) => id !== assetId) : [...draft.selectedAssetIds, assetId]
        : [assetId]
      draft.activePanel = 'project'
    })
  }

  selectClip(clipId: ClipId, additive = false): void {
    const sequence = this.getActiveSequence()
    const clip = sequence?.tracks.flatMap((track) => track.clips).find((item) => item.id === clipId)
    const linkedIds = clip?.linkGroupId && this.state.linkedSelection
      ? sequence?.tracks.flatMap((track) => track.clips).filter((item) => item.linkGroupId === clip.linkGroupId).map((item) => item.id) ?? [clipId]
      : [clipId]
    this.set((draft) => {
      draft.selectedClipIds = additive
        ? Array.from(new Set([...draft.selectedClipIds, ...linkedIds]))
        : linkedIds
      draft.activePanel = 'effect-controls'
    })
  }

  selectTrackForward(trackId: string, from: TickString, allTargetedTracks = false): void {
    const sequence = this.getActiveSequence()
    if (!sequence) return
    const sourceTrack = sequence.tracks.find((track) => track.id === trackId)
    if (!sourceTrack) return
    const eligibleTracks = allTargetedTracks
      ? sequence.tracks.filter((track) => track.kind === sourceTrack.kind && track.targeted)
      : [sourceTrack]
    const ids = eligibleTracks.flatMap((track) => track.clips)
      .filter((clip) => ticks(clip.timelineStart) >= ticks(from))
      .map((clip) => clip.id)
    this.set((draft) => {
      draft.selectedClipIds = ids
      draft.activePanel = 'timeline'
      draft.notice = ids.length
        ? { kind: 'info', message: `${ids.length} ${ids.length === 1 ? 'clip' : 'clips'} selected forward on ${allTargetedTracks ? 'targeted tracks' : sourceTrack.name}.` }
        : { kind: 'info', message: `No clips after the pointer on ${sourceTrack.name}.` }
    })
  }

  clearSelection(): void { this.set((draft) => { draft.selectedClipIds = []; draft.selectedAssetIds = [] }) }

  async importFiles(files: File[], handles?: FileSystemFileHandle[]): Promise<Asset[]> {
    const project = this.state.project
    if (!project || files.length === 0) return []
    this.setNotice({ kind: 'info', message: `Analyzing ${files.length} ${files.length === 1 ? 'file' : 'files'} locally…` })
    const assets: Asset[] = []
    const captionItems: CaptionItem[] = []
    const captionTrack = project.sequences[project.activeSequenceId]?.tracks.find((track) => track.kind === 'caption')
    for (const file of files) {
      try {
        const asset = await fileToAsset(file)
        if (asset.kind === 'caption' && captionTrack) {
          const cues = parseCaptionFile(await file.text())
          for (const cue of cues) {
            captionItems.push({
              id: makeId('caption'), trackId: captionTrack.id, ...cue, position: 'bottom',
              style: { fontFamily: 'system-ui', fontSize: 48, color: '#ffffff', background: '#000000aa' },
            })
          }
          const end = cues.reduce<bigint>((latest, cue) => {
            const cueEnd = ticks(addTicks(cue.start, cue.duration))
            return cueEnd > latest ? cueEnd : latest
          }, 0n)
          asset.metadata.durationTicks = end.toString()
        }
        assets.push(asset)
        mediaRegistry.set(asset.id, file)
        const handle = handles?.find((candidate) => candidate.name === file.name)
        if (handle) await projectRepository.storeFileHandle(project.id, asset.id, handle)
      } catch (error) {
        this.setNotice({ kind: 'error', message: `${file.name}: ${error instanceof Error ? error.message : 'Could not read media.'}` })
      }
    }
    if (assets.length) {
      this.commit('Import media', [...assets.map((asset) => asset.id), ...captionItems.map((caption) => caption.id)], (draft) => {
        for (const asset of assets) draft.assets[asset.id] = asset
        const target = draft.sequences[draft.activeSequenceId].tracks.find((track) => track.kind === 'caption')
        if (target) target.captions.push(...captionItems.map((caption) => ({ ...caption, trackId: target.id })))
        if (captionItems.length) recalculateSequenceDuration(draft.sequences[draft.activeSequenceId])
      })
      this.set((draft) => {
        draft.selectedAssetIds = assets.map((asset) => asset.id)
        draft.notice = { kind: 'success', message: `${assets.length} ${assets.length === 1 ? 'asset' : 'assets'} imported${captionItems.length ? ` with ${captionItems.length} caption segments` : ''}. Nothing was uploaded.` }
      })
    }
    return assets
  }

  async relinkAsset(assetId: AssetId, file: File, handle?: FileSystemFileHandle): Promise<boolean> {
    const project = this.state.project
    const asset = project?.assets[assetId]
    if (!project || !asset) return false
    const sampleHash = await fingerprintFile(file)
    if (asset.fingerprint.sampleHash && sampleHash !== asset.fingerprint.sampleHash) {
      this.setNotice({ kind: 'warning', message: 'That file does not match the original media fingerprint.' })
      return false
    }
    mediaRegistry.set(assetId, file)
    if (handle) await projectRepository.storeFileHandle(project.id, assetId, handle)
    this.commit('Relink media', [assetId], (draft) => { draft.assets[assetId].relinkState = 'online' })
    this.setNotice({ kind: 'success', message: `${asset.name} is online.` })
    return true
  }

  async generateProxy(assetId: AssetId, height: 720 | 1080 = 720): Promise<void> {
    const project = this.state.project
    const asset = project?.assets[assetId]
    const runtime = mediaRegistry.get(assetId)
    if (!project || !asset || asset.kind !== 'video' || !runtime || asset.proxy.state === 'generating') return
    const estimate = await navigator.storage?.estimate?.().catch(() => null)
    const available = (estimate?.quota ?? 0) - (estimate?.usage ?? 0)
    if (estimate?.quota && available < asset.fingerprint.size * 1.1) {
      this.setNotice({ kind: 'warning', message: 'Not enough browser storage is available for this proxy.' })
      return
    }
    this.set((draft) => {
      if (!draft.project) return
      draft.project.assets[assetId].proxy = { state: 'generating', height, progress: 0, fileName: `${assetId}.webm`, useForPreview: true }
    })
    this.setNotice({ kind: 'info', message: `Generating a ${height}p editing proxy in a local worker…` })
    try {
      const outputHandle = await projectRepository.createProxyFileHandle(project.id, assetId)
      await generateProxy(runtime.file, outputHandle, height, (progress) => {
        this.set((draft) => {
          const proxy = draft.project?.assets[assetId]?.proxy
          if (proxy) proxy.progress = progress
        })
      })
      const proxyFile = await projectRepository.getProxyFile(project.id, assetId)
      if (!proxyFile) throw new Error('The proxy was encoded but could not be reopened.')
      mediaRegistry.setProxy(assetId, proxyFile, true)
      this.commit('Generate proxy', [assetId], (draft) => {
        draft.assets[assetId].proxy = { state: 'ready', height, progress: 1, fileName: `${assetId}.webm`, useForPreview: true }
      })
      this.setNotice({ kind: 'success', message: `${height}p proxy ready. Preview now uses the proxy; export still uses the original.` })
    } catch (error) {
      await projectRepository.removeProxy(project.id, assetId)
      this.set((draft) => {
        const proxy = draft.project?.assets[assetId]?.proxy
        if (proxy) { proxy.state = 'failed'; proxy.error = error instanceof Error ? error.message : 'Proxy generation failed.' }
      })
      this.setNotice({ kind: 'error', message: error instanceof Error ? error.message : 'Proxy generation failed.' })
    }
  }

  toggleProxy(assetId: AssetId): void {
    const asset = this.state.project?.assets[assetId]
    if (!asset || asset.proxy.state !== 'ready') return
    const next = !asset.proxy.useForPreview
    mediaRegistry.setUseProxy(assetId, next)
    this.set((draft) => {
      if (!draft.project) return
      draft.project.assets[assetId].proxy.useForPreview = next
      draft.dirty = true
    })
    this.scheduleAutosave()
  }

  async clearGeneratedCache(): Promise<void> {
    const project = this.state.project
    if (!project) return
    await projectRepository.clearProjectCache(project.id)
    for (const asset of Object.values(project.assets)) mediaRegistry.clearProxy(asset.id)
    this.set((draft) => {
      if (!draft.project) return
      for (const asset of Object.values(draft.project.assets)) asset.proxy = { state: 'none' }
      draft.dirty = true
      draft.notice = { kind: 'success', message: 'Generated proxies, thumbnails, waveforms, and render cache were cleared. The project manifest and source links remain.' }
    })
    await this.flushAutosave()
  }

  insertAsset(assetId: AssetId, targetTrackId?: string): void {
    const sequence = this.getActiveSequence()
    const asset = this.state.project?.assets[assetId]
    if (!sequence || !asset) return
    if (asset.kind === 'caption') {
      this.setActivePanel('captions')
      this.setNotice({ kind: 'info', message: 'Caption cues were added to the caption track when the file was imported.' })
      return
    }
    const requestedTrack = targetTrackId ? sequence.tracks.find((track) => track.id === targetTrackId) : undefined
    if (requestedTrack?.locked) {
      this.setNotice({ kind: 'warning', message: `${requestedTrack.name} is locked. Unlock it before inserting media.` })
      return
    }
    const primaryKind = asset.kind === 'audio' ? 'audio' : 'video'
    const primaryTrack = requestedTrack?.kind === primaryKind
      ? requestedTrack
      : sequence.tracks.find((track) => track.kind === primaryKind && track.targeted && !track.locked)
        ?? sequence.tracks.find((track) => track.kind === primaryKind && !track.locked)
    if (!primaryTrack) {
      this.setNotice({ kind: 'warning', message: `No unlocked ${primaryKind} track is available.` })
      return
    }
    const clip = assetToClip(asset, primaryTrack.id, this.state.currentTime)
    const audioTrack = asset.kind === 'video' && asset.metadata.audioCodec
      ? (requestedTrack?.kind === 'audio' ? requestedTrack : undefined)
        ?? sequence.tracks.find((track) => track.kind === 'audio' && track.order === primaryTrack.order && !track.locked)
        ?? sequence.tracks.find((track) => track.kind === 'audio' && track.targeted && !track.locked)
        ?? sequence.tracks.find((track) => track.kind === 'audio' && !track.locked)
      : undefined
    const audioClip = audioTrack ? assetToClip(asset, audioTrack.id, this.state.currentTime) : null
    if (audioClip) {
      audioClip.linkGroupId = clip.linkGroupId
      audioClip.label = '#4f8b65'
    }
    this.commit('Insert clip', [clip.id, ...(audioClip ? [audioClip.id] : [])], (draft) => {
      const draftSequence = draft.sequences[draft.activeSequenceId]
      draftSequence.tracks.find((track) => track.id === primaryTrack.id)?.clips.push(clip)
      if (audioClip && audioTrack) draftSequence.tracks.find((track) => track.id === audioTrack.id)?.clips.push(audioClip)
      recalculateSequenceDuration(draftSequence)
    })
    this.set((draft) => { draft.selectedClipIds = [clip.id, ...(audioClip ? [audioClip.id] : [])] })
  }

  moveClip(clipId: ClipId, timelineStart: TickString, trackId?: string): void {
    const sequence = this.getActiveSequence()
    const sourceTrack = sequence?.tracks.find((track) => track.clips.some((clip) => clip.id === clipId))
    const sourceClip = sourceTrack?.clips.find((clip) => clip.id === clipId)
    if (!sequence || !sourceTrack || !sourceClip || sourceTrack.locked) return
    const delta = subtractTicks(timelineStart, sourceClip.timelineStart)
    const moving = sourceClip.linkGroupId && this.state.linkedSelection
      ? sequence.tracks.flatMap((track) => track.clips).filter((clip) => clip.linkGroupId === sourceClip.linkGroupId)
      : [sourceClip]
    const requestedAnchorTrack = trackId
      ? sequence.tracks.find((track) => track.id === trackId && track.kind === sourceTrack.kind && !track.locked)
      : undefined
    this.commit('Move clip', moving.map((clip) => clip.id), (draft) => {
      const draftSequence = draft.sequences[draft.activeSequenceId]
      for (const movingClip of moving) {
        const oldTrack = draftSequence.tracks.find((track) => track.clips.some((clip) => clip.id === movingClip.id))
        const clipIndex = oldTrack?.clips.findIndex((clip) => clip.id === movingClip.id) ?? -1
        if (!oldTrack || oldTrack.locked || clipIndex < 0) continue
        const [clip] = oldTrack.clips.splice(clipIndex, 1)
        clip.timelineStart = ticks(addTicks(clip.timelineStart, delta)) < 0n ? '0' : addTicks(clip.timelineStart, delta)
        const destinationTrack = requestedAnchorTrack
          ? movingClip.id === clipId
            ? draftSequence.tracks.find((track) => track.id === requestedAnchorTrack.id)
            : draftSequence.tracks.find((track) => track.kind === oldTrack.kind && track.order === requestedAnchorTrack.order && !track.locked) ?? oldTrack
          : oldTrack
        clip.trackId = destinationTrack?.id ?? oldTrack.id
        ;(destinationTrack ?? oldTrack).clips.push(clip)
      }
      recalculateSequenceDuration(draftSequence)
    })
  }

  trimClip(clipId: ClipId, edge: 'start' | 'end', value: TickString): void {
    const sequence = this.getActiveSequence()
    const track = sequence?.tracks.find((candidate) => candidate.clips.some((clip) => clip.id === clipId))
    const clip = track?.clips.find((candidate) => candidate.id === clipId)
    if (!sequence || !track || !clip || track.locked) return
    const minimum = secondsToTicks(1 / (sequence.frameRate.numerator / sequence.frameRate.denominator))
    this.commit(edge === 'start' ? 'Trim in point' : 'Trim out point', [clipId], (draft) => {
      const item = draft.sequences[draft.activeSequenceId].tracks.flatMap((candidate) => candidate.clips).find((candidate) => candidate.id === clipId)
      if (!item) return
      if (edge === 'start') {
        const oldEnd = addTicks(item.timelineStart, item.timelineDuration)
        const nextStart = clampTicks(value, '0', subtractTicks(oldEnd, minimum))
        const change = subtractTicks(nextStart, item.timelineStart)
        item.timelineStart = nextStart
        item.timelineDuration = subtractTicks(oldEnd, nextStart)
        item.sourceIn = addTicks(item.sourceIn, change)
        item.sourceDuration = item.timelineDuration
      } else {
        const nextEnd = ticks(value) < ticks(addTicks(item.timelineStart, minimum)) ? addTicks(item.timelineStart, minimum) : value
        item.timelineDuration = subtractTicks(nextEnd, item.timelineStart)
        item.sourceDuration = item.timelineDuration
      }
      recalculateSequenceDuration(draft.sequences[draft.activeSequenceId])
    })
  }

  rippleTrimClip(clipId: ClipId, edge: 'start' | 'end', value: TickString): void {
    const sequence = this.getActiveSequence()
    const sourceTrack = sequence?.tracks.find((track) => track.clips.some((clip) => clip.id === clipId))
    const sourceClip = sourceTrack?.clips.find((clip) => clip.id === clipId)
    if (!sequence || !sourceTrack || !sourceClip || sourceTrack.locked) return
    const minimum = secondsToTicks(1 / (sequence.frameRate.numerator / sequence.frameRate.denominator))
    const oldStart = sourceClip.timelineStart
    const oldEnd = addTicks(sourceClip.timelineStart, sourceClip.timelineDuration)
    const boundary = edge === 'start'
      ? clampTicks(value, '0', subtractTicks(oldEnd, minimum))
      : ticks(value) < ticks(addTicks(oldStart, minimum)) ? addTicks(oldStart, minimum) : value
    const delta = edge === 'start' ? subtractTicks(boundary, oldStart) : subtractTicks(boundary, oldEnd)
    this.commit('Ripple trim', [clipId], (draft) => {
      const draftSequence = draft.sequences[draft.activeSequenceId]
      const item = draftSequence.tracks.flatMap((track) => track.clips).find((clip) => clip.id === clipId)
      if (!item) return
      if (edge === 'start') {
        item.sourceIn = addTicks(item.sourceIn, delta)
        item.timelineDuration = subtractTicks(item.timelineDuration, delta)
        item.sourceDuration = item.timelineDuration
      } else {
        item.timelineDuration = subtractTicks(boundary, item.timelineStart)
        item.sourceDuration = item.timelineDuration
      }
      for (const track of draftSequence.tracks.filter((track) => track.syncLock && !track.locked)) {
        for (const other of track.clips) {
          if (other.id === clipId || ticks(other.timelineStart) < ticks(oldEnd)) continue
          const shift = edge === 'start' ? -ticks(delta) : ticks(delta)
          other.timelineStart = (ticks(other.timelineStart) + shift).toString()
        }
      }
      recalculateSequenceDuration(draftSequence)
    })
  }

  rollingTrimClip(clipId: ClipId, edge: 'start' | 'end', value: TickString): void {
    const sequence = this.getActiveSequence()
    const track = sequence?.tracks.find((candidate) => candidate.clips.some((clip) => clip.id === clipId))
    const clip = track?.clips.find((candidate) => candidate.id === clipId)
    if (!sequence || !track || !clip || track.locked) return
    const oldStart = clip.timelineStart
    const oldEnd = addTicks(clip.timelineStart, clip.timelineDuration)
    const neighbor = edge === 'end'
      ? track.clips.find((candidate) => candidate.id !== clip.id && ticks(candidate.timelineStart) === ticks(oldEnd))
      : track.clips.find((candidate) => candidate.id !== clip.id && ticks(addTicks(candidate.timelineStart, candidate.timelineDuration)) === ticks(oldStart))
    if (!neighbor) {
      this.setNotice({ kind: 'warning', message: 'Rolling Edit needs an adjacent clip at that edit point.' })
      return
    }
    const minimum = secondsToTicks(1 / (sequence.frameRate.numerator / sequence.frameRate.denominator))
    const minBoundary = edge === 'end' ? addTicks(clip.timelineStart, minimum) : addTicks(neighbor.timelineStart, minimum)
    const maxBoundary = edge === 'end' ? subtractTicks(addTicks(neighbor.timelineStart, neighbor.timelineDuration), minimum) : subtractTicks(oldEnd, minimum)
    const boundary = clampTicks(value, minBoundary, maxBoundary)
    this.commit('Rolling edit', [clip.id, neighbor.id], (draft) => {
      const draftTrack = draft.sequences[draft.activeSequenceId].tracks.find((candidate) => candidate.id === track.id)
      const item = draftTrack?.clips.find((candidate) => candidate.id === clip.id)
      const adjacent = draftTrack?.clips.find((candidate) => candidate.id === neighbor.id)
      if (!item || !adjacent) return
      if (edge === 'end') {
        const adjacentEnd = addTicks(adjacent.timelineStart, adjacent.timelineDuration)
        const sourceShift = subtractTicks(boundary, adjacent.timelineStart)
        item.timelineDuration = subtractTicks(boundary, item.timelineStart)
        item.sourceDuration = item.timelineDuration
        adjacent.timelineStart = boundary
        adjacent.timelineDuration = subtractTicks(adjacentEnd, boundary)
        adjacent.sourceIn = addTicks(adjacent.sourceIn, sourceShift)
        adjacent.sourceDuration = adjacent.timelineDuration
      } else {
        const sourceShift = subtractTicks(boundary, item.timelineStart)
        adjacent.timelineDuration = subtractTicks(boundary, adjacent.timelineStart)
        adjacent.sourceDuration = adjacent.timelineDuration
        item.timelineStart = boundary
        item.timelineDuration = subtractTicks(oldEnd, boundary)
        item.sourceIn = addTicks(item.sourceIn, sourceShift)
        item.sourceDuration = item.timelineDuration
      }
    })
  }

  rateStretchClip(clipId: ClipId, edge: 'start' | 'end', value: TickString): void {
    const sequence = this.getActiveSequence()
    const track = sequence?.tracks.find((candidate) => candidate.clips.some((clip) => clip.id === clipId))
    const clip = track?.clips.find((candidate) => candidate.id === clipId)
    if (!sequence || !track || !clip || track.locked) return
    const minimum = secondsToTicks(1 / (sequence.frameRate.numerator / sequence.frameRate.denominator))
    const oldEnd = addTicks(clip.timelineStart, clip.timelineDuration)
    const start = edge === 'start' ? clampTicks(value, '0', subtractTicks(oldEnd, minimum)) : clip.timelineStart
    const end = edge === 'end' ? (ticks(value) < ticks(addTicks(clip.timelineStart, minimum)) ? addTicks(clip.timelineStart, minimum) : value) : oldEnd
    this.commit('Rate stretch', [clipId], (draft) => {
      const item = draft.sequences[draft.activeSequenceId].tracks.flatMap((candidate) => candidate.clips).find((candidate) => candidate.id === clipId)
      if (!item) return
      const sourceDuration = item.sourceDuration
      item.timelineStart = start
      item.timelineDuration = subtractTicks(end, start)
      item.playbackRate = Math.max(0.1, Math.min(8, Number(ticks(sourceDuration)) / Number(ticks(item.timelineDuration))))
      recalculateSequenceDuration(draft.sequences[draft.activeSequenceId])
    })
  }

  slipClip(clipId: ClipId, delta: TickString): void {
    const sequence = this.getActiveSequence()
    const track = sequence?.tracks.find((candidate) => candidate.clips.some((clip) => clip.id === clipId))
    const clip = track?.clips.find((candidate) => candidate.id === clipId)
    const asset = clip ? this.state.project?.assets[clip.assetId] : undefined
    if (!track || !clip || !asset || track.locked) return
    const maxIn = ticks(asset.metadata.durationTicks) > ticks(clip.sourceDuration)
      ? subtractTicks(asset.metadata.durationTicks, clip.sourceDuration)
      : '0'
    const nextIn = clampTicks(addTicks(clip.sourceIn, delta), '0', maxIn)
    this.commit('Slip clip', [clipId], (draft) => {
      const item = draft.sequences[draft.activeSequenceId].tracks.flatMap((candidate) => candidate.clips).find((candidate) => candidate.id === clipId)
      if (item) item.sourceIn = nextIn
    })
  }

  slideClip(clipId: ClipId, timelineStart: TickString): void {
    const sequence = this.getActiveSequence()
    const track = sequence?.tracks.find((candidate) => candidate.clips.some((clip) => clip.id === clipId))
    const clip = track?.clips.find((candidate) => candidate.id === clipId)
    if (!sequence || !track || !clip || track.locked) return
    const oldEnd = addTicks(clip.timelineStart, clip.timelineDuration)
    const previous = track.clips.find((candidate) => candidate.id !== clip.id && ticks(addTicks(candidate.timelineStart, candidate.timelineDuration)) === ticks(clip.timelineStart))
    const next = track.clips.find((candidate) => candidate.id !== clip.id && ticks(candidate.timelineStart) === ticks(oldEnd))
    if (!previous || !next) {
      this.moveClip(clipId, timelineStart)
      return
    }
    const minimum = secondsToTicks(1 / (sequence.frameRate.numerator / sequence.frameRate.denominator))
    const requested = subtractTicks(timelineStart, clip.timelineStart)
    const minDelta = -ticks(subtractTicks(previous.timelineDuration, minimum))
    const maxDelta = ticks(subtractTicks(next.timelineDuration, minimum))
    const delta = (ticks(requested) < minDelta ? minDelta : ticks(requested) > maxDelta ? maxDelta : ticks(requested)).toString()
    this.commit('Slide clip', [previous.id, clip.id, next.id], (draft) => {
      const draftTrack = draft.sequences[draft.activeSequenceId].tracks.find((candidate) => candidate.id === track.id)
      const before = draftTrack?.clips.find((candidate) => candidate.id === previous.id)
      const item = draftTrack?.clips.find((candidate) => candidate.id === clip.id)
      const after = draftTrack?.clips.find((candidate) => candidate.id === next.id)
      if (!before || !item || !after) return
      before.timelineDuration = addTicks(before.timelineDuration, delta)
      before.sourceDuration = before.timelineDuration
      item.timelineStart = addTicks(item.timelineStart, delta)
      after.timelineStart = addTicks(after.timelineStart, delta)
      after.timelineDuration = subtractTicks(after.timelineDuration, delta)
      after.sourceIn = addTicks(after.sourceIn, delta)
      after.sourceDuration = after.timelineDuration
    })
  }

  splitSelected(): void {
    const sequence = this.getActiveSequence()
    if (!sequence) return
    const selected = sequence.tracks.flatMap((track) => track.clips).filter((clip) => this.state.selectedClipIds.includes(clip.id))
    const at = this.state.currentTime
    const splittable = selected.filter((clip) => ticks(at) > ticks(clip.timelineStart) && ticks(at) < ticks(addTicks(clip.timelineStart, clip.timelineDuration)))
    if (!splittable.length) return
    const newIds: string[] = []
    this.commit('Add edit', splittable.map((clip) => clip.id), (draft) => {
      const draftSequence = draft.sequences[draft.activeSequenceId]
      for (const original of splittable) {
        const track = draftSequence.tracks.find((candidate) => candidate.clips.some((clip) => clip.id === original.id))
        const clip = track?.clips.find((candidate) => candidate.id === original.id)
        if (!track || !clip) continue
        const leftDuration = subtractTicks(at, clip.timelineStart)
        const rightDuration = subtractTicks(clip.timelineDuration, leftDuration)
        clip.timelineDuration = leftDuration
        clip.sourceDuration = leftDuration
        const right = structuredClone(original)
        right.id = makeId('clip')
        right.timelineStart = at
        right.timelineDuration = rightDuration
        right.sourceIn = addTicks(clip.sourceIn, leftDuration)
        right.sourceDuration = rightDuration
        track.clips.push(right)
        newIds.push(right.id)
      }
    })
    this.set((draft) => { draft.selectedClipIds = newIds })
  }

  splitClipAt(clipId: ClipId, at: TickString = this.state.currentTime): void {
    const sequence = this.getActiveSequence()
    const anchor = sequence?.tracks.flatMap((track) => track.clips).find((clip) => clip.id === clipId)
    if (!sequence || !anchor) return
    const candidates = anchor.linkGroupId && this.state.linkedSelection
      ? sequence.tracks.flatMap((track) => track.clips).filter((clip) => clip.linkGroupId === anchor.linkGroupId)
      : [anchor]
    const splittable = candidates.filter((clip) => ticks(at) > ticks(clip.timelineStart) && ticks(at) < ticks(addTicks(clip.timelineStart, clip.timelineDuration)))
    if (!splittable.length) {
      this.setNotice({ kind: 'warning', message: 'Move the playhead inside the clip before splitting.' })
      return
    }
    const newIds: string[] = []
    this.commit('Split clip', splittable.map((clip) => clip.id), (draft) => {
      const draftSequence = draft.sequences[draft.activeSequenceId]
      for (const original of splittable) {
        const track = draftSequence.tracks.find((candidate) => candidate.clips.some((clip) => clip.id === original.id))
        const clip = track?.clips.find((candidate) => candidate.id === original.id)
        if (!track || !clip) continue
        const leftDuration = subtractTicks(at, clip.timelineStart)
        const rightDuration = subtractTicks(clip.timelineDuration, leftDuration)
        clip.timelineDuration = leftDuration
        clip.sourceDuration = leftDuration
        const right = structuredClone(original)
        right.id = makeId('clip')
        right.timelineStart = at
        right.timelineDuration = rightDuration
        right.sourceIn = addTicks(clip.sourceIn, leftDuration)
        right.sourceDuration = rightDuration
        track.clips.push(right)
        newIds.push(right.id)
      }
      recalculateSequenceDuration(draftSequence)
    })
    this.set((draft) => { draft.selectedClipIds = newIds })
  }

  deleteSelected(ripple = false): void {
    const sequence = this.getActiveSequence()
    const selected = this.state.selectedClipIds
    if (!sequence || !selected.length) return
    const removed = sequence.tracks.flatMap((track) => track.clips).filter((clip) => selected.includes(clip.id))
    const earliest = removed.reduce((min, clip) => ticks(clip.timelineStart) < ticks(min) ? clip.timelineStart : min, removed[0]?.timelineStart ?? '0')
    const latest = removed.reduce((max, clip) => ticks(addTicks(clip.timelineStart, clip.timelineDuration)) > ticks(max) ? addTicks(clip.timelineStart, clip.timelineDuration) : max, '0')
    const gap = subtractTicks(latest, earliest)
    this.commit(ripple ? 'Ripple delete' : 'Delete clips', selected, (draft) => {
      const draftSequence = draft.sequences[draft.activeSequenceId]
      for (const track of draftSequence.tracks) {
        track.clips = track.clips.filter((clip) => !selected.includes(clip.id))
        if (ripple && track.syncLock) {
          for (const clip of track.clips) if (ticks(clip.timelineStart) >= ticks(latest)) clip.timelineStart = subtractTicks(clip.timelineStart, gap)
        }
      }
      recalculateSequenceDuration(draftSequence)
    })
    this.set((draft) => { draft.selectedClipIds = [] })
  }

  copySelected(): boolean {
    const sequence = this.getActiveSequence()
    if (!sequence || !this.state.selectedClipIds.length) return false
    this.clipClipboard = sequence.tracks.flatMap((track) => track.clips
      .filter((clip) => this.state.selectedClipIds.includes(clip.id))
      .map((clip) => ({ clip: structuredClone(clip), trackKind: track.kind, trackOrder: track.order })))
    this.setNotice({ kind: 'success', message: `${this.clipClipboard.length} ${this.clipClipboard.length === 1 ? 'clip' : 'clips'} copied.` })
    return this.clipClipboard.length > 0
  }

  cutSelected(): void {
    if (this.copySelected()) this.deleteSelected(false)
  }

  canPaste(): boolean { return this.clipClipboard.length > 0 }

  pasteClipboard(at: TickString = this.state.currentTime): void {
    const sequence = this.getActiveSequence()
    if (!sequence || !this.clipClipboard.length) return
    const earliest = this.clipClipboard.reduce((value, entry) => ticks(entry.clip.timelineStart) < ticks(value) ? entry.clip.timelineStart : value, this.clipClipboard[0].clip.timelineStart)
    const linkMap = new Map<string, string>()
    const copies = this.clipClipboard.map((entry) => {
      const target = sequence.tracks.find((track) => track.kind === entry.trackKind && track.order === entry.trackOrder && !track.locked)
        ?? sequence.tracks.find((track) => track.kind === entry.trackKind && track.targeted && !track.locked)
        ?? sequence.tracks.find((track) => track.kind === entry.trackKind && !track.locked)
      if (!target) return null
      const copy = structuredClone(entry.clip)
      copy.id = makeId('clip')
      copy.trackId = target.id
      copy.timelineStart = addTicks(at, subtractTicks(entry.clip.timelineStart, earliest))
      if (copy.linkGroupId) {
        const nextLink = linkMap.get(copy.linkGroupId) ?? makeId('link')
        linkMap.set(copy.linkGroupId, nextLink)
        copy.linkGroupId = nextLink
      }
      return { targetId: target.id, clip: copy }
    }).filter((entry): entry is { targetId: string; clip: ClipItem } => entry !== null)
    if (!copies.length) return
    this.commit('Paste clips', copies.map((entry) => entry.clip.id), (draft) => {
      const draftSequence = draft.sequences[draft.activeSequenceId]
      for (const entry of copies) draftSequence.tracks.find((track) => track.id === entry.targetId)?.clips.push(entry.clip)
      recalculateSequenceDuration(draftSequence)
    })
    this.set((draft) => { draft.selectedClipIds = copies.map((entry) => entry.clip.id) })
  }

  duplicateSelected(): void {
    const sequence = this.getActiveSequence()
    if (!sequence || !this.state.selectedClipIds.length) return
    const selected = sequence.tracks.flatMap((track) => track.clips).filter((clip) => this.state.selectedClipIds.includes(clip.id))
    if (!selected.length) return
    const earliest = selected.reduce((value, clip) => ticks(clip.timelineStart) < ticks(value) ? clip.timelineStart : value, selected[0].timelineStart)
    const latest = selected.reduce((value, clip) => ticks(addTicks(clip.timelineStart, clip.timelineDuration)) > ticks(value) ? addTicks(clip.timelineStart, clip.timelineDuration) : value, '0')
    const offset = subtractTicks(latest, earliest)
    const linkMap = new Map<string, string>()
    const copies = selected.map((clip) => {
      const copy = structuredClone(clip)
      copy.id = makeId('clip')
      copy.timelineStart = addTicks(copy.timelineStart, offset)
      if (copy.linkGroupId) {
        const nextLink = linkMap.get(copy.linkGroupId) ?? makeId('link')
        linkMap.set(copy.linkGroupId, nextLink)
        copy.linkGroupId = nextLink
      }
      return copy
    })
    this.commit('Duplicate clips', copies.map((clip) => clip.id), (draft) => {
      const draftSequence = draft.sequences[draft.activeSequenceId]
      for (const copy of copies) draftSequence.tracks.find((track) => track.id === copy.trackId)?.clips.push(copy)
      recalculateSequenceDuration(draftSequence)
    })
    this.set((draft) => { draft.selectedClipIds = copies.map((clip) => clip.id) })
  }

  toggleSelectedEnabled(): void {
    const selected = this.state.selectedClipIds
    const sequence = this.getActiveSequence()
    const first = sequence?.tracks.flatMap((track) => track.clips).find((clip) => selected.includes(clip.id))
    if (!selected.length || !first) return
    const enabled = first.enabled === false
    this.commit(enabled ? 'Enable clips' : 'Disable clips', selected, (draft) => {
      for (const clip of draft.sequences[draft.activeSequenceId].tracks.flatMap((track) => track.clips).filter((clip) => selected.includes(clip.id))) clip.enabled = enabled
    })
  }

  unlinkSelected(): void {
    const selected = this.state.selectedClipIds
    if (!selected.length) return
    this.commit('Unlink clips', selected, (draft) => {
      for (const clip of draft.sequences[draft.activeSequenceId].tracks.flatMap((track) => track.clips).filter((clip) => selected.includes(clip.id))) delete clip.linkGroupId
    })
    this.setNotice({ kind: 'success', message: 'Selected video and audio can now be edited independently.' })
  }

  linkSelected(): void {
    const sequence = this.getActiveSequence()
    const selected = sequence?.tracks.flatMap((track) => track.clips).filter((clip) => this.state.selectedClipIds.includes(clip.id)) ?? []
    if (selected.length < 2) {
      this.setNotice({ kind: 'warning', message: 'Select at least two clips to link them.' })
      return
    }
    const group = makeId('link')
    this.commit('Link clips', selected.map((clip) => clip.id), (draft) => {
      for (const clip of draft.sequences[draft.activeSequenceId].tracks.flatMap((track) => track.clips).filter((clip) => selected.some((item) => item.id === clip.id))) clip.linkGroupId = group
    })
  }

  detachAudio(clipId: ClipId): void {
    const sequence = this.getActiveSequence()
    const videoTrack = sequence?.tracks.find((track) => track.kind === 'video' && track.clips.some((clip) => clip.id === clipId))
    const videoClip = videoTrack?.clips.find((clip) => clip.id === clipId)
    const asset = videoClip ? this.state.project?.assets[videoClip.assetId] : undefined
    if (!sequence || !videoClip || !asset?.metadata.audioCodec) {
      this.setNotice({ kind: 'warning', message: 'This clip has no detachable audio track.' })
      return
    }
    const linkedAudio = videoClip.linkGroupId
      ? sequence.tracks.filter((track) => track.kind === 'audio').flatMap((track) => track.clips).filter((clip) => clip.linkGroupId === videoClip.linkGroupId)
      : []
    if (linkedAudio.length) {
      const ids = [videoClip.id, ...linkedAudio.map((clip) => clip.id)]
      this.commit('Detach audio', ids, (draft) => {
        for (const clip of draft.sequences[draft.activeSequenceId].tracks.flatMap((track) => track.clips).filter((clip) => ids.includes(clip.id))) delete clip.linkGroupId
      })
      this.set((draft) => { draft.selectedClipIds = linkedAudio.map((clip) => clip.id) })
      this.setNotice({ kind: 'success', message: 'Audio detached. Video and audio now move independently.' })
      return
    }
    const audioTrack = sequence.tracks.find((track) => track.kind === 'audio' && track.targeted && !track.locked)
      ?? sequence.tracks.find((track) => track.kind === 'audio' && !track.locked)
    if (!audioTrack) return
    const audioClip = structuredClone(videoClip)
    audioClip.id = makeId('clip')
    audioClip.trackId = audioTrack.id
    audioClip.name = `${videoClip.name} [Audio]`
    audioClip.label = '#4f8b65'
    delete audioClip.linkGroupId
    this.commit('Detach audio', [videoClip.id, audioClip.id], (draft) => {
      const item = draft.sequences[draft.activeSequenceId].tracks.flatMap((track) => track.clips).find((clip) => clip.id === videoClip.id)
      if (item) delete item.linkGroupId
      draft.sequences[draft.activeSequenceId].tracks.find((track) => track.id === audioTrack.id)?.clips.push(audioClip)
    })
    this.set((draft) => { draft.selectedClipIds = [audioClip.id] })
    this.setNotice({ kind: 'success', message: 'Audio detached onto the targeted audio track.' })
  }

  removeSelectedEffects(): void {
    const selected = this.state.selectedClipIds
    if (!selected.length) return
    this.commit('Remove clip effects', selected, (draft) => {
      for (const clip of draft.sequences[draft.activeSequenceId].tracks.flatMap((track) => track.clips).filter((clip) => selected.includes(clip.id))) {
        clip.effects = defaultEffects()
        delete clip.transitionIn
        delete clip.transitionOut
      }
    })
  }

  addTitleClip(trackId?: string, at: TickString = this.state.currentTime): void {
    const sequence = this.getActiveSequence()
    const track = sequence?.tracks.find((candidate) => candidate.id === trackId && candidate.kind === 'video' && !candidate.locked)
      ?? sequence?.tracks.find((candidate) => candidate.kind === 'video' && candidate.targeted && !candidate.locked)
      ?? sequence?.tracks.find((candidate) => candidate.kind === 'video' && !candidate.locked)
    if (!sequence || !track) return
    const clip: ClipItem = {
      id: makeId('clip'), assetId: 'generated-title', trackId: track.id, name: 'New Title', titleText: 'New Title',
      timelineStart: at, timelineDuration: secondsToTicks(5), sourceIn: '0', sourceDuration: secondsToTicks(5),
      playbackRate: 1, reverse: false, freezeFrame: false, enabled: true, label: '#78694d', effects: defaultEffects(),
    }
    this.commit('Add title', [clip.id], (draft) => {
      const draftSequence = draft.sequences[draft.activeSequenceId]
      draftSequence.tracks.find((candidate) => candidate.id === track.id)?.clips.push(clip)
      recalculateSequenceDuration(draftSequence)
    })
    this.set((draft) => { draft.selectedClipIds = [clip.id]; draft.activePanel = 'text' })
    this.setNotice({ kind: 'success', message: 'Title added. Edit its text in the Text panel.' })
  }

  setClipEffect(path: string, value: number | string | boolean): void {
    const clipIds = this.state.selectedClipIds
    if (!clipIds.length) return
    this.commit(`Change ${path}`, clipIds, (draft) => {
      const sequence = draft.sequences[draft.activeSequenceId]
      for (const clip of sequence.tracks.flatMap((track) => track.clips).filter((item) => clipIds.includes(item.id))) {
        const keys = path.split('.')
        let target = clip.effects as unknown as Record<string, unknown>
        for (const key of keys.slice(0, -1)) target = target[key] as Record<string, unknown>
        target[keys.at(-1)!] = value
      }
    })
  }

  setClipMotion(clipId: ClipId, motion: ClipItem['effects']['motion']): void {
    const sequence = this.getActiveSequence()
    const track = sequence?.tracks.find((candidate) => candidate.clips.some((clip) => clip.id === clipId))
    const clip = track?.clips.find((candidate) => candidate.id === clipId)
    if (!sequence || !track || !clip || track.locked) return
    const next = {
      positionX: Math.max(-sequence.width * 2, Math.min(sequence.width * 2, motion.positionX)),
      positionY: Math.max(-sequence.height * 2, Math.min(sequence.height * 2, motion.positionY)),
      scale: Math.max(1, Math.min(800, motion.scale)),
      rotation: ((motion.rotation + 180) % 360 + 360) % 360 - 180,
      anchorX: Math.max(0, Math.min(100, motion.anchorX)),
      anchorY: Math.max(0, Math.min(100, motion.anchorY)),
    }
    this.commit('Transform clip in Program Monitor', [clipId], (draft) => {
      const item = draft.sequences[draft.activeSequenceId].tracks.flatMap((candidate) => candidate.clips).find((candidate) => candidate.id === clipId)
      if (item) item.effects.motion = next
    })
  }

  setClipPlaybackRate(ratePercent: number): void {
    const clipIds = this.state.selectedClipIds
    if (!clipIds.length) return
    this.commit('Change clip speed', clipIds, (draft) => {
      const clips = draft.sequences[draft.activeSequenceId].tracks.flatMap((track) => track.clips)
      for (const clip of clips.filter((item) => clipIds.includes(item.id))) clip.playbackRate = Math.max(0.1, Math.min(8, ratePercent / 100))
    })
  }

  toggleClipFlag(field: 'reverse' | 'freezeFrame'): void {
    const clipIds = this.state.selectedClipIds
    if (!clipIds.length) return
    this.commit(field === 'reverse' ? 'Reverse clip' : 'Freeze frame', clipIds, (draft) => {
      const clips = draft.sequences[draft.activeSequenceId].tracks.flatMap((track) => track.clips)
      for (const clip of clips.filter((item) => clipIds.includes(item.id))) clip[field] = !clip[field]
    })
  }

  toggleTrack(trackId: string, field: 'locked' | 'muted' | 'solo' | 'visible' | 'targeted' | 'syncLock'): void {
    this.commit(`Toggle track ${field}`, [trackId], (draft) => {
      const track = draft.sequences[draft.activeSequenceId].tracks.find((candidate) => candidate.id === trackId)
      if (track) track[field] = !track[field]
    })
  }

  setTrackMix(trackId: string, gainDb: number): void {
    this.commit('Adjust track level', [trackId], (draft) => {
      const track = draft.sequences[draft.activeSequenceId].tracks.find((candidate) => candidate.id === trackId)
      if (track) track.gainDb = Math.max(-60, Math.min(12, gainDb))
    })
  }

  setMasterGain(gainDb: number): void {
    const sequence = this.getActiveSequence()
    if (!sequence) return
    this.commit('Adjust master level', [sequence.id], (draft) => {
      draft.sequences[draft.activeSequenceId].masterGainDb = Math.max(-60, Math.min(12, gainDb))
    })
  }

  addMarker(): void {
    const at = this.state.currentTime
    this.commit('Add marker', [], (draft) => {
      draft.sequences[draft.activeSequenceId].markers.push({ id: makeId('marker'), at, name: 'Marker', color: '#8ea0ec' })
    })
  }

  setSequencePoint(kind: 'in' | 'out'): void {
    const sequence = this.getActiveSequence()
    if (!sequence) return
    const at = this.state.currentTime
    if (kind === 'in' && sequence.outPoint && ticks(at) > ticks(sequence.outPoint)) {
      this.setNotice({ kind: 'warning', message: 'The In point must be before the Out point.' })
      return
    }
    if (kind === 'out' && sequence.inPoint && ticks(at) < ticks(sequence.inPoint)) {
      this.setNotice({ kind: 'warning', message: 'The Out point must be after the In point.' })
      return
    }
    this.commit(`Set ${kind === 'in' ? 'In' : 'Out'} point`, [sequence.id], (draft) => {
      const item = draft.sequences[draft.activeSequenceId]
      if (kind === 'in') item.inPoint = at
      else item.outPoint = at
    })
    this.setNotice({ kind: 'success', message: `Sequence ${kind === 'in' ? 'In' : 'Out'} point set.` })
  }

  setTitleText(clipId: ClipId, titleText: string): void {
    const clean = titleText.trim() || 'Untitled'
    this.commit('Edit title', [clipId], (draft) => {
      const clip = draft.sequences[draft.activeSequenceId].tracks.flatMap((track) => track.clips).find((item) => item.id === clipId)
      if (clip?.titleText !== undefined) {
        clip.titleText = clean
        clip.name = clean
      }
    })
  }

  renameProject(name: string): void {
    const clean = name.trim()
    if (!clean) return
    this.commit('Rename project', this.state.project ? [this.state.project.id] : [], (draft) => { draft.name = clean })
  }

  addSequence(): void {
    const project = this.state.project
    if (!project) return
    const sequence = createSequence(`Sequence ${String(project.sequenceOrder.length + 1).padStart(2, '0')}`)
    this.commit('Create sequence', [sequence.id], (draft) => {
      draft.sequences[sequence.id] = sequence
      draft.sequenceOrder.push(sequence.id)
      draft.activeSequenceId = sequence.id
    })
    this.set((draft) => { draft.currentTime = '0'; draft.selectedClipIds = [] })
  }

  setActiveSequence(sequenceId: string): void {
    if (!this.state.project?.sequences[sequenceId]) return
    this.set((draft) => {
      if (!draft.project) return
      draft.project.activeSequenceId = sequenceId
      draft.currentTime = '0'
      draft.selectedClipIds = []
    })
  }

  applyTransition(edge: 'in' | 'out', transition: 'cross-dissolve' | 'dip-black' | 'wipe'): void {
    const clipIds = this.state.selectedClipIds
    if (!clipIds.length) return
    this.commit(`Add ${transition}`, clipIds, (draft) => {
      const clips = draft.sequences[draft.activeSequenceId].tracks.flatMap((track) => track.clips)
      for (const clip of clips.filter((item) => clipIds.includes(item.id))) {
        if (edge === 'in') clip.transitionIn = transition
        else clip.transitionOut = transition
      }
    })
  }

  addCaption(text = 'New caption'): void {
    const sequence = this.getActiveSequence()
    const captionTrack = sequence?.tracks.find((track) => track.kind === 'caption')
    if (!sequence || !captionTrack) return
    const caption = {
      id: makeId('caption'), trackId: captionTrack.id, start: this.state.currentTime, duration: secondsToTicks(3), text,
      position: 'bottom' as const, style: { fontFamily: 'system-ui', fontSize: 48, color: '#ffffff', background: '#000000aa' },
    }
    this.commit('Add caption', [caption.id], (draft) => {
      draft.sequences[draft.activeSequenceId].tracks.find((track) => track.id === captionTrack.id)?.captions.push(caption)
    })
  }

  updateCaption(captionId: string, text: string): void {
    this.commit('Edit caption', [captionId], (draft) => {
      const caption = draft.sequences[draft.activeSequenceId].tracks.flatMap((track) => track.captions).find((item) => item.id === captionId)
      if (caption) caption.text = text
    })
  }

  undo(): void {
    if (!this.state.project || !this.past.length) return
    const previous = this.past.pop()!
    this.future.push(cloneProject(this.state.project))
    this.set((draft) => {
      draft.project = previous
      draft.dirty = true
      draft.commandLog.unshift({ id: makeId('cmd'), type: 'Undo', payload: {}, transactionId: makeId('tx'), affectedEntities: [], createdAt: new Date().toISOString() })
    })
    this.scheduleAutosave()
  }

  redo(): void {
    if (!this.state.project || !this.future.length) return
    const next = this.future.pop()!
    this.past.push(cloneProject(this.state.project))
    this.set((draft) => {
      draft.project = next
      draft.dirty = true
      draft.commandLog.unshift({ id: makeId('cmd'), type: 'Redo', payload: {}, transactionId: makeId('tx'), affectedEntities: [], createdAt: new Date().toISOString() })
    })
    this.scheduleAutosave()
  }

  canUndo(): boolean { return this.past.length > 0 }
  canRedo(): boolean { return this.future.length > 0 }

  queueExport(preset: ExportPreset, outputName: string): ExportJob | null {
    const sequence = this.getActiveSequence()
    const project = this.state.project
    if (!sequence || !project) return null
    const totalFrames = Math.max(1, Math.ceil(Number(ticks(sequence.durationTicks) * BigInt(preset.frameRate.numerator) / BigInt(preset.frameRate.denominator) / BigInt('254016000000'))))
    const job: ExportJob = {
      id: makeId('export'), projectId: project.id, sequenceId: sequence.id, preset, outputName,
      status: 'queued', progress: 0, renderedFrames: 0, totalFrames, elapsedMs: 0,
    }
    this.set((draft) => { draft.exportJobs.unshift(job) })
    return job
  }

  updateExportJob(id: string, update: Partial<ExportJob>): void {
    this.set((draft) => {
      const job = draft.exportJobs.find((candidate) => candidate.id === id)
      if (job) Object.assign(job, update)
    })
  }

  getActiveSequence(): Sequence | null {
    const project = this.state.project
    return project?.sequences[project.activeSequenceId] ?? null
  }

  async flushAutosave(): Promise<void> {
    if (this.autosaveTimer !== null) window.clearTimeout(this.autosaveTimer)
    this.autosaveTimer = null
    const project = this.state.project
    if (!project || !this.state.dirty) return
    await projectRepository.saveProject(project, true)
    this.set((draft) => { draft.dirty = false })
  }

  private scheduleAutosave(): void {
    if (this.autosaveTimer !== null) window.clearTimeout(this.autosaveTimer)
    this.autosaveTimer = window.setTimeout(() => void this.flushAutosave(), 750)
  }

  private async restoreLinkedMedia(): Promise<void> {
    const project = this.state.project
    if (!project) return
    let restored = 0
    const states = new Map<string, 'online' | 'permission-needed' | 'missing'>()
    for (const asset of Object.values(project.assets)) {
      const handle = await projectRepository.getFileHandle(project.id, asset.id)
      if (!handle) { states.set(asset.id, 'missing'); continue }
      try {
        const permission = await (handle as FileSystemFileHandle & { queryPermission?: (options: { mode: 'read' }) => Promise<PermissionState> }).queryPermission?.({ mode: 'read' })
        if (permission === 'denied' || permission === 'prompt') { states.set(asset.id, 'permission-needed'); continue }
        mediaRegistry.set(asset.id, await handle.getFile())
        if (asset.proxy.state === 'ready') {
          const proxy = await projectRepository.getProxyFile(project.id, asset.id)
          if (proxy) mediaRegistry.setProxy(asset.id, proxy, asset.proxy.useForPreview !== false)
        }
        states.set(asset.id, 'online')
        restored += 1
      } catch {
        states.set(asset.id, 'missing')
      }
    }
    this.set((draft) => {
      if (!draft.project) return
      for (const [assetId, state] of states) draft.project.assets[assetId].relinkState = state
      draft.notice = Object.keys(project.assets).length === 0
        ? { kind: 'info', message: 'Import local media to begin. Files never leave your device.' }
        : restored === Object.keys(project.assets).length
          ? { kind: 'success', message: 'All linked media is online.' }
          : { kind: 'warning', message: `${Object.keys(project.assets).length - restored} linked ${Object.keys(project.assets).length - restored === 1 ? 'file needs' : 'files need'} permission or relinking.` }
    })
  }
}

export const editorStore = new EditorStore()
export const useEditorState = (): EditorState => useSyncExternalStore(editorStore.subscribe, editorStore.getSnapshot, editorStore.getSnapshot)
