import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { assertDDrivePath } from '../../scripts/path-guards'

const e2eDataRoot = assertDDrivePath(
  process.env.OPENCAST_E2E_DATA_ROOT ?? 'D:\\open-source\\opencast-e2e-data',
  'OPENCAST_E2E_DATA_ROOT',
)
const screenshotRoot = path.join(
  assertDDrivePath(
    process.env.OPENCAST_E2E_ARTIFACTS ?? 'D:\\open-source\\.temp\\opencast-e2e',
    'OPENCAST_E2E_ARTIFACTS',
  ),
  'screenshots',
)

async function installRecorderStub(page: Page) {
  await page.addInitScript(() => {
    const mediaDevices = window.navigator.mediaDevices as
      & MediaDevices
      & {
        getDisplayMedia: (...args: unknown[]) => Promise<MediaStream>
        getUserMedia: (...args: unknown[]) => Promise<MediaStream>
      }

    const createDisplayStream = () => {
      const canvas = document.createElement('canvas')
      canvas.width = 640
      canvas.height = 360
      const context = canvas.getContext('2d')
      const captureStream = canvas.captureStream(30)
      const tracks = captureStream.getVideoTracks()
      const stream = new MediaStream()

      for (const track of tracks) {
        stream.addTrack(track)
      }

      let tick = 0

      const render = () => {
        if (context) {
          context.fillStyle = `hsl(${tick % 360}, 75%, 12%)`
          context.fillRect(0, 0, canvas.width, canvas.height)
          context.fillStyle = 'rgba(255, 255, 255, 0.9)'
          context.fillText(`${tick}`, 24, 40)
          tick += 1
        }

        window.requestAnimationFrame(render)
      }

      render()
      return stream
    }

    mediaDevices.getDisplayMedia = async () => createDisplayStream()
    mediaDevices.getUserMedia = async () => new MediaStream()
  })
}

test.beforeEach(async ({ request }) => {
  await waitForApiConfig(request)
  await resetE2eData()
  await deleteRecordings(request)
})

test('loads config and advances from setup into the recorder path', async ({ page }) => {
  const consoleMessages = collectConsoleIssues(page)

  await page.goto('/')
  await expect(page).toHaveTitle(/ShareFrame/)
  await expect(page.getByRole('heading', { name: 'ShareFrame' })).toBeVisible()
  await expect(page.getByText('Capture ready')).toBeVisible()
  await expect(page.getByText(e2eDataRoot)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Ready Room' })).toBeVisible()
  await expect(page.getByText('Your path: Setup, Record, Save, Share.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Complete room setup' })).toBeVisible()
  await expect(page.getByText('Set up room')).toBeVisible()
  await expect(page.getByLabel('Current guidance').getByText('Confirm the room')).toBeVisible()

  await page.getByRole('button', { name: 'Start' }).click()

  await expect(page.getByRole('heading', { name: 'Ready Room' })).toBeHidden()
  await expect(page.getByRole('button', { name: 'Record', exact: true })).toBeVisible()
  await expect(page.getByText('Start recording')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Record first take' })).toBeVisible()
  await expect(page.getByLabel('Current guidance').getByText('Choose what to capture')).toBeVisible()
  await expect(page.getByText('No recordings yet')).toBeVisible()

  await saveSmokeScreenshot(page, 'setup-transition.png')
  expect(consoleMessages()).toEqual([])
})

test('guides first-run onboarding from setup to first saved recording and share', async ({ page, request }) => {
  const consoleMessages = collectConsoleIssues(page)

  await page.goto('/')
  await page.getByRole('button', { name: 'Start' }).click()

  const firstRunTitle = 'First run take'
  await createRecording(request, firstRunTitle)
  await expect(page.getByRole('button', { name: 'Refresh' })).toBeVisible()
  await page.getByRole('button', { name: 'Refresh' }).click()

  await expect(page.getByText('No recordings yet')).toBeHidden()
  await expect(page.getByRole('button', { name: firstRunTitle })).toBeVisible()
  await expect(page.getByLabel('Current guidance').getByText('Manage the archive')).toBeVisible()
  await expect(page.getByText('Your path: Setup, Record, Save, Share.')).toBeHidden()
  await expect(
    page.getByRole('button', { name: 'Complete room setup' }),
  ).toBeHidden()

  const selected = page.getByLabel('Selected recording')
  const shareDialog = page.getByRole('dialog', { name: 'Share recording' })
  await expect(selected).toBeVisible()
  await selected.getByRole('button', { name: 'Share' }).click()
  await expect(shareDialog).toBeVisible()
  await expect(shareDialog.getByText('No shared link yet')).toBeVisible()
  await shareDialog.getByRole('button', { name: 'Create link' }).click()
  await expect(shareDialog.getByText('/s/')).toBeVisible()
  await expect(shareDialog.getByLabel('Share ready').getByText('Ready to send')).toBeVisible()
  await expect(shareDialog.getByRole('button', { name: 'Copy guest link' })).toBeVisible()

  await saveSmokeScreenshot(page, 'first-run-share-flow.png')
  expect(consoleMessages()).toEqual([])
})

test('guides first-run from record draft to save then share', async ({ page }) => {
  const consoleMessages = collectConsoleIssues(page)
  await installRecorderStub(page)

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Ready Room' })).toBeVisible()
  await page.getByRole('button', { name: 'Start' }).click()

  await expect(page.getByRole('button', { name: 'Record', exact: true })).toBeVisible()
  const phaseMeter = page.getByLabel('Capture phase meter')
  await expect(phaseMeter.locator('.phase-step.active')).toContainText('Setup')
  await page.getByRole('button', { name: 'Record', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible()
  await page.getByRole('button', { name: 'Stop' }).click()
  await expect(page.getByRole('heading', { name: 'Review' })).toBeVisible()
  await expect(phaseMeter.locator('.phase-step.active')).toContainText('Save')
  await expect(page.getByLabel('Recorder next-step hint')).toContainText(
    'Save this draft to add it to your library, or discard to retry.',
  )
  await expect(page.getByLabel('Current guidance').getByText('Save this draft')).toBeVisible()
  const draftStatus = page.getByLabel('Draft status')
  await expect(draftStatus.getByText('Unsaved local draft')).toBeVisible()
  await expect(draftStatus.getByText('Share after save')).toBeVisible()
  const reviewMomentum = page.getByLabel('Review momentum')
  await expect(reviewMomentum.getByText('Draft ready')).toBeVisible()
  await expect(reviewMomentum.getByText('Save locks this take into the library and opens sharing.')).toBeVisible()
  await expect(reviewMomentum.getByText('Preview')).toBeVisible()
  await expect(reviewMomentum.getByText('Save', { exact: true })).toBeVisible()
  await expect(reviewMomentum.getByText('Share')).toBeVisible()

  const draftTitle = 'Unsaved flow draft'
  await page.getByRole('textbox', { name: 'Title' }).fill(draftTitle)
  await saveSmokeScreenshot(page, 'review-save-momentum.png')
  await page.getByLabel('Review recording').getByRole('button', { name: 'Save & open Share' }).click()

  const shareDialog = page.getByRole('dialog', { name: 'Share recording' })
  await expect(shareDialog).toBeVisible({ timeout: 15000 })
  await expect(shareDialog.getByText('Saved. Share link ready when you are.')).toBeVisible({ timeout: 15000 })
  await expect(page.getByText('No recordings yet')).toBeHidden()
  await expect(page.getByLabel('Current guidance').getByText('Lock the link')).toBeVisible()
  await expect(page.getByRole('button', { name: draftTitle })).toBeVisible()

  const selected = page.getByLabel('Selected recording')
  await expect(selected).toBeVisible()
  await expect(shareDialog.getByText('No shared link yet')).toBeVisible()
  await shareDialog.getByRole('button', { name: 'Create link' }).click()
  await expect(shareDialog.getByText('/s/')).toBeVisible()
  const readyState = shareDialog.getByLabel('Share ready')
  await expect(readyState.getByText('Ready to send')).toBeVisible()
  await expect(readyState.getByText('Link created')).toBeVisible()
  await expect(readyState.getByText('Copy link')).toBeVisible()
  await expect(readyState.getByText('Review guest view')).toBeVisible()
  await expect(shareDialog.getByRole('button', { name: 'Copy guest link' })).toBeVisible()
  await expect(shareDialog.getByRole('button', { name: 'Update link' })).toBeVisible()
  await shareDialog.getByRole('button', { name: 'Copy guest link' }).click()
  await expect(shareDialog.getByText('Share link copied.')).toBeVisible()
  const copyButton = shareDialog.getByRole('button', { name: 'Copy link' })
  await expect(copyButton).toBeVisible()
  await copyButton.click()
  await expect(shareDialog.getByText('Share link copied.')).toBeVisible()
  await shareDialog.getByRole('button', { name: 'Close share dialog' }).click()
  await expect(shareDialog).toBeHidden()
  await expect(page.getByText('1 saved')).toBeVisible()
  await expect(page.getByRole('button', { name: draftTitle })).toBeVisible()

  await saveSmokeScreenshot(page, 'first-run-record-draft-to-share.png')
  expect(consoleMessages()).toEqual([])
})

test('confirms draft discard inline and leaves the library empty', async ({ page }) => {
  const consoleMessages = collectConsoleIssues(page)
  await installRecorderStub(page)

  await page.goto('/')
  await page.getByRole('button', { name: 'Start' }).click()
  await page.getByRole('button', { name: 'Record', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible()
  await page.getByRole('button', { name: 'Stop' }).click()

  const reviewCard = page.getByLabel('Review recording')
  await expect(reviewCard.getByRole('heading', { name: 'Review' })).toBeVisible()
  await expect(reviewCard.getByText('Unsaved local draft')).toBeVisible()
  await expect(reviewCard.getByLabel('Review momentum').getByText('Save', { exact: true })).toBeVisible()

  await reviewCard.getByRole('button', { name: 'Discard' }).click()
  await expect(reviewCard.getByText('Discard this draft?')).toBeVisible()
  await expect(reviewCard.getByRole('button', { name: 'Keep draft' })).toBeVisible()
  await reviewCard.getByRole('button', { name: 'Keep draft' }).click()
  await expect(reviewCard.getByText('Discard this draft?')).toBeHidden()
  await expect(reviewCard.getByRole('textbox', { name: 'Title' })).toBeVisible()

  await reviewCard.getByRole('button', { name: 'Discard' }).click()
  await reviewCard.getByRole('button', { name: 'Confirm discard' }).click()
  await expect(page.getByRole('heading', { name: 'Review' })).toBeHidden()
  await expect(page.getByText('No recordings yet')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Record first take' })).toBeVisible()

  await saveSmokeScreenshot(page, 'review-discard-confirmation.png')
  expect(consoleMessages()).toEqual([])
})

test('guides live recording controls through pause, resume, and discard', async ({ page }) => {
  const consoleMessages = collectConsoleIssues(page)
  await installRecorderStub(page)

  await page.goto('/')
  await page.getByRole('button', { name: 'Start' }).click()

  const captureStatus = page.getByLabel('Capture status')
  const captureInputStatus = page.getByLabel('Capture input status')
  const phaseMeter = page.getByLabel('Capture phase meter')
  await expect(captureStatus.getByText('Source: None')).toBeVisible()
  await expect(captureStatus.getByText('Mic: On')).toBeVisible()
  await expect(captureStatus.getByText('Camera: Off')).toBeVisible()
  await expect(captureStatus.getByText(/Time: 00:00/)).toBeVisible()
  await expect(captureStatus.getByText('Capture: Source required')).toBeVisible()
  await expect(captureInputStatus.getByText('Screen: Not selected')).toBeVisible()
  await expect(captureInputStatus.getByText('Mic: Enabled')).toBeVisible()
  await expect(captureInputStatus.getByText('Camera: Disabled')).toBeVisible()
  await expect(captureInputStatus.getByText('Capture: Source required')).toBeVisible()
  await expect(phaseMeter.locator('.phase-step.active')).toContainText('Setup')
  await page.getByRole('button', { name: 'Camera' }).click()
  await expect(captureStatus.getByText('Camera: On')).toBeVisible()
  await expect(captureInputStatus.getByText('Camera: Enabled')).toBeVisible()
  await page.getByRole('button', { name: 'Clear capture setup' }).click()
  await expect(captureStatus.getByText('Mic: Off')).toBeVisible()
  await expect(captureStatus.getByText('Camera: Off')).toBeVisible()
  await expect(captureInputStatus.getByText('Mic: Disabled')).toBeVisible()
  await expect(captureInputStatus.getByText('Camera: Disabled')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Clear capture setup' })).toBeHidden()
  const actionPath = page.getByLabel('Recorder action path')

  await page.getByRole('button', { name: 'Record', exact: true }).click()
  await expect(page.getByText('Get ready')).toBeVisible()
  await expect(phaseMeter.locator('.phase-step.active')).toContainText('Countdown')
  await expect(page.getByLabel('Recorder next-step hint')).toContainText(
    'Keep source and audio/video channels as-is while countdown completes.',
  )
  await expect(actionPath.getByText('Standby')).toBeVisible()
  await expect(actionPath.getByText('Cancel to adjust setup')).toBeVisible()
  await expect(captureStatus.getByText('Source: Armed')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible()

  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible()
  await page.getByRole('button', { name: 'Pause' }).click()
  await expect(page.getByLabel('Recorder next-step hint')).toContainText(
    'Resume for more time, or stop to open the review draft.',
  )
  await expect(phaseMeter.locator('.phase-step.active')).toContainText('Record')
  await expect(actionPath.getByText('Resume')).toBeVisible()
  await expect(actionPath.getByText('Stop + Review')).toBeVisible()
  await expect(page.locator('.pause-overlay').getByText('Paused')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible()

  await page.getByRole('button', { name: 'Resume' }).click()
  await expect(page.getByLabel('Recorder next-step hint')).toContainText(
    'Pause for a break, or stop when you are ready to review and save.',
  )
  await expect(phaseMeter.locator('.phase-step.active')).toContainText('Record')
  await expect(actionPath.getByText('Pause')).toBeVisible()
  await expect(actionPath.getByText('Stop + Review')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Cancel' }).click()

  await expect(page.getByRole('heading', { name: 'Review' })).toBeHidden()
  await expect(page.getByText('No recordings yet')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Record first take' })).toBeVisible()
  await expect(captureStatus.getByText('Source: None')).toBeVisible()

  await saveSmokeScreenshot(page, 'recording-controls-discard.png')
  expect(consoleMessages()).toEqual([])
})

test('shows library recordings, validates rename, and opens the share modal', async ({
  page,
  request,
}) => {
  const consoleMessages = collectConsoleIssues(page)
  await createRecording(request, 'Alpha fixture')
  const recording = await createRecording(request, 'Golden path fixture')

  await page.goto('/')
  await page.getByRole('button', { name: 'Start' }).click()

  const selected = page.getByLabel('Selected recording')
  await page.getByRole('button', { name: /Golden path fixture/ }).click()
  await expect(page.getByText('2 saved')).toBeVisible()
  await expect(selected.getByRole('textbox', { name: 'Recording title' })).toHaveValue(
    'Golden path fixture',
  )
  await expect(selected.getByLabel('Recording details').getByText('Updated')).toBeVisible()
  await expect(selected.getByLabel('Recording details').getByText('Share state')).toBeVisible()
  await expect(selected.getByLabel('Share state overview')).toBeVisible()
  const ownerPath = selected.getByLabel('Owner path')
  await expect(ownerPath.getByText('Ready to share this recording')).toBeVisible()
  await expect(ownerPath.getByRole('button', { name: 'Create guest link' })).toBeVisible()
  await expect(selected.getByText('This recording is private. Use Share and create a link when you are ready to share it.')).toBeVisible()
  await expect(selected.getByRole('button', { name: 'Rename' })).toBeDisabled()
  await expect(selected.getByLabel('Recording details').getByText('Created')).toBeVisible()
  await expect(selected.getByLabel('Recording details').getByText('Size')).toBeVisible()
  await expect(selected.getByLabel('Recording details').getByText('Views')).toBeVisible()
  await expect(selected.getByLabel('Recording details').getByText('Expiry', { exact: true })).toBeVisible()
  await expect(selected.getByLabel('Recording details').getByText('No expiry')).toBeVisible()
  await expect(
    selected.getByText('Next: create a guest link when this take is ready to share.'),
  ).toBeVisible()

  const renamedTitle = 'Golden path fixture renamed'
  const titleInput = selected.getByRole('textbox', { name: 'Recording title' })
  await titleInput.fill(renamedTitle)
  await expect(selected.getByRole('button', { name: 'Rename' })).toBeEnabled()
  await titleInput.press('Enter')
  await expect(page.getByRole('button', { name: renamedTitle })).toBeVisible()
  await expect(selected.getByRole('button', { name: 'Rename' })).toBeDisabled()

  const librarySearch = page.getByRole('textbox', { name: 'Search' })
  await expect(librarySearch).toBeVisible()
  await librarySearch.fill('renamed')
  await expect(page.getByRole('button', { name: renamedTitle })).toBeVisible()
  await librarySearch.fill('missing')
  await expect(page.getByText('No matching recordings')).toBeVisible()
  await page.getByRole('button', { name: 'Clear search' }).click()
  await expect(page.getByRole('button', { name: renamedTitle })).toBeVisible()

  const librarySort = page.getByRole('combobox', { name: 'Sort' })
  const libraryRows = page.getByLabel('Recording library').locator('.recording-row')
  await expect(librarySort).toBeVisible()
  await librarySort.selectOption('title')
  await expect(libraryRows.first()).toContainText('Alpha fixture')
  await expect(libraryRows.nth(1)).toContainText(renamedTitle)

  await page.getByRole('button', { name: 'Share' }).click()
  const shareDialog = page.getByRole('dialog', { name: 'Share recording' })
  await expect(shareDialog).toBeVisible()
  await expect(shareDialog.getByText('No shared link yet')).toBeVisible()
  await page.getByRole('button', { name: 'Create link' }).click()
  await expect(page.getByText('/s/')).toBeVisible()
  await expect(shareDialog.getByLabel('Share ready').getByText('Ready to send')).toBeVisible()
  await expect(shareDialog.getByRole('button', { name: 'Copy guest link' })).toBeVisible()
  await expect(shareDialog.getByRole('link', { name: 'View as guest' })).toBeVisible()
  await saveSmokeScreenshot(page, 'share-modal.png')

  await page.getByRole('button', { name: 'Close share dialog' }).click()
  await expect(ownerPath.getByText('Share this recording now')).toBeVisible()
  await expect(ownerPath.getByRole('button', { name: 'Copy guest link' })).toBeVisible()
  await ownerPath.getByRole('button', { name: 'Copy guest link' }).click()
  await expect(selected.getByText('Share link copied.')).toBeVisible()
  await expect(
    selected.getByText('Next: copy the guest link, review as guest, or unshare when access should end.'),
  ).toBeVisible()
  await expect(selected.getByRole('button', { name: 'Copy link' })).toBeVisible()
  await selected.getByRole('button', { name: 'Copy link' }).click()
  await expect(selected.getByText('Share link copied.')).toBeVisible()
  const selectedGuestLink = selected.getByRole('link', { name: 'View as guest' })
  await expect(selectedGuestLink).toBeVisible()
  await expect(selectedGuestLink).toHaveAttribute('href', /\/s\//)

  expect(recording.id).toBeTruthy()
  expect(consoleMessages()).toEqual([])
})

test('applies password expiry and playback-only share settings for guests', async ({
  page,
  request,
}) => {
  const consoleMessages = collectConsoleIssues(page)
  await createRecording(request, 'Protected share fixture')

  await page.goto('/')
  await page.getByRole('button', { name: 'Start' }).click()

  const selected = page.getByLabel('Selected recording')
  await selected.getByRole('button', { name: 'Share' }).click()

  const shareDialog = page.getByRole('dialog', { name: 'Share recording' })
  await expect(shareDialog).toBeVisible()
  await expect(shareDialog.getByLabel('Share settings summary').getByText('No password')).toBeVisible()
  await expect(shareDialog.getByLabel('Share settings summary').getByText('No expiry')).toBeVisible()
  await expect(shareDialog.getByLabel('Share settings summary').getByText('Downloads allowed')).toBeVisible()

  await shareDialog.getByLabel('Require password').check()
  await shareDialog.getByLabel('Share password').fill('secret-pass')
  await shareDialog.getByRole('button', { name: '24h' }).click()
  await shareDialog.getByLabel('Allow downloads').uncheck()

  await expect(shareDialog.getByLabel('Share settings summary').getByText('Password required')).toBeVisible()
  await expect(shareDialog.getByLabel('Share settings summary').getByText(/Expires/)).toBeVisible()
  await expect(shareDialog.getByLabel('Share settings summary').getByText('Playback only')).toBeVisible()

  await shareDialog.getByRole('button', { name: 'Create link' }).click()
  await expect(shareDialog.getByText('Share link active')).toBeVisible()
  await expect(shareDialog.getByLabel('Share ready').getByText('Ready to send')).toBeVisible()
  await expect(shareDialog.locator('.share-state').getByText('Password')).toBeVisible()

  const guestHref = await shareDialog.getByRole('link', { name: 'View as guest' }).getAttribute('href')
  expect(guestHref).toContain('/s/')

  await page.goto(guestHref!)
  await expect(page.getByRole('heading', { name: 'ShareFrame' })).toBeVisible()
  await expect(page.getByLabel('Password')).toBeVisible()
  await page.getByLabel('Password').fill('secret-pass')
  await page.getByRole('button', { name: 'Unlock' }).click()

  await expect(page.locator('video.shared-video')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Protected share fixture' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Download' })).toBeHidden()

  await saveSmokeScreenshot(page, 'protected-share-playback-only.png')
  expect(consoleMessages()).toEqual([])
})

test('revokes a shared link, blocks old guest links, and recreates', async ({ page, request }) => {
  const recording = await createRecording(request, 'Revoke lifecycle fixture')

  await page.goto('/')
  await page.getByRole('button', { name: 'Start' }).click()

  const selected = page.getByLabel('Selected recording')
  await selected.getByRole('button', { name: 'Share' }).click()

  const shareDialog = page.getByRole('dialog', { name: 'Share recording' })
  await expect(shareDialog).toBeVisible()
  await shareDialog.getByRole('button', { name: 'Create link' }).click()
  await expect(shareDialog.getByText('/s/')).toBeVisible()
  await expect(shareDialog.getByText('Share link active')).toBeVisible()
  await expect(shareDialog.getByLabel('Share ready').getByText('Ready to send')).toBeVisible()
  const guestHref = await shareDialog.getByRole('link', { name: 'View as guest' }).getAttribute('href')
  expect(guestHref).toContain('/s/')
  await expect(shareDialog.getByText('Public link is ready. Copy to share or unshare when access should stop.')).toBeVisible()

  await shareDialog.getByRole('button', { name: 'Unshare' }).click()
  await expect(shareDialog.getByText('Share link revoked.')).toBeVisible()
  await expect(shareDialog.getByText('This share link was revoked.')).toBeVisible()
  await expect(shareDialog.getByRole('link', { name: 'View as guest' })).toBeHidden()

  const revokedListResponse = await request.get('/api/recordings')
  const revokedList = (await revokedListResponse.json()) as {
    recordings: Array<{ id: string; shareWasRevoked: boolean; shareToken: string | null }>
  }
  const revokedRecording = revokedList.recordings.find((item) => item.id === recording.id)
  expect(revokedRecording?.shareWasRevoked).toBe(true)
  expect(revokedRecording?.shareToken).toBeNull()

  await page.goto(guestHref!)
  await expect(page.getByText('This share link is unavailable.')).toBeVisible()

  await page.goto('/')
  await page.reload()
  await expect(selected.getByLabel('Recording details').getByText('Revoked', { exact: true })).toBeVisible()
  await expect(selected.getByRole('button', { name: 'Share' })).toBeVisible()

  await selected.getByRole('button', { name: 'Share' }).click()
  await expect(shareDialog.getByText('Share link revoked')).toBeVisible()
  await expect(shareDialog.getByText('This share link was revoked.')).toBeVisible()
  await expect(shareDialog.getByRole('button', { name: 'Recreate link' })).toBeVisible()
  await shareDialog.getByRole('button', { name: 'Recreate link' }).click()
  await expect(shareDialog.getByText('/s/')).toBeVisible()
  await expect(shareDialog.getByLabel('Share ready').getByText('Ready to send')).toBeVisible()

  const recreatedHref = await shareDialog.getByRole('link', { name: 'View as guest' }).getAttribute('href')
  expect(recreatedHref).toBeTruthy()
  expect(recreatedHref).not.toBe(guestHref)

  const recreatedListResponse = await request.get('/api/recordings')
  const recreatedList = (await recreatedListResponse.json()) as {
    recordings: Array<{ id: string; shareWasRevoked: boolean; shareToken: string | null }>
  }
  const recreatedRecording = recreatedList.recordings.find((item) => item.id === recording.id)
  expect(recreatedRecording?.shareWasRevoked).toBe(false)
  expect(recreatedRecording?.shareToken).toBeTruthy()

  await page.goto(guestHref!)
  await expect(page.getByText('This share link is unavailable.')).toBeVisible()
  await page.goto(recreatedHref!)
  await expect(page.locator('.shared-video')).toBeVisible()
  await expect(page.getByText('This share link is unavailable.')).toBeHidden()
  await expect(page.getByText('This share link is no longer available.')).toBeHidden()

  await page.goto('/')
  const shareDialogVisible = await shareDialog.isVisible().catch(() => false)
  if (shareDialogVisible) {
    await shareDialog.getByRole('button', { name: 'Close share dialog' }).click()
    await expect(shareDialog).toBeHidden()
  }
  await expect(selected.getByRole('button', { name: 'Unshare' })).toBeVisible()
  await selected.getByRole('button', { name: 'Unshare' }).click()
  await expect(page.getByText('Share link revoked.')).toBeVisible()
  await expect(selected.getByRole('button', { name: 'Unshare' })).toBeHidden()

  await selected.getByRole('button', { name: 'Share' }).click()
  await expect(shareDialog.getByRole('button', { name: 'Recreate link' })).toBeVisible()
  await shareDialog.getByRole('button', { name: 'Recreate link' }).click()
  await expect(shareDialog.getByText('/s/')).toBeVisible()
  await expect(shareDialog.getByText('Share link active')).toBeVisible()
  await expect(shareDialog.getByRole('button', { name: 'Copy guest link' })).toBeVisible()
  await expect(shareDialog.getByRole('button', { name: 'Update link' })).toBeVisible()

  const reupdatedHref = await shareDialog.getByRole('link', { name: 'View as guest' }).getAttribute('href')

  await shareDialog.getByRole('button', { name: 'Update link' }).click()
  await expect(shareDialog.getByText('/s/')).toBeVisible()
  const postUpdateHref = await shareDialog.getByRole('link', { name: 'View as guest' }).getAttribute('href')
  expect(postUpdateHref).toBe(reupdatedHref)
  await shareDialog.getByRole('button', { name: 'Close share dialog' }).click()
  await expect(shareDialog).toBeHidden()
  expect(postUpdateHref).toBeTruthy()
  await page.goto(postUpdateHref!)
  await expect(page.locator('.shared-video')).toBeVisible()
  await expect(page.getByText('This share link is unavailable.')).toBeHidden()
  await expect(page.getByText('This share link is no longer available.')).toBeHidden()

  await page.goto('/')
  await saveSmokeScreenshot(page, 'share-revoke-lifecycle.png')
  expect(recording.id).toBeTruthy()
})

test('confirms delete explicitly and keeps keyboard rename flow for library recording', async ({ page, request }) => {
  const consoleMessages = collectConsoleIssues(page)

  await createRecording(request, 'Delete fixture')

  await page.goto('/')
  await page.getByRole('button', { name: 'Start' }).click()

  const selected = page.getByLabel('Selected recording')
  const titleInput = selected.getByRole('textbox', { name: 'Recording title' })
  const renameButton = selected.getByRole('button', { name: 'Rename' })
  const deleteButton = selected.getByRole('button', { name: 'Delete' })
  const keepButton = selected.getByRole('button', { name: 'Keep' })

  await expect(titleInput).toHaveValue('Delete fixture')
  await titleInput.fill('Delete fixture renamed')
  await expect(renameButton).toBeEnabled()
  await titleInput.press('Enter')
  await expect(page.getByRole('button', { name: 'Delete fixture renamed' })).toBeVisible()

  await deleteButton.click()
  await expect(selected.getByText('Delete this recording permanently?')).toBeVisible()
  await expect(keepButton).toBeVisible()
  await keepButton.click()
  await expect(selected.getByRole('button', { name: 'Delete' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Delete fixture renamed/ })).toBeVisible()

  await selected.getByRole('button', { name: 'Delete' }).click()
  await selected.getByRole('button', { name: 'Confirm delete' }).click()
  const undoButton = page.getByRole('button', { name: 'Undo' })
  await expect(undoButton).toBeVisible()
  await expect(undoButton).toBeEnabled()

  await undoButton.click()
  await expect(page.getByText('No recordings yet')).toBeHidden()
  await expect(page.getByRole('button', { name: 'Delete fixture renamed' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Undo' })).toBeHidden()
  await expect(selected.getByRole('button', { name: 'Delete' })).toBeVisible()

  await selected.getByRole('button', { name: 'Delete' }).click()
  await selected.getByRole('button', { name: 'Confirm delete' }).click()
  await expect(undoButton).toBeVisible()
  await page.waitForTimeout(4200)
  await expect(page.getByText('No recordings yet')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Record first take' })).toBeVisible()
  await expect(undoButton).toBeHidden()

  await saveSmokeScreenshot(page, 'library-delete-confirmation.png')
  expect(consoleMessages()).toEqual([])
})

test('keeps the guided path usable on a mobile viewport', async ({ page, request }) => {
  const consoleMessages = collectConsoleIssues(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await createRecording(request, 'Mobile fixture')

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'ShareFrame' })).toBeVisible()
  await expect(page.getByLabel('Workflow').getByText('Browser OK')).toBeVisible()
  await expect(page.getByLabel('Workflow').getByText('D:')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Ready Room' })).toBeVisible()
  await expect(page.getByLabel('Current guidance').getByText('Confirm the room')).toBeVisible()

  await page.getByRole('button', { name: 'Start' }).click()

  await expect(page.getByRole('heading', { name: 'Ready Room' })).toBeHidden()
  await expect(page.getByRole('button', { name: 'Record' })).toBeVisible()
  await expect(page.getByLabel('Current guidance').getByText('Manage the archive')).toBeVisible()
  await expectNoHorizontalOverflow(page)

  const mobileFixtureRow = page.getByRole('button', { name: /Mobile fixture/ })
  await mobileFixtureRow.scrollIntoViewIfNeeded()
  await expect(mobileFixtureRow).toBeVisible()
  await expect(page.getByText('1 saved')).toBeVisible()
  await expectNoHorizontalOverflow(page)

  const mobileShareButton = page.getByRole('button', { name: 'Share' })
  await mobileShareButton.scrollIntoViewIfNeeded()
  await expect(mobileShareButton).toBeVisible()
  await mobileShareButton.click()

  const mobileShareDialog = page.getByRole('dialog', { name: 'Share recording' })
  await expect(mobileShareDialog).toBeVisible()
  await expect(mobileShareDialog.getByText('No shared link yet')).toBeVisible()
  await mobileShareDialog.getByRole('button', { name: 'Create link' }).click()
  await expect(mobileShareDialog.getByText('/s/')).toBeVisible()
  await expect(mobileShareDialog.getByLabel('Share ready').getByText('Ready to send')).toBeVisible()
  await expect(mobileShareDialog.getByRole('button', { name: 'Copy guest link' })).toBeVisible()
  await expect(mobileShareDialog.getByRole('button', { name: 'Copy link' })).toBeVisible()
  const guestLink = mobileShareDialog.getByRole('link', { name: 'View as guest' })
  await expect(guestLink).toBeVisible()
  const guestHref = await guestLink.getAttribute('href')
  expect(guestHref).toContain('/s/')
  await expectNoHorizontalOverflow(page)

  await saveSmokeScreenshot(page, 'mobile-share-modal.png')

  await page.goto(guestHref!)
  await expect(page.getByRole('heading', { name: 'ShareFrame' })).toBeVisible()
  await expect(page.getByText('Shared recording')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Mobile fixture' })).toBeVisible()
  await expect(page.locator('video.shared-video')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Download' })).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await saveSmokeScreenshot(page, 'mobile-guest-share.png')
  expect(consoleMessages()).toEqual([])
})

async function resetE2eData() {
  await rm(e2eDataRoot, { force: true, recursive: true })
  await mkdir(e2eDataRoot, { recursive: true })
}

async function deleteRecordings(request: APIRequestContext) {
  const response = await request.get('/api/recordings')

  if (!response.ok()) {
    return
  }

  const body = (await response.json()) as { recordings?: Array<{ id: string }> }

  for (const recording of body.recordings ?? []) {
    await request.delete(`/api/recordings/${recording.id}`)
  }
}

async function waitForApiConfig(request: APIRequestContext) {
  const deadline = Date.now() + 15_000
  let lastError: unknown

  while (Date.now() < deadline) {
    try {
      const response = await request.get('/api/config')

      if (response.ok()) {
        const config = (await response.json()) as { dataRoot?: string }
        if (config.dataRoot === e2eDataRoot) {
          return
        }
      }
    } catch (error) {
      lastError = error
    }

    await new Promise((resolve) => setTimeout(resolve, 250))
  }

  throw new Error(`E2E API did not become ready with data root ${e2eDataRoot}: ${String(lastError)}`)
}

async function createRecording(request: APIRequestContext, title: string) {
  const response = await request.post('/api/recordings', {
    multipart: {
      title,
      durationMs: '2000',
      video: {
        name: 'fixture.webm',
        mimeType: 'video/webm',
        buffer: Buffer.from('ShareFrame E2E fixture'),
      },
    },
  })

  expect(response.ok()).toBeTruthy()
  const body = (await response.json()) as { recording: { id: string; title: string } }
  return body.recording
}

function collectConsoleIssues(page: Page) {
  const messages: string[] = []

  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      messages.push(`${message.type()}: ${message.text()}`)
    }
  })

  page.on('pageerror', (error) => {
    messages.push(`pageerror: ${error.message}`)
  })

  return () => messages
}

async function saveSmokeScreenshot(page: Page, name: string) {
  await mkdir(screenshotRoot, { recursive: true })
  await page.screenshot({ path: path.join(screenshotRoot, name), fullPage: false })
}

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    bodyScrollWidth: document.body.scrollWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }))

  expect(Math.max(dimensions.bodyScrollWidth, dimensions.documentScrollWidth)).toBeLessThanOrEqual(
    dimensions.viewportWidth + 1,
  )
}
