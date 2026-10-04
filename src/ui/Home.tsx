import { useMemo, useState } from 'react'
import { createProject, makeId } from '../domain/project'
import { formatDuration } from '../domain/time'
import type { MediaCapabilityReport, ProjectCatalogEntry } from '../domain/types'
import { editorStore } from '../editor/store'
import { requestPersistentStorage } from '../media/capabilities'
import { projectRepository } from '../storage/repository'
import { Icon } from './Icon'
import { formatBytes, pickProjectFile } from './utils'

interface HomeProps {
  projects: ProjectCatalogEntry[]
  capabilities: MediaCapabilityReport | null
  onRefresh: () => Promise<void>
}

export function Home({ projects, capabilities, onRefresh }: HomeProps) {
  const [creating, setCreating] = useState(false)
  const [projectName, setProjectName] = useState('Untitled Project')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const storagePercent = capabilities?.quota ? Math.min(100, ((capabilities.usage / capabilities.quota) * 100)) : 0
  const updatedLabel = useMemo(() => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }), [])

  const openProject = async (id: string) => {
    setBusy(id)
    setError(null)
    try {
      const project = await projectRepository.loadProject(id)
      if (!project) throw new Error('The local project document could not be found.')
      await editorStore.open(project)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not open this project.')
    } finally {
      setBusy(null)
    }
  }

  const confirmCreate = () => {
    const project = editorStore.create(projectName)
    void projectRepository.saveProject(project, false)
    setCreating(false)
  }

  const importManifest = async () => {
    const file = await pickProjectFile()
    if (!file) return
    setBusy('import')
    try {
      const project = await projectRepository.importProject(file)
      await editorStore.open(project)
      await onRefresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The project manifest is invalid.')
    } finally {
      setBusy(null)
    }
  }

  const duplicateProject = async (event: React.MouseEvent, id: string) => {
    event.stopPropagation()
    const original = await projectRepository.loadProject(id)
    if (!original) return
    const now = new Date().toISOString()
    const duplicate = structuredClone(original)
    duplicate.id = makeId('project')
    duplicate.name = `${original.name} copy`
    duplicate.createdAt = now
    duplicate.updatedAt = now
    await projectRepository.saveProject(duplicate, false)
    await onRefresh()
  }

  const deleteProject = async (event: React.MouseEvent, id: string, name: string) => {
    event.stopPropagation()
    if (!window.confirm(`Delete “${name}” and its local cache from this browser? Source media will not be deleted.`)) return
    await projectRepository.deleteProject(id)
    await onRefresh()
  }

  return <main className="home-shell">
    <aside className="home-rail">
      <div className="brand-lockup" aria-label="EditDatVid">
        <svg className="brand-mark" viewBox="0 0 38 26" aria-hidden="true"><path d="M2 2h17v5H8v4h9v5H8v4h11v5H2V2Zm21 0h6c5 0 7 3.5 7 11.5S34 25 29 25h-6V2Zm6 5h-1v13h1c1.5 0 2-2.1 2-6.5S30.5 7 29 7Z" /></svg>
        <span>EditDatVid</span>
      </div>
      <nav className="home-nav" aria-label="Home">
        <span className="home-nav-item active" aria-current="page"><Icon name="film" /><span>Projects</span></span>
        <button className="home-nav-item" disabled title="Team storage is intentionally unavailable in this client-only editor."><Icon name="link" /><span>Shared</span></button>
      </nav>
      <div className="privacy-block">
        <div className="privacy-symbol" aria-hidden="true"><span /></div>
        <strong>Private by construction</strong>
        <p>Media and edits stay on this device. There are no accounts and no uploads.</p>
      </div>
      <div className="storage-block">
        <div className="storage-copy"><span>Browser storage</span><span>{formatBytes(capabilities?.usage ?? 0)} / {formatBytes(capabilities?.quota ?? 0)}</span></div>
        <div className="storage-track"><span style={{ width: `${storagePercent}%` }} /></div>
        {!capabilities?.persistentStorage && <button onClick={() => void requestPersistentStorage()} className="text-action">Protect local files from eviction</button>}
      </div>
    </aside>

    <section className="home-content">
      <header className="home-header">
        <div>
          <h1>Your edits, on your machine.</h1>
          <p>Open a recent project or start a clean timeline.</p>
        </div>
        <div className="home-actions">
          <button className="button secondary" onClick={() => void importManifest()} disabled={busy === 'import'}><Icon name="folder-open" />Open project file</button>
          <button className="button primary" onClick={() => setCreating(true)}><Icon name="plus" />New project</button>
        </div>
      </header>

      {error && <div className="home-error" role="alert">{error}<button onClick={() => setError(null)} aria-label="Dismiss"><Icon name="close" /></button></div>}

      <div className="project-heading"><h2>Recent projects</h2><span>{projects.length} local</span></div>
      {projects.length ? <div className="project-list" role="list">
        {projects.map((project) => <div key={project.id} role="listitem" className="project-row">
          <button className="project-open" onClick={() => void openProject(project.id)}>
            <span className="project-thumb"><span className="project-thumb-play"><Icon name="play" size={13} /></span><span className="project-thumb-stripe" /></span>
            <span className="project-main"><strong>{project.name}</strong><small>{project.assetCount} {project.assetCount === 1 ? 'asset' : 'assets'} · {formatDuration(project.durationTicks)}</small></span>
            <span className="project-updated">{updatedLabel.format(new Date(project.updatedAt))}</span>
          </button>
          <span className="project-row-actions">
            <button title="Duplicate project" onClick={(event) => void duplicateProject(event, project.id)}><Icon name="plus" /></button>
            <button title="Delete project" onClick={(event) => void deleteProject(event, project.id, project.name)}><Icon name="trash" /></button>
          </span>
          {busy === project.id && <span className="project-opening">Opening…</span>}
        </div>)}
      </div> : <button className="empty-projects" onClick={() => setCreating(true)}>
        <span className="empty-projects-art" aria-hidden="true"><span /><span /><span /></span>
        <strong>No local projects yet</strong>
        <span>Create one. Your source files stay exactly where they are.</span>
      </button>}

      <footer className="home-foot">
        <span className={capabilities?.webCodecs ? 'status-ok' : 'status-bad'}>{capabilities?.webCodecs ? 'WebCodecs ready' : 'WebCodecs unavailable'}</span>
        <span>{capabilities?.fileSystemAccess ? 'Direct file access ready' : 'File picker fallback'}</span>
        <span>{navigator.onLine ? 'App shell online' : 'Working offline'}</span>
      </footer>
    </section>

    {creating && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCreating(false) }}>
      <section className="dialog project-dialog" role="dialog" aria-modal="true" aria-labelledby="new-project-title">
        <header><h2 id="new-project-title">New project</h2><button className="icon-button" onClick={() => setCreating(false)} aria-label="Close"><Icon name="close" /></button></header>
        <div className="dialog-body">
          <label className="field-label" htmlFor="project-name">Project name</label>
          <input id="project-name" autoFocus value={projectName} onChange={(event) => setProjectName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') confirmCreate() }} />
          <div className="local-only-note"><span className="local-only-mark" /><div><strong>Saved locally</strong><p>EditDatVid stores the project manifest and cache in this browser. Export an .edvproj file for a portable backup.</p></div></div>
        </div>
        <footer><button className="button secondary" onClick={() => setCreating(false)}>Cancel</button><button className="button primary" onClick={confirmCreate}>Create project</button></footer>
      </section>
    </div>}
  </main>
}
