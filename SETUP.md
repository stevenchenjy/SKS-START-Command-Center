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
   permanent Deployment ID and Web App entry point;
3. compares local source with remote HEAD and the deployed version;
4. pushes to the configured existing Script ID;
5. re-clones HEAD and proves the pushed source is synchronized;
6. creates an immutable Apps Script version and re-clones that exact version;
7. updates only the configured existing Deployment ID to that version;
8. polls authoritative Apps Script API state for the exact version, Web App
   entry point, access/execution policy, and `/exec` URL;
9. requests the public `/exec` page and requires the source-frozen visible build
   marker before reporting success.

The immediate text/JSON printed by a clasp mutation is advisory. The command
uses post-mutation API state as the authority, so a harmless clasp output change
or short propagation delay does not become a false release failure. If the new
deployment cannot be verified, the command restores and verifies the previous
immutable version automatically.

It never calls `create-deployment`. Do not use **New deployment** for a normal
release.

To deliberately restore a known immutable version without pushing or creating
anything, use:

```bash
npm run gas:recover -- 1 "Restore reviewed version 1"
```

Recovery validates that version's manifest and Web App handler, updates the
same configured Deployment ID, and verifies the unchanged `/exec` URL and
served START UI.

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
- **Visible build token unchanged:** update `data-web-build` in `Index.html`
  when runtime source changes, then commit the reviewed marker with the code.
- **Web App invariant failure:** keep `doGet`, the manifest `webapp` block, and
  the existing `USER_DEPLOYING` / `ANYONE_ANONYMOUS` policy. Do not add an
  `executionApi` block or create a replacement deployment.
- **Workbook access error after deployment:** confirm the execution identity has
  Editor access to the existing spreadsheet and `START_SPREADSHEET_ID` was not
  overridden with a different Script Property.
