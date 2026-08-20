# Working on SKS START Command Center

## Product boundary

Keep this system small. The goal is a reliable student workflow before the
school term, not a general sustainability platform.

- Preserve compatibility with the existing `START Control Center` Google
  Sheet. Map header variations defensively before proposing structural changes.
- Keep Google Sheets as the operational store and Google Apps Script as the web
  app runtime. Do not add React, a build system, an external database, or paid
  infrastructure without a concrete requirement and user approval.
- Preserve both core loops: claim and finish practical tasks; and move a student
  idea through Validation, School Review, Active work, and completion.
- Keep official START scoring, certification decisions, carbon calculations,
  and metric-completion workflows outside this app.
- Do not add scraping, AI/chat features, automatic reports, reminders, email
  automation, or complex permissions to v0.1.

## Data and safety

- Never place passwords, API keys, OAuth tokens, deployment credentials, or
  student private information in this repository.
- Never seed fake production rows into the bound workbook. Local in-memory test
  fixtures are acceptable.
- Treat the live workbook as user data. Inspect exact headers before changing
  read/write logic, and make deliberate, narrowly scoped writes.
- Keep task and project mutations behind `LockService.getScriptLock()` and
  validate status/stage transitions plus the selected member identity. Do not
  use a document lock: Apps Script returns no document lock from a web app.
- Render sheet-sourced text as text, not trusted HTML.

## Current implementation contract

- `apps-script/Code.gs` is the server and opens the known workbook ID with
  `SpreadsheetApp.openById()`. Do not replace this with an "active spreadsheet"
  method: Google does not make bound-container active methods available when a
  script runs as a web app.
- `apps-script/Index.html` contains all browser HTML, CSS, and JavaScript.
- Public server calls used by the client are `getDashboardData`, `claimTask`,
  `addTaskUpdate`, `blockTask`, `resumeTask`, `completeTask`, `releaseTask`, and
  `saveMyDisplayName`. `setupMembersSheet` is an editor-run, idempotent setup
  helper, not a normal browser action. `updateTask` remains only as a legacy
  client compatibility entry point and must also write canonical statuses.
- Project calls are `createProjectIdea`, `startProjectValidation`,
  `saveProjectValidation`, `recordSchoolReview`, `setProjectLead`,
  `addProjectTask`, `addProjectUpdate`, `editProjectNextAction`,
  `completeProject`, and `pauseProject`.
- New task writes use only `Open`, `Doing`, `Blocked`, and `Done`. Continue to
  read legacy `Claimed` and `In Progress` as `Doing`, and legacy `Waiting` as
  `Blocked`; do not force a destructive migration of existing task rows.
- `Members` uses `Email`, `Display Name`, and `Active`. Email is the stable key
  when available, while member-facing UI uses the display name. Existing task
  owners may be either names or emails, so ownership checks must accept both.
- Google email identity is opportunistic. When it is unavailable, allow only an
  active `Members` profile selected and remembered in the browser. Do not accept
  arbitrary free-form identities or add custom authentication.
- New project writes use `Idea`, `Validation`, `School Review`, `Active`,
  `Completed`, `Paused`, or `Rejected`. Read legacy `Proposal Ready` as `School
  Review` and `Pilot` as `Active` without rewriting old rows.
- Project validation uses the append-only columns `Validation Evidence`,
  `Success Measure`, `School Contact`, `Known Concerns`, and `Decision Notes`;
  completion uses `Completed Work` and `Observed Result`. Keep the original 15
  project columns compatible and never seed or rewrite production rows.
- `setupProjectWorkflow` may append only those missing headers and update the
  Settings stage-options value. It must remain idempotent and must not modify
  project or task data rows.
- Project tasks remain normal rows in `Tasks`, and all project history remains
  in `Updates`. Do not add a second history store.
- Metrics are read from the existing `Metrics` tab for lightweight linking only.
  Do not add metric scoring, tier mutation, or a separate Metrics workflow.

## Before handing off a change

Run:

```bash
node tests/run-tests.js
```

For interface changes, also exercise the narrowest desktop and phone layouts
and confirm loading, error, empty, and populated states remain understandable.
Keep `SETUP.md` in sync with any deployment or sheet requirements.
