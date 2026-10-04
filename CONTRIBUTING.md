# Contributing to EditDatVid

Thanks for helping. EditDatVid is a local-first editor, so every change must keep one promise: **user media and edits never leave the device.** Do not add network calls, analytics, remote fonts or CDN scripts.

## Setup

```bash
git clone https://github.com/cneuralnetwork/editdatvid.git
cd editdatvid
npm install
npm run dev
```

Use a current desktop Chromium browser (Chrome, Edge, Brave).

## Project layout

| Path | Responsibility |
| --- | --- |
| `src/domain/` | Pure data model and time math. No DOM or browser APIs. Keep it unit tested. |
| `src/editor/store.ts` | All edit operations and undo/redo. UI components call the store; they do not mutate project data directly. |
| `src/media/` | Probing, codec capability checks, proxy worker, exporter, captions. |
| `src/storage/` | IndexedDB and OPFS persistence. |
| `src/ui/` | React components and dockable panels. |
| `tests/e2e/` | Playwright tests that drive real edits. |

## Before opening a pull request

- [ ] `npm test` passes
- [ ] `npm run build` passes (this also type-checks)
- [ ] `npm run test:e2e` passes if you touched editing, import, export or storage
- [ ] New domain logic has unit tests next to it (`*.test.ts`)
- [ ] No new network requests (the e2e suite fails if the app requests any non-local URL)
- [ ] Unsupported codecs stay disabled with a clear reason, never silently swapped

## Style

- TypeScript strict mode, functional React components.
- Match the existing code: compact, few comments, descriptive names.
- Keep pull requests focused on one change.

## Reporting bugs

Open an issue with your browser and version, OS, the steps to reproduce, and the media format involved (container, codec, resolution). Do not attach private footage; a short clip generated with `ffmpeg -f lavfi -i testsrc2` is ideal.
