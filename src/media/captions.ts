import { addTicks, secondsToTicks, ticksToSeconds } from '../domain/time'
import type { CaptionItem } from '../domain/types'

export interface ParsedCaptionCue {
  start: string
  duration: string
  text: string
}

const parseTimestamp = (value: string): number | null => {
  const normalized = value.trim().replace(',', '.')
  const parts = normalized.split(':')
  if (parts.length < 2 || parts.length > 3) return null
  const seconds = Number(parts.pop())
  const minutes = Number(parts.pop())
  const hours = parts.length ? Number(parts.pop()) : 0
  if (![hours, minutes, seconds].every(Number.isFinite)) return null
  return hours * 3600 + minutes * 60 + seconds
}

const cleanCueText = (lines: string[]): string => lines
  .join('\n')
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<[^>]+>/g, '')
  .trim()

export const parseCaptionFile = (source: string): ParsedCaptionCue[] => {
  const blocks = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split(/\n{2,}/)
  const cues: ParsedCaptionCue[] = []
  for (const block of blocks) {
    const lines = block.split('\n').map((line) => line.trimEnd())
    if (!lines.length || /^WEBVTT(?:\s|$)/i.test(lines[0]) || /^(NOTE|STYLE|REGION)(?:\s|$)/i.test(lines[0])) continue
    const timingIndex = lines.findIndex((line) => line.includes('-->'))
    if (timingIndex < 0) continue
    const [rawStart, rawEndWithSettings] = lines[timingIndex].split(/\s+-->\s+/)
    const rawEnd = rawEndWithSettings?.split(/\s+/)[0]
    const startSeconds = parseTimestamp(rawStart)
    const endSeconds = rawEnd ? parseTimestamp(rawEnd) : null
    const text = cleanCueText(lines.slice(timingIndex + 1))
    if (startSeconds === null || endSeconds === null || endSeconds <= startSeconds || !text) continue
    cues.push({
      start: secondsToTicks(startSeconds),
      duration: secondsToTicks(endSeconds - startSeconds),
      text,
    })
  }
  return cues.sort((a, b) => Number(BigInt(a.start) - BigInt(b.start)))
}

const formatTimestamp = (seconds: number, separator: ',' | '.'): string => {
  const totalMilliseconds = Math.max(0, Math.round(seconds * 1000))
  const milliseconds = totalMilliseconds % 1000
  const totalSeconds = Math.floor(totalMilliseconds / 1000)
  const secs = totalSeconds % 60
  const minutes = Math.floor(totalSeconds / 60) % 60
  const hours = Math.floor(totalSeconds / 3600)
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}${separator}${milliseconds.toString().padStart(3, '0')}`
}

export const serializeCaptions = (captions: CaptionItem[], format: 'srt' | 'vtt'): string => {
  const ordered = [...captions].sort((a, b) => Number(BigInt(a.start) - BigInt(b.start)))
  const separator = format === 'srt' ? ',' : '.'
  const body = ordered.map((caption, index) => {
    const start = formatTimestamp(ticksToSeconds(caption.start), separator)
    const end = formatTimestamp(ticksToSeconds(addTicks(caption.start, caption.duration)), separator)
    return `${index + 1}\n${start} --> ${end}\n${caption.text.trim()}`
  }).join('\n\n')
  return `${format === 'vtt' ? 'WEBVTT\n\n' : ''}${body}${body ? '\n' : ''}`
}
