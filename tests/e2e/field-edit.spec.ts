import { expect, test, type Locator } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

test('makes, exports, and reopens an actual local edit', async ({ page }, testInfo) => {
  test.slow()
  test.setTimeout(180_000)
  const first = testInfo.outputPath('first-camera.mp4')
  const second = testInfo.outputPath('second-camera.mp4')
  const music = testInfo.outputPath('music-bed.mp3')
  const generated = (video: string, tone: number, output: string) => execFileSync('/usr/bin/ffmpeg', [
    '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `${video}=size=320x180:rate=15`,
    '-f', 'lavfi', '-i', `sine=frequency=${tone}:sample_rate=48000`, '-t', '2.5',
    '-c:v', 'libopenh264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', output,
  ])
  generated('testsrc2', 880, first)
  generated('smptebars', 1046, second)
  execFileSync('/usr/bin/ffmpeg', [
    '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000',
    '-t', '5', '-c:a', 'libmp3lame', music,
  ])

  const errors: string[] = []
  const requests: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('request', (request) => { if (/^https?:/.test(request.url()) && !request.url().startsWith('http://127.0.0.1:4462/')) requests.push(request.url()) })
  await page.addInitScript(() => { Object.defineProperty(window, 'showOpenFilePicker', { value: undefined, configurable: true }) })
  await page.goto('/')
  await page.getByRole('button', { name: 'New project' }).click()
  await page.getByLabel('Project name').fill('Field Edit')
  await page.getByRole('button', { name: 'Create project' }).click()

  const files = page.waitForEvent('filechooser')
  await page.locator('.project-drop-empty').click()
  await (await files).setFiles([first, second, music])
  for (const name of ['first-camera.mp4', 'second-camera.mp4', 'music-bed.mp3']) {
    await expect(page.locator('.asset-row').filter({ hasText: name })).toBeVisible()
  }
  const firstAsset = page.locator('.asset-row').filter({ hasText: 'first-camera.mp4' })
  const secondAsset = page.locator('.asset-row').filter({ hasText: 'second-camera.mp4' })
  const musicAsset = page.locator('.asset-row').filter({ hasText: 'music-bed.mp3' })
  const trimEndToPlayhead = async (clip: Locator) => {
    const handle = await clip.locator('.trim-handle.end').boundingBox()
    expect(handle).not.toBeNull()
    const x = handle!.x + handle!.width / 2
    const y = handle!.y + handle!.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x - 5, y, { steps: 3 })
    await page.mouse.up()
  }

  await firstAsset.dblclick()
  await expect(page.locator('.timeline-clip.video')).toHaveCount(1)
  await expect(page.locator('.timeline-clip.audio')).toHaveCount(1)
  await page.locator('.timeline-clip.video').first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Detach Audio' }).click()
  await page.keyboard.press('Delete')
  await expect(page.locator('.timeline-clip.audio')).toHaveCount(0)

  await page.getByLabel('Current timeline timecode').fill('00:00:02:15')
  await page.getByLabel('Current timeline timecode').press('Enter')
  await trimEndToPlayhead(page.locator('.timeline-clip.video').first())
  await secondAsset.dblclick()
  await expect(page.locator('.timeline-clip.video')).toHaveCount(2)
  await page.locator('.timeline-clip.video').last().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Detach Audio' }).click()
  await page.keyboard.press('Delete')
  await expect(page.locator('.timeline-clip.audio')).toHaveCount(0)

  await page.getByLabel('Current timeline timecode').fill('00:00:05:00')
  await page.getByLabel('Current timeline timecode').press('Enter')
  await trimEndToPlayhead(page.locator('.timeline-clip.video').last())

  await page.getByLabel('Current timeline timecode').fill('00:00:00:00')
  await page.getByLabel('Current timeline timecode').press('Enter')
  await musicAsset.dblclick()
  await expect(page.locator('.timeline-clip.audio')).toHaveCount(1)
  await page.getByLabel('Current timeline timecode').fill('00:00:05:00')
  await page.getByLabel('Current timeline timecode').press('Enter')
  await trimEndToPlayhead(page.locator('.timeline-clip.audio'))
  await page.getByLabel('Current timeline timecode').fill('00:00:00:00')
  await page.getByLabel('Current timeline timecode').press('Enter')
  await page.getByTitle('Target V2').click()
  await page.locator('.flexlayout__tab_button').filter({ hasText: /^Text$/ }).click()
  await page.getByRole('button', { name: 'Add title at playhead' }).click()
  const titleInput = page.getByLabel('Title text')
  await titleInput.fill('FIELD EDIT')
  await titleInput.blur()
  await expect(page.locator('.program-title')).toContainText('FIELD EDIT')
  const transform = page.getByTestId('program-transform-box')
  const original = await transform.boundingBox()
  expect(original).not.toBeNull()
  await page.mouse.move(original!.x + original!.width / 2, original!.y + original!.height / 2)
  await page.mouse.down()
  await page.mouse.move(original!.x + original!.width / 2 + 35, original!.y + original!.height / 2 - 19, { steps: 4 })
  await page.mouse.up()
  await expect.poll(async () => (await transform.boundingBox())!.x).toBeGreaterThan(original!.x + 25)
  const southeast = transform.getByRole('button', { name: /Resize .* from SE/ })
  const handle = await southeast.boundingBox()
  await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2)
  await page.mouse.down()
  await page.mouse.move(handle!.x + 35, handle!.y + 25, { steps: 4 })
  await page.mouse.up()
  await expect.poll(async () => (await transform.boundingBox())!.width).toBeGreaterThan(original!.width)

  await page.getByLabel('Current timeline timecode').fill('00:00:01:00')
  await page.getByLabel('Current timeline timecode').press('Enter')
  await page.locator('.flexlayout__tab_button').filter({ hasText: /^Captions$/ }).click()
  await page.getByRole('button', { name: 'New caption' }).click()
  await page.locator('.captions-panel textarea').fill('Made entirely on this device.')
  await expect(page.locator('.timeline-caption')).toContainText('Made entirely on this device.')
  await page.getByLabel('Current timeline timecode').fill('00:00:01:15')
  await page.getByLabel('Current timeline timecode').press('Enter')
  await expect(page.locator('.program-media-layer')).toHaveCount(1)
  await expect(page.locator('.program-title')).toContainText('FIELD EDIT')
  await expect(page.locator('.program-audio-layer')).toHaveCount(1)
  await page.screenshot({ path: testInfo.outputPath('actual-edit-workspace.png'), fullPage: true })
  await page.locator('.program-monitor .play-control').click()
  await expect.poll(() => page.locator('.program-media-layer').evaluate((node) => (node as HTMLVideoElement).currentTime)).toBeGreaterThan(0.5)
  await page.locator('.program-monitor .play-control').click()

  const artifactDirectory = resolve('outputs/field-edit')
  mkdirSync(artifactDirectory, { recursive: true })
  await page.locator('.app-menubar').getByRole('button', { name: 'File', exact: true }).click()
  const projectDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Project File…' }).click()
  const manifest = await projectDownload
  const manifestPath = resolve(artifactDirectory, 'Field Edit.edvproj')
  await manifest.saveAs(manifestPath)
  const projectJson = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const savedSequence = projectJson.project.sequences[projectJson.project.activeSequenceId]
  expect(savedSequence.tracks.flatMap((track: { clips: unknown[] }) => track.clips)).toHaveLength(4)
  expect(Number(BigInt(savedSequence.durationTicks)) / 254016000000).toBe(5)

  await page.getByRole('tab', { name: 'Export' }).click()
  await expect(page.locator('.export-preview .program-title')).toContainText('FIELD EDIT')
  await expect(page.locator('.export-preview .program-media-layer')).toHaveCount(1)
  await page.getByRole('slider', { name: 'Export preview playhead' }).fill('90')
  await expect(page.locator('.export-preview .program-media-layer')).toHaveCount(1)
  await expect(page.locator('.export-preview .program-caption')).toHaveCount(1)
  await page.getByRole('button', { name: /WebM/ }).click()
  await page.locator('.export-detail select').selectOption('1280x720')
  const exportDownload = page.waitForEvent('download', { timeout: 120_000 })
  await page.getByRole('button', { name: 'Export to this device' }).click()
  const rendered = await exportDownload
  const renderedPath = resolve(artifactDirectory, 'Field Edit.webm')
  await rendered.saveAs(renderedPath)
  await expect(page.locator('.export-job.completed')).toBeVisible()
  const probe = JSON.parse(execFileSync('/usr/bin/ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height', '-of', 'json', renderedPath,
  ], { encoding: 'utf8' }))
  expect(Number(probe.format.duration)).toBeGreaterThan(4.9)
  expect(Number(probe.format.duration)).toBeLessThan(5.1)
  expect(probe.streams).toEqual(expect.arrayContaining([
    expect.objectContaining({ codec_type: 'video', codec_name: 'vp9', width: 1280, height: 720 }),
    expect.objectContaining({ codec_type: 'audio', codec_name: 'opus' }),
  ]))
  const frameCount = Number(execFileSync('/usr/bin/ffprobe', [
    '-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=nb_read_frames', '-of', 'default=noprint_wrappers=1:nokey=1', renderedPath,
  ], { encoding: 'utf8' }).trim())
  expect(frameCount).toBe(150)
  const decodedAudio = execFileSync('/usr/bin/ffmpeg', [
    '-v', 'error', '-i', renderedPath, '-map', '0:a:0', '-ac', '1', '-ar', '48000', '-f', 'f32le', 'pipe:1',
  ], { maxBuffer: 8 * 1024 * 1024 })
  const toneAmplitude = (startSeconds: number, frequency: number) => {
    const offset = Math.floor(startSeconds * 48000)
    let real = 0
    let imaginary = 0
    for (let index = 0; index < 48000; index += 1) {
      const sample = decodedAudio.readFloatLE((offset + index) * 4)
      const phase = 2 * Math.PI * frequency * index / 48000
      real += sample * Math.cos(phase)
      imaginary += sample * Math.sin(phase)
    }
    return Math.hypot(real, imaginary) / 48000
  }
  const musicAtFirst = toneAmplitude(1, 220)
  const musicAtSecond = toneAmplitude(3, 220)
  expect(musicAtFirst).toBeGreaterThan(0.01)
  expect(musicAtSecond).toBeGreaterThan(0.01)
  expect(toneAmplitude(1, 880)).toBeLessThan(musicAtFirst / 10)
  expect(toneAmplitude(3, 1046)).toBeLessThan(musicAtSecond / 10)

  await page.locator('.app-menubar').getByRole('button', { name: 'File', exact: true }).click()
  await page.locator('.menu-popover').getByRole('button', { name: 'Back to Projects', exact: true }).click()
  const projectChooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Open project file' }).click()
  await (await projectChooser).setFiles(manifestPath)
  await expect(page.locator('.timeline-clip')).toHaveCount(4)
  await expect(page.locator('.asset-offline')).toHaveCount(3)
  for (const [name, source] of [['first-camera.mp4', first], ['second-camera.mp4', second], ['music-bed.mp3', music]] as const) {
    const chooser = page.waitForEvent('filechooser')
    await page.locator('.asset-row').filter({ hasText: name }).locator('.asset-offline').click()
    await (await chooser).setFiles(source)
  }
  await expect(page.locator('.asset-offline')).toHaveCount(0)
  await page.getByLabel('Current timeline timecode').fill('00:00:03:00')
  await page.getByLabel('Current timeline timecode').press('Enter')
  await expect(page.locator('.program-media-layer')).toHaveCount(1)
  await expect(page.locator('.program-title')).toContainText('FIELD EDIT')
  expect(requests).toEqual([])
  expect(errors).toEqual([])
})
