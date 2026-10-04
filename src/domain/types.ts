export const PROJECT_SCHEMA_VERSION = 1 as const
export const TICKS_PER_SECOND = '254016000000'

export type ProjectId = string
export type AssetId = string
export type SequenceId = string
export type TrackId = string
export type ClipId = string
export type TickString = string

export type AssetKind = 'video' | 'audio' | 'image' | 'caption'
export type TrackKind = 'video' | 'audio' | 'caption'
export type EditorTool = 'selection' | 'track-select' | 'razor' | 'ripple' | 'rolling' | 'rate' | 'slip' | 'slide' | 'hand' | 'zoom' | 'type'
export type WorkspaceMode = 'import' | 'edit' | 'export'
export type PreviewQuality = 'auto' | 'full' | 'half' | 'quarter'
export type Interpolation = 'linear' | 'hold' | 'ease-in' | 'ease-out'

export interface RationalFrameRate {
  numerator: number
  denominator: number
}

export interface AssetFingerprint {
  name: string
  size: number
  lastModified: number
  type: string
  sampleHash?: string
}

export interface MediaMetadata {
  durationTicks: TickString
  width?: number
  height?: number
  frameRate?: RationalFrameRate
  sampleRate?: number
  channels?: number
  videoCodec?: string
  audioCodec?: string
  container?: string
  rotation?: number
}

export interface ProxyDescriptor {
  state: 'none' | 'queued' | 'generating' | 'ready' | 'failed'
  height?: 720 | 1080
  progress?: number
  fileName?: string
  useForPreview?: boolean
  error?: string
}

export interface Asset {
  id: AssetId
  name: string
  kind: AssetKind
  binId: string
  fingerprint: AssetFingerprint
  metadata: MediaMetadata
  relinkState: 'online' | 'permission-needed' | 'missing'
  proxy: ProxyDescriptor
  createdAt: string
  label: string
}

export interface Bin {
  id: string
  name: string
  parentId: string | null
}

export interface Keyframe {
  id: string
  at: TickString
  value: number
  interpolation: Interpolation
}

export interface ClipEffects {
  motion: {
    positionX: number
    positionY: number
    scale: number
    rotation: number
    anchorX: number
    anchorY: number
  }
  opacity: number
  blendMode: 'normal' | 'multiply' | 'screen' | 'overlay'
  crop: { top: number; right: number; bottom: number; left: number }
  color: {
    exposure: number
    contrast: number
    highlights: number
    shadows: number
    temperature: number
    tint: number
    saturation: number
  }
  blur: number
  sharpen: number
  chromaKey: { enabled: boolean; color: string; similarity: number; smoothness: number }
  audio: { gainDb: number; pan: number; fadeInTicks: TickString; fadeOutTicks: TickString }
  keyframes: Record<string, Keyframe[]>
}

export interface ClipItem {
  id: ClipId
  assetId: AssetId
  trackId: TrackId
  name: string
  timelineStart: TickString
  timelineDuration: TickString
  sourceIn: TickString
  sourceDuration: TickString
  playbackRate: number
  reverse: boolean
  freezeFrame: boolean
  enabled?: boolean
  titleText?: string
  linkGroupId?: string
  label: string
  effects: ClipEffects
  transitionIn?: 'cross-dissolve' | 'dip-black' | 'wipe'
  transitionOut?: 'cross-dissolve' | 'dip-black' | 'wipe'
}

export interface CaptionItem {
  id: string
  trackId: TrackId
  start: TickString
  duration: TickString
  text: string
  position: 'top' | 'center' | 'bottom'
  style: { fontFamily: string; fontSize: number; color: string; background: string }
}

export interface Track {
  id: TrackId
  kind: TrackKind
  name: string
  order: number
  locked: boolean
  muted: boolean
  solo: boolean
  visible: boolean
  targeted: boolean
  syncLock: boolean
  gainDb?: number
  pan?: number
  clips: ClipItem[]
  captions: CaptionItem[]
}

export interface Sequence {
  id: SequenceId
  name: string
  width: number
  height: number
  frameRate: RationalFrameRate
  sampleRate: number
  colorSpace: 'rec709'
  masterGainDb?: number
  durationTicks: TickString
  tracks: Track[]
  markers: Array<{ id: string; at: TickString; name: string; color: string }>
  inPoint?: TickString
  outPoint?: TickString
}

export interface WorkspaceLayout {
  flexLayout?: unknown
  activePanel?: string
  savedAt?: string
}

export interface ProjectDocumentV1 {
  schemaVersion: typeof PROJECT_SCHEMA_VERSION
  id: ProjectId
  name: string
  createdAt: string
  updatedAt: string
  settings: {
    ticksPerSecond: typeof TICKS_PER_SECOND
    autosaveLimit: 10
    workingColorSpace: 'rec709'
  }
  bins: Bin[]
  assets: Record<AssetId, Asset>
  sequences: Record<SequenceId, Sequence>
  sequenceOrder: SequenceId[]
  activeSequenceId: SequenceId
  workspace: WorkspaceLayout
}

export interface ProjectCatalogEntry {
  id: ProjectId
  name: string
  createdAt: string
  updatedAt: string
  durationTicks: TickString
  assetCount: number
  thumbnail?: string
}

export interface EditorCommand<T = unknown> {
  id: string
  type: string
  payload: T
  transactionId: string
  affectedEntities: string[]
  createdAt: string
}

export interface MediaCapabilityReport {
  secureContext: boolean
  crossOriginIsolated: boolean
  webCodecs: boolean
  audioEncoder: boolean
  videoEncoder: boolean
  offscreenCanvas: boolean
  webgl2: boolean
  audioWorklet: boolean
  opfs: boolean
  fileSystemAccess: boolean
  persistentStorage: boolean
  usage: number
  quota: number
  encoders: Record<string, boolean>
  decoders: Record<string, boolean>
}

export type ExportFormat = 'mp4-h264' | 'webm-vp9' | 'wav' | 'mp3' | 'png-sequence' | 'jpeg-sequence'
export type ExportJobStatus = 'queued' | 'analyzing' | 'rendering' | 'muxing' | 'writing' | 'completed' | 'cancelled' | 'failed'

export interface ExportPreset {
  id: string
  name: string
  format: ExportFormat
  width: number
  height: number
  frameRate: RationalFrameRate
  videoBitrate?: number
  audioBitrate?: number
  sampleRate: number
  channels: 1 | 2
}

export interface ExportJob {
  id: string
  projectId: ProjectId
  sequenceId: SequenceId
  preset: ExportPreset
  outputName: string
  status: ExportJobStatus
  progress: number
  renderedFrames: number
  totalFrames: number
  startedAt?: string
  completedAt?: string
  elapsedMs: number
  etaMs?: number
  error?: string
  outputUrl?: string
}

export interface EditorState {
  project: ProjectDocumentV1 | null
  mode: WorkspaceMode
  activeTool: EditorTool
  previewQuality: PreviewQuality
  currentTime: TickString
  selectedClipIds: ClipId[]
  selectedAssetIds: AssetId[]
  activePanel: string
  isPlaying: boolean
  playbackRate: number
  snapping: boolean
  linkedSelection: boolean
  timelineZoom: number
  exportJobs: ExportJob[]
  commandLog: EditorCommand[]
  dirty: boolean
  notice?: { kind: 'info' | 'warning' | 'error' | 'success'; message: string }
}
