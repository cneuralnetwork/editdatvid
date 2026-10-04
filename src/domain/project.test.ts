import { describe, expect, it } from 'vitest'
import { assetToClip, createProject, recalculateSequenceDuration } from './project'
import { secondsToTicks } from './time'
import type { Asset } from './types'

const asset: Asset = {
  id: 'asset-1', name: 'Interview.mp4', kind: 'video', binId: 'root',
  fingerprint: { name: 'Interview.mp4', size: 100, lastModified: 1, type: 'video/mp4' },
  metadata: { durationTicks: secondsToTicks(8), width: 1920, height: 1080 },
  relinkState: 'online', proxy: { state: 'none' }, createdAt: '2026-08-27T00:00:00.000Z', label: '#5f78b8',
}

describe('project graph', () => {
  it('creates the professional default sequence without floating media bytes', () => {
    const project = createProject('  Local Cut  ')
    const sequence = project.sequences[project.activeSequenceId]
    expect(project.name).toBe('Local Cut')
    expect(sequence.tracks.filter((track) => track.kind === 'video')).toHaveLength(3)
    expect(sequence.tracks.filter((track) => track.kind === 'audio')).toHaveLength(3)
    expect(sequence.tracks.filter((track) => track.kind === 'caption')).toHaveLength(1)
  })

  it('maps assets to exact timeline ranges and extends sequence duration', () => {
    const project = createProject('Cut')
    const sequence = project.sequences[project.activeSequenceId]
    const track = sequence.tracks.find((candidate) => candidate.kind === 'video')!
    const clip = assetToClip(asset, track.id, secondsToTicks(12))
    track.clips.push(clip)
    recalculateSequenceDuration(sequence)
    expect(clip.sourceDuration).toBe(secondsToTicks(8))
    expect(sequence.durationTicks).toBe(secondsToTicks(20))
  })
})
