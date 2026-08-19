# Working on SKS START Command Center

## Product boundary

Keep this system small. The goal is a reliable student workflow before the
school term, not a general sustainability platform.

- Preserve compatibility with the existing `START Control Center` Google
  Sheet. Map header variations defensively before proposing structural changes.
- Keep Google Sheets as the operational store and Google Apps Script as the web
  app runtime. Do not add React, a build system, an external database, or paid
  infrastructure without a concrete requirement and user approval.
- Prioritize the loop: see a task, claim it, update it, record a blocker, and
  finish it. Project editing is secondary.
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
- Keep task mutations behind `LockService.getScriptLock()` and validate both
  status values and the selected member identity. Do not use a document lock:
  Apps Script returns no document lock when code runs as a web app.
- Render sheet-sourced text as text, not trusted HTML.

## Current implementation contract

- `apps-script/Code.gs` is the server and opens the known workbook ID with
  `SpreadsheetApp.openById()`. Do not replace this with an "active spreadsheet"
  method: Google does not make bound-container active methods available when a
  script runs as a web app.
- `apps-script/Index.html` contains all browser HTML, CSS, and JavaScript.
- Public server calls used by the client are `getDashboardData`, `claimTask`,
  and `updateTask`.
- Supported task statuses are `Open`, `Claimed`, `In Progress`, `Waiting`, and
  `Done`.
- Google email identity is opportunistic. A Settings-backed selector is the
  temporary fallback until the school chooses a durable identity policy. Do not
  accept arbitrary free-form identities for write actions.

## Before handing off a change

Run:

```bash
node tests/run-tests.js
```

For interface changes, also exercise the narrowest desktop and phone layouts
and confirm loading, error, empty, and populated states remain understandable.
Keep `SETUP.md` in sync with any deployment or sheet requirements.
