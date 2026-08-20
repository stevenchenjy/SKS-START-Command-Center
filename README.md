# SKS START Command Center

A small internal dashboard for The Storm King School's student START committee.
The app is a bound Google Apps Script web app: Google Sheets stores the
operational data, `Code.gs` provides the server functions, and `Index.html`
provides the complete responsive interface.

## What the current app does

- Shows open, doing, blocked, and completed tasks; active projects; items
  waiting on school; and recent updates.
- Lets a member claim an open task directly into **Doing**, add a short update,
  mark it **Blocked**, resume it, finish it, or release it for someone else.
- Moves a lightweight student idea through **Validation**, **School Review**,
  **Active**, and **Completed**, while preserving paused or rejected history.
- Turns an active project into a practical hub for related tasks, short project
  updates, its next action, optional lead, and observed results.
- Reads the existing Metrics tab for a small project metric selector without
  adding scoring or a separate Metrics workflow.
- Uses the Google account email as a stable identity when Apps Script makes it
  available, while showing the person's display name from `Members`. Otherwise,
  it uses an active-member profile selector remembered by that browser.
- Maps the existing sheet headers defensively instead of changing the workbook.

The app intentionally does not score official START metrics, calculate carbon,
send reminders, or add an AI assistant. Those remain outside this version.

## Repository layout

```text
.
├── README.md
├── AGENTS.md
├── SETUP.md
├── apps-script/
│   ├── Code.gs
│   └── Index.html
└── tests/
    └── run-tests.js
```

There is no package install, build step, database, or secret configuration.

## Deploy

Follow [SETUP.md](SETUP.md) to copy the two Apps Script files into the existing
`START Control Center` spreadsheet and deploy the web app.

## Test locally

The lightweight test runner uses only Node.js built-ins and a small in-memory
Google Sheets simulation:

```bash
node tests/run-tests.js
```

It checks the server workflow without writing to the live spreadsheet. Final
deployment verification is a short manual check described in `SETUP.md`.

## Data source

The bound workbook is `START Control Center` and contains `Metrics`, `Tasks`,
`Projects`, `Updates`, `Settings`, and the lightweight `Members` identity tab.
The web app reads `Tasks`, `Projects`, `Updates`, `Settings`, and `Members`;
it also reads metric names and context from `Metrics` for project linking. Task
and project history continues to use the single existing `Updates` tab.
`Code.gs` opens the known workbook ID explicitly because Apps Script does not
provide bound-container “active spreadsheet” methods during web-app execution.
