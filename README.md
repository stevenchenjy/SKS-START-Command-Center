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
- Use school Google identity when available, with an active `Members` profile
  selector as the constrained fallback.
- Link projects to existing START metrics without scoring or changing official
  tiers.

The app does not calculate carbon, certify outcomes, send reminders, or make
project decisions. AI and other future helpers are disabled by default.

## Platform foundation

The server is split into small `.gs` modules while preserving every existing
browser-callable function. The foundation also provides:

- centralized, private Script Property access;
- alias-aware, read-only schema inspection with `inspectStartSchema()`;
- safe, explicit additive setup helpers;
- a reusable deterministic, bounded, privacy-minimized program snapshot layer;
- pinned clasp tooling that compares local source with both Apps Script HEAD and
  the current permanent deployment before a push or release;
- checks for syntax, secrets, conflicts, manifest scopes, source-root drift,
  and accidental deployment replacement.

Future flags use exact, case-sensitive Script Property values:

| Script Property | Default |
| --- | --- |
| `FEATURE_AI_HELPER` | disabled |
| `FEATURE_DRIVE_KNOWLEDGE` | disabled |
| `FEATURE_DECISION_HELPER` | disabled |
| `FEATURE_REPORTING` | disabled |

Only the usable `aiHelper` capability is exposed to browser code. Private
configuration, folder IDs, model names, and API keys are never returned.

## Dormant future foundation

The `future/ai-foundation` branch adds a read-only Ask START service and hidden
interface without enabling either for students. The server selects a small,
deterministic slice of current Command Center records, sends at most one request
to the OpenAI Responses API when explicitly activated, validates a strict
structured response, and hydrates source references from server-owned records.
It cannot change a task, project, Sheet, metric, or Drive file.

The same branch includes:

- a tested curated-knowledge interface and bounded selector, with the real
  Google Drive extraction adapter deliberately left uninstalled;
- factual project-decision comparison data with no score, rank, or automatic
  decision;
- bounded semester/reporting data that labels every recorded observed result as
  reported and not independently verified;
- a feature-gated Ask START view that is absent from navigation and inaccessible
  while its server capability is false.

See [FUTURE_FEATURES.md](FUTURE_FEATURES.md) for activation status and the exact
future steps. Merging the platform branch does not add the external-request
scope; that scope exists only on the future branch.

## Repository layout

```text
apps-script/                 Apps Script runtime source and manifest
scripts/gas-tooling.js       guarded local compare, push, and release workflow
scripts/verify.js            static and safety checks
tests/                       workflow, platform, snapshot, assistant, and tooling tests
.clasp.json.example          existing Apps Script project binding template
.gas-deploy.example.json     existing permanent deployment template
SETUP.md                     one-time local setup and release instructions
AGENTS.md                    product and engineering constraints
FUTURE_FEATURES.md           dormant capability status and activation notes
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
```

`gas:status` shows local upload candidates and then performs the authenticated
remote comparison; clasp's local status alone is not a synchronization check.
`gas:dev` synchronizes reviewed source for an editor-only `/dev` test deployment.
`gas:release` creates a version and updates only the configured permanent
deployment—never a new deployment—so the existing `/exec` URL is preserved.

Automated tests use local Sheet simulations and mocks. They never write to the
production workbook, deploy Apps Script, or call a paid service.

## Operational data

The existing `START Control Center` workbook contains `Metrics`, `Tasks`,
`Projects`, `Updates`, `Settings`, and `Members`. The server opens its known
spreadsheet ID explicitly because bound-container active-spreadsheet methods are
not available during web-app execution. Setup helpers add only missing supported
headers/settings and never seed or rewrite operational rows.
