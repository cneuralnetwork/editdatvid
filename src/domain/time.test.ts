import { describe, expect, it } from 'vitest'
import { addTicks, formatTimecode, framesToTicks, parseTimecode, secondsToTicks, snapToFrame, ticksToFrames, ticksToSeconds } from './time'

describe('exact project timebase', () => {
  it.each([
    { numerator: 24_000, denominator: 1001 },
    { numerator: 30_000, denominator: 1001 },
    { numerator: 60_000, denominator: 1001 },
  ])('round-trips frame boundaries at $numerator/$denominator', (rate) => {
    const value = framesToTicks(12_345, rate)
    expect(ticksToFrames(value, rate)).toBe(12_345)
    expect(snapToFrame(addTicks(value, framesToTicks(0, rate)), rate)).toBe(value)
  })

  it('preserves millisecond caption boundaries', () => {
    const value = secondsToTicks(3723.456)
    expect(ticksToSeconds(value)).toBeCloseTo(3723.456, 9)
  })

  it('formats frame-accurate non-drop timecode', () => {
    expect(formatTimecode(framesToTicks(108_015, { numerator: 30, denominator: 1 }), { numerator: 30, denominator: 1 })).toBe('01:00:00:15')
  })

  it('parses valid editor timecode and rejects impossible fields', () => {
    const rate = { numerator: 30, denominator: 1 }
    expect(parseTimecode('01:00:00:15', rate)).toBe(framesToTicks(108_015, rate))
    expect(parseTimecode('00:72:00:00', rate)).toBeNull()
    expect(parseTimecode('00:00:00:30', rate)).toBeNull()
  })
})
