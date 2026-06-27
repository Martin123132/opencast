import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'

const wallpaperPath = path.resolve(process.cwd(), 'src/assets/shareframe-wallpaper.png')

test('ShareFrame wallpaper asset is wired into the app shell', async () => {
  const css = await readFile(path.resolve(process.cwd(), 'src/App.css'), 'utf8')
  const asset = await readFile(wallpaperPath)
  const assetStat = await stat(wallpaperPath)

  assert.ok(css.includes('url("./assets/shareframe-wallpaper.png")'), 'app shell should reference the custom wallpaper')
  assert.ok(css.includes('rgba(245, 247, 248'), 'wallpaper should keep a readability wash over the app chrome')
  assert.ok(assetStat.size > 500_000, 'wallpaper should be a real generated bitmap, not a placeholder')
  assert.deepEqual(
    Array.from(asset.subarray(0, 8)),
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    'wallpaper should remain a PNG asset',
  )
})
