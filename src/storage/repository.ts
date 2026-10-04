import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { z } from 'zod'
import { PROJECT_SCHEMA_VERSION, type AssetId, type ProjectCatalogEntry, type ProjectDocumentV1, type ProjectId } from '../domain/types'
import { toCatalogEntry } from '../domain/project'

interface EditDatVidDb extends DBSchema {
  projects: { key: ProjectId; value: ProjectCatalogEntry }
  documents: { key: ProjectId; value: ProjectDocumentV1 }
  handles: { key: string; value: FileSystemFileHandle }
  settings: { key: string; value: unknown }
}

const projectEnvelopeSchema = z.object({
  format: z.literal('editdatvid-project'),
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  checksum: z.string(),
  project: z.object({
    schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
    id: z.string(),
    name: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }).passthrough(),
})

type ProjectEnvelope = {
  format: 'editdatvid-project'
  schemaVersion: 1
  checksum: string
  project: ProjectDocumentV1
}

const encode = (value: unknown): string => JSON.stringify(value, null, 2)

async function sha256(value: string): Promise<string> {
  if (!crypto.subtle) return 'checksum-unavailable'
  const bytes = new TextEncoder().encode(value)
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function makeEnvelope(project: ProjectDocumentV1): Promise<ProjectEnvelope> {
  const projectText = JSON.stringify(project)
  return {
    format: 'editdatvid-project',
    schemaVersion: PROJECT_SCHEMA_VERSION,
    checksum: await sha256(projectText),
    project,
  }
}

export class ProjectRepository {
  private dbPromise: Promise<IDBPDatabase<EditDatVidDb>> | null = null

  private db(): Promise<IDBPDatabase<EditDatVidDb>> {
    if (!this.dbPromise) {
      this.dbPromise = openDB<EditDatVidDb>('editdatvid', 1, {
        upgrade(db) {
          db.createObjectStore('projects')
          db.createObjectStore('documents')
          db.createObjectStore('handles')
          db.createObjectStore('settings')
        },
      })
    }
    return this.dbPromise
  }

  async listProjects(): Promise<ProjectCatalogEntry[]> {
    const entries = await (await this.db()).getAll('projects')
    return entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async loadProject(id: ProjectId): Promise<ProjectDocumentV1 | null> {
    const fromOpfs = await this.readCurrentFromOpfs(id).catch(() => null)
    if (fromOpfs) return fromOpfs
    return await (await this.db()).get('documents', id) ?? null
  }

  async saveProject(project: ProjectDocumentV1, autosave = true): Promise<void> {
    const db = await this.db()
    const tx = db.transaction(['projects', 'documents'], 'readwrite')
    await Promise.all([
      tx.objectStore('projects').put(toCatalogEntry(project), project.id),
      tx.objectStore('documents').put(project, project.id),
    ])
    await tx.done
    await this.writeToOpfs(project, autosave).catch(() => undefined)
  }

  async deleteProject(id: ProjectId): Promise<void> {
    const db = await this.db()
    const tx = db.transaction(['projects', 'documents', 'handles'], 'readwrite')
    await Promise.all([
      tx.objectStore('projects').delete(id),
      tx.objectStore('documents').delete(id),
    ])
    let cursor = await tx.objectStore('handles').openCursor()
    while (cursor) {
      if (String(cursor.key).startsWith(`${id}:`)) await cursor.delete()
      cursor = await cursor.continue()
    }
    await tx.done
    try {
      const root = await navigator.storage.getDirectory()
      const app = await root.getDirectoryHandle('editdatvid')
      await app.removeEntry(id, { recursive: true })
    } catch {
      // The OPFS project may not exist. IndexedDB deletion still succeeded.
    }
  }

  async storeFileHandle(projectId: ProjectId, assetId: AssetId, handle: FileSystemFileHandle): Promise<void> {
    await (await this.db()).put('handles', handle, `${projectId}:${assetId}`)
  }

  async getFileHandle(projectId: ProjectId, assetId: AssetId): Promise<FileSystemFileHandle | null> {
    return await (await this.db()).get('handles', `${projectId}:${assetId}`) ?? null
  }

  async exportProject(project: ProjectDocumentV1): Promise<Blob> {
    return new Blob([encode(await makeEnvelope(project))], { type: 'application/vnd.editdatvid.project+json' })
  }

  async importProject(file: File): Promise<ProjectDocumentV1> {
    const parsed: unknown = JSON.parse(await file.text())
    const envelope = projectEnvelopeSchema.parse(parsed)
    const project = envelope.project as unknown as ProjectDocumentV1
    const actualChecksum = await sha256(JSON.stringify(project))
    if (envelope.checksum !== 'checksum-unavailable' && actualChecksum !== envelope.checksum) {
      throw new Error('This project file failed its integrity check.')
    }
    await this.saveProject(project, false)
    return project
  }

  async clearProjectCache(id: ProjectId): Promise<void> {
    try {
      const projectDir = await this.getProjectDir(id, false)
      for (const name of ['proxies', 'thumbnails', 'waveforms', 'render-cache']) {
        await projectDir.removeEntry(name, { recursive: true }).catch(() => undefined)
      }
    } catch {
      // Cache directories are optional.
    }
  }

  async createProxyFileHandle(projectId: ProjectId, assetId: AssetId): Promise<FileSystemFileHandle> {
    const projectDir = await this.getProjectDir(projectId)
    const proxies = await projectDir.getDirectoryHandle('proxies', { create: true })
    return await proxies.getFileHandle(`${assetId}.webm`, { create: true })
  }

  async getProxyFile(projectId: ProjectId, assetId: AssetId): Promise<File | null> {
    try {
      const projectDir = await this.getProjectDir(projectId, false)
      const proxies = await projectDir.getDirectoryHandle('proxies')
      return await (await proxies.getFileHandle(`${assetId}.webm`)).getFile()
    } catch {
      return null
    }
  }

  async removeProxy(projectId: ProjectId, assetId: AssetId): Promise<void> {
    try {
      const projectDir = await this.getProjectDir(projectId, false)
      const proxies = await projectDir.getDirectoryHandle('proxies')
      await proxies.removeEntry(`${assetId}.webm`)
    } catch {
      // The partial proxy may not exist.
    }
  }

  private async getProjectDir(id: ProjectId, create = true): Promise<FileSystemDirectoryHandle> {
    const root = await navigator.storage.getDirectory()
    const app = await root.getDirectoryHandle('editdatvid', { create })
    return await app.getDirectoryHandle(id, { create })
  }

  private async writeText(directory: FileSystemDirectoryHandle, name: string, value: string): Promise<void> {
    const file = await directory.getFileHandle(name, { create: true })
    const writable = await file.createWritable()
    await writable.write(value)
    await writable.close()
  }

  private async writeToOpfs(project: ProjectDocumentV1, autosave: boolean): Promise<void> {
    if (!navigator.storage?.getDirectory) return
    const directory = await this.getProjectDir(project.id)
    const text = encode(await makeEnvelope(project))
    await this.writeText(directory, 'current.edvproj', text)
    if (!autosave) return
    const autosaves = await directory.getDirectoryHandle('autosaves', { create: true })
    const snapshotName = `${Date.now()}-${project.updatedAt.replaceAll(':', '-')}.edvproj`
    await this.writeText(autosaves, snapshotName, text)
    const names: string[] = []
    for await (const [name] of (autosaves as FileSystemDirectoryHandle & { entries(): AsyncIterableIterator<[string, FileSystemHandle]> }).entries()) names.push(name)
    names.sort().reverse()
    for (const stale of names.slice(project.settings.autosaveLimit)) await autosaves.removeEntry(stale)
  }

  private async readCurrentFromOpfs(id: ProjectId): Promise<ProjectDocumentV1 | null> {
    if (!navigator.storage?.getDirectory) return null
    const directory = await this.getProjectDir(id, false)
    const file = await (await directory.getFileHandle('current.edvproj')).getFile()
    const parsed: unknown = JSON.parse(await file.text())
    const envelope = projectEnvelopeSchema.parse(parsed)
    return envelope.project as unknown as ProjectDocumentV1
  }
}

export const projectRepository = new ProjectRepository()
