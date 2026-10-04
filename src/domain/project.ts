import { addTicks, framesToTicks, maxTick, secondsToTicks, ticks } from './time'
import {
  PROJECT_SCHEMA_VERSION,
  TICKS_PER_SECOND,
  type Asset,
  type ClipEffects,
  type ClipItem,
  type ProjectCatalogEntry,
  type ProjectDocumentV1,
  type Sequence,
  type Track,
  type TrackKind,
} from './types'

export const makeId = (prefix: string): string => `${prefix}_${crypto.randomUUID()}`

export const defaultEffects = (): ClipEffects => ({
  motion: { positionX: 0, positionY: 0, scale: 100, rotation: 0, anchorX: 50, anchorY: 50 },
  opacity: 100,
  blendMode: 'normal',
  crop: { top: 0, right: 0, bottom: 0, left: 0 },
  color: { exposure: 0, contrast: 0, highlights: 0, shadows: 0, temperature: 0, tint: 0, saturation: 100 },
  blur: 0,
  sharpen: 0,
  chromaKey: { enabled: false, color: '#00b140', similarity: 30, smoothness: 10 },
  audio: { gainDb: 0, pan: 0, fadeInTicks: '0', fadeOutTicks: '0' },
  keyframes: {},
})

const makeTrack = (kind: TrackKind, order: number): Track => ({
  id: makeId(kind[0]),
  kind,
  name: `${kind === 'video' ? 'V' : kind === 'audio' ? 'A' : 'C'}${order + 1}`,
  order,
  locked: false,
  muted: false,
  solo: false,
  visible: true,
  targeted: order === 0,
  syncLock: true,
  gainDb: 0,
  pan: 0,
  clips: [],
  captions: [],
})

export const createSequence = (name = 'Sequence 01', width = 1920, height = 1080): Sequence => {
  const id = makeId('seq')
  return {
    id,
    name,
    width,
    height,
    frameRate: { numerator: 30, denominator: 1 },
    sampleRate: 48000,
    colorSpace: 'rec709',
    masterGainDb: 0,
    durationTicks: secondsToTicks(30),
    tracks: [
      makeTrack('video', 2), makeTrack('video', 1), makeTrack('video', 0),
      makeTrack('audio', 0), makeTrack('audio', 1), makeTrack('audio', 2),
      makeTrack('caption', 0),
    ],
    markers: [],
  }
}

export const createProject = (name: string): ProjectDocumentV1 => {
  const now = new Date().toISOString()
  const sequence = createSequence()
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: makeId('project'),
    name: name.trim() || 'Untitled Project',
    createdAt: now,
    updatedAt: now,
    settings: { ticksPerSecond: TICKS_PER_SECOND, autosaveLimit: 10, workingColorSpace: 'rec709' },
    bins: [{ id: 'root', name: 'Project', parentId: null }],
    assets: {},
    sequences: { [sequence.id]: sequence },
    sequenceOrder: [sequence.id],
    activeSequenceId: sequence.id,
    workspace: {},
  }
}

export const assetToClip = (asset: Asset, trackId: string, start: string): ClipItem => {
  const duration = ticks(asset.metadata.durationTicks) > 0n ? asset.metadata.durationTicks : secondsToTicks(5)
  return {
    id: makeId('clip'),
    assetId: asset.id,
    trackId,
    name: asset.name,
    timelineStart: start,
    timelineDuration: duration,
    sourceIn: '0',
    sourceDuration: duration,
    playbackRate: 1,
    reverse: false,
    freezeFrame: false,
    enabled: true,
    linkGroupId: asset.kind === 'video' ? makeId('link') : undefined,
    label: asset.label,
    effects: defaultEffects(),
  }
}

export const recalculateSequenceDuration = (sequence: Sequence): void => {
  const clipEnds = sequence.tracks.flatMap((track) => track.clips.map((clip) => addTicks(clip.timelineStart, clip.timelineDuration)))
  const captionEnds = sequence.tracks.flatMap((track) => track.captions.map((caption) => addTicks(caption.start, caption.duration)))
  sequence.durationTicks = maxTick(framesToTicks(1, sequence.frameRate), ...clipEnds, ...captionEnds)
}

export const toCatalogEntry = (project: ProjectDocumentV1): ProjectCatalogEntry => ({
  id: project.id,
  name: project.name,
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
  durationTicks: project.sequences[project.activeSequenceId]?.durationTicks ?? '0',
  assetCount: Object.keys(project.assets).length,
})
