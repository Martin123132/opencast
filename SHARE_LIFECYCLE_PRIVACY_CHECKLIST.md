# Share Lifecycle Privacy Contract

This checklist captures the minimum privacy guarantees for share link lifecycle behavior.
It applies to both the API/store layer and the guest-facing behavior.

## Scope

- Recording share creation
- Revoke and persisted state
- Page reload / restart persistence
- Recreate and token rotation
- Guest access behavior for old vs. current tokens
- Information disclosure in guest responses

## Contract (must pass)

- [ ] New recording defaults are private and unshared:
  - `shareToken === null`
  - `shareWasRevoked === false`
- [ ] After create (`POST /api/recordings/:id/share`):
  - Response includes a non-empty `recording.shareToken`
  - `recording.shareWasRevoked === false`
- [ ] Owner reload/persistence:
  - Reloading from `/api/recordings` after create still returns a matching `shareToken`
  - `shareWasRevoked` remains `false`
- [ ] Revoke (`DELETE /api/recordings/:id/share`):
  - Response and persisted recording set `shareWasRevoked === true`
  - `shareToken === null`
  - Old token no longer resolves (`/api/recordings/:id` lookups by old token return `null`)
  - Guest path for old token returns non-leaky unavailable state (`This share link is unavailable.`)
- [ ] Recreate (`POST /api/recordings/:id/share` after revoke):
  - `shareWasRevoked` resets to `false`
  - New token is generated
  - New token is different from the revoked token
  - New token resolves to the recording
  - Revoked/stale token still fails
- [ ] Guest non-leak:
  - Guest endpoints for unavailable links do not reveal internal file paths, storage metadata, or password hashes.
  - Public responses must not surface:
    - `fileName`
    - `sharePasswordHash`
    - `sharePasswordSalt`
    - `shareSecret` (or any equivalent private key material)

## Test mapping

- API/store-level checks:
  - `npm run test`
  - Covers create → revoke → persisted state → stale-token block → recreate path.
- Browser-level checks:
  - `npm run test:e2e`
  - Covers owner UX + guest unavailable vs working link behavior with reload/persistence contexts.

## Owners

- Owners should see explicit revoked/recreate states in share UI.
- Guests should only get:
  - a working current share token path, or
  - a non-leaky unavailable response for revoked/invalid/expired links.
