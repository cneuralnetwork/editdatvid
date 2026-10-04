import type { SVGProps } from 'react'

export type IconName =
  | 'arrow-left' | 'audio' | 'bin' | 'captions' | 'check' | 'chevron-down' | 'close' | 'download'
  | 'eye' | 'film' | 'folder-open' | 'hand' | 'image' | 'link' | 'lock' | 'marker' | 'maximize' | 'menu'
  | 'pause' | 'play' | 'plus' | 'razor' | 'redo' | 'search' | 'selection' | 'settings'
  | 'skip-back' | 'skip-forward' | 'sliders' | 'snap' | 'text' | 'trash' | 'undo' | 'unlink'
  | 'unlock' | 'video' | 'volume' | 'waveform' | 'zoom-in' | 'zoom-out'

const paths: Record<IconName, React.ReactNode> = {
  'arrow-left': <path d="M13.5 4.5 6 12l7.5 7.5M6 12h13" />,
  audio: <><path d="M5 9v6M9 6v12M13 4v16M17 8v8M21 10v4" /></>,
  bin: <><path d="M3.5 7.5h17v12h-17zM7 7.5V5h5l2 2.5" /><path d="M3.5 11h17" /></>,
  captions: <><rect x="3" y="5" width="18" height="14" rx="1" /><path d="M10 10a3 3 0 1 0 0 4M18 10a3 3 0 1 0 0 4" /></>,
  check: <path d="m5 12 4.2 4.2L19 6.5" />,
  'chevron-down': <path d="m6 9 6 6 6-6" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  download: <><path d="M12 3v12m0 0 5-5m-5 5-5-5" /><path d="M4 19h16" /></>,
  eye: <><path d="M2.5 12s3.6-6 9.5-6 9.5 6 9.5 6-3.6 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.5" /></>,
  film: <><rect x="3" y="4" width="18" height="16" rx="1" /><path d="M7 4v16M17 4v16M3 9h4m10 0h4M3 15h4m10 0h4" /></>,
  'folder-open': <path d="M3 7h7l2 2h9l-2.5 10h-15L2 9h18" />,
  hand: <path d="M8 11V6.5a1.5 1.5 0 0 1 3 0V10m0-4.5a1.5 1.5 0 0 1 3 0V10m0-3a1.5 1.5 0 0 1 3 0v4m0-2a1.5 1.5 0 0 1 3 0v4c0 5-3 8-8 8-3.2 0-5.2-1.6-7-4l-2-3a1.5 1.5 0 0 1 2.4-1.8L8 14" />,
  image: <><rect x="3" y="4" width="18" height="16" rx="1" /><circle cx="8" cy="9" r="2" /><path d="m4 18 5-5 3 3 3-4 5 6" /></>,
  link: <><path d="M10 13.5 8.5 15a3.5 3.5 0 0 1-5-5L7 6.5a3.5 3.5 0 0 1 5 0" /><path d="m14 10.5 1.5-1.5a3.5 3.5 0 0 1 5 5L17 17.5a3.5 3.5 0 0 1-5 0M8.5 12h7" /></>,
  lock: <><rect x="5" y="10" width="14" height="11" rx="1" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
  marker: <path d="M6 4h12v10l-6 6-6-6Z" />,
  maximize: <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  pause: <path d="M8 5v14M16 5v14" />,
  play: <path d="m8 5 11 7-11 7Z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  razor: <><path d="M4 18 16 5l4 4-12 9H4Z" /><path d="m11 10 4 4" /></>,
  redo: <><path d="m15 6 4 4-4 4" /><path d="M19 10h-7a6 6 0 0 0-6 6v2" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6" /><path d="m15 15 5 5" /></>,
  selection: <path d="M6 3 18 13l-6 .5L9 20Z" />,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M19 5l-2 2M7 17l-2 2" /></>,
  'skip-back': <><path d="M7 5v14" /><path d="m18 6-8 6 8 6Z" /></>,
  'skip-forward': <><path d="M17 5v14" /><path d="m6 6 8 6-8 6Z" /></>,
  sliders: <><path d="M4 7h4m4 0h8M4 12h10m4 0h2M4 17h7m4 0h5" /><circle cx="10" cy="7" r="2" /><circle cx="16" cy="12" r="2" /><circle cx="13" cy="17" r="2" /></>,
  snap: <path d="M5 4v9a7 7 0 0 0 14 0V4h-4v9a3 3 0 0 1-6 0V4Z" />,
  text: <path d="M4 5h16M12 5v14M8 19h8" />,
  trash: <><path d="M5 7h14M9 7V4h6v3M7 7l1 14h8l1-14" /><path d="M10 11v6M14 11v6" /></>,
  undo: <><path d="m9 6-4 4 4 4" /><path d="M5 10h7a6 6 0 0 1 6 6v2" /></>,
  unlink: <><path d="m10 13.5-1.5 1.5a3.5 3.5 0 0 1-5-5L7 6.5M14 10.5 15.5 9a3.5 3.5 0 0 1 5 5L17 17.5M4 4l16 16" /></>,
  unlock: <><rect x="5" y="10" width="14" height="11" rx="1" /><path d="M16 10V7a4 4 0 0 0-7.5-2" /></>,
  video: <><rect x="3" y="5" width="14" height="14" rx="1" /><path d="m17 10 4-3v10l-4-3Z" /></>,
  volume: <><path d="M4 10v4h4l5 4V6l-5 4Z" /><path d="M17 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12" /></>,
  waveform: <path d="M3 12h3l2-6 3 12 3-10 2 4h5" />,
  'zoom-in': <><circle cx="10.5" cy="10.5" r="6" /><path d="m15 15 5 5M10.5 7.5v6m-3-3h6" /></>,
  'zoom-out': <><circle cx="10.5" cy="10.5" r="6" /><path d="m15 15 5 5M7.5 10.5h6" /></>,
}

export function Icon({ name, size = 16, ...props }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name]}</svg>
}
