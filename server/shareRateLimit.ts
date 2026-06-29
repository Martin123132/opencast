export type ShareRateLimitOptions = {
  maxFailures: number
  windowMs: number
  cooldownMs: number
  maxTrackedKeys: number
}

export type ShareRateLimitBlocked = {
  allowed: false
  retryAfterSeconds: number
}

export type ShareRateLimitResult =
  | {
      allowed: true
    }
  | ShareRateLimitBlocked

type ShareRateLimitBucket = {
  failures: number
  windowStartedAt: number
  blockedUntil: number
}

export const shareAccessRateLimitDefaults: ShareRateLimitOptions = {
  maxFailures: 5,
  windowMs: 60 * 1000,
  cooldownMs: 5 * 60 * 1000,
  maxTrackedKeys: 1000,
}

export function createShareRateLimiter(options: Partial<ShareRateLimitOptions> = {}) {
  const settings = {
    ...shareAccessRateLimitDefaults,
    ...options,
  }
  const buckets = new Map<string, ShareRateLimitBucket>()

  function check(key: string, now = Date.now()): ShareRateLimitResult {
    pruneExpiredBuckets(now)

    const bucket = buckets.get(key)

    if (!bucket) {
      return { allowed: true }
    }

    if (bucket.blockedUntil > now) {
      return blockedResult(bucket.blockedUntil, now)
    }

    if (hasWindowExpired(bucket, now)) {
      buckets.delete(key)
    }

    return { allowed: true }
  }

  function recordFailure(key: string, now = Date.now()): ShareRateLimitResult {
    const currentStatus = check(key, now)

    if (!currentStatus.allowed) {
      return currentStatus
    }

    const bucket = buckets.get(key) ?? {
      failures: 0,
      windowStartedAt: now,
      blockedUntil: 0,
    }

    if (hasWindowExpired(bucket, now)) {
      bucket.failures = 0
      bucket.windowStartedAt = now
      bucket.blockedUntil = 0
    }

    bucket.failures += 1

    if (bucket.failures >= settings.maxFailures) {
      bucket.blockedUntil = now + settings.cooldownMs
    }

    buckets.set(key, bucket)
    trimTrackedKeys()

    if (bucket.blockedUntil > now) {
      return blockedResult(bucket.blockedUntil, now)
    }

    return { allowed: true }
  }

  function recordSuccess(key: string) {
    buckets.delete(key)
  }

  function size() {
    return buckets.size
  }

  function hasWindowExpired(bucket: ShareRateLimitBucket, now: number) {
    return bucket.blockedUntil <= now && now - bucket.windowStartedAt >= settings.windowMs
  }

  function pruneExpiredBuckets(now: number) {
    for (const [key, bucket] of buckets) {
      if (bucket.blockedUntil <= now && hasWindowExpired(bucket, now)) {
        buckets.delete(key)
      }
    }
  }

  function trimTrackedKeys() {
    while (buckets.size > settings.maxTrackedKeys) {
      const oldestKey = buckets.keys().next().value

      if (!oldestKey) {
        return
      }

      buckets.delete(oldestKey)
    }
  }

  return {
    check,
    recordFailure,
    recordSuccess,
    size,
  }
}

function blockedResult(blockedUntil: number, now: number): ShareRateLimitBlocked {
  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil((blockedUntil - now) / 1000)),
  }
}
