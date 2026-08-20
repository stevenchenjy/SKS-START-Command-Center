#!/usr/bin/env node

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const TASK_HEADERS = [
  'Task ID', 'Task', 'Related Project', 'Related Metric', 'Interest Tag',
  'Estimated Time', 'Due Date', 'Status', 'Claimed By', 'Last Update',
  'Blocker', 'Supporting Link'
];

const BASE_PROJECT_HEADERS = [
  'Project ID', 'Project Name', 'Problem / Opportunity',
  'Linked START Metrics', 'Carbon Track', 'Stage', 'START Impact',
  'START Difficulty', 'START Cost', 'Local Feasibility', 'Recommendation',
  'School Feedback', 'Next Action', 'Project Lead', 'Results Link'
];

const PROJECT_WORKFLOW_HEADERS = [
  'Validation Evidence', 'Success Measure', 'School Contact',
  'Known Concerns', 'Decision Notes', 'Completed Work', 'Observed Result'
];

const PROJECT_HEADERS = [
  ...BASE_PROJECT_HEADERS,
  ...PROJECT_WORKFLOW_HEADERS
];

const UPDATE_HEADERS = [
  'Timestamp', 'Member', 'Task / Project', 'Update', 'Blocker', 'Next Step',
  'Link'
];

const SETTINGS_HEADERS = ['Setting', 'Value', 'Notes'];
const MEMBER_HEADERS = ['Email', 'Display Name', 'Active'];
const METRIC_HEADERS = [
  'Metric', 'Category', 'Current Tier', 'Status', 'Staff Contact',
  'Waiting On', 'Last Action', 'Last Updated', 'Updated By',
  'Supporting Link', 'Legacy Assigned To'
];
const PROJECT_STAGE_SETTING =
  'Idea | Validation | School Review | Active | Completed | Paused | Rejected';
const STEVEN_KEY = 'steven.chen@sks.org';
const JORDAN_KEY = 'jordan.lee@sks.org';

function displayValue(value) {
  if (value === null || typeof value === 'undefined') return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return value.toISOString();
  }
  return String(value);
}

class FakeRange {
  constructor(sheet, row, column, rowCount = 1, columnCount = 1) {
    this.sheet = sheet;
    this.row = row;
    this.column = column;
    this.rowCount = rowCount;
    this.columnCount = columnCount;
  }

  getDisplayValues() {
    return Array.from({ length: this.rowCount }, (_, rowOffset) => (
      Array.from({ length: this.columnCount }, (_, columnOffset) => (
        displayValue(this.sheet.valueAt(
          this.row + rowOffset,
          this.column + columnOffset
        ))
      ))
    ));
  }

  getValues() {
    return Array.from({ length: this.rowCount }, (_, rowOffset) => (
      Array.from({ length: this.columnCount }, (_, columnOffset) => (
        this.sheet.valueAt(this.row + rowOffset, this.column + columnOffset)
      ))
    ));
  }

  setValue(value) {
    this.sheet.setValueAt(this.row, this.column, value);
    return this;
  }

  setValues(values) {
    assert.equal(values.length, this.rowCount, 'setValues row count');
    values.forEach((rowValues, rowOffset) => {
      assert.equal(rowValues.length, this.columnCount, 'setValues column count');
      rowValues.forEach((value, columnOffset) => {
        this.sheet.setValueAt(
          this.row + rowOffset,
          this.column + columnOffset,
          value
        );
      });
    });
    return this;
  }

  setFontWeight() { return this; }
  setBackground() { return this; }
  setFontColor() { return this; }
  setWrap() { return this; }
}

class FakeSheet {
  constructor(name, rows = [], options = {}) {
    this.name = name;
    this.rows = rows.map((row) => row.slice());
    this.frozenRows = 0;
    this.maxColumns = options.maxColumns || Math.max(
      rows.reduce((maximum, row) => Math.max(maximum, row.length), 0),
      rows.length ? 1 : 26
    );
  }

  getName() {
    return this.name;
  }

  getLastRow() {
    for (let index = this.rows.length - 1; index >= 0; index -= 1) {
      if (this.rows[index].some((value) => displayValue(value) !== '')) {
        return index + 1;
      }
    }
    return 0;
  }

  getLastColumn() {
    let lastColumn = 0;
    this.rows.forEach((row) => {
      for (let index = row.length - 1; index >= 0; index -= 1) {
        if (displayValue(row[index]) !== '') {
          lastColumn = Math.max(lastColumn, index + 1);
          break;
        }
      }
    });
    return lastColumn;
  }

  getRange(row, column, rowCount = 1, columnCount = 1) {
    assert.ok(row >= 1 && column >= 1, 'getRange uses one-based coordinates');
    assert.ok(rowCount >= 1 && columnCount >= 1, 'getRange dimensions are positive');
    assert.ok(
      column + columnCount - 1 <= this.maxColumns,
      `getRange exceeds ${this.name} grid columns`
    );
    return new FakeRange(this, row, column, rowCount, columnCount);
  }

  getMaxColumns() {
    return this.maxColumns;
  }

  insertColumnsAfter(afterPosition, howMany) {
    assert.ok(afterPosition >= 1 && afterPosition <= this.maxColumns);
    assert.ok(howMany >= 1);
    this.rows.forEach((row) => {
      while (row.length < afterPosition) row.push('');
      row.splice(afterPosition, 0, ...Array(howMany).fill(''));
    });
    this.maxColumns += howMany;
    return this;
  }

  valueAt(row, column) {
    return this.rows[row - 1]?.[column - 1] ?? '';
  }

  setValueAt(row, column, value) {
    while (this.rows.length < row) this.rows.push([]);
    while (this.rows[row - 1].length < column) this.rows[row - 1].push('');
    this.rows[row - 1][column - 1] = value;
  }

  appendRow(row) {
    this.rows.push(row.slice());
    return this;
  }

  setFrozenRows(count) {
    this.frozenRows = count;
    return this;
  }

  autoResizeColumns() { return this; }

  rowObject(rowNumber) {
    return Object.fromEntries(
      this.rows[0].map((header, index) => [header, this.valueAt(rowNumber, index + 1)])
    );
  }
}

class FakeSpreadsheet {
  constructor(sheets) {
    this.sheets = Object.fromEntries(sheets.map((sheet) => [sheet.name, sheet]));
  }

  getSheetByName(name) {
    return this.sheets[name] || null;
  }

  insertSheet(name) {
    if (this.sheets[name]) throw new Error(`Sheet ${name} already exists`);
    const sheet = new FakeSheet(name);
    this.sheets[name] = sheet;
    return sheet;
  }
}

function makeFixture({
  empty = false,
  includeMembers = true,
  nameless = false,
  includeMetrics = true,
  projectWorkflowReady = true
} = {}) {
  const taskRows = empty ? [] : [
    [
      'T-001', 'Run a dining hall waste audit', 'Waste Reduction', 'M-01',
      'Data', '45 min', '2026-09-01', 'Open', '', '', '',
      'https://example.edu/audit'
    ],
    [
      'T-002', 'Draft project proposal', 'Native Planting', 'M-02',
      'Writing', '60 min', '2026-09-05', 'Claimed', 'Jordan Lee', '', '', ''
    ],
    [
      'T-003', 'Confirm facilities meeting', 'Energy Dashboard', 'M-03',
      'Outreach', '15 min', '2026-09-07', 'Waiting', STEVEN_KEY, '',
      'Waiting for facilities director', ''
    ],
    [
      'T-004', 'Confirm meter access', 'Energy Dashboard', 'M-03',
      'Outreach', '20 min', '2026-09-08', 'In Progress', JORDAN_KEY, '', '', ''
    ],
    [
      'T-005', 'Publish audit notes', 'Waste Reduction', 'M-01',
      'Writing', '20 min', '2026-09-09', 'Doing', 'Steven Chen', '', '', ''
    ],
    [
      'T-006', 'Archive old checklist', 'Waste Reduction', '',
      'Admin', '10 min', '2026-08-01', 'Done', 'Maya Patel', '', '', ''
    ]
  ];

  const projectRows = empty ? [] : [
    [
      'P-001', 'Waste Reduction', 'Reduce dining hall waste', 'M-01',
      'Direct Carbon Reduction', 'Active', 'High', 'Medium', 'Low', 'Ready',
      'Do Now', '', 'Complete baseline audit', 'Steven Chen', '',
      'Three lunch audits found avoidable waste',
      'Reduce avoidable waste by one third', 'Dining Services',
      'Bin placement may disrupt lunch traffic', '', '', ''
    ],
    [
      'P-002', 'Energy Dashboard', 'Make energy use visible', 'M-03',
      'Data / Measurement Support', 'School Review', 'Medium', 'Medium',
      'Medium', 'Needs Conversation', 'Needs School Decision',
      'Facilities is reviewing access', 'Schedule facilities meeting',
      'Jordan Lee', '', 'Students cannot see current energy use',
      'Publish a weekly dashboard', 'Facilities',
      'Meter permissions and data privacy', '', '', ''
    ],
    [
      'P-003', 'Native Planting', 'Improve campus habitat', 'M-02',
      'Broader Sustainability', 'Paused', 'Medium', 'Low', 'Medium', 'Blocked',
      'Later', '', 'Wait for grounds plan', 'Maya Patel', '', '', '', '', '',
      'Paused until the grounds plan is published', '', ''
    ]
  ];

  const updateRows = empty ? [] : [
    [
      '2026-08-18 10:00', STEVEN_KEY, 'T-003: Confirm facilities meeting',
      'Asked facilities for a meeting', 'Waiting for reply',
      'Follow up Friday', ''
    ]
  ];

  const sheets = [
    new FakeSheet('Tasks', [TASK_HEADERS, ...taskRows]),
    new FakeSheet(
      'Projects',
      [
        projectWorkflowReady ? PROJECT_HEADERS : BASE_PROJECT_HEADERS,
        ...projectRows.map((row) => (
          projectWorkflowReady ? row : row.slice(0, BASE_PROJECT_HEADERS.length)
        ))
      ],
      { maxColumns: projectWorkflowReady ? PROJECT_HEADERS.length : BASE_PROJECT_HEADERS.length }
    ),
    new FakeSheet('Updates', [UPDATE_HEADERS, ...updateRows]),
    new FakeSheet('Settings', [
      SETTINGS_HEADERS,
      ['Program Name', 'Storm King School START Committee', ''],
      ['Student Lead', 'Steven Chen', ''],
      ['System Steward', 'Maya Patel', ''],
      ['Committee Members', 'Steven Chen | Jordan Lee | Maya Patel', ''],
      ['Task Status Options', 'Open | Doing | Blocked | Done', ''],
      ...(projectWorkflowReady
        ? [['Project Stage Options', PROJECT_STAGE_SETTING, '']]
        : [])
    ])
  ];

  if (includeMembers) {
    const memberRows = [
      [STEVEN_KEY, 'Steven Chen', true],
      [JORDAN_KEY, 'Jordan Lee', 'TRUE'],
      ['maya.patel@sks.org', 'Maya Patel', 'yes'],
      ['former.member@sks.org', 'Former Member', false]
    ];
    if (nameless) memberRows.push(['nameless.student@sks.org', '', true]);
    sheets.push(new FakeSheet('Members', [MEMBER_HEADERS, ...memberRows]));
  }

  if (includeMetrics) {
    sheets.push(new FakeSheet('Metrics', [
      METRIC_HEADERS,
      [
        'M-01', 'Waste', 'Tier 1', 'In Progress', 'Dining Services', '',
        'Baseline audit scheduled', '2026-08-17', STEVEN_KEY,
        'https://example.edu/waste', ''
      ],
      [
        'M-02', 'Biodiversity', 'Tier 0', 'Not Started', 'Grounds',
        'Campus grounds plan', '', '', '', '', 'Maya Patel'
      ],
      [
        'M-03', 'Energy', 'Tier 1', 'Waiting', 'Facilities',
        'Meter access', 'Requested a meeting', '2026-08-18', JORDAN_KEY,
        '', ''
      ]
    ]));
  }

  return new FakeSpreadsheet(sheets);
}

let spreadsheet = makeFixture();
let sessionEmail = '';
let flushCount = 0;
let lockHeld = false;

const sandbox = {
  console,
  Date,
  Error,
  Object,
  Array,
  Number,
  String,
  RegExp,
  Math,
  JSON,
  isNaN,
  SpreadsheetApp: {
    openById(id) {
      assert.equal(id, '1XFTIrKIcckrwavS-tJ5E_fReKVR3BlLtsbLUXRhto6I');
      return spreadsheet;
    },
    flush() {
      flushCount += 1;
    }
  },
  Session: {
    getActiveUser() {
      return { getEmail: () => sessionEmail };
    }
  },
  LockService: {
    getScriptLock() {
      return {
        tryLock() {
          if (lockHeld) return false;
          lockHeld = true;
          return true;
        },
        releaseLock() {
          lockHeld = false;
        }
      };
    }
  },
  HtmlService: {
    createHtmlOutputFromFile(file) {
      return {
        file,
        title: '',
        meta: {},
        setTitle(title) {
          this.title = title;
          return this;
        },
        addMetaTag(name, value) {
          this.meta[name] = value;
          return this;
        }
      };
    }
  }
};

const serverDirectory = path.join(__dirname, '..', 'apps-script');
const serverFiles = fs.readdirSync(serverDirectory)
  .filter((fileName) => fileName.endsWith('.gs'))
  .sort();

function loadServerFiles(context, fileNames) {
  fileNames.forEach((fileName) => {
    const serverPath = path.join(serverDirectory, fileName);
    vm.runInContext(fs.readFileSync(serverPath, 'utf8'), context, {
      filename: serverPath
    });
  });
}

vm.createContext(sandbox);
loadServerFiles(sandbox, serverFiles);

const reverseOrderSandbox = {};
vm.createContext(reverseOrderSandbox);
loadServerFiles(reverseOrderSandbox, serverFiles.slice().reverse());

const tests = [];

function test(name, work) {
  tests.push({ name, work });
}

test('loads every Apps Script module in reverse order without top-level dependencies', () => {
  assert.ok(serverFiles.length > 1);
  assert.equal(typeof reverseOrderSandbox.doGet, 'function');
  assert.equal(typeof reverseOrderSandbox.buildDashboardData_, 'function');
  assert.equal(typeof reverseOrderSandbox.mutateTask_, 'function');
  assert.equal(typeof reverseOrderSandbox.loadProjectMutation_, 'function');
  assert.equal(typeof reverseOrderSandbox.readMemberDirectory_, 'function');
  assert.equal(typeof reverseOrderSandbox.readTable_, 'function');
  assert.equal(
    reverseOrderSandbox.PROJECT_STAGE_OPTIONS,
    'Idea | Validation | School Review | Active | Completed | Paused | Rejected'
  );
});

function reset(options) {
  spreadsheet = makeFixture(options);
  sessionEmail = '';
  flushCount = 0;
  lockHeld = false;
}

function taskRow(taskId) {
  const sheet = spreadsheet.getSheetByName('Tasks');
  const rowIndex = sheet.rows.findIndex((row) => row[0] === taskId);
  assert.notEqual(rowIndex, -1, `task ${taskId} exists`);
  return sheet.rowObject(rowIndex + 1);
}

function newestUpdate() {
  const updates = spreadsheet.getSheetByName('Updates');
  return updates.rowObject(updates.getLastRow());
}

function taskFrom(data, taskId) {
  const task = data.tasks.find((candidate) => candidate.taskId === taskId);
  assert.ok(task, `dashboard includes ${taskId}`);
  return task;
}

function projectRow(projectId) {
  const sheet = spreadsheet.getSheetByName('Projects');
  const rowIndex = sheet.rows.findIndex((row) => row[0] === projectId);
  assert.notEqual(rowIndex, -1, `project ${projectId} exists`);
  return sheet.rowObject(rowIndex + 1);
}

function projectFrom(data, projectKey) {
  const project = data.projects.find((candidate) => (
    candidate.projectKey === projectKey || candidate.projectId === projectKey
  ));
  assert.ok(project, `dashboard includes ${projectKey}`);
  return project;
}

function settingValue(settingName) {
  const settings = spreadsheet.getSheetByName('Settings');
  const row = settings.rows.find((candidate) => candidate[0] === settingName);
  assert.ok(row, `setting ${settingName} exists`);
  return row[1];
}

function createIdea(overrides = {}) {
  return sandbox.createProjectIdea(STEVEN_KEY, {
    projectName: 'Refill Station Pilot',
    problemOpportunity: 'Students rely on single-use bottles after practice.',
    note: 'Start with the field house.',
    ...overrides
  });
}

function updateRowsFor(labelPart) {
  const updates = spreadsheet.getSheetByName('Updates');
  return updates.rows.slice(1).filter((row) => String(row[2]).includes(labelPart));
}

test('opens the dashboard HTML entry point', () => {
  const output = sandbox.doGet();
  assert.equal(output.file, 'Index');
  assert.equal(output.title, 'START Command Center');
  assert.equal(output.meta.viewport, 'width=device-width, initial-scale=1');
});

test('reads active Members profiles, display names, updates, and summary counts', () => {
  reset();
  const data = sandbox.getDashboardData(STEVEN_KEY);

  assert.equal(data.viewer.identity, STEVEN_KEY);
  assert.equal(data.viewer.profileKey, STEVEN_KEY);
  assert.equal(data.viewer.displayName, 'Steven Chen');
  assert.equal(data.viewer.email, STEVEN_KEY);
  assert.equal(data.viewer.authMode, 'members_selector');
  assert.equal(data.viewer.needsProfileSelection, false);
  assert.equal(data.members.length, 3);
  assert.deepEqual(
    Array.from(data.members, (member) => member.displayName),
    ['Steven Chen', 'Jordan Lee', 'Maya Patel']
  );
  assert.equal(data.members.some((member) => member.displayName === 'Former Member'), false);
  assert.equal(data.updates[0].member, 'Steven Chen');
  assert.equal(data.tasks.length, 6);
  assert.equal(data.projects.length, 3);
  assert.equal(data.summary.openTasks, 1);
  assert.equal(data.summary.myTasks, 2);
  assert.equal(data.summary.activeProjects, 1);
  assert.equal(data.summary.waitingOnSchool, 2);
});

test('normalizes every legacy task status while preserving owner display mapping', () => {
  reset();
  const data = sandbox.getDashboardData(STEVEN_KEY);

  assert.equal(taskFrom(data, 'T-002').status, 'Doing');
  assert.equal(taskFrom(data, 'T-003').status, 'Blocked');
  assert.equal(taskFrom(data, 'T-004').status, 'Doing');
  assert.equal(taskFrom(data, 'T-003').claimedBy, STEVEN_KEY);
  assert.equal(taskFrom(data, 'T-003').claimedByDisplay, 'Steven Chen');
  assert.equal(taskFrom(data, 'T-002').claimedByDisplay, 'Jordan Lee');
  assert.equal(taskFrom(data, 'T-003').isMine, true);
  assert.equal(taskFrom(data, 'T-005').isMine, true);
});

test('claims an Open task as Doing using email as the stable owner key', () => {
  reset();
  const data = sandbox.claimTask('T-001', STEVEN_KEY);

  assert.equal(taskRow('T-001').Status, 'Doing');
  assert.equal(taskRow('T-001')['Claimed By'], STEVEN_KEY);
  assert.equal(taskFrom(data, 'T-001').status, 'Doing');
  assert.equal(taskFrom(data, 'T-001').claimedByDisplay, 'Steven Chen');
  assert.equal(taskFrom(data, 'T-001').isMine, true);
  assert.equal(newestUpdate().Member, 'Steven Chen');
  assert.match(newestUpdate().Update, /claim/i);
  assert.equal(flushCount, 1);
});

test('requires a blocker explanation before Doing can become Blocked', () => {
  reset();
  sandbox.claimTask('T-001', STEVEN_KEY);
  const rowCount = spreadsheet.getSheetByName('Updates').getLastRow();

  assert.throws(
    () => sandbox.blockTask('T-001', STEVEN_KEY, '   '),
    /blocker|required|waiting/i
  );
  assert.equal(taskRow('T-001').Status, 'Doing');
  assert.equal(taskRow('T-001').Blocker, '');
  assert.equal(spreadsheet.getSheetByName('Updates').getLastRow(), rowCount);
});

test('blocks a Doing task and records the blocker in Updates', () => {
  reset();
  sandbox.claimTask('T-001', STEVEN_KEY);
  const data = sandbox.blockTask(
    'T-001',
    STEVEN_KEY,
    'Need dining staff confirmation'
  );

  assert.equal(taskRow('T-001').Status, 'Blocked');
  assert.equal(taskRow('T-001').Blocker, 'Need dining staff confirmation');
  assert.equal(taskFrom(data, 'T-001').status, 'Blocked');
  assert.equal(newestUpdate().Member, 'Steven Chen');
  assert.equal(newestUpdate().Blocker, 'Need dining staff confirmation');
});

test('resumes a Blocked task, clears its active blocker, and keeps blocker history', () => {
  reset();
  sandbox.claimTask('T-001', STEVEN_KEY);
  sandbox.blockTask('T-001', STEVEN_KEY, 'Need dining staff confirmation');
  const blockedUpdateRow = spreadsheet.getSheetByName('Updates').getLastRow();
  const data = sandbox.resumeTask('T-001', STEVEN_KEY);

  assert.equal(taskRow('T-001').Status, 'Doing');
  assert.equal(taskRow('T-001').Blocker, '');
  assert.equal(taskFrom(data, 'T-001').status, 'Doing');
  assert.equal(
    spreadsheet.getSheetByName('Updates').rowObject(blockedUpdateRow).Blocker,
    'Need dining staff confirmation'
  );
  assert.match(newestUpdate().Update, /resume|work/i);
  assert.equal(newestUpdate().Blocker, 'Need dining staff confirmation');
});

test('adds a progress update without changing task state or active blocker', () => {
  reset();
  const data = sandbox.addTaskUpdate(
    'T-003',
    STEVEN_KEY,
    'Facilities suggested Thursday morning'
  );

  assert.equal(taskRow('T-003').Status, 'Blocked');
  assert.equal(taskRow('T-003').Blocker, 'Waiting for facilities director');
  assert.equal(taskFrom(data, 'T-003').status, 'Blocked');
  assert.equal(newestUpdate().Update, 'Facilities suggested Thursday morning');
  assert.equal(newestUpdate().Blocker, '');
});

test('completes a Doing task with a canonical Done write', () => {
  reset();
  sandbox.claimTask('T-001', STEVEN_KEY);
  const data = sandbox.completeTask('T-001', STEVEN_KEY);

  assert.equal(taskRow('T-001').Status, 'Done');
  assert.equal(taskRow('T-001').Blocker, '');
  assert.equal(taskFrom(data, 'T-001').status, 'Done');
  assert.match(newestUpdate().Update, /done|complete/i);
});

test('releases a Doing task back to Open and clears the owner', () => {
  reset();
  sandbox.claimTask('T-001', STEVEN_KEY);
  const data = sandbox.releaseTask('T-001', STEVEN_KEY);

  assert.equal(taskRow('T-001').Status, 'Open');
  assert.equal(taskRow('T-001')['Claimed By'], '');
  assert.equal(taskRow('T-001').Blocker, '');
  assert.equal(taskFrom(data, 'T-001').status, 'Open');
  assert.equal(taskFrom(data, 'T-001').isOpen, true);
  assert.match(newestUpdate().Update, /release/i);
});

test('recognizes an automatic Google email and displays the matching member name', () => {
  reset();
  sessionEmail = 'STEVEN.CHEN@SKS.ORG';
  const data = sandbox.claimTask('T-001', '');

  assert.equal(data.viewer.email, STEVEN_KEY);
  assert.equal(data.viewer.profileKey, STEVEN_KEY);
  assert.equal(data.viewer.displayName, 'Steven Chen');
  assert.equal(data.viewer.authMode, 'google');
  assert.equal(taskRow('T-001')['Claimed By'], STEVEN_KEY);
  assert.equal(newestUpdate().Member, 'Steven Chen');
});

test('uses a temporary name and lets an email-backed member save a display name', () => {
  reset({ nameless: true });
  sessionEmail = 'nameless.student@sks.org';
  const before = sandbox.getDashboardData('');

  assert.equal(before.viewer.needsDisplayName, true);
  assert.ok(before.viewer.displayName);
  assert.notEqual(before.viewer.displayName, 'nameless.student@sks.org');

  const after = sandbox.saveMyDisplayName('Nora Student');
  const members = spreadsheet.getSheetByName('Members');
  const rowNumber = members.rows.findIndex((row) => row[0] === sessionEmail) + 1;
  assert.ok(rowNumber > 1);
  assert.equal(members.rowObject(rowNumber)['Display Name'], 'Nora Student');
  assert.equal(after.viewer.displayName, 'Nora Student');
  assert.equal(after.viewer.needsDisplayName, false);
});

test('falls back to active Members profiles when Google email is unavailable', () => {
  reset();
  const selected = sandbox.getDashboardData(JORDAN_KEY);
  const inactive = sandbox.getDashboardData('former.member@sks.org');

  assert.equal(selected.viewer.email, JORDAN_KEY);
  assert.equal(selected.viewer.profileKey, JORDAN_KEY);
  assert.equal(selected.viewer.displayName, 'Jordan Lee');
  assert.equal(selected.viewer.authMode, 'members_selector');
  assert.equal(inactive.viewer.profileKey, '');
  assert.equal(inactive.viewer.displayName, '');
  assert.throws(
    () => sandbox.claimTask('T-001', 'former.member@sks.org'),
    /active|member|profile/i
  );
});

test('preserves the Settings-backed fallback when Members does not exist yet', () => {
  reset({ includeMembers: false });
  const data = sandbox.getDashboardData('Steven Chen');

  assert.equal(data.viewer.profileKey, 'Steven Chen');
  assert.equal(data.viewer.displayName, 'Steven Chen');
  assert.equal(data.members.some((member) => member.displayName === 'Steven Chen'), true);

  sandbox.claimTask('T-001', 'Steven Chen');
  assert.equal(taskRow('T-001').Status, 'Doing');
  assert.equal(taskRow('T-001')['Claimed By'], 'Steven Chen');
});

test('creates a missing Members sheet safely and leaves production task rows untouched', () => {
  reset({ includeMembers: false });
  const tasksBefore = JSON.stringify(spreadsheet.getSheetByName('Tasks').rows);
  const result = sandbox.setupMembersSheet();
  const members = spreadsheet.getSheetByName('Members');

  assert.ok(result);
  assert.ok(members);
  assert.deepEqual(members.rows[0], MEMBER_HEADERS);
  assert.equal(JSON.stringify(spreadsheet.getSheetByName('Tasks').rows), tasksBefore);

  const rowCount = members.getLastRow();
  sandbox.setupMembersSheet();
  assert.equal(members.getLastRow(), rowCount);
  assert.deepEqual(members.rows[0], MEMBER_HEADERS);
});

test('accepts migrated owners stored as either email or display name', () => {
  reset();
  sandbox.addTaskUpdate('T-003', STEVEN_KEY, 'Updated email-owned task');
  sandbox.addTaskUpdate('T-005', STEVEN_KEY, 'Updated name-owned task');

  assert.equal(taskRow('T-003')['Claimed By'], STEVEN_KEY);
  assert.equal(taskRow('T-005')['Claimed By'], STEVEN_KEY);
  assert.equal(newestUpdate().Member, 'Steven Chen');
});

test('keeps the legacy updateTask entry point but writes only canonical statuses', () => {
  reset();
  sandbox.updateTask(
    'T-005',
    STEVEN_KEY,
    'Waiting',
    'Sent the notes for review',
    'Waiting for editor review'
  );
  assert.equal(taskRow('T-005').Status, 'Blocked');

  sandbox.updateTask(
    'T-005',
    STEVEN_KEY,
    'In Progress',
    'Editor review arrived',
    ''
  );
  assert.equal(taskRow('T-005').Status, 'Doing');
  assert.equal(taskRow('T-005').Blocker, '');

  sandbox.updateTask('T-005', STEVEN_KEY, 'Claimed', '', '');
  assert.equal(taskRow('T-005').Status, 'Doing');

  sandbox.completeTask('T-005', STEVEN_KEY);
  const updatesBeforeInvalidTransition = spreadsheet.getSheetByName('Updates').getLastRow();
  assert.throws(
    () => sandbox.updateTask('T-005', STEVEN_KEY, 'Open', 'Reopen completed work', ''),
    /cannot change|Done|current state/i
  );
  assert.equal(taskRow('T-005').Status, 'Done');
  assert.equal(spreadsheet.getSheetByName('Updates').getLastRow(), updatesBeforeInvalidTransition);
});

test('prevents a second member from taking or editing another member\'s task', () => {
  reset();
  sandbox.claimTask('T-001', STEVEN_KEY);

  assert.throws(
    () => sandbox.claimTask('T-001', JORDAN_KEY),
    /no longer open|already/i
  );
  assert.throws(
    () => sandbox.addTaskUpdate('T-001', JORDAN_KEY, 'Not mine'),
    /only|owner|claimed|Steven/i
  );
  assert.throws(
    () => sandbox.completeTask('T-003', JORDAN_KEY),
    /only|owner|claimed|Steven/i
  );
  assert.equal(taskRow('T-001').Status, 'Doing');
  assert.equal(taskRow('T-003').Status, 'Waiting');
});

test('stores update and blocker formula markers as literal text', () => {
  reset();
  sandbox.claimTask('T-001', STEVEN_KEY);
  sandbox.addTaskUpdate(
    'T-001',
    STEVEN_KEY,
    '=HYPERLINK("https://example.test", "progress")'
  );
  assert.equal(
    newestUpdate().Update,
    "'=HYPERLINK(\"https://example.test\", \"progress\")"
  );

  sandbox.blockTask('T-001', STEVEN_KEY, '+SUM(1, 1)');
  assert.equal(taskRow('T-001').Blocker, "'+SUM(1, 1)");
  assert.equal(newestUpdate().Blocker, "'+SUM(1, 1)");
});

test('keeps a blank-ID task action attached after the sheet is sorted', () => {
  reset();
  const tasks = spreadsheet.getSheetByName('Tasks');
  tasks.rows.push([
    '', 'Task without an ID', 'Waste Reduction', 'M-01', 'Data', '10 min',
    '2026-09-08', 'Open', '', '', '', ''
  ]);
  const key = sandbox.getDashboardData(STEVEN_KEY).tasks
    .find((task) => task.task === 'Task without an ID').taskKey;

  const moved = tasks.rows.pop();
  tasks.rows.splice(1, 0, moved);
  sandbox.claimTask(key, STEVEN_KEY);

  const movedRow = tasks.rows.findIndex((row) => row[1] === 'Task without an ID') + 1;
  assert.equal(tasks.rowObject(movedRow).Status, 'Doing');
  assert.equal(tasks.rowObject(movedRow)['Claimed By'], STEVEN_KEY);
  assert.equal(taskRow('T-001').Status, 'Open');
});

test('returns useful empty collections when data sheets contain headers only', () => {
  reset({ empty: true });
  const data = sandbox.getDashboardData(STEVEN_KEY);

  assert.equal(data.tasks.length, 0);
  assert.equal(data.projects.length, 0);
  assert.equal(data.updates.length, 0);
  assert.equal(data.summary.openTasks, 0);
  assert.equal(data.summary.myTasks, 0);
  assert.equal(data.summary.activeProjects, 0);
  assert.equal(data.summary.waitingOnSchool, 0);
});

test('maps small supported task and project header variations defensively', () => {
  reset({ empty: true });
  spreadsheet.sheets.Tasks = new FakeSheet('Tasks', [
    [
      'ID', 'Title', 'Project', 'Metric', 'Tag', 'Estimate', 'Deadline',
      'Task Status', 'Assignee', 'Last Updated', 'Current Blocker', 'URL'
    ],
    ['ALT-1', 'Check alias mapping', '', '', '', '', '', 'Todo', '', '', '', '']
  ]);
  spreadsheet.sheets.Projects = new FakeSheet('Projects', [
    ['ID', 'Name', 'Project Stage', 'Feasibility', 'Feedback', 'Next Step', 'Lead'],
    ['ALT-P', 'Alias project', 'Validation', 'Ready', '', 'Talk to students', 'Maya Patel']
  ]);

  const data = sandbox.getDashboardData(STEVEN_KEY);
  assert.equal(data.tasks[0].task, 'Check alias mapping');
  assert.equal(data.tasks[0].status, 'Open');
  assert.equal(data.projects[0].projectName, 'Alias project');
  assert.equal(data.projects[0].nextAction, 'Talk to students');
});

test('reads Metrics and enriches projects with workflow fields and related tasks', () => {
  reset();
  const data = sandbox.getDashboardData(STEVEN_KEY);
  const project = projectFrom(data, 'P-001');

  assert.equal(data.metrics.length, 3);
  assert.equal(data.metrics[0].metric, 'M-01');
  assert.equal(data.metrics[0].category, 'Waste');
  assert.equal(data.metrics[0].currentTier, 'Tier 1');
  assert.equal(data.metrics[0].updatedBy, 'Steven Chen');
  assert.deepEqual(Array.from(project.linkedMetricNames), ['M-01']);
  assert.equal(project.validationEvidence, 'Three lunch audits found avoidable waste');
  assert.equal(project.successMeasure, 'Reduce avoidable waste by one third');
  assert.deepEqual(
    Array.from(project.relatedTasks, (task) => task.taskId).sort(),
    ['T-001', 'T-005', 'T-006']
  );
});

test('creates a lightweight Idea with a unique ID, no required lead, and creation history', () => {
  reset();
  const beforeProjects = spreadsheet.getSheetByName('Projects').getLastRow();
  const beforeUpdates = spreadsheet.getSheetByName('Updates').getLastRow();
  const result = createIdea({ linkedStartMetrics: 'M-01' });
  const projectKey = result.mutation.projectKey;
  const row = projectRow(projectKey);

  assert.match(projectKey, /^PRJ-\d{8}-\d{3}$/);
  assert.equal(spreadsheet.getSheetByName('Projects').getLastRow(), beforeProjects + 1);
  assert.equal(row['Project Name'], 'Refill Station Pilot');
  assert.equal(
    row['Problem / Opportunity'],
    'Students rely on single-use bottles after practice.'
  );
  assert.equal(row['Linked START Metrics'], 'M-01');
  assert.equal(row.Stage, 'Idea');
  assert.equal(row['Project Lead'], '');
  assert.equal(projectFrom(result, projectKey).stage, 'Idea');
  assert.equal(spreadsheet.getSheetByName('Updates').getLastRow(), beforeUpdates + 1);
  assert.equal(newestUpdate()['Task / Project'], `${projectKey}: Refill Station Pilot`);
  assert.match(newestUpdate().Update, /created|idea|submitted/i);
  assert.match(newestUpdate().Update, /field house/i);
});

test('generates collision-free Project IDs for multiple Ideas created together', () => {
  reset();
  const first = createIdea({ projectName: 'First New Idea' }).mutation.projectKey;
  const second = createIdea({ projectName: 'Second New Idea' }).mutation.projectKey;
  const ids = spreadsheet.getSheetByName('Projects').rows.slice(1).map((row) => row[0]);

  assert.notEqual(first, second);
  assert.equal(new Set(ids).size, ids.length);
  assert.match(first, /^PRJ-\d{8}-\d{3}$/);
  assert.match(second, /^PRJ-\d{8}-\d{3}$/);
});

test('moves an Idea to Validation and preserves its original information and history', () => {
  reset();
  const created = createIdea();
  const projectKey = created.mutation.projectKey;
  const problemBefore = projectRow(projectKey)['Problem / Opportunity'];
  const historyBefore = updateRowsFor(projectKey).length;
  const result = sandbox.startProjectValidation(projectKey, STEVEN_KEY);

  assert.equal(projectRow(projectKey).Stage, 'Validation');
  assert.equal(projectRow(projectKey)['Problem / Opportunity'], problemBefore);
  assert.equal(projectFrom(result, projectKey).stage, 'Validation');
  assert.ok(updateRowsFor(projectKey).length > historyBefore);
});

test('keeps Needs More Information in Validation with the missing work as Next Action', () => {
  reset();
  const projectKey = createIdea().mutation.projectKey;
  sandbox.startProjectValidation(projectKey, STEVEN_KEY);
  const result = sandbox.saveProjectValidation(projectKey, STEVEN_KEY, {
    validationEvidence: 'Bottle counts from three practices show repeated purchases.',
    successMeasure: 'Fewer than ten single-use bottles after each practice.',
    schoolContact: 'Athletics and Facilities',
    knownConcerns: 'Need a safe location and a plumbing check.',
    localFeasibility: 'Needs Conversation',
    linkedStartMetrics: 'M-01',
    nextAction: 'Ask Facilities to inspect the field house plumbing.',
    outcome: 'more_info'
  });
  const row = projectRow(projectKey);

  assert.equal(row.Stage, 'Validation');
  assert.equal(row['Next Action'], 'Ask Facilities to inspect the field house plumbing.');
  assert.equal(row['Local Feasibility'], 'Needs Conversation');
  assert.equal(projectFrom(result, projectKey).stage, 'Validation');
});

test('moves validated work to School Review and marks it as waiting on school', () => {
  reset();
  const projectKey = createIdea().mutation.projectKey;
  sandbox.startProjectValidation(projectKey, STEVEN_KEY);
  const result = sandbox.saveProjectValidation(projectKey, STEVEN_KEY, {
    validationEvidence: 'Bottle counts from three practices show repeated purchases.',
    successMeasure: 'Fewer than ten single-use bottles after each practice.',
    schoolContact: 'Athletics and Facilities',
    knownConcerns: 'Need a safe location and a plumbing check.',
    localFeasibility: 'Needs Conversation',
    linkedStartMetrics: 'M-01',
    nextAction: 'Facilities reviews location and installation.',
    outcome: 'school_review'
  });
  const row = projectRow(projectKey);
  const project = projectFrom(result, projectKey);

  assert.equal(row.Stage, 'School Review');
  assert.equal(row['Validation Evidence'], 'Bottle counts from three practices show repeated purchases.');
  assert.equal(row['Success Measure'], 'Fewer than ten single-use bottles after each practice.');
  assert.equal(row['School Contact'], 'Athletics and Facilities');
  assert.equal(row['Known Concerns'], 'Need a safe location and a plumbing check.');
  assert.equal(row['Next Action'], 'Waiting on school review');
  assert.equal(project.stage, 'School Review');
  assert.equal(project.isWaitingOnSchool, true);
});

test('approves School Review into Active while preserving the school decision', () => {
  reset();
  const result = sandbox.recordSchoolReview('P-002', STEVEN_KEY, {
    outcome: 'approved',
    consulted: 'Facilities Director',
    schoolFeedback: 'Approved for a limited dashboard pilot.',
    nextAction: 'Build the first dashboard view.',
    localFeasibility: 'Ready'
  });
  const row = projectRow('P-002');

  assert.equal(row.Stage, 'Active');
  assert.equal(row['School Contact'], 'Facilities Director');
  assert.equal(row['School Feedback'], 'Approved for a limited dashboard pilot.');
  assert.equal(row['Next Action'], 'Build the first dashboard view.');
  assert.equal(row['Local Feasibility'], 'Ready');
  assert.equal(projectFrom(result, 'P-002').stage, 'Active');
  assert.match(newestUpdate().Update, /approved|active/i);
});

test('returns Needs Revision to Validation without losing school feedback', () => {
  reset();
  const result = sandbox.recordSchoolReview('P-002', STEVEN_KEY, {
    outcome: 'revision',
    consulted: 'Facilities and IT',
    schoolFeedback: 'Revise the dashboard to use aggregate data only.',
    nextAction: 'Document an aggregate-only data plan.',
    localFeasibility: 'Needs Conversation'
  });
  const row = projectRow('P-002');

  assert.equal(row.Stage, 'Validation');
  assert.equal(row['School Contact'], 'Facilities and IT');
  assert.equal(row['School Feedback'], 'Revise the dashboard to use aggregate data only.');
  assert.equal(row['Decision Notes'], 'Revise the dashboard to use aggregate data only.');
  assert.equal(row['Next Action'], 'Document an aggregate-only data plan.');
  assert.equal(row.Recommendation, 'Needs Revision');
  assert.equal(projectFrom(result, 'P-002').stage, 'Validation');
});

test('records a declined School Review as Rejected and preserves its reason', () => {
  reset();
  const result = sandbox.recordSchoolReview('P-002', STEVEN_KEY, {
    outcome: 'declined',
    consulted: 'Facilities Director',
    schoolFeedback: 'Meter data cannot be shared under the current agreement.',
    nextAction: '',
    localFeasibility: 'Blocked'
  });
  const row = projectRow('P-002');

  assert.equal(row.Stage, 'Rejected');
  assert.equal(row['School Feedback'], 'Meter data cannot be shared under the current agreement.');
  assert.equal(row['Decision Notes'], 'Meter data cannot be shared under the current agreement.');
  assert.equal(row.Recommendation, 'Declined');
  assert.equal(projectFrom(result, 'P-002').stage, 'Rejected');
});

test('pauses an Active project with a reason and a reconsideration step', () => {
  reset();
  const result = sandbox.pauseProject(
    'P-001',
    STEVEN_KEY,
    'Dining hall renovation makes the audit unreliable.',
    'Reconsider after the dining hall reopens in October.'
  );
  const row = projectRow('P-001');

  assert.equal(row.Stage, 'Paused');
  assert.equal(row['Decision Notes'], 'Dining hall renovation makes the audit unreliable.');
  assert.equal(row['Next Action'], 'Reconsider after the dining hall reopens in October.');
  assert.equal(row.Recommendation, 'Paused');
  assert.equal(projectFrom(result, 'P-001').stage, 'Paused');
});

test('completes an Active project with observed results and keeps tasks and history', () => {
  reset();
  sandbox.addProjectUpdate(
    'P-001',
    STEVEN_KEY,
    'The final waste audit is complete.',
    'Share results with Dining Services.'
  );
  const taskRowsBefore = JSON.stringify(spreadsheet.getSheetByName('Tasks').rows);
  const historyBefore = updateRowsFor('P-001').map((row) => row[3]);
  const result = sandbox.completeProject('P-001', STEVEN_KEY, {
    completedWork: 'Completed five lunch audits and changed bin signage.',
    observedResult: 'Avoidable waste fell by 28 percent.',
    resultsLink: 'https://example.edu/waste-results'
  });
  const row = projectRow('P-001');
  const historyAfter = updateRowsFor('P-001').map((updateRow) => updateRow[3]);

  assert.equal(row.Stage, 'Completed');
  assert.equal(row['Completed Work'], 'Completed five lunch audits and changed bin signage.');
  assert.equal(row['Observed Result'], 'Avoidable waste fell by 28 percent.');
  assert.equal(row['Results Link'], 'https://example.edu/waste-results');
  assert.equal(row['Next Action'], '');
  assert.equal(JSON.stringify(spreadsheet.getSheetByName('Tasks').rows), taskRowsBefore);
  historyBefore.forEach((entry) => assert.ok(historyAfter.includes(entry)));
  assert.ok(projectFrom(result, 'P-001').recentUpdates.length >= 2);
  assert.match(newestUpdate().Update, /observed result: Avoidable waste fell by 28 percent/i);
  assert.equal(newestUpdate()['Next Step'], '');
});

test('adds an unclaimed Open task only from Active and inherits one obvious metric', () => {
  reset();
  const beforeRows = spreadsheet.getSheetByName('Tasks').getLastRow();
  assert.throws(
    () => sandbox.addProjectTask('P-001', STEVEN_KEY, {
      task: 'Missing practical planning fields',
      estimatedTime: '30 min'
    }),
    /Interest tag|required/i
  );
  assert.throws(
    () => sandbox.addProjectTask('P-001', STEVEN_KEY, {
      task: 'Still missing a practical planning field',
      interestTag: 'Data'
    }),
    /Estimated time|required/i
  );
  assert.equal(spreadsheet.getSheetByName('Tasks').getLastRow(), beforeRows);
  const result = sandbox.addProjectTask('P-001', STEVEN_KEY, {
    task: 'Weigh waste after Friday lunch',
    interestTag: 'Data',
    estimatedTime: '30 min',
    dueDate: '2026-09-18',
    supportingLink: 'https://example.edu/audit-form'
  });
  const taskKey = result.mutation.taskKey;
  const row = taskRow(taskKey);

  assert.match(taskKey, /^TASK-\d{8}-\d{3}$/);
  assert.equal(spreadsheet.getSheetByName('Tasks').getLastRow(), beforeRows + 1);
  assert.equal(row['Related Project'], 'P-001: Waste Reduction');
  assert.equal(row['Related Metric'], 'M-01');
  assert.equal(row.Status, 'Open');
  assert.equal(row['Claimed By'], '');
  assert.equal(taskFrom(result, taskKey).isOpen, true);
  assert.ok(projectFrom(result, 'P-001').relatedTasks.some((task) => task.taskId === taskKey));

  const rowsAfterActiveAdd = spreadsheet.getSheetByName('Tasks').getLastRow();
  assert.throws(
    () => sandbox.addProjectTask('P-002', STEVEN_KEY, {
      task: 'This should not be created',
      interestTag: 'Data',
      estimatedTime: '10 min'
    }),
    /Active|stage|task/i
  );
  assert.equal(spreadsheet.getSheetByName('Tasks').getLastRow(), rowsAfterActiveAdd);
});

test('leaves Related Metric blank when an Active project links multiple metrics', () => {
  reset();
  spreadsheet.getSheetByName('Projects').appendRow([
    'P-004', 'Mixed Metrics Pilot', 'Test a cross-category project.',
    'M-01 | M-02', '', 'Active', '', '', '', 'Ready', '', '',
    'Create the first task', '', '', '', '', '', '', '', '', ''
  ]);
  const result = sandbox.addProjectTask('P-004', STEVEN_KEY, {
    task: 'Define the mixed-metric baseline',
    interestTag: 'Data',
    estimatedTime: '45 min'
  });

  assert.equal(taskRow(result.mutation.taskKey)['Related Metric'], '');
});

test('posts project updates to the shared Updates sheet and edits Next Action', () => {
  reset();
  const result = sandbox.addProjectUpdate(
    'P-001',
    STEVEN_KEY,
    'Dining Services confirmed the new signage locations.',
    'Print and install the signs.'
  );
  const update = newestUpdate();

  assert.equal(update.Member, 'Steven Chen');
  assert.equal(update['Task / Project'], 'P-001: Waste Reduction');
  assert.equal(update.Update, 'Dining Services confirmed the new signage locations.');
  assert.equal(update['Next Step'], 'Print and install the signs.');
  assert.equal(projectRow('P-001')['Next Action'], 'Print and install the signs.');
  assert.ok(projectFrom(result, 'P-001').recentUpdates.some((entry) => (
    entry.update === 'Dining Services confirmed the new signage locations.'
  )));
});

test('resolves related tasks and project Updates stored by ID, name, or canonical label', () => {
  reset();
  spreadsheet.getSheetByName('Tasks').appendRow([
    'T-007', 'ID-linked task', 'P-001', '', 'Data', '15 min', '',
    'Open', '', '', '', ''
  ]);
  spreadsheet.getSheetByName('Updates').appendRow([
    '2026-08-19 08:00', STEVEN_KEY, 'Waste Reduction',
    'Legacy name-only project update', '', '', ''
  ]);
  spreadsheet.getSheetByName('Updates').appendRow([
    '2026-08-19 09:00', STEVEN_KEY, 'P-001',
    'ID-only project update', '', '', ''
  ]);
  spreadsheet.getSheetByName('Updates').appendRow([
    '2026-08-19 10:00', STEVEN_KEY, 'P-001: Waste Reduction',
    'Canonical project update', '', '', ''
  ]);
  const project = projectFrom(sandbox.getDashboardData(STEVEN_KEY), 'P-001');
  const taskIds = Array.from(project.relatedTasks, (task) => task.taskId);
  const updateTexts = Array.from(project.recentUpdates, (update) => update.update);

  assert.ok(taskIds.includes('T-001'));
  assert.ok(taskIds.includes('T-007'));
  assert.ok(updateTexts.includes('Legacy name-only project update'));
  assert.ok(updateTexts.includes('ID-only project update'));
  assert.ok(updateTexts.includes('Canonical project update'));

  spreadsheet.getSheetByName('Projects').appendRow([
    'P-004', 'Waste Reduction', 'A separate project with the same display name', '', '', 'Idea'
  ]);
  const duplicateData = sandbox.getDashboardData(STEVEN_KEY);
  const originalAfterDuplicate = projectFrom(duplicateData, 'P-001');
  const duplicateProject = projectFrom(duplicateData, 'P-004');
  const originalTaskIds = Array.from(originalAfterDuplicate.relatedTasks, (task) => task.taskId);
  const originalUpdateTexts = Array.from(originalAfterDuplicate.recentUpdates, (update) => update.update);
  const duplicateUpdateTexts = Array.from(duplicateProject.recentUpdates, (update) => update.update);

  assert.ok(originalTaskIds.includes('T-007'));
  assert.equal(originalTaskIds.includes('T-001'), false);
  assert.ok(originalUpdateTexts.includes('ID-only project update'));
  assert.ok(originalUpdateTexts.includes('Canonical project update'));
  assert.equal(originalUpdateTexts.includes('Legacy name-only project update'), false);
  assert.equal(duplicateUpdateTexts.includes('Legacy name-only project update'), false);
});

test('normalizes legacy project stages without rewriting their stored rows', () => {
  reset();
  spreadsheet.getSheetByName('Projects').appendRow([
    'P-004', 'Legacy Proposal', 'Awaiting review', '', '', 'Proposal Ready'
  ]);
  spreadsheet.getSheetByName('Projects').appendRow([
    'P-005', 'Legacy Pilot', 'Already under way', '', '', 'Pilot'
  ]);
  const data = sandbox.getDashboardData(STEVEN_KEY);

  assert.equal(projectFrom(data, 'P-004').stage, 'School Review');
  assert.equal(projectFrom(data, 'P-005').stage, 'Active');
  assert.equal(projectRow('P-004').Stage, 'Proposal Ready');
  assert.equal(projectRow('P-005').Stage, 'Pilot');
});

test('returns a useful project and metrics payload when Projects has no data rows', () => {
  reset({ empty: true });
  const data = sandbox.getDashboardData(STEVEN_KEY);

  assert.deepEqual(Array.from(data.projects), []);
  assert.equal(data.metrics.length, 3);
  assert.equal(data.summary.activeProjects, 0);
  assert.equal(data.summary.waitingOnSchoolProjects, 0);
  assert.equal(data.summary.ideasNeedingValidation, 0);
});

test('rejects invalid project transitions without changing the row or history', () => {
  reset();
  const projectBefore = JSON.stringify(projectRow('P-001'));
  const updatesBefore = spreadsheet.getSheetByName('Updates').getLastRow();

  assert.throws(
    () => sandbox.startProjectValidation('P-001', STEVEN_KEY),
    /Idea|Validation|transition|stage/i
  );
  assert.equal(JSON.stringify(projectRow('P-001')), projectBefore);
  assert.equal(spreadsheet.getSheetByName('Updates').getLastRow(), updatesBefore);
});

test('rejects project mutations from inactive or unknown identities', () => {
  reset();
  const rowsBefore = spreadsheet.getSheetByName('Projects').getLastRow();

  assert.throws(
    () => sandbox.createProjectIdea('former.member@sks.org', {
      projectName: 'Unauthorized Idea',
      problemOpportunity: 'This row must not be created.'
    }),
    /active|member|profile/i
  );
  assert.throws(
    () => sandbox.pauseProject(
      'P-001',
      'unknown.student@sks.org',
      'Unauthorized pause',
      ''
    ),
    /active|member|profile/i
  );
  assert.equal(spreadsheet.getSheetByName('Projects').getLastRow(), rowsBefore);
  assert.equal(projectRow('P-001').Stage, 'Active');
});

test('validates required project text and stores formula markers as literal Sheet text', () => {
  reset();
  assert.throws(
    () => sandbox.createProjectIdea(STEVEN_KEY, {
      projectName: ' ',
      problemOpportunity: 'A real problem.'
    }),
    /Project Name|required/i
  );
  assert.throws(
    () => sandbox.createProjectIdea(STEVEN_KEY, {
      projectName: 'Overlong idea',
      problemOpportunity: 'x'.repeat(5001)
    }),
    /characters|long|fewer/i
  );

  const created = sandbox.createProjectIdea(STEVEN_KEY, {
    projectName: '=HYPERLINK("https://example.test", "Unsafe")',
    problemOpportunity: '+SUM(1, 1)',
    note: '@IMPORTDATA("https://example.test")'
  });
  const row = projectRow(created.mutation.projectKey);
  assert.equal(row['Project Name'], "'=HYPERLINK(\"https://example.test\", \"Unsafe\")");
  assert.equal(row['Problem / Opportunity'], "'+SUM(1, 1)");
  assert.match(newestUpdate().Update, /^'/);

  const validationKey = createIdea({ projectName: 'Validation Safety' }).mutation.projectKey;
  sandbox.startProjectValidation(validationKey, STEVEN_KEY);
  assert.throws(
    () => sandbox.saveProjectValidation(validationKey, STEVEN_KEY, {
      validationEvidence: '',
      successMeasure: '',
      schoolContact: '',
      knownConcerns: '',
      nextAction: '',
      outcome: 'school_review'
    }),
    /evidence|measure|contact|concern|required/i
  );
  assert.equal(projectRow(validationKey).Stage, 'Validation');
});

test('keeps Project Lead optional and lets an active member set it explicitly', () => {
  reset();
  const projectKey = createIdea({ projectName: 'Lead Optional Idea' }).mutation.projectKey;
  assert.equal(projectRow(projectKey)['Project Lead'], '');

  const result = sandbox.setProjectLead(projectKey, STEVEN_KEY, JORDAN_KEY);
  assert.equal(projectRow(projectKey)['Project Lead'], JORDAN_KEY);
  assert.equal(projectFrom(result, projectKey).projectLead, 'Jordan Lee');
  assert.equal(projectFrom(result, projectKey).projectLeadProfileKey, JORDAN_KEY);
});

test('edits an Active project Next Action without changing its stage', () => {
  reset();
  const result = sandbox.editProjectNextAction(
    'P-001',
    STEVEN_KEY,
    'Ask student volunteers to cover all lunch periods.'
  );

  assert.equal(projectRow('P-001').Stage, 'Active');
  assert.equal(
    projectRow('P-001')['Next Action'],
    'Ask student volunteers to cover all lunch periods.'
  );
  assert.equal(projectFrom(result, 'P-001').stage, 'Active');
  assert.match(newestUpdate().Update, /next action/i);
});

test('setupProjectWorkflow is idempotent and never overwrites existing project rows', () => {
  reset({ projectWorkflowReady: false });
  const projects = spreadsheet.getSheetByName('Projects');
  const baseRowsBefore = projects.rows.slice(1).map((row) => row.slice(0, BASE_PROJECT_HEADERS.length));
  const tasksBefore = JSON.stringify(spreadsheet.getSheetByName('Tasks').rows);

  sandbox.setupProjectWorkflow();
  assert.deepEqual(projects.rows[0], PROJECT_HEADERS);
  assert.equal(projects.getMaxColumns(), PROJECT_HEADERS.length);
  assert.deepEqual(
    projects.rows.slice(1).map((row) => row.slice(0, BASE_PROJECT_HEADERS.length)),
    baseRowsBefore
  );
  assert.equal(
    settingValue('Project Stage Options'),
    PROJECT_STAGE_SETTING
  );
  assert.equal(JSON.stringify(spreadsheet.getSheetByName('Tasks').rows), tasksBefore);

  const stateAfterFirstRun = JSON.stringify(projects.rows);
  const settingsAfterFirstRun = JSON.stringify(spreadsheet.getSheetByName('Settings').rows);
  sandbox.setupProjectWorkflow();
  assert.equal(JSON.stringify(projects.rows), stateAfterFirstRun);
  assert.equal(JSON.stringify(spreadsheet.getSheetByName('Settings').rows), settingsAfterFirstRun);
});

let failures = 0;
tests.forEach(({ name, work }) => {
  try {
    work();
    console.log(`✓ ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`✗ ${name}`);
    console.error(error && error.stack ? error.stack : error);
  }
});

if (failures) {
  console.error(`\n${failures} of ${tests.length} tests failed.`);
  process.exitCode = 1;
} else {
  console.log(`\n${tests.length} tests passed.`);
}
