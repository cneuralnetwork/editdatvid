import { useEffect, useMemo, useRef, useState } from 'react'
import { Actions, Layout, Model, type IJsonModel, type TabNode } from 'flexlayout-react'
import type { MediaCapabilityReport } from '../domain/types'
import { editorStore, useEditorState } from '../editor/store'
import { projectRepository } from '../storage/repository'
import { Icon } from './Icon'
import { ImportMode, ExportMode } from './Modes'
import { Timeline } from './Timeline'
import { downloadBlob, pickMediaFiles, safeFileName } from './utils'
import { ProjectPanel } from './panels/ProjectPanel'
import { ProgramMonitor, SourceMonitor } from './panels/MonitorPanels'
import { CaptionsPanel, ColorPanel, EffectControlsPanel, EssentialSoundPanel, MetadataPanel, PropertiesPanel, TextPanel } from './panels/InspectorPanels'
import { AudioMixerPanel, EffectsPanel, HistoryPanel, InfoPanel, MediaBrowserPanel, ScopesPanel, StoragePanel } from './panels/UtilityPanels'

const defaultLayout = (): IJsonModel => ({
  global: {
    rootOrientationVertical: true,
    splitterSize: 3,
    tabEnableClose: true,
    tabSetEnableMaximize: true,
    tabSetMinWidth: 180,
    tabSetMinHeight: 110,
  },
  borders: [],
  layout: {
    type: 'row',
    weight: 100,
    children: [
      {
        type: 'row', weight: 48,
        children: [
          { type: 'tabset', weight: 27, selected: 0, children: [
            { type: 'tab', id: 'source', name: 'Source', component: 'source' },
            { type: 'tab', id: 'effect-controls', name: 'Effect Controls', component: 'effect-controls' },
            { type: 'tab', id: 'audio-mixer', name: 'Audio Clip Mixer', component: 'audio-mixer' },
            { type: 'tab', id: 'metadata', name: 'Metadata', component: 'metadata' },
          ] },
          { type: 'tabset', weight: 50, selected: 0, children: [
            { type: 'tab', id: 'program', name: 'Program', component: 'program', enableClose: false },
          ] },
          { type: 'tabset', weight: 23, selected: 0, children: [
            { type: 'tab', id: 'properties', name: 'Properties', component: 'properties' },
            { type: 'tab', id: 'text', name: 'Text', component: 'text' },
            { type: 'tab', id: 'captions', name: 'Captions', component: 'captions' },
            { type: 'tab', id: 'color', name: 'Color', component: 'color' },
            { type: 'tab', id: 'essential-sound', name: 'Essential Sound', component: 'essential-sound' },
            { type: 'tab', id: 'scopes', name: 'Scopes', component: 'scopes' },
          ] },
        ],
      },
      {
        type: 'row', weight: 52,
        children: [
          { type: 'tabset', weight: 27, selected: 0, children: [
            { type: 'tab', id: 'project', name: 'Project', component: 'project', enableClose: false },
            { type: 'tab', id: 'media-browser', name: 'Media Browser', component: 'media-browser' },
            { type: 'tab', id: 'effects', name: 'Effects', component: 'effects' },
            { type: 'tab', id: 'info', name: 'Info', component: 'info' },
            { type: 'tab', id: 'history', name: 'History', component: 'history' },
          ] },
          { type: 'tabset', weight: 73, selected: 0, children: [
            { type: 'tab', id: 'timeline', name: 'Timeline', component: 'timeline', enableClose: false },
          ] },
        ],
      },
    ],
  },
})

function PanelHost({ id, children }: { id: string; children: React.ReactNode }) {
  return <div className={`panel-host ${id === 'timeline' ? 'timeline-host' : ''}`} onPointerDown={() => editorStore.setActivePanel(id)}>{children}</div>
}

const panelFactory = (node: TabNode): React.ReactNode => {
  const component = String(node.getComponent())
  const content: Record<string, React.ReactNode> = {
    source: <SourceMonitor />, program: <ProgramMonitor />, 'effect-controls': <EffectControlsPanel />, 'audio-mixer': <AudioMixerPanel />, metadata: <MetadataPanel />,
    project: <ProjectPanel />, 'media-browser': <MediaBrowserPanel />, effects: <EffectsPanel />, info: <InfoPanel />, history: <HistoryPanel />, timeline: <Timeline />,
    properties: <PropertiesPanel />, text: <TextPanel />, captions: <CaptionsPanel />, color: <ColorPanel />, 'essential-sound': <EssentialSoundPanel />, scopes: <ScopesPanel />, storage: <StoragePanel />,
  }
  return <PanelHost id={component}>{content[component] ?? <div className="panel-body">Panel unavailable</div>}</PanelHost>
}

type MenuName = 'file' | 'edit' | 'clip' | 'sequence' | 'markers' | 'view' | 'window' | 'help'

function TopMenu({ onHome, onResetWorkspace, onOpenSettings, onToggleMaximize }: { onHome: () => void; onResetWorkspace: () => void; onOpenSettings: () => void; onToggleMaximize: () => void }) {
  const state = useEditorState()
  const [open, setOpen] = useState<MenuName | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const project = state.project!

  useEffect(() => {
    const close = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(null) }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [])

  const importMedia = async () => {
    setOpen(null)
    try { const picked = await pickMediaFiles(); await editorStore.importFiles(picked.files, picked.handles) } catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) editorStore.setNotice({ kind: 'error', message: 'Import was not completed.' }) }
  }
  const exportManifest = async () => {
    setOpen(null)
    await editorStore.flushAutosave()
    downloadBlob(await projectRepository.exportProject(project), `${safeFileName(project.name)}.edvproj`)
    editorStore.setNotice({ kind: 'success', message: 'Portable project manifest downloaded.' })
  }
  const item = (label: string, action: () => void, shortcut?: string, disabled = false) => <button disabled={disabled} onClick={() => { setOpen(null); action() }}><span>{label}</span>{shortcut && <kbd>{shortcut}</kbd>}</button>
  const menus: Record<MenuName, React.ReactNode> = {
    file: <>{item('Back to Projects', onHome)}<hr />{item('Import…', () => void importMedia(), 'Ctrl+I')}{item('Save', () => void editorStore.flushAutosave(), 'Ctrl+S')}{item('Export Project File…', () => void exportManifest())}<hr />{item('Project Settings…', onOpenSettings)}</>,
    edit: <>{item('Undo', () => editorStore.undo(), 'Ctrl+Z', !editorStore.canUndo())}{item('Redo', () => editorStore.redo(), 'Ctrl+Shift+Z', !editorStore.canRedo())}<hr />{item('Cut', () => editorStore.cutSelected(), 'Ctrl+X', !state.selectedClipIds.length)}{item('Copy', () => editorStore.copySelected(), 'Ctrl+C', !state.selectedClipIds.length)}{item('Paste', () => editorStore.pasteClipboard(), 'Ctrl+V', !editorStore.canPaste())}{item('Duplicate', () => editorStore.duplicateSelected(), 'Ctrl+Shift+/', !state.selectedClipIds.length)}<hr />{item('Delete', () => editorStore.deleteSelected(false), 'Delete', !state.selectedClipIds.length)}{item('Ripple Delete', () => editorStore.deleteSelected(true), 'Shift+Delete', !state.selectedClipIds.length)}</>,
    clip: <>{item('Add Edit', () => editorStore.splitSelected(), 'Ctrl+K', !state.selectedClipIds.length)}{item('Link', () => editorStore.linkSelected(), undefined, state.selectedClipIds.length < 2)}{item('Unlink', () => editorStore.unlinkSelected(), undefined, !state.selectedClipIds.length)}{item('Enable / Disable', () => editorStore.toggleSelectedEnabled(), undefined, !state.selectedClipIds.length)}<hr />{item('Add Cross Dissolve', () => editorStore.applyTransition('in', 'cross-dissolve'), 'Ctrl+D', !state.selectedClipIds.length)}{item('Reverse Speed', () => editorStore.toggleClipFlag('reverse'), undefined, !state.selectedClipIds.length)}{item('Freeze Frame', () => editorStore.toggleClipFlag('freezeFrame'), undefined, !state.selectedClipIds.length)}</>,
    sequence: <>{item('New Sequence', () => editorStore.addSequence(), 'Ctrl+N')}{item('Add Caption', () => editorStore.addCaption())}{item('Export Media…', () => editorStore.setMode('export'), 'Ctrl+M')}</>,
    markers: <>{item('Add Marker', () => editorStore.addMarker(), 'M')}{item('Set In Point', () => editorStore.setSequencePoint('in'), 'I')}{item('Set Out Point', () => editorStore.setSequencePoint('out'), 'O')}</>,
    view: <>{item('Zoom In Timeline', () => editorStore.setTimelineZoom(state.timelineZoom * 1.25), '+')}{item('Zoom Out Timeline', () => editorStore.setTimelineZoom(state.timelineZoom / 1.25), '−')}{item('Toggle Snapping', () => editorStore.toggleSnapping(), 'S')}{item('Full Screen Active Panel', onToggleMaximize, '`')}</>,
    window: <>{item('Reset to Saved Layout', onResetWorkspace)}<hr />{item('Project', () => editorStore.setActivePanel('project'), 'Shift+1')}{item('Effect Controls', () => editorStore.setActivePanel('effect-controls'), 'Shift+5')}{item('Effects', () => editorStore.setActivePanel('effects'), 'Shift+7')}{item('Media Browser', () => editorStore.setActivePanel('media-browser'), 'Shift+8')}</>,
    help: <>{item('Privacy Contract', () => editorStore.setNotice({ kind: 'info', message: 'EditDatVid has no upload, account, analytics, or server project path.' }))}{item('Browser Capabilities', onOpenSettings)}{item('About EditDatVid', () => editorStore.setNotice({ kind: 'info', message: 'EditDatVid v0.1 · Browser-native editing core.' }))}</>,
  }
  return <div className="app-menubar" ref={rootRef}>
    <button className="menu-brand" onClick={onHome} aria-label="Back to projects"><svg viewBox="0 0 32 22"><path d="M1 1h15v4H6v4h8v4H6v4h10v4H1V1Zm19 0h5c4 0 6 3 6 10s-2 10-6 10h-5V1Zm5 4h-1v13h1c1 0 2-2 2-7s-1-7-2-7Z" /></svg></button>
    <div className="menu-items">{(Object.keys(menus) as MenuName[]).map((name) => <div key={name} className="menu-root"><button className={open === name ? 'open' : ''} onClick={() => setOpen(open === name ? null : name)}>{name[0].toUpperCase() + name.slice(1)}</button>{open === name && <div className="menu-popover">{menus[name]}</div>}</div>)}</div>
    <div className="project-title-control"><span>{project.name}</span>{state.dirty && <i title="Unsaved local changes" />}</div>
    <div className="workspace-modes" role="tablist" aria-label="Workspace mode"><button role="tab" aria-selected={state.mode === 'import'} onClick={() => editorStore.setMode('import')}>Import</button><button role="tab" aria-selected={state.mode === 'edit'} onClick={() => editorStore.setMode('edit')}>Edit</button><button role="tab" aria-selected={state.mode === 'export'} onClick={() => editorStore.setMode('export')}>Export</button></div>
    <div className="menu-status"><span className="local-status-dot" /><span>Local</span><button onClick={onOpenSettings} title="Project settings"><Icon name="settings" /></button></div>
  </div>
}

function ProjectSettings({ capabilities, onClose }: { capabilities: MediaCapabilityReport | null; onClose: () => void }) {
  const state = useEditorState()
  const project = state.project!
  const [name, setName] = useState(project.name)
  const usagePercent = capabilities?.quota ? capabilities.usage / capabilities.quota * 100 : 0
  return <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="dialog settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title"><header><h2 id="settings-title">Project settings</h2><button className="icon-button" onClick={onClose}><Icon name="close" /></button></header><div className="settings-layout"><nav><span className="active">General</span><button onClick={() => editorStore.setNotice({ kind: 'info', message: 'Scratch storage is managed in this browser.' })}>Scratch storage</button><button onClick={() => editorStore.setNotice({ kind: 'info', message: 'Codec support is detected from this browser and operating system.' })}>Capabilities</button></nav><div className="settings-content"><label className="field-label">Project name<input value={name} onChange={(event) => setName(event.target.value)} /></label><div className="settings-grid"><div><span>Working color space</span><strong>Rec. 709 SDR</strong></div><div><span>Autosave snapshots</span><strong>10 versions</strong></div><div><span>Project timebase</span><strong>254,016,000,000 ticks/s</strong></div><div><span>Media handling</span><strong>Link in place</strong></div></div><section className="storage-summary"><div><strong>Browser storage</strong><span>{usagePercent.toFixed(1)}% used</span></div><div className="storage-track"><span style={{ width: `${Math.min(100, usagePercent)}%` }} /></div><p>Clearing site data removes browser-managed project caches. Source media remains untouched.</p><button className="button secondary compact" onClick={() => void editorStore.clearGeneratedCache()}>Clear generated cache</button></section><section className="capability-summary"><span className={capabilities?.webCodecs ? 'ready' : ''}>WebCodecs</span><span className={capabilities?.opfs ? 'ready' : ''}>OPFS</span><span className={capabilities?.webgl2 ? 'ready' : ''}>WebGL 2</span><span className={capabilities?.crossOriginIsolated ? 'ready' : ''}>Thread isolation</span></section></div></div><footer><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" onClick={() => { editorStore.renameProject(name); onClose() }}>Save settings</button></footer></section></div>
}

export function Workspace({ capabilities }: { capabilities: MediaCapabilityReport | null }) {
  const state = useEditorState()
  const project = state.project!
  const [resetVersion, setResetVersion] = useState(0)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const savedLayout = project.workspace.flexLayout as IJsonModel | undefined
  const model = useMemo(() => {
    try { return Model.fromJson(resetVersion === 0 && savedLayout ? savedLayout : defaultLayout()) }
    catch { return Model.fromJson(defaultLayout()) }
  }, [project.id, resetVersion])
  const toggleMaximize = () => {
    const tabset = model.getMaximizedTabset() ?? model.getActiveTabset() ?? model.getFirstTabSet()
    model.doAction(Actions.maximizeToggle(tabset.getId()))
  }

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (target.matches('input, textarea, select, [contenteditable="true"]')) return
      const mod = event.ctrlKey || event.metaKey
      if (mod && event.key.toLowerCase() === 's') { event.preventDefault(); void editorStore.flushAutosave(); return }
      if (mod && event.key.toLowerCase() === 'i') { event.preventDefault(); editorStore.setMode('import'); return }
      if (mod && event.key.toLowerCase() === 'm') { event.preventDefault(); editorStore.setMode('export'); return }
      if (mod && event.key.toLowerCase() === 'k') { event.preventDefault(); editorStore.splitSelected(); return }
      if (mod && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? editorStore.redo() : editorStore.undo(); return }
      if (mod && event.key.toLowerCase() === 'x') { event.preventDefault(); editorStore.cutSelected(); return }
      if (mod && event.key.toLowerCase() === 'c') { if (state.selectedClipIds.length) { event.preventDefault(); editorStore.copySelected() }; return }
      if (mod && event.key.toLowerCase() === 'v') { event.preventDefault(); editorStore.pasteClipboard(); return }
      if (mod && event.shiftKey && event.code === 'Slash') { event.preventDefault(); editorStore.duplicateSelected(); return }
      if (mod && event.key.toLowerCase() === 'd') { event.preventDefault(); editorStore.applyTransition('in', 'cross-dissolve'); return }
      if (event.key === ' ') { event.preventDefault(); editorStore.togglePlayback(); return }
      if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); editorStore.deleteSelected(event.shiftKey); return }
      if (event.key === '`' || event.key === '~') { event.preventDefault(); toggleMaximize(); return }
      if (event.key.toLowerCase() === 'k') { editorStore.setPlaying(false); editorStore.setPlaybackRate(1); return }
      if (event.key.toLowerCase() === 'j') { editorStore.setPlaybackRate(state.playbackRate < 0 ? Math.max(-8, state.playbackRate * 2) : -1); editorStore.setPlaying(true); return }
      if (event.key.toLowerCase() === 'l') { editorStore.setPlaybackRate(state.playbackRate > 0 ? Math.min(8, state.playbackRate * 2) : 1); editorStore.setPlaying(true); return }
      if (event.key.toLowerCase() === 'm') { editorStore.addMarker(); return }
      if (event.key.toLowerCase() === 'i') { editorStore.setSequencePoint('in'); return }
      if (event.key.toLowerCase() === 'o') { editorStore.setSequencePoint('out'); return }
      if (event.key.toLowerCase() === 's') { editorStore.toggleSnapping(); return }
      if (event.key === '+' || event.key === '=') { editorStore.setTimelineZoom(state.timelineZoom * 1.25); return }
      if (event.key === '-') { editorStore.setTimelineZoom(state.timelineZoom / 1.25); return }
      const tool = { v: 'selection', a: 'track-select', b: 'ripple', n: 'rolling', r: 'rate', c: 'razor', y: 'slip', u: 'slide', h: 'hand', z: 'zoom', t: 'type' }[event.key.toLowerCase()]
      if (tool) editorStore.setTool(tool as Parameters<typeof editorStore.setTool>[0])
    }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [state.timelineZoom, state.playbackRate, state.selectedClipIds.length, model])

  useEffect(() => {
    if (!state.notice || state.notice.kind === 'error') return
    const timeout = window.setTimeout(() => editorStore.setNotice(), state.notice.kind === 'warning' ? 6500 : 4200)
    return () => window.clearTimeout(timeout)
  }, [state.notice])

  const goHome = () => {
    if (state.dirty) void editorStore.flushAutosave()
    editorStore.close()
  }

  return <main className="editor-shell">
    <TopMenu onHome={goHome} onResetWorkspace={() => setResetVersion((value) => value + 1)} onOpenSettings={() => setSettingsOpen(true)} onToggleMaximize={toggleMaximize} />
    <div className="mode-content">
      {state.mode === 'import' ? <ImportMode /> : state.mode === 'export' ? <ExportMode capabilities={capabilities} /> : <div className="edit-workspace"><Layout model={model} factory={panelFactory} onModelChange={(changedModel) => editorStore.setWorkspaceLayout(changedModel.toJson())} /></div>}
    </div>
    <div className="app-statusbar"><span><Icon name={state.isPlaying ? 'play' : 'pause'} size={11} />{state.isPlaying ? `${state.playbackRate}× playback` : 'Ready'}</span><span>{Object.values(project.assets).filter((asset) => asset.relinkState !== 'online').length ? 'Media needs attention' : 'All media local'}</span><span>Rec. 709</span><span className="status-spacer" /><span>{state.dirty ? 'Autosave pending…' : 'Saved locally'}</span></div>
    {state.notice && <div className={`notice-toast ${state.notice.kind} ${state.mode}`} role="status"><span>{state.notice.message}</span><button onClick={() => editorStore.setNotice()} aria-label="Dismiss"><Icon name="close" size={12} /></button></div>}
    {settingsOpen && <ProjectSettings capabilities={capabilities} onClose={() => setSettingsOpen(false)} />}
  </main>
}
