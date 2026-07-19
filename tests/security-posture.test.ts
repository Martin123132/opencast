import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

test('server applies privacy headers without opening public CORS', async () => {
  const serverSource = await readFile('server/index.ts', 'utf8')

  for (const fragment of [
    'Content-Security-Policy',
    "default-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
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

test('recording uploads use the shared guardrail contract and return clear limit errors', async () => {
  const serverSource = await readFile('server/index.ts', 'utf8')

  for (const fragment of [
    'recordingGuardrails.maxRecordingBytes',
    'recordingGuardrails.maxUploadOverheadBytes',
    'isRecordingLimitError',
    'Recording is too large',
    'reply.code(413)',
  ]) {
    assert.ok(serverSource.includes(fragment), `Expected upload guardrail contract to include: ${fragment}`)
  }
})

test('public share password attempts are locally rate limited without exposing recording details', async () => {
  const serverSource = await readFile('server/index.ts', 'utf8')

  for (const fragment of [
    'createShareRateLimiter',
    'shareAccessLimiter.check',
    'shareAccessLimiter.recordFailure',
    'shareAccessLimiter.recordSuccess',
    'shareAccessRateLimited',
    'Too many password attempts. Wait before trying again.',
    'Retry-After',
    '.code(429)',
  ]) {
    assert.ok(serverSource.includes(fragment), `Expected share rate-limit contract to include: ${fragment}`)
  }

  assert.doesNotMatch(
    serverSource,
    /Too many password attempts[\s\S]*recording\.title/,
    'Rate-limit responses should not include private recording details',
  )
})
