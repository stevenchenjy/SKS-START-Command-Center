#!/usr/bin/env node

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'apps-script', 'Config.gs');
const SOURCE_PATH = path.join(ROOT, 'apps-script', 'Integrity.gs');
const CONFIG_SOURCE = fs.readFileSync(CONFIG_PATH, 'utf8');
const SOURCE = fs.readFileSync(SOURCE_PATH, 'utf8');
const context = vm.createContext({});
new vm.Script(CONFIG_SOURCE, { filename: CONFIG_PATH }).runInContext(context);
new vm.Script(SOURCE, { filename: SOURCE_PATH }).runInContext(context);

const standaloneContext = vm.createContext({});
new vm.Script(SOURCE, { filename: SOURCE_PATH }).runInContext(standaloneContext);

assert.equal(typeof context.buildDataIntegrityReport_, 'function');
assert.equal(typeof context.buildStartIntegrityReport_, 'function');
assert.equal(typeof standaloneContext.buildDataIntegrityReport_, 'function');

const report = (source, today = '2026-08-20', options) => (
  JSON.parse(JSON.stringify(context.buildDataIntegrityReport_(source, today, options)))
);
const tests = [];

function test(name, work) {
  tests.push({ name, work });
}

function table(headers, rows) {
  return { headers, rows };
}

const HEADERS = {
  Members: ['Email', 'Display Name', 'Active'],
  Metrics: ['Metric'],
  Projects: [
    'Project ID', 'Project Name', 'Linked START Metrics', 'Stage', 'School Feedback',
    'Next Action', 'Project Lead', 'Validation Evidence', 'Success Measure',
    'School Contact', 'Known Concerns', 'Decision Notes', 'Completed Work', 'Observed Result',
    'Results Link'
  ],
  Tasks: [
    'Task ID', 'Task', 'Related Project', 'Related Metric', 'Due Date', 'Status',
    'Claimed By', 'Last Update', 'Blocker', 'Supporting Link'
  ],
  Updates: ['Timestamp', 'Member', 'Task / Project', 'Update', 'Link'],
  Settings: ['Setting', 'Value']
};

function projectRow({
  id = 'P1', name = 'Project', metrics = '', stage = 'Idea', feedback = '',
  next = '', lead = '', evidence = '', success = '', contact = '', concerns = '',
  decision = '', completed = '', observed = '', resultsLink = ''
} = {}) {
  return [
    id, name, metrics, stage, feedback, next, lead, evidence, success,
    contact, concerns, decision, completed, observed, resultsLink
  ];
}

function taskRow({
  id = 'T1', title = 'Task', project = '', metric = '', due = '', status = 'Open',
  owner = '', updated = '2026-08-19', blocker = '', supportingLink = ''
} = {}) {
  return [id, title, project, metric, due, status, owner, updated, blocker, supportingLink];
}

function cleanFixture() {
  return {
    Members: table(HEADERS.Members, [['alice@example.org', 'Alice Student', 'TRUE']]),
    Metrics: table(HEADERS.Metrics, [['Waste']]),
    Projects: table(HEADERS.Projects, [projectRow({
      id: 'P1', name: 'Bin audit', metrics: 'Waste', stage: 'Active',
      next: 'Count bins', lead: 'alice@example.org'
    })]),
    Tasks: table(HEADERS.Tasks, [taskRow({
      id: 'T1', title: 'Audit bins', project: 'P1: Bin audit', metric: 'Waste',
      due: '2026-08-30', status: 'Doing', owner: 'alice@example.org'
    })]),
    Updates: table(HEADERS.Updates, [[
      '2026-08-19T10:00:00Z', 'Alice Student', 'T1: Audit bins', 'Count started', ''
    ]]),
    Settings: table(HEADERS.Settings, [
      ['Task Status Options', 'Open | Doing | Blocked | Done'],
      ['Project Stage Options', 'Idea | Validation | School Review | Active | Completed | Paused | Rejected']
    ])
  };
}

function codes(result) {
  return new Set(Object.keys(result.countsByCode));
}

function assertCodes(result, expected) {
  const actual = codes(result);
  expected.forEach((code) => assert.ok(actual.has(code), `expected issue code ${code}`));
}

test('returns a stable empty issue report for a clean canonical workbook without mutating input', () => {
  const fixture = cleanFixture();
  const before = JSON.stringify(fixture);
  const first = report(fixture);
  const second = report(fixture);

  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(fixture), before);
  assert.equal(first.schemaVersion, 'start-integrity-report/v1');
  assert.equal(first.asOfDate, '2026-08-20');
  assert.deepEqual(first.summary, {
    totalIssues: 0,
    detailIssues: 0,
    omittedIssues: 0,
    bySeverity: {},
    byCategory: {},
    bySheet: {}
  });
  assert.deepEqual(first.countsByCode, {});
  assert.deepEqual(first.issues, []);
  assert.equal(first.truncated, false);
  const standalone = JSON.parse(JSON.stringify(
    standaloneContext.buildDataIntegrityReport_(fixture, '2026-08-20')
  ));
  assert.deepEqual(standalone, first, 'fallback aliases match configured runtime aliases for canonical tables');
});

test('detects duplicate headers, alias collisions, identifiers, settings, and malformed members', () => {
  const fixture = cleanFixture();
  fixture.Tasks = table(
    ['Task ID', 'Task', 'Task Name', 'Status', 'Status'],
    [
      ['DUP', 'First', 'First', 'Doing', 'Doing'],
      ['dup', 'Second', 'Second', 'Doing', 'Doing'],
      ['', 'Missing ID', 'Missing ID', 'Not a status', 'Not a status']
    ]
  );
  fixture.Projects = table(HEADERS.Projects, [
    projectRow({ id: 'DUP', name: 'First' }),
    projectRow({ id: 'dup', name: 'Second' }),
    projectRow({ id: '', name: 'Missing ID', stage: 'Unknown stage' })
  ]);
  fixture.Settings = table(HEADERS.Settings, [['Same Key', 'A'], [' same-key ', 'B']]);
  fixture.Members = table(HEADERS.Members, [
    ['bad-email', 'Same Name', 'maybe'],
    ['DUP@example.org', 'Same Name', 'TRUE'],
    ['dup@example.org', 'Third Name', 'TRUE'],
    ['', 'No Email', 'TRUE'],
    ['missing@example.org', '', 'FALSE'],
    ['collision@example.org', 'dup@example.org', 'FALSE']
  ]);
  fixture.Updates = table(HEADERS.Updates, []);

  const result = report(fixture);
  assertCodes(result, [
    'DUPLICATE_HEADER',
    'AMBIGUOUS_HEADER_ALIAS',
    'DUPLICATE_TASK_ID',
    'MISSING_TASK_ID',
    'INVALID_TASK_STATUS',
    'DUPLICATE_PROJECT_ID',
    'MISSING_PROJECT_ID',
    'INVALID_PROJECT_STAGE',
    'DUPLICATE_SETTING',
    'MALFORMED_MEMBER_EMAIL',
    'DUPLICATE_MEMBER_EMAIL',
    'AMBIGUOUS_MEMBER_DISPLAY_NAME',
    'MEMBER_IDENTITY_NAMESPACE_COLLISION',
    'ACTIVE_MEMBER_MISSING_EMAIL',
    'MEMBER_MISSING_DISPLAY_NAME',
    'UNRECOGNIZED_MEMBER_ACTIVE'
  ]);
  assert.equal(result.countsByCode.DUPLICATE_TASK_ID, 2);
  assert.equal(result.countsByCode.DUPLICATE_PROJECT_ID, 2);
  assert.equal(result.countsByCode.DUPLICATE_MEMBER_EMAIL, 2);
  assert.equal(result.countsByCode.AMBIGUOUS_MEMBER_DISPLAY_NAME, 2);
});

test('reports task state, ownership, association, date, and stale-blocker problems', () => {
  const fixture = {
    Members: table(HEADERS.Members, [
      ['alice@example.org', 'Alice', 'TRUE'],
      ['inactive@example.org', 'Inactive', 'FALSE'],
      ['alex.one@example.org', 'Alex', 'TRUE'],
      ['alex.two@example.org', 'Alex', 'TRUE']
    ]),
    Metrics: table(HEADERS.Metrics, [['Waste'], ['Energy'], [' energy ']]),
    Projects: table(HEADERS.Projects, [
      projectRow({ id: 'P1', name: 'Solar' }),
      projectRow({ id: 'P2', name: 'Solar' }),
      projectRow({ id: 'P3', name: 'Unique' })
    ]),
    Tasks: table(HEADERS.Tasks, [
      taskRow({ id: 'T1', status: 'Open', owner: 'alice@example.org' }),
      taskRow({ id: 'T2', status: 'Doing', owner: '' }),
      taskRow({ id: 'T3', status: 'Blocked', owner: 'alice@example.org', blocker: '', updated: '2026-08-01' }),
      taskRow({ id: 'T4', status: 'Doing', owner: 'inactive@example.org' }),
      taskRow({ id: 'T5', status: 'Doing', owner: 'Nobody' }),
      taskRow({ id: 'T6', status: 'Doing', owner: 'Alex' }),
      taskRow({
        id: 'T7', status: 'Doing', owner: 'alice@example.org', project: 'Missing project',
        metric: 'Missing metric', due: '08/40/2026', updated: 'yesterday'
      }),
      taskRow({ id: 'T8', status: 'Doing', owner: 'alice@example.org', project: 'Solar', metric: 'Energy' }),
      taskRow({ id: 'T9', status: 'Doing', owner: 'alice@example.org', blocker: 'Old blocker' }),
      taskRow({ id: 'T10', status: 'Blocked', owner: 'alice@example.org', blocker: 'Waiting', updated: '' }),
      taskRow({ id: 'T11', status: 'Doing', owner: 'Alice' })
    ]),
    Updates: table(HEADERS.Updates, []),
    Settings: table(HEADERS.Settings, [])
  };
  const result = report(fixture);

  assertCodes(result, [
    'OPEN_TASK_HAS_OWNER',
    'WORKING_TASK_MISSING_OWNER',
    'BLOCKED_TASK_MISSING_BLOCKER',
    'NONBLOCKED_TASK_HAS_BLOCKER',
    'INACTIVE_TASK_OWNER',
    'UNKNOWN_TASK_OWNER',
    'AMBIGUOUS_TASK_OWNER',
    'LEGACY_TASK_OWNER_IDENTITY',
    'MISSING_TASK_PROJECT',
    'AMBIGUOUS_TASK_PROJECT',
    'MISSING_TASK_METRIC',
    'AMBIGUOUS_TASK_METRIC',
    'INVALID_TASK_DUE_DATE',
    'INVALID_TASK_LAST_UPDATE',
    'STALE_BLOCKED_TASK',
    'BLOCKED_TASK_MISSING_LAST_UPDATE'
  ]);
  assert.equal(result.countsByCode.STALE_BLOCKED_TASK, 1);
  assert.equal(result.countsByCode.INVALID_TASK_LAST_UPDATE, 1);
});

test('reports project lifecycle, lead, and metric inconsistencies without inventing history', () => {
  const fixture = {
    Members: table(HEADERS.Members, [
      ['active@example.org', 'Active Member', 'TRUE'],
      ['inactive@example.org', 'Inactive Member', 'FALSE'],
      ['alex.one@example.org', 'Alex', 'TRUE'],
      ['alex.two@example.org', 'Alex', 'TRUE']
    ]),
    Metrics: table(HEADERS.Metrics, [['Energy'], [' energy '], ['Waste']]),
    Projects: table(HEADERS.Projects, [
      projectRow({ id: 'P1', name: 'Validation', stage: 'Validation', next: '' }),
      projectRow({
        id: 'P2', name: 'Review', stage: 'School Review', next: '',
        lead: 'inactive@example.org', metrics: 'Missing metric'
      }),
      projectRow({ id: 'P3', name: 'Active', stage: 'Active', next: '', lead: 'Nobody', metrics: 'Energy' }),
      projectRow({ id: 'P4', name: 'Ambiguous lead', stage: 'Active', next: 'Work', lead: 'Alex' }),
      projectRow({ id: 'P5', name: 'Paused', stage: 'Paused', decision: '' }),
      projectRow({ id: 'P6', name: 'Rejected', stage: 'Rejected', decision: '', feedback: '' }),
      projectRow({ id: 'P7', name: 'Completed', stage: 'Completed', next: 'Still work', completed: '', observed: '' }),
      projectRow({ id: 'P8', name: 'Invalid', stage: 'Someday' })
    ]),
    Tasks: table(HEADERS.Tasks, []),
    Updates: table(HEADERS.Updates, []),
    Settings: table(HEADERS.Settings, [])
  };
  const result = report(fixture);

  assertCodes(result, [
    'WORKING_PROJECT_MISSING_NEXT_ACTION',
    'SCHOOL_REVIEW_MISSING_REQUIRED_FACT',
    'INACTIVE_PROJECT_LEAD',
    'UNKNOWN_PROJECT_LEAD',
    'AMBIGUOUS_PROJECT_LEAD',
    'MISSING_PROJECT_METRIC',
    'AMBIGUOUS_PROJECT_METRIC',
    'PAUSED_PROJECT_MISSING_REASON',
    'REJECTED_PROJECT_MISSING_REASON',
    'COMPLETED_PROJECT_MISSING_WORK',
    'COMPLETED_PROJECT_MISSING_RESULT',
    'COMPLETED_PROJECT_HAS_NEXT_ACTION',
    'INVALID_PROJECT_STAGE'
  ]);
  assert.equal(result.countsByCode.SCHOOL_REVIEW_MISSING_REQUIRED_FACT, 4);
  assert.equal(result.countsByCode.WORKING_PROJECT_MISSING_NEXT_ACTION, 3);
});

test('reports missing row text and malformed links without fetching, leaking, or flagging app-safe links', () => {
  const fixture = cleanFixture();
  fixture.Projects = table(HEADERS.Projects, [
    projectRow({
      id: 'P1', name: 'Bin audit', metrics: 'Waste', stage: 'Active',
      next: 'Count bins', lead: 'alice@example.org',
      resultsLink: 'https://example.edu/results?q=summer#summary'
    }),
    projectRow({
      id: 'P2', name: '', stage: 'Idea',
      resultsLink: 'https://student@example.org/private'
    })
  ]);
  fixture.Tasks = table(HEADERS.Tasks, [
    taskRow({
      id: 'T1', title: 'Audit bins', project: 'P1: Bin audit', metric: 'Waste',
      due: '2026-08-30', status: 'Doing', owner: 'alice@example.org',
      supportingLink: 'docs.example.edu/audit-form'
    }),
    taskRow({
      id: 'student@example.org', title: '', status: 'Open',
      supportingLink: 'ftp://example.edu/file'
    })
  ]);
  fixture.Updates = table(HEADERS.Updates, [
    ['2026-08-19T10:00:00Z', 'Alice Student', 'T1', 'Count started', 'http://example.edu:8080/progress'],
    ['2026-08-19T11:00:00Z', '', 'P1', '', 'javascript:alert(1)']
  ]);
  const before = JSON.stringify(fixture);
  const result = report(fixture);

  assert.equal(JSON.stringify(fixture), before);
  assert.equal(result.summary.totalIssues, 7);
  assert.equal(result.countsByCode.MISSING_PROJECT_NAME, 1);
  assert.equal(result.countsByCode.MISSING_TASK_TITLE, 1);
  assert.equal(result.countsByCode.MISSING_UPDATE_MEMBER, 1);
  assert.equal(result.countsByCode.MISSING_UPDATE_TEXT, 1);
  assert.equal(result.countsByCode.INVALID_TASK_SUPPORTING_LINK, 1);
  assert.equal(result.countsByCode.INVALID_PROJECT_RESULTS_LINK, 1);
  assert.equal(result.countsByCode.INVALID_UPDATE_LINK, 1);
  assert.doesNotMatch(JSON.stringify(result), /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);

  const capped = report(fixture, '2026-08-20', { issueLimit: 3 });
  assert.equal(capped.summary.totalIssues, 7);
  assert.equal(capped.summary.detailIssues, 3);
  assert.equal(capped.summary.omittedIssues, 4);
  assert.deepEqual(capped.countsByCode, result.countsByCode);
  assert.equal(capped.truncated, true);

  ['https://example.edu/path', 'http://127.0.0.1:8080/a', 'docs.example.edu/path'].forEach((link) => {
    assert.equal(context.integrityValidHttpLink_(link), true, `expected valid web link: ${link}`);
  });
  [
    'javascript:alert(1)', 'ftp://example.edu/file', 'https://',
    'https://bad host.example', 'https://student@example.edu/private',
    'https://example.edu:70000/path'
  ].forEach((link) => {
    assert.equal(context.integrityValidHttpLink_(link), false, `expected invalid web link: ${link}`);
  });
});

test('associates Updates conservatively by exact ID, canonical label, ID prefix, or unique name', () => {
  const fixture = {
    Members: table(HEADERS.Members, []),
    Metrics: table(HEADERS.Metrics, []),
    Projects: table(HEADERS.Projects, [projectRow({ id: 'P1', name: 'Unique project' })]),
    Tasks: table(HEADERS.Tasks, [
      taskRow({ id: 'T1', title: 'Duplicate', status: 'Done' }),
      taskRow({ id: 'T2', title: 'Duplicate', status: 'Done' }),
      taskRow({ id: 'T3', title: 'Unique task', status: 'Done' })
    ]),
    Updates: table(HEADERS.Updates, [
      ['2026-08-19T10:00:00Z', 'Former Member', 'T1: Old renamed title', 'Historical label'],
      ['2026-08-19T11:00:00Z', 'Former Member', 'P1: Unique project', 'Project update'],
      ['2026-08-19T12:00:00Z', 'Former Member', 'Duplicate', 'Ambiguous title'],
      ['2026-08-19T13:00:00Z', 'Former Member', 'Deleted task', 'May be historical'],
      ['2026-08-19T14:00:00Z', 'Former Member', '', 'Missing reference'],
      ['not-a-date', 'Former Member', 'T3', 'Bad timestamp'],
      ['', 'Former Member', 'T3', 'Missing timestamp'],
      ['2026-08-21T00:00:00Z', 'Former Member', 'T3', 'Future timestamp']
    ]),
    Settings: table(HEADERS.Settings, [])
  };
  const result = report(fixture);

  assert.equal(result.countsByCode.UNASSOCIATED_UPDATE_REFERENCE, 2);
  assert.equal(result.countsByCode.AMBIGUOUS_UPDATE_REFERENCE, 1);
  assert.equal(result.countsByCode.INVALID_UPDATE_TIMESTAMP, 1);
  assert.equal(result.countsByCode.MISSING_UPDATE_TIMESTAMP, 1);
  assert.equal(result.countsByCode.FUTURE_UPDATE_TIMESTAMP, 1);
});

test('bounds details at 200, reports exact omissions, redacts emails, and is input-order independent', () => {
  const rows = Array.from({ length: 250 }, (_, index) => ({
    rowNumber: index + 2,
    taskId: `student${index}@example.org`,
    task: `Contact owner${index}@example.org`,
    status: 'Not valid'
  }));
  const forward = report({ tasks: rows });
  const reversed = report({ tasks: rows.slice().reverse() });

  assert.deepEqual(forward, reversed);
  assert.equal(forward.summary.totalIssues, 250);
  assert.equal(forward.summary.detailIssues, 200);
  assert.equal(forward.summary.omittedIssues, 50);
  assert.equal(forward.omissions.issueDetails, 50);
  assert.equal(forward.truncated, true);
  assert.doesNotMatch(JSON.stringify(forward), /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  assert.ok(forward.issues.every((issue) => issue.itemLabel.length <= 140));
});

test('reads a Spreadsheet-like in-memory fixture without invoking any write method', () => {
  const fixture = cleanFixture();
  let readCalls = 0;
  let writeCalls = 0;
  const spreadsheet = {
    getSheetByName(name) {
      const source = fixture[name];
      if (!source) return null;
      const values = [source.headers].concat(source.rows);
      return {
        getLastRow: () => values.length,
        getLastColumn: () => source.headers.length,
        getRange() {
          readCalls += 1;
          return {
            getValues: () => values,
            getDisplayValues: () => values,
            setValue() { writeCalls += 1; throw new Error('unexpected write'); },
            setValues() { writeCalls += 1; throw new Error('unexpected write'); }
          };
        },
        setFrozenRows() { writeCalls += 1; throw new Error('unexpected write'); },
        insertColumnsAfter() { writeCalls += 1; throw new Error('unexpected write'); }
      };
    }
  };

  const result = report(spreadsheet);
  assert.equal(result.summary.totalIssues, 0);
  assert.equal(readCalls, 6);
  assert.equal(writeCalls, 0);
});

test('validates the injected date and bounded options', () => {
  assert.throws(
    () => context.buildDataIntegrityReport_({}, '08/20/2026'),
    /real YYYY-MM-DD/i
  );
  assert.throws(
    () => context.buildDataIntegrityReport_({}, '2026-02-30'),
    /real YYYY-MM-DD/i
  );
  assert.throws(
    () => context.buildDataIntegrityReport_({}, '2026-08-20', { issueLimit: 201 }),
    /issueLimit/i
  );
  assert.throws(
    () => context.buildDataIntegrityReport_({}, '2026-08-20', { staleBlockedDays: 0 }),
    /staleBlockedDays/i
  );
  const zeroDetails = report({ tasks: [{ taskId: 'T1', task: 'Task', status: 'bad' }] }, '2026-08-20', {
    issueLimit: 0
  });
  assert.equal(zeroDetails.summary.totalIssues, 1);
  assert.deepEqual(zeroDetails.issues, []);
  assert.equal(zeroDetails.omissions.issueDetails, 1);
});

(async () => {
  let failures = 0;
  for (const { name, work } of tests) {
    try {
      await work();
      console.log(`✓ ${name}`);
    } catch (error) {
      failures += 1;
      console.error(`✗ ${name}`);
      console.error(error && error.stack ? error.stack : error);
    }
  }
  if (failures) {
    console.error(`\n${failures} integrity test(s) failed.`);
    process.exitCode = 1;
    return;
  }
  console.log(`\n${tests.length}/${tests.length} integrity tests passed.`);
})();
