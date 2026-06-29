import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

test('server applies privacy headers without opening public CORS', async () => {
  const serverSource = await readFile('server/index.ts', 'utf8')

  for (const fragment of [
    'X-Content-Type-Options',
    'nosniff',
    'Referrer-Policy',
    'no-referrer',
    'X-Frame-Options',
    'DENY',
    'Cross-Origin-Opener-Policy',
    'same-origin',
    'Cross-Origin-Resource-Policy',
    'X-Permitted-Cross-Domain-Policies',
    'Permissions-Policy',
    'display-capture=(self)',
  ]) {
    assert.ok(serverSource.includes(fragment), `Expected security header contract to include: ${fragment}`)
  }

  assert.doesNotMatch(
    serverSource,
    /Access-Control-Allow-Origin/i,
    'ShareFrame should not opt into cross-origin API/share access by default',
  )
})

test('private API and share responses are marked no-store', async () => {
  const serverSource = await readFile('server/index.ts', 'utf8')

  for (const fragment of [
    "reply.header('Cache-Control', 'no-store')",
    "url.startsWith('/api/')",
    "url.startsWith('/s/')",
    ".header('Cache-Control', 'no-store')",
  ]) {
    assert.ok(serverSource.includes(fragment), `Expected private cache-control contract to include: ${fragment}`)
  }
})
