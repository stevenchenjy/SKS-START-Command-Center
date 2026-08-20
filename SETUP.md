# One-time local setup and release

This repository is already configured for the existing START Apps Script
project and permanent web-app deployment. Do not create another spreadsheet,
script project, or deployment.

## Existing production targets

- Spreadsheet ID: `1XFTIrKIcckrwavS-tJ5E_fReKVR3BlLtsbLUXRhto6I`
- Apps Script ID: `12Ex89VwthU9KQo0txTbhvdl-4hIpZe5SjpbEnekFGz5gbYaNRdm2S0Dg`
- Permanent Deployment ID:
  `AKfycbwuBPUusFBHHILfJ8ySalyHmI5Fk5tVff4z5cEUUZo0sgPviBwc2szUMqi4tVixyayZ`
- Permanent URL:
  `https://script.google.com/macros/s/AKfycbwuBPUusFBHHILfJ8ySalyHmI5Fk5tVff4z5cEUUZo0sgPviBwc2szUMqi4tVixyayZ/exec`

Use a durable, school-managed Storm King Google Workspace account that owns or
can edit the Apps Script project and has **Editor** access to the workbook. Do
not use a graduating student's personal account.

## 1. Install the pinned tooling

Install Node.js 20 or newer. From the repository root, run:

```bash
npm install
```

This installs the repository-pinned `@google/clasp` version. Use the npm
commands below instead of an unrelated global clasp installation.

## 2. Enable and authorize Apps Script access

1. Sign into the intended school-managed owner account.
2. Open [Apps Script user settings](https://script.google.com/home/usersettings)
   and turn on **Google Apps Script API**.
3. Run:

   ```bash
   npm run gas:login
   ```

4. Complete Google's OAuth prompt with that same account. OAuth files and local
   target files are ignored by Git and must never be committed.

## 3. Create the local project/deployment files

Run:

```bash
npm run gas:configure
```

This copies the tracked templates to ignored `.clasp.json` and
`.gas-deploy.json` files. The templates already contain the existing Script ID,
permanent Deployment ID, and `apps-script` source root shown above. Confirm
those values; do not replace them with a newly created target.

No Script Properties are required for the current student product. Future
feature flags remain absent and therefore disabled.

## 4. Establish the remote baseline

Run the local suite, then perform the authenticated comparison:

```bash
npm run verify
npm run gas:compare
```

The comparison clones Apps Script HEAD and the version behind the configured
permanent deployment into separate temporary directories. It does not pull over
or overwrite repository files. Review every different or local-only file.
A runtime file that exists only on remote HEAD stops push/release until it is
deliberately preserved or removed; historical differences in the deployed
version remain visible for rollback review.

`npm run gas:status` first lists local upload candidates, then runs the same
authenticated comparison. The local candidate list by itself is not proof that
local and remote source match.

## Normal development

Before sharing a change, run:

```bash
npm run verify
```

To synchronize reviewed source for editor-only browser testing:

```bash
npm run gas:dev
```

Then use **Deploy → Test deployments → Web app** in Apps Script. Its `/dev` URL
runs current saved source for script editors. This command does not change the
permanent `/exec` deployment.

## Release to the existing `/exec` URL

Commit all reviewed changes first; the release command refuses a dirty worktree.
Then run:

```bash
npm run gas:release -- "Short reviewed release description"
```

The command:

1. runs all tests and static checks;
2. verifies the pinned clasp version, local IDs, clean Git state, and existing
   permanent Deployment ID;
3. compares local source with remote HEAD and the deployed version;
4. pushes to the configured existing Script ID;
5. creates an immutable Apps Script version;
6. updates only the configured existing Deployment ID to that version;
7. confirms the update and prints the unchanged `/exec` URL, previous version,
   and rollback command.

It never calls `create-deployment`. Do not use **New deployment** for a normal
release.

The `future/ai-foundation` manifest adds only Apps Script's
`script.external_request` scope. The first reviewed release containing that
branch may ask the deployment owner to authorize the added scope even while Ask
START remains disabled. It does not add a Google Drive scope. Leave the future
branch unreleased until the committee deliberately chooses it; activation steps
are separate in [FUTURE_FEATURES.md](FUTURE_FEATURES.md).

## Troubleshooting

- **Not logged in / authorization error:** run `npm run gas:login` with the
  school-managed owner account.
- **Apps Script API disabled:** enable it at the user-settings link above, then
  retry.
- **Configured deployment not found:** stop and confirm the account can access
  the existing project and that the IDs match this guide. Do not create a
  replacement deployment.
- **Remote-only runtime file:** inspect the printed temporary clone and make an
  explicit preservation/removal decision before retrying.
- **Dirty worktree:** commit the exact reviewed release state; do not bypass the
  guard.
- **Workbook access error after deployment:** confirm the execution identity has
  Editor access to the existing spreadsheet and `START_SPREADSHEET_ID` was not
  overridden with a different Script Property.
