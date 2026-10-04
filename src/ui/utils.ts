export const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`
}

export const downloadBlob = (blob: Blob, fileName: string): void => {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const safeFileName = (name: string): string =>
  name.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ') || 'Untitled'

export async function pickMediaFiles(): Promise<{ files: File[]; handles?: FileSystemFileHandle[] }> {
  const picker = (window as typeof window & {
    showOpenFilePicker?: (options?: unknown) => Promise<FileSystemFileHandle[]>
  }).showOpenFilePicker
  if (picker) {
    const handles = await picker({
      multiple: true,
      types: [{
        description: 'Media',
        accept: {
          'video/*': ['.mp4', '.mov', '.m4v', '.webm', '.mkv'],
          'audio/*': ['.wav', '.mp3', '.aac', '.m4a', '.ogg', '.flac'],
          'image/*': ['.png', '.jpg', '.jpeg', '.webp'],
          'text/plain': ['.srt', '.vtt'],
        },
      }],
    })
    return { files: await Promise.all(handles.map((handle) => handle.getFile())), handles }
  }
  return await new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.accept = 'video/*,audio/*,image/*,.srt,.vtt'
    input.onchange = () => resolve({ files: Array.from(input.files ?? []) })
    input.click()
  })
}

export async function pickProjectFile(): Promise<File | null> {
  return await new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.edvproj,application/json,application/vnd.editdatvid.project+json'
    input.onchange = () => resolve(input.files?.[0] ?? null)
    input.click()
  })
}
