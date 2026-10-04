import type { AssetId } from '../domain/types'

type RuntimeMedia = {
  file: File
  url: string
  proxyFile?: File
  proxyUrl?: string
  useProxy: boolean
}

class MediaRegistry {
  private media = new Map<AssetId, RuntimeMedia>()

  set(assetId: AssetId, file: File): string {
    this.remove(assetId)
    const url = URL.createObjectURL(file)
    this.media.set(assetId, { file, url, useProxy: false })
    return url
  }

  setProxy(assetId: AssetId, file: File, useForPreview = true): void {
    const current = this.media.get(assetId)
    if (!current) return
    if (current.proxyUrl) URL.revokeObjectURL(current.proxyUrl)
    current.proxyFile = file
    current.proxyUrl = URL.createObjectURL(file)
    current.useProxy = useForPreview
  }

  setUseProxy(assetId: AssetId, value: boolean): void {
    const current = this.media.get(assetId)
    if (current?.proxyUrl) current.useProxy = value
  }

  clearProxy(assetId: AssetId): void {
    const current = this.media.get(assetId)
    if (!current) return
    if (current.proxyUrl) URL.revokeObjectURL(current.proxyUrl)
    current.proxyFile = undefined
    current.proxyUrl = undefined
    current.useProxy = false
  }

  get(assetId: AssetId): RuntimeMedia | undefined {
    return this.media.get(assetId)
  }

  getUrl(assetId: AssetId): string | undefined {
    const current = this.media.get(assetId)
    return current?.useProxy && current.proxyUrl ? current.proxyUrl : current?.url
  }

  getOriginalUrl(assetId: AssetId): string | undefined {
    return this.media.get(assetId)?.url
  }

  remove(assetId: AssetId): void {
    const current = this.media.get(assetId)
    if (current) {
      URL.revokeObjectURL(current.url)
      if (current.proxyUrl) URL.revokeObjectURL(current.proxyUrl)
    }
    this.media.delete(assetId)
  }

  clear(): void {
    for (const item of this.media.values()) {
      URL.revokeObjectURL(item.url)
      if (item.proxyUrl) URL.revokeObjectURL(item.proxyUrl)
    }
    this.media.clear()
  }
}

export const mediaRegistry = new MediaRegistry()
