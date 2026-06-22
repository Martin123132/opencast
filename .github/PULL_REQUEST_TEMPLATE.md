# Share lifecycle privacy review (for sharing behavior)

## Requested change category

- [ ] General refactor
- [ ] Share lifecycle behavior
- [ ] Library/recording management
- [ ] UX polish (non-sharing)
- [ ] Other

## Share lifecycle review required before merging

If this PR touches sharing, share links, or guest visibility, please complete these checks:

- [ ] I reviewed the share-lifecycle privacy checklist [`SHARE_LIFECYCLE_PRIVACY_CHECKLIST.md`](../SHARE_LIFECYCLE_PRIVACY_CHECKLIST.md) and confirmed applicable scenarios are still satisfied.
- [ ] I checked create/revoke/recreate behavior against the existing contract.
- [ ] I checked reload/persistence behavior for `shareToken` and `shareWasRevoked`.
- [ ] I checked stale-token and previously-revoked token handling remains blocked and non-leaky.
- [ ] I checked owner vs guest expectations are preserved and guest responses do not expose private details.
- [ ] I ran:
  - `npm run test`
  - `npm run test:e2e`

## Evidence

- [ ] Relevant test logs/outputs attached
- [ ] Screenshots or notes for changed share/guest flows (if UI changed)

## Files touched

- Add list here.
