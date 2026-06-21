import { randomBytes, timingSafeEqual, createHmac, scrypt as scryptCallback } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { storagePaths } from './config.js'
import type { Recording } from './store.js'

const scrypt = promisify(scryptCallback)
const accessTokenTtlMs = 1000 * 60 * 60 * 4
let cachedSecret: string | null = null

export async function hashSharePassword(password: string) {
  const salt = randomBytes(16).toString('base64url')
  const derived = (await scrypt(password, salt, 64)) as Buffer

  return {
    hash: derived.toString('base64url'),
    salt,
  }
}

export async function verifySharePassword(recording: Recording, password: string) {
  if (!recording.sharePasswordHash || !recording.sharePasswordSalt) {
    return true
  }

  const derived = (await scrypt(password, recording.sharePasswordSalt, 64)) as Buffer
  const expected = Buffer.from(recording.sharePasswordHash, 'base64url')

  if (derived.length !== expected.length) {
    return false
  }

  return timingSafeEqual(derived, expected)
}

export async function createShareAccessToken(recording: Recording) {
  if (!recording.shareToken) {
    throw new Error('Cannot create access token for a recording without a share token')
  }

  const expiresAt = Date.now() + accessTokenTtlMs
  const payload = `${recording.shareToken}.${expiresAt}`
  const signature = await signPayload(payload)

  return `${expiresAt}.${signature}`
}

export async function verifyShareAccessToken(recording: Recording, token: string | undefined) {
  if (!recording.sharePasswordHash) {
    return true
  }

  if (!recording.shareToken || !token) {
    return false
  }

  const [expiresAtSource, signature] = token.split('.')
  const expiresAt = Number(expiresAtSource)

  if (!Number.isFinite(expiresAt) || expiresAt < Date.now() || !signature) {
    return false
  }

  const payload = `${recording.shareToken}.${expiresAt}`
  const expected = await signPayload(payload)
  const actualBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expected)

  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
}

async function signPayload(payload: string) {
  const secret = await getShareSecret()
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

async function getShareSecret() {
  if (cachedSecret) {
    return cachedSecret
  }

  try {
    cachedSecret = (await readFile(storagePaths.shareSecretFile, 'utf8')).trim()
  } catch {
    cachedSecret = randomBytes(32).toString('base64url')
    await writeFile(storagePaths.shareSecretFile, `${cachedSecret}\n`, 'utf8')
  }

  return cachedSecret
}
