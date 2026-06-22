# Share Lifecycle Release Review (privacy)  

Use this template before releasing any change that touches recording sharing or guest
share access behavior.

## Release Metadata

- Release/branch:
- Commit SHA(s):
- Reviewer:
- Review date:
- CI run URL:

## Mandatory validation checks

- [ ] `npm run lint`
- [ ] `npm run build`
- [ ] `npm run test`
- [ ] `npm run test:e2e`
- [ ] CI link recorded:
  - https://github.com/Martin123132/opencast/actions/runs/...

## Share lifecycle evidence

- [ ] Create path validated (recording → create share link)
- [ ] Revoke path validated
- [ ] Reload/persistence path validated (`shareToken` + `shareWasRevoked`)
- [ ] Recreate path validated
- [ ] Old/stale token blocked after revoke/recreate
- [ ] Owner state is explicit and correct after lifecycle transitions
- [ ] Guest flow remains safe for unavailable links
- [ ] Guest responses do not leak private recording details

## Outcome

- [ ] Approve for release
- [ ] Hold for follow-up

## Notes

- Add short notes here, including non-leaky proof location:
  - CI run: `<insert run URL>`
  - Evidence links:
    - `<insert test or screenshot location>`
