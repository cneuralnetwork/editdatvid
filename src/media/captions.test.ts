import { describe, expect, it } from 'vitest'
import { secondsToTicks } from '../domain/time'
import type { CaptionItem } from '../domain/types'
import { parseCaptionFile, serializeCaptions } from './captions'

describe('caption interchange', () => {
  it('parses SRT and ignores malformed cues', () => {
    const cues = parseCaptionFile(`1\n00:00:01,250 --> 00:00:03,500\nFirst line\nsecond line\n\n2\nnot a time --> 00:00:05,000\nSkip me`)
    expect(cues).toEqual([{ start: secondsToTicks(1.25), duration: secondsToTicks(2.25), text: 'First line\nsecond line' }])
  })

  it('parses VTT settings and serializes stable WebVTT', () => {
    const parsed = parseCaptionFile(`WEBVTT\n\nintro\n00:00:02.000 --> 00:00:04.100 align:center\nHello <b>world</b>`)
    expect(parsed[0]?.text).toBe('Hello world')
    const caption: CaptionItem = {
      id: 'caption-1', trackId: 'c1', ...parsed[0], position: 'bottom',
      style: { fontFamily: 'system-ui', fontSize: 48, color: '#fff', background: '#000a' },
    }
    expect(serializeCaptions([caption], 'vtt')).toBe('WEBVTT\n\n1\n00:00:02.000 --> 00:00:04.100\nHello world\n')
  })
})
