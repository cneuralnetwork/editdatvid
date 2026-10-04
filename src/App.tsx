import { useCallback, useEffect, useState } from 'react'
import type { MediaCapabilityReport, ProjectCatalogEntry } from './domain/types'
import { editorStore, useEditorState } from './editor/store'
import { detectCapabilities, requestPersistentStorage } from './media/capabilities'
import { projectRepository } from './storage/repository'
import { Home } from './ui/Home'
import { Workspace } from './ui/Workspace'

export default function App() {
  const editor = useEditorState()
  const [projects, setProjects] = useState<ProjectCatalogEntry[]>([])
  const [capabilities, setCapabilities] = useState<MediaCapabilityReport | null>(null)
  const [loading, setLoading] = useState(true)

  const refreshProjects = useCallback(async () => setProjects(await projectRepository.listProjects()), [])

  useEffect(() => {
    let active = true
    void Promise.all([detectCapabilities(), projectRepository.listProjects()]).then(([report, entries]) => {
      if (!active) return
      setCapabilities(report)
      setProjects(entries)
      setLoading(false)
      if (!report.persistentStorage) void requestPersistentStorage()
    }).catch(() => setLoading(false))
    return () => { active = false }
  }, [])

  useEffect(() => {
    const saveWhenHidden = () => { if (document.visibilityState === 'hidden') void editorStore.flushAutosave() }
    document.addEventListener('visibilitychange', saveWhenHidden)
    window.addEventListener('beforeunload', saveWhenHidden)
    return () => { document.removeEventListener('visibilitychange', saveWhenHidden); window.removeEventListener('beforeunload', saveWhenHidden) }
  }, [])

  if (loading) return <div className="app-loading"><svg viewBox="0 0 38 26"><path d="M2 2h17v5H8v4h9v5H8v4h11v5H2V2Zm21 0h6c5 0 7 3.5 7 11.5S34 25 29 25h-6V2Zm6 5h-1v13h1c1.5 0 2-2.1 2-6.5S30.5 7 29 7Z" /></svg><span>Opening local workspace…</span></div>

  if (window.innerWidth < 1024) return <main className="unsupported-screen"><div className="unsupported-ruler"><span /><span /><span /></div><strong>EditDatVid needs a desktop canvas.</strong><p>Open this project in Chromium on a display at least 1024 pixels wide. Your local project data has not been changed.</p><span className="unsupported-size">Current viewport: {window.innerWidth} × {window.innerHeight}</span></main>

  return editor.project ? <Workspace capabilities={capabilities} /> : <Home projects={projects} capabilities={capabilities} onRefresh={refreshProjects} />
}
