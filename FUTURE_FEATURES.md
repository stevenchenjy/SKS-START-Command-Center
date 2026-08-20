# Dormant future features

Everything in this document is optional. The current task/project workflow
remains the product, and every future feature flag defaults to disabled.

## Ask START

Status: engineered and tested on `future/ai-foundation`, hidden and disabled.

Already implemented:

- read-only `askStartAssistant(profileKey, request)` server endpoint;
- deterministic context for a project, available work, waiting-on-school work,
  a program summary, or a proposal draft;
- bounded, email-minimized records and server-owned source IDs;
- current OpenAI Responses API transport with strict Structured Outputs;
- server validation, source hydration, sanitized errors, and no autonomous
  writes;
- hidden desktop/phone interface with loading, error, empty, sourced-fact, and
  relevant-item states;
- mocked tests that make no paid or external requests.

After this future branch has been reviewed and merged, activation requires no
new AI engineering:

1. In **Apps Script → Project Settings → Script Properties**, add
   `OPENAI_API_KEY` with the approved server-side key.
2. Optionally add `OPENAI_MODEL`. If omitted, the documented default is
   `gpt-5.6-luna`.
3. Add `FEATURE_AI_HELPER` with the exact value `true`.
4. Run `npm run verify`, complete phone/desktop review with committee members,
   then release with:

   ```bash
   npm run gas:release -- "Enable reviewed Ask START helper"
   ```

The key must never be placed in Git, HTML, browser JavaScript, Sheets, logs, or
model context. Removing the flag, changing it to anything except lowercase
`true`, or removing the key hides the interface and makes the server refuse.

## Curated Drive / GSA knowledge

Status: interface, selector, mocks, and tests are ready; production extraction
is intentionally stubbed and the feature must stay disabled.

The current selector accepts only explicitly allowlisted folder IDs, supported
Google Docs/Sheets or plain-text candidates, and a bounded number of redacted
excerpts. It cannot browse or write Drive and the manifest has no Drive scope.
If `FEATURE_DRIVE_KNOWLEDGE=true` is set now, Ask START fails closed before a
model call.

Later activation requires a separate security/scope iteration:

1. choose the minimum read-only Google API and scopes for robust Docs/Sheets
   extraction;
2. implement and review the isolated production loader without arbitrary Drive
   traversal;
3. configure private `SKS_START_FOLDER_ID` and/or `GSA_RESOURCE_FOLDER_ID`
   Script Properties;
4. test the execute-as-owner data boundary and school-domain access model;
5. only then set `FEATURE_DRIVE_KNOWLEDGE=true` and release normally.

## Decision helper

Status: pure factual data preparation is ready; no major UI is exposed.

The helpers preserve recorded START Impact, Difficulty, Cost, feasibility,
stage, feedback, validation evidence, success measure, concerns, next action,
and missing information. They never invent values, score, rank, pick a winner,
or make a decision. A later human-facing comparison still needs a deliberately
reviewed lightweight interface before `FEATURE_DECISION_HELPER` is used.

## Reporting

Status: pure bounded report data is ready; no poster, report generator, or
database has been added.

Prepared sections cover recent progress, school decisions, completed projects,
active work, blockers, and upcoming priorities. The workbook has no independent
verification field, so `Observed Result` is always labelled
`reported/not_verified`. A later reporting UI/export can reuse this data after
human review; `FEATURE_REPORTING` remains disabled.
