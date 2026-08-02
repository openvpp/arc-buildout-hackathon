<!--
  Keep PRs small and focused. See docs/development.md for the workflow.
-->

## Summary

<!-- What does this change do, and why? -->

## Phase / scope

- [ ] This change stays within the current phase's scope (see `CLAUDE.md`).
- [ ] No frontend/backend responsibilities were combined.
- [ ] No domain integration was mocked as if it were a production implementation.

## Architectural checklist

- [ ] Route/page files stay thin; business logic lives in `features`/`lib`.
- [ ] Environment access goes through `src/config/env.ts` only.
- [ ] No direct `fetch` in React components; external data is schema-validated.
- [ ] Shared modules do not import from `features`; features don't reach into
      other features' internals.
- [ ] No secrets, private keys, seed phrases, or backend credentials added.

## Quality gate

<!-- Paste the actual results. Do not claim a check passed unless it ran. -->

- [ ] `pnpm validate` passed locally
- [ ] `pnpm test:e2e` passed (or explicitly noted why it could not run)

## Notes for reviewers

<!-- Anything that needs special attention, follow-ups, or deferred work. -->
