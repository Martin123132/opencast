import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createShareRateLimiter,
  shareAccessRateLimitDefaults,
} from '../server/shareRateLimit.ts'

test('share password limiter blocks repeated failures temporarily', () => {
  const limiter = createShareRateLimiter({
    maxFailures: 2,
    windowMs: 1000,
    cooldownMs: 5000,
  })

  assert.deepEqual(limiter.check('127.0.0.1:token', 1000), { allowed: true })
  assert.deepEqual(limiter.recordFailure('127.0.0.1:token', 1000), { allowed: true })

  const blocked = limiter.recordFailure('127.0.0.1:token', 1100)

  assert.equal(blocked.allowed, false)
  if (!blocked.allowed) {
    assert.equal(blocked.retryAfterSeconds, 5)
  }

  assert.equal(limiter.check('127.0.0.1:token', 6099).allowed, false)
  assert.equal(limiter.check('127.0.0.1:token', 6100).allowed, true)
})

test('share password limiter clears failed attempts after a successful unlock', () => {
  const limiter = createShareRateLimiter({
    maxFailures: 2,
    windowMs: 1000,
    cooldownMs: 5000,
  })

  assert.equal(limiter.recordFailure('127.0.0.1:token', 1000).allowed, true)
  limiter.recordSuccess('127.0.0.1:token')

  assert.equal(limiter.recordFailure('127.0.0.1:token', 1100).allowed, true)
  assert.equal(limiter.check('127.0.0.1:token', 1101).allowed, true)
})

test('share password limiter expires old windows and caps tracked keys', () => {
  const limiter = createShareRateLimiter({
    maxFailures: 3,
    maxTrackedKeys: 1,
    windowMs: 1000,
    cooldownMs: 5000,
  })

  assert.equal(shareAccessRateLimitDefaults.maxFailures, 5)
  assert.equal(limiter.recordFailure('127.0.0.1:first-token', 1000).allowed, true)
  assert.equal(limiter.recordFailure('127.0.0.1:second-token', 1001).allowed, true)
  assert.equal(limiter.size(), 1)

  assert.equal(limiter.recordFailure('127.0.0.1:second-token', 3000).allowed, true)
  assert.equal(limiter.size(), 1)
})
