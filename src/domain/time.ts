import { TICKS_PER_SECOND, type RationalFrameRate, type TickString } from './types'

const TPS = BigInt(TICKS_PER_SECOND)

export const ticks = (value: TickString | bigint | number): bigint => BigInt(value)

export const secondsToTicks = (seconds: number): TickString =>
  BigInt(Math.max(0, Math.round(seconds * Number(TPS)))).toString()

export const ticksToSeconds = (value: TickString | bigint): number =>
  Number(ticks(value)) / Number(TPS)

export const framesToTicks = (frames: number, rate: RationalFrameRate): TickString =>
  ((BigInt(frames) * TPS * BigInt(rate.denominator)) / BigInt(rate.numerator)).toString()

export const ticksToFrames = (value: TickString, rate: RationalFrameRate): number =>
  Number((ticks(value) * BigInt(rate.numerator)) / (TPS * BigInt(rate.denominator)))

export const addTicks = (...values: Array<TickString | bigint>): TickString =>
  values.reduce<bigint>((total, value) => total + ticks(value), 0n).toString()

export const subtractTicks = (a: TickString | bigint, b: TickString | bigint): TickString =>
  (ticks(a) - ticks(b)).toString()

export const clampTicks = (value: TickString, min: TickString, max: TickString): TickString => {
  const parsed = ticks(value)
  return (parsed < ticks(min) ? ticks(min) : parsed > ticks(max) ? ticks(max) : parsed).toString()
}

export const formatTimecode = (value: TickString, rate: RationalFrameRate = { numerator: 30, denominator: 1 }): string => {
  const totalFrames = Math.max(0, ticksToFrames(value, rate))
  const nominal = Math.round(rate.numerator / rate.denominator)
  const frames = totalFrames % nominal
  const totalSeconds = Math.floor(totalFrames / nominal)
  const seconds = totalSeconds % 60
  const minutes = Math.floor(totalSeconds / 60) % 60
  const hours = Math.floor(totalSeconds / 3600)
  return [hours, minutes, seconds, frames].map((part) => part.toString().padStart(2, '0')).join(':')
}

export const parseTimecode = (value: string, rate: RationalFrameRate = { numerator: 30, denominator: 1 }): TickString | null => {
  const parts = value.trim().split(':').map((part) => Number(part))
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0)) return null
  const [hours, minutes, seconds, frames] = parts
  const nominal = Math.round(rate.numerator / rate.denominator)
  if (minutes > 59 || seconds > 59 || frames >= nominal) return null
  return framesToTicks((((hours * 60 + minutes) * 60 + seconds) * nominal) + frames, rate)
}

export const formatDuration = (value: TickString): string => {
  const totalSeconds = Math.max(0, Math.round(ticksToSeconds(value)))
  const seconds = totalSeconds % 60
  const minutes = Math.floor(totalSeconds / 60) % 60
  const hours = Math.floor(totalSeconds / 3600)
  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
    : `${minutes}:${seconds.toString().padStart(2, '0')}`
}

export const maxTick = (...values: TickString[]): TickString =>
  values.reduce<bigint>((max, value) => ticks(value) > max ? ticks(value) : max, 0n).toString()

export const snapToFrame = (value: TickString, rate: RationalFrameRate): TickString => {
  const frameTicks = (TPS * BigInt(rate.denominator)) / BigInt(rate.numerator)
  const current = ticks(value)
  return (((current + frameTicks / 2n) / frameTicks) * frameTicks).toString()
}
