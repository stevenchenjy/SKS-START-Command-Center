# START Command Center operations

This is the short operating guide for the school-year owner or coordinator.
The `START Control Center` Google Sheet is the source of truth; the Apps Script
web app is the normal student interface. Do not duplicate Tasks, Projects, or
Updates into another system.

## Access model

The permanent Web App continues to execute as the school-managed deployment
account so students do not need direct access to edit the workbook. The public
URL can load the application shell, but the server returns operational data and
accepts changes only when all of these are true:

1. Apps Script supplies the visitor's Google email through `Session`.
2. That email occurs exactly once in the `Members` tab.
3. The matching row is Active.

The browser cannot choose or impersonate a member. A requested profile name is
ignored for authorization. Missing, unknown, inactive, and duplicate identities
receive an access-needed response containing no task, project, metric, update,
or member data.

Because the app executes as its deployer, Google may withhold the active email
for accounts outside the deployer's Workspace domain. In practice, members
should use their school Google accounts. An approved personal account may still
be denied by Google's identity policy; never work around that by restoring a
profile picker or accepting a browser-provided identity.

Administrative operations are limited to the deployment owner and active
Members whose exact emails appear in the private Script Property
`START_COORDINATOR_EMAILS`. Use a comma-, semicolon-, pipe-, or newline-separated
list. The property is configuration, not a substitute for an active Member row.
Never put it in the Sheet, HTML, logs, or Git.

## Routine member administration

Use the Operations view in the Web App:

- Add a member with their complete Google account email and a unique display
  name. New entries should remain inactive until the coordinator reviews them.
- Activate a reviewed member, or deactivate someone who leaves the committee.
- Update display names there. Display names are presentation and history labels;
  the member's normalized email/profile key is the only task-mutation identity.
- Resolve duplicate emails or display names and email/display-name namespace
  collisions before expecting identity checks to pass.

Before deactivating someone, release their Doing/Blocked tasks to Open so other
members can claim them, and select replacement leads for ongoing projects. The
server does not silently rewrite ownership or history when a member leaves.

If a Doing or Blocked task is already stranded because its recorded owner is
missing, inactive, unknown, ambiguous, or uses a legacy display-name owner, use
**Stranded task recovery** in Operations. Enter the exact unique Task ID and a
short reason. The locked, admin-only action releases only that task to Open,
retains its old blocker and the coordinator reason in Updates, and never changes
a task owned by an active member's stable email/profile key. Rows without a
unique Task ID must be repaired deliberately in the Sheet first.

The deployment owner can initialize a missing `Members` tab or add missing
project-workflow headers through the explicit setup controls. These helpers are
additive. They do not seed, rewrite, or clean operational rows.

## Weekly readiness check

Open Operations and review the read-only schema and integrity results. Resolve
warnings in the source Sheet with a second person reviewing any meaningful
change. Pay particular attention to:

- duplicate or missing task/project IDs;
- invalid task statuses or project stages;
- owners who are missing, inactive, ambiguous, or still stored as legacy
  display names;
- blocked work with no blocker, or blockers that have gone stale;
- task/project/update references that no longer resolve;
- missing required headers or duplicate Settings rows.

The diagnostics never repair data automatically. Preserve IDs once created,
and do not rename an ID to make a warning disappear unless all references are
reviewed together. Use Google Sheets version history to recover accidental row
edits. Before any deliberate schema or bulk-data operation, create a named
version or a reviewed copy of the workbook; normal code releases require no
Sheet migration.

## Development, release, and recovery

Use the commands in [SETUP.md](SETUP.md). The normal sequence is:

```bash
npm ci
npm run verify
npm run gas:compare
npm run gas:dev
```

Review the editor-only `/dev` app on desktop and phone before production. A
production release must be a clean, committed `main` exactly synchronized with
`origin/main`; `gas:release` refuses feature branches, detached HEADs, and
ahead/behind/diverged state. It updates only the configured permanent
deployment and preserves the `/exec` URL. If post-release verification fails,
use the guarded recovery workflow—never create a replacement deployment as a
shortcut.

Every release description ends with
`Web v<version> · build <build> · git <short-sha>`. Bump the build token for
each runtime release and use this suffix plus the exact version printed by the
release command when recovering. A separate Git-tag convention is not needed
for this lightweight product.

GitHub CI runs install, tests, and static verification only. It has no clasp or
production credentials and must never deploy.

## Ownership continuity

Keep the Apps Script project, workbook, clasp authorization, and permanent
deployment under a durable school-managed account, with at least one other
trusted school staff member able to reach the repository and source files.
Record the current owner in the school's password/account-management process,
not in Git.

Google does not transfer ownership of an existing versioned Apps Script
deployment when the script project changes owners. Before disabling the actual
deployment-owner account:

1. Give the successor access to the repository, Apps Script project, workbook,
   and the school account-management record.
2. Inventory private Script Properties and transfer their values through a
   protected school channel; never copy them into Git or an ordinary document.
3. Authorize clasp as the school-managed successor and verify `gas:compare` and
   the editor-only `/dev` app while the current owner is still available.
4. Keep the current deployment-owner account active whenever possible. If it
   must be retired, plan and communicate the deliberate new-deployment URL
   cutover that Google may require; do not assume project ownership transfer
   preserves the existing versioned deployment.

## Boundaries that remain intentional

The app records committee workflow; it does not make official START tier or
school decisions, calculate carbon, certify outcomes, or independently verify
reported results. `FEATURE_AI_HELPER`, `FEATURE_DRIVE_KNOWLEDGE`,
`FEATURE_DECISION_HELPER`, and `FEATURE_REPORTING` remain off unless the exact
private Script Property value is `true`. Do not enable them as part of ordinary
operations, and never add an API key or private Drive folder ID to the Sheet,
HTML, logs, or repository.

The deterministic factual Briefing, project comparison, and meeting report are
core non-AI views; they do not depend on those dormant future-helper flags.
