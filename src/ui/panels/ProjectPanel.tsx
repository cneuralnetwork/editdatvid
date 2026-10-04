import { useMemo, useState } from 'react'
import { formatDuration } from '../../domain/time'
import type { Asset } from '../../domain/types'
import { editorStore, useEditorState } from '../../editor/store'
import { Icon, type IconName } from '../Icon'
import { pickMediaFiles } from '../utils'

const assetIcon = (asset: Asset): IconName => asset.kind === 'video' ? 'film' : asset.kind === 'audio' ? 'waveform' : asset.kind === 'image' ? 'image' : 'captions'

export function ProjectPanel() {
  const state = useEditorState()
  const [query, setQuery] = useState('')
  const [view, setView] = useState<'list' | 'grid'>('list')
  const [dragging, setDragging] = useState(false)
  const project = state.project
  const sequence = project?.sequences[project.activeSequenceId]
  const assets = useMemo(() => Object.values(project?.assets ?? {}).filter((asset) => asset.name.toLowerCase().includes(query.toLowerCase())), [project?.assets, query])

  const importMedia = async () => {
    try {
      const picked = await pickMediaFiles()
      await editorStore.importFiles(picked.files, picked.handles)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      editorStore.setNotice({ kind: 'error', message: error instanceof Error ? error.message : 'Could not open media picker.' })
    }
  }

  const relink = async (asset: Asset) => {
    try {
      const picked = await pickMediaFiles()
      if (picked.files[0]) await editorStore.relinkAsset(asset.id, picked.files[0], picked.handles?.[0])
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) editorStore.setNotice({ kind: 'error', message: 'Relink was not completed.' })
    }
  }

  return <div className={`panel-body project-panel ${dragging ? 'dragging' : ''}`}
    onDragOver={(event) => { event.preventDefault(); if (event.dataTransfer.types.includes('Files')) setDragging(true) }}
    onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false) }}
    onDrop={(event) => { event.preventDefault(); setDragging(false); void editorStore.importFiles(Array.from(event.dataTransfer.files)) }}>
    <div className="panel-search-row">
      <label className="search-field"><Icon name="search" size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search project" aria-label="Search project" />{query && <button onClick={() => setQuery('')} aria-label="Clear search"><Icon name="close" size={12} /></button>}</label>
      <button className="panel-tool-button" onClick={() => setView(view === 'list' ? 'grid' : 'list')} title={view === 'list' ? 'Icon view' : 'List view'}><Icon name={view === 'list' ? 'image' : 'menu'} /></button>
    </div>
    <div className="project-location"><Icon name="bin" size={14} /><span>{project?.name ?? 'Project'}</span><Icon name="chevron-down" size={11} /></div>
    <div className={`asset-browser ${view}`}>
      {sequence && <button className="asset-row sequence-row" onDoubleClick={() => editorStore.setActivePanel('timeline')}>
        <span className="asset-icon sequence-icon"><Icon name="film" /></span>
        <span className="asset-copy"><strong>{sequence.name}</strong><small>{sequence.width} × {sequence.height} · {sequence.frameRate.numerator / sequence.frameRate.denominator} fps</small></span>
        <span className="asset-duration">{formatDuration(sequence.durationTicks)}</span>
      </button>}
      {assets.map((asset) => {
        const selected = state.selectedAssetIds.includes(asset.id)
        return <button key={asset.id} className={`asset-row ${selected ? 'selected' : ''}`} draggable
          onClick={(event) => editorStore.selectAsset(asset.id, event.ctrlKey || event.metaKey)}
          onDoubleClick={() => editorStore.insertAsset(asset.id)}
          onDragStart={(event) => { event.dataTransfer.setData('application/x-editdatvid-asset', asset.id); event.dataTransfer.effectAllowed = 'copy' }}>
          <span className="asset-icon" style={{ color: asset.label }}><Icon name={assetIcon(asset)} /></span>
          <span className="asset-copy"><strong>{asset.name}</strong><small>{asset.metadata.width ? `${asset.metadata.width} × ${asset.metadata.height}` : asset.metadata.sampleRate ? `${asset.metadata.sampleRate / 1000} kHz` : asset.kind} · {asset.metadata.container ?? 'local'}</small></span>
          {asset.relinkState !== 'online' ? <span className="asset-offline" onClick={(event) => { event.stopPropagation(); void relink(asset) }}>{asset.relinkState === 'permission-needed' ? 'Allow' : 'Relink'}</span> : <span className="asset-duration">{formatDuration(asset.metadata.durationTicks)}</span>}
        </button>
      })}
      {!assets.length && <button className="project-drop-empty" onClick={() => void importMedia()}><Icon name="download" size={22} /><strong>Import media</strong><span>Choose files or drop them here</span></button>}
    </div>
    {dragging && <div className="drop-overlay"><Icon name="download" size={24} /><strong>Drop to import locally</strong></div>}
    <div className="panel-bottom-bar">
      <button className="panel-tool-button" onClick={() => void importMedia()} title="Import media"><Icon name="plus" /></button>
      <span className="panel-bottom-status">{assets.length} {assets.length === 1 ? 'item' : 'items'}</span>
      <button className="panel-tool-button" onClick={() => setView('list')} aria-pressed={view === 'list'} title="List view"><Icon name="menu" /></button>
      <button className="panel-tool-button" onClick={() => setView('grid')} aria-pressed={view === 'grid'} title="Icon view"><Icon name="image" /></button>
    </div>
  </div>
}
