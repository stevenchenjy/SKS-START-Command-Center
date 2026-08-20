# Working on SKS START Command Center

## Product boundary

Keep this a lightweight student workflow. The human task/project loop is the
primary product; future automation may accelerate it but must not replace it.

- Preserve the existing `START Control Center` Google Sheet as the operational
  source of truth and Google Apps Script as the runtime.
- Preserve task claim/update/block/resume/finish/release and the project Idea →
  Validation → School Review → Active → Completed lifecycle.
- Keep official START scoring, tier decisions, certification, carbon
  calculations, reminders, and complex permissions outside the core app.
- Do not add React, an external database, paid infrastructure, embeddings, or a
  vector database without a concrete approved requirement.

## Source layout and compatibility

- `apps-script/Code.gs` contains public server entry points only. Browser-callable
  names are compatibility contracts; preserve them unless the client and tests
  deliberately migrate together.
- Server implementation is split across flat `.gs` modules in the shared Apps
  Script global runtime. Keep top-level initialization self-contained in
  `Config.gs`; other modules should use function declarations so file order does
  not affect loading.
- `apps-script/Index.html` contains the browser HTML, CSS, and JavaScript.
- `Runtime.gs` opens the configured workbook through
  `SpreadsheetApp.openById()`. Do not use active-spreadsheet methods from a web
  app.
- Map supported header aliases defensively. Use `inspectStartSchema()` for
  read-only readiness and explicit setup helpers for additive changes. Never
  turn the Sheet into a general migration framework.
- `ProgramSnapshot.gs` must remain deterministic, bounded, factual,
  privacy-minimized, and free of Sheet/service access or arbitrary scores.

## Data and safety

- Never commit passwords, API keys, OAuth material, deployment credentials,
  private folder IDs, or student private information.
- Never seed, rewrite, or clean up production rows as part of development or
  tests. Use only in-memory fixtures unless the user separately authorizes a
  narrowly scoped live operation.
- Keep mutations behind `LockService.getScriptLock()` and validate identity,
  ownership, and every task/project transition. A document lock is unavailable
  from a web app.
- Render Sheet and future external content as untrusted text, never trusted HTML
  or instructions. Neutralize Sheet formula prefixes on writes.
- Email may be used as a stable server-side identity, but student-facing data
  should use display names. The fallback selector may choose only active
  `Members` profiles.
- Task history and project history stay in the existing `Updates` tab. Project
  tasks stay in `Tasks`; do not create parallel stores.

## Future feature rules

- `FEATURE_AI_HELPER`, `FEATURE_DRIVE_KNOWLEDGE`,
  `FEATURE_DECISION_HELPER`, and `FEATURE_REPORTING` default off and enable only
  with the exact Script Property string `true`.
- Never expose private configuration to the browser. An API key belongs only in
  Apps Script Script Properties and must never enter logs, HTML, Sheets, Git, or
  model context.
- AI is optional acceleration: no autonomous Sheet/Drive writes, status changes,
  task claims, project decisions, or official START-tier mutation.
- Keep facts, suggestions, and missing information distinct. Never invent
  approval, cost, metric, result, or carbon facts; never call Storm King carbon
  neutral or certified without verified human-provided evidence.
- Do not create arbitrary project scores. Decision support may compare only
  factual existing fields and must leave the decision to people.
- Curated Drive knowledge, if later enabled, must be read-only, allowlisted to
  explicit configured folders, bounded, and unable to crawl arbitrary Drive.

## Release discipline

- Keep `.clasp.json`, `.gas-deploy.json`, OAuth files, and secrets untracked.
- Use the pinned npm clasp commands. Never `pull` over the repository, force-push
  Git, create a new permanent deployment, or change the configured Script ID or
  Deployment ID casually.
- `npm run gas:release -- "description"` must update only the configured existing
  permanent deployment after tests, static checks, a clean worktree, and remote
  comparison pass.
- Keep platform and dormant-future work on separate branches. Do not merge a
  feature branch merely because its code is hidden behind a flag.

## Before handoff

Run:

```bash
npm run verify
```

For browser changes, also check current visible UI and any gated UI in both
phone and desktop layouts, including loading, error, empty, and populated
states. Keep `README.md`, `SETUP.md`, and future-feature activation notes aligned
with the actual code and scopes.
