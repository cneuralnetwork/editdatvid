const CACHE = 'editdatvid-shell-v2'
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).then((response) => {
      const copy = response.clone()
      caches.open(CACHE).then((cache) => cache.put('/index.html', copy))
      return response
    }).catch(() => caches.match('/index.html')))
    return
  }
  event.respondWith(caches.match(event.request).then((cached) => {
    const fresh = fetch(event.request).then((response) => {
      if (response.ok) caches.open(CACHE).then((cache) => cache.put(event.request, response.clone()))
      return response
    })
    return cached ?? fresh
  }))
})
