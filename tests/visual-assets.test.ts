import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'

const wallpaperPath = path.resolve(process.cwd(), 'src/assets/shareframe-wallpaper.png')
const guestWallpaperPath = path.resolve(process.cwd(), 'src/assets/shareframe-guest-wallpaper.png')

test('ShareFrame wallpaper asset is wired into the app shell', async () => {
  const css = await readFile(path.resolve(process.cwd(), 'src/App.css'), 'utf8')
  const asset = await readFile(wallpaperPath)
  const assetStat = await stat(wallpaperPath)
  const guestAsset = await readFile(guestWallpaperPath)
  const guestAssetStat = await stat(guestWallpaperPath)

  assert.ok(css.includes('url("./assets/shareframe-wallpaper.png")'), 'app shell should reference the custom wallpaper')
  assert.ok(
    css.includes('url("./assets/shareframe-guest-wallpaper.png")'),
    'guest share shell should reference the custom guest wallpaper',
  )
  assert.ok(css.includes('.stage'), 'recorder stage styles should stay explicit')
  assert.ok(css.includes('.stage-empty::before'), 'idle recorder stage should have a capture-frame wallpaper treatment')
  assert.ok(css.includes('rgba(245, 247, 248'), 'wallpaper should keep a readability wash over the app chrome')
  assert.ok(assetStat.size > 500_000, 'wallpaper should be a real generated bitmap, not a placeholder')
  assert.ok(guestAssetStat.size > 500_000, 'guest wallpaper should be a real generated bitmap, not a placeholder')
  assert.deepEqual(
    Array.from(asset.subarray(0, 8)),
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    'wallpaper should remain a PNG asset',
  )
  assert.deepEqual(
    Array.from(guestAsset.subarray(0, 8)),
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    'guest wallpaper should remain a PNG asset',
  )
})
