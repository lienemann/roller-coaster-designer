# Contributing

Read [`webfvd-spec.md`](./webfvd-spec.md) once before you do anything. Reread the
relevant section whenever you start work on something you haven't touched
before. The spec is the source of truth; this file is the working agreement.

## The tier system

Work happens in three tiers.

| Tier | Scope                                                                             | Ships      |
| ---- | --------------------------------------------------------------------------------- | ---------- |
| T1   | FVD++-in-the-browser with a modern UI. MVP.                                       | End of M10 |
| T2   | KexEdit-peer features: shuttles, bridges, multi-car, optimizer, node graph        | M16        |
| T3   | Modern design: switch tracks, launches, magnetic brakes, overhang, rigid-body sim | M21        |

Do not skip ahead. If you are working on a T1 milestone and find yourself
reaching for a T2 feature, stop and defer it. Scope discipline is what keeps the
project from drowning.

## One milestone per PR

Milestones are defined in `docs/webfvd-spec.md` §19. Each milestone is a
reviewable unit. Large milestones (M7, M11, M20) may split by feature — note
the split in the PR description. Never bundle two milestones.

## Branch naming

Feature branches: `feat/<short-kebab>`. Fix branches: `fix/<short-kebab>`.
Per-milestone branches: `milestone/M<N>-<slug>`.

`main` is always deployable. Everything that might break the build sits behind
a feature flag until the milestone ships.

## Commits

Commit messages are public. They explain what changed and why, in plain
English, in the imperative mood.

```
Good:  Port SubFunc quartic degree with asymmetric arg1 branch
       Fix off-by-one at section boundary in cumulative time array
       Add golden test for straight section at g-load 1.0
Bad:   updates
       WIP
       fix bug
```

No commit messages about history ("changed from X", "previously was Y"). Write
the code as if it always was.

## Physics changes

Physics PRs require golden-file tests under `packages/core/test/golden/`. Build
the test harness before the integrator. If the PR touches
`packages/core/src/physics/` and does not add or update a golden test, it is
not ready.

For T1 physics: match FVD++ 0.79 byte-for-byte. Port the math from
`reference/openfvd/core/` verbatim. Add `// NOTE: matches FVD++ 0.79` next to
things that look wrong — they are intentional.

For T2/T3 features (beyond FVD++): design deliberately, not by porting. Record
the reasoning in the PR description.

## Package boundaries

`packages/core` has no runtime dependency on the DOM, React, or Three.js. If
you write `import ... from 'react'` or `import ... from 'three'` in `core/`,
something is wrong. `gl-matrix` is the only math library in core. Recompute
runs in the Web Worker — never call an integrator from a React component.

## Code style

- TypeScript strict, no `any` without a justification comment.
- Files: `kebab-case.ts`. Type-only modules: `*.types.ts`.
- Named exports. No default exports.
- Numeric enums for things that round-trip to `.fvd`. String union types for
  app-only states.
- No comments that explain what the code does — names do that. Comments
  explain why: a hidden constraint, a subtle invariant, a workaround.
- No history comments. No TODO comments without a tracking issue.
- SPDX header on every new source file: `// SPDX-License-Identifier: AGPL-3.0-only`.

## i18n

No user-facing strings in JSX. Everything goes through `t()`. Every new key
lands in both `packages/app/src/i18n/locales/en/*.json` and `.../de/*.json`. If
the German translation is uncertain, add the key with a
`// TODO(i18n-de): verify` comment — never leave the DE file short. Human DE
review before T1 ships.

## Privacy

No telemetry, analytics, CDN calls, or third-party scripts, at any tier. No
cookies beyond `localStorage`. This is non-negotiable.

## Pull request checklist

- [ ] PR title names the milestone: `M2: First integrator - Straight + Anchor`.
- [ ] Description links the spec sections it implements.
- [ ] `pnpm -r lint && pnpm -r typecheck && pnpm -r test` all green locally.
- [ ] Physics changes include golden-file tests.
- [ ] UI changes include a screenshot or short screen recording.
- [ ] New user-facing strings land in EN and DE.
- [ ] `packages/<pkg>/CONTEXT.md` updated if you changed the package's shape.
- [ ] CI green on the PR.
