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

Use a durable, school-managed Storm King Google Workspace account that owns the
current permanent deployment and has **Editor** access to the workbook. An Apps
Script project editor is not automatically the owner of an existing versioned
deployment. Do not use a graduating student's personal account.

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

Never commit `.clasprc.json`, `.clasp.json`, `.gas-deploy.json`, OAuth/client
secret files, refresh tokens, passwords, API keys, Script Property values or
coordinator allowlists, private Drive folder IDs, student-data exports, or
private student information.

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

For an additional coordinator, set the private Script Property
`START_COORDINATOR_EMAILS` to the approved Google emails separated by commas,
semicolons, pipes, or newlines. Each coordinator must also have exactly one
active `Members` row. Do not put this allowlist in the Sheet or repository.

The Web App executes as the durable school-managed deployment account so
ordinary members do not need to edit the workbook. Operational access still
fails closed unless `Session.getActiveUser().getEmail()` exactly matches one
active Members row. Google commonly exposes that identity for users in the same
Workspace domain as the deployer, but can withhold it for external/personal
accounts. Use school Google accounts; never restore a client-side profile picker
as an authentication fallback.

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

1. requires a clean, attached `main` exactly synchronized with `origin/main`,
   then runs all tests and static checks;
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

The branch guard deliberately does not apply to `gas:recover`: an already-known
immutable production version must remain recoverable even when the local Git
branch is damaged or unavailable.

To deliberately restore a known immutable version without pushing or creating
anything, replace `<version>` with the exact previous version printed by
`gas:release`—do not guess—and use:

```bash
npm run gas:recover -- <version> "Restore reviewed version <version>"
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
- **Not synchronized with `origin/main`:** fetch, review the difference, and
  resolve it normally. Do not detach HEAD, force-push, or bypass the release
  guard.
- **Visible build token unchanged:** update `START_WEB_BUILD` in `Config.gs` and
  the matching `data-web-build` value/text in `Index.html` whenever runtime
  source changes, then commit the reviewed marker with the code. Keep the Web
  version aligned with `package.json` and `package-lock.json`.
- **Web App invariant failure:** keep `doGet`, the manifest `webapp` block, and
  the existing `USER_DEPLOYING` / `ANYONE_ANONYMOUS` policy. Do not add an
  `executionApi` block or create a replacement deployment.
- **Workbook access error after deployment:** confirm the execution identity has
  Editor access to the existing spreadsheet and `START_SPREADSHEET_ID` was not
  overridden with a different Script Property.

For routine member administration, diagnostics, version history, and ownership
continuity, use [OPERATIONS.md](OPERATIONS.md). Existing versioned Apps Script
deployments do not change owner when a script project is transferred, so keep
the current deployment account active through any planned handoff.
