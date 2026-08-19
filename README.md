# SKS START Command Center

A small internal dashboard for The Storm King School's student START committee.
The v0.1 app is a bound Google Apps Script web app: Google Sheets stores the
operational data, `Code.gs` provides the server functions, and `Index.html`
provides the complete responsive interface.

## What v0.1 does

- Shows open tasks, claimed tasks, active projects, items waiting on school,
  and recent updates.
- Lets a member claim a task, move it to **In Progress** or **Waiting**, add a
  short progress note or blocker, and mark it **Done**.
- Shows each project's stage, START metrics, local feasibility, school
  feedback, next action, and lead.
- Uses the Google account email when Apps Script makes it available. Otherwise,
  it uses a clearly marked temporary selector populated from `Settings`.
- Maps the existing sheet headers defensively instead of changing the workbook.

The app intentionally does not score official START metrics, calculate carbon,
send reminders, or add an AI assistant. Those features are outside v0.1.

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
`Projects`, `Updates`, and `Settings`. The web app reads `Tasks`, `Projects`,
`Updates`, and `Settings`; `Metrics` remains outside the interface for v0.1.
`Code.gs` opens the known workbook ID explicitly because Apps Script does not
provide bound-container “active spreadsheet” methods during web-app execution.
