# SKS START Command Center

The START Command Center is The Storm King School student sustainability
committee's lightweight work dashboard. Google Sheets remains the operational
source of truth and Google Apps Script serves the responsive web app.

## Current student workflow

- Find, claim, update, block, resume, finish, or release practical tasks.
- Move student ideas through Idea, Validation, School Review, Active work, and
  completion while retaining paused and rejected history.
- See active projects, work waiting on school, recent progress, and related
  tasks and updates.
- Use the signed-in school Google identity matched exactly to one active
  `Members` row; browser-selected profiles are never authorization.
- Use the member email/profile key—not a changeable display name—as task
  mutation authority; legacy name-owned tasks go through coordinator recovery.
- Link projects to existing START metrics without scoring or changing official
  tiers.

The app does not calculate carbon, certify outcomes, send reminders, or make
project decisions. AI and other future helpers are disabled by default.

Coordinators also have a small authorization-gated Operations view for member
status, schema readiness, and read-only data-integrity diagnostics. Students can
use factual project comparison and meeting-briefing views without arbitrary
scores or automated decisions. See [OPERATIONS.md](OPERATIONS.md) for the access
model and the weekly owner checklist.

The deterministic factual Briefing and project comparison are always-on core,
non-AI features. They do not require or activate `FEATURE_DECISION_HELPER` or
`FEATURE_REPORTING`.

## Platform foundation

The server is split into small `.gs` modules while preserving every existing
browser-callable function. The foundation also provides:

- centralized, private Script Property access;
- alias-aware, read-only schema inspection with `inspectStartSchema()`;
- safe, explicit additive setup helpers;
- a reusable deterministic, bounded, privacy-minimized program snapshot layer;
- pinned clasp tooling that compares local source with both Apps Script HEAD and
  the current permanent deployment before a push or release;
- authoritative permanent-deployment checks for version, Web App entry point,
  access policy, execution identity, and the exact `/exec` URL;
- an immutable visible Web version/build footer for browser release checks;
- checks for syntax, secrets, conflicts, manifest scopes, source-root drift,
  and accidental deployment replacement.

Future flags use exact, case-sensitive Script Property values:

| Script Property | Default |
| --- | --- |
| `FEATURE_AI_HELPER` | disabled |
| `FEATURE_DRIVE_KNOWLEDGE` | disabled |
| `FEATURE_DECISION_HELPER` | disabled |
| `FEATURE_REPORTING` | disabled |

The ordinary dashboard capability payload exposes only a usable `aiHelper`
boolean. The admin-only Operations response also shows the four non-secret flag
states so an owner can confirm that dormant helpers remain off. Private values,
folder IDs, model names, and API keys are never returned.

## Repository layout

```text
apps-script/                 Apps Script runtime source and manifest
scripts/gas-tooling.js       guarded local compare, push, and release workflow
scripts/verify.js            static and safety checks
tests/                       workflow, auth, reporting, integrity, client, and tooling tests
.clasp.json.example          existing Apps Script project binding template
.gas-deploy.example.json     existing permanent deployment template
SETUP.md                     one-time local setup and release instructions
OPERATIONS.md                school-year access, diagnostics, and continuity guide
AGENTS.md                    product and engineering constraints
```

## Development and release commands

Node.js 20 or newer is required. Complete the one-time steps in
[SETUP.md](SETUP.md), then use:

```bash
npm test
npm run check
npm run verify
npm run gas:status
npm run gas:compare
npm run gas:dev
npm run gas:release -- "Reviewed release description"
npm run gas:recover -- <version> "Restore reviewed version <version>"
```

`gas:status` shows local upload candidates and then performs the authenticated
remote comparison; clasp's local status alone is not a synchronization check.
`gas:dev` synchronizes reviewed source for an editor-only `/dev` test deployment.
`gas:release` creates a version and updates only the configured permanent
deployment—never a new deployment—so the existing `/exec` URL is preserved. It
re-reads deployment state through the Apps Script API, checks the served build
marker, and automatically restores the previous version if post-update
verification fails. Production release is allowed only from a clean `main`
exactly synchronized with `origin/main`. `gas:recover` is the guarded path for explicitly restoring
an already-existing immutable version to that same permanent deployment.

Each created Apps Script version is described as
`Web v<version> · build <build> · git <short-sha>` (after the human release
description), which is the lightweight link between an immutable Apps Script
version and its reviewed Git commit.

Automated tests use local Sheet simulations and mocks. They never write to the
production workbook, deploy Apps Script, or call a paid service.

## Operational data

The existing `START Control Center` workbook contains `Metrics`, `Tasks`,
`Projects`, `Updates`, `Settings`, and `Members`. The server opens its known
spreadsheet ID explicitly because bound-container active-spreadsheet methods are
not available during web-app execution. Setup helpers add only missing supported
headers/settings and never seed or rewrite operational rows.
