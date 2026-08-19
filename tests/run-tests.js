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

const PROJECT_HEADERS = [
  'Project ID', 'Project Name', 'Problem / Opportunity',
  'Linked START Metrics', 'Carbon Track', 'Stage', 'START Impact',
  'START Difficulty', 'START Cost', 'Local Feasibility', 'Recommendation',
  'School Feedback', 'Next Action', 'Project Lead', 'Results Link'
];

const UPDATE_HEADERS = [
  'Timestamp', 'Member', 'Task / Project', 'Update', 'Blocker', 'Next Step',
  'Link'
];

const SETTINGS_HEADERS = ['Setting', 'Value', 'Notes'];

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
}

class FakeSheet {
  constructor(name, rows) {
    this.name = name;
    this.rows = rows.map((row) => row.slice());
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
    return new FakeRange(this, row, column, rowCount, columnCount);
  }

  valueAt(row, column) {
    return this.rows[row - 1]?.[column - 1] ?? '';
  }

  setValueAt(row, column, value) {
    while (this.rows.length < row) this.rows.push([]);
    while (this.rows[row - 1].length < column) this.rows[row - 1].push('');
    this.rows[row - 1][column - 1] = value;
  }

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
}

function makeFixture({ empty = false } = {}) {
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
      'Outreach', '15 min', '2026-09-07', 'Waiting', 'Steven Chen', '',
      'Waiting for facilities director', ''
    ]
  ];

  const projectRows = empty ? [] : [
    [
      'P-001', 'Waste Reduction', 'Reduce dining hall waste', 'M-01',
      'Direct Carbon Reduction', 'Active', 'High', 'Medium', 'Low', 'Ready',
      'Do Now', '', 'Complete baseline audit', 'Steven Chen', ''
    ],
    [
      'P-002', 'Energy Dashboard', 'Make energy use visible', 'M-03',
      'Data / Measurement Support', 'School Review', 'Medium', 'Medium',
      'Medium', 'Needs Conversation', 'Needs School Decision',
      'Facilities is reviewing access', 'Schedule facilities meeting',
      'Jordan Lee', ''
    ],
    [
      'P-003', 'Native Planting', 'Improve campus habitat', 'M-02',
      'Broader Sustainability', 'Paused', 'Medium', 'Low', 'Medium', 'Blocked',
      'Later', '', 'Wait for grounds plan', 'Maya Patel', ''
    ]
  ];

  const updateRows = empty ? [] : [
    [
      '2026-08-18 10:00', 'Steven Chen', 'T-003: Confirm facilities meeting',
      'Asked facilities for a meeting', 'Waiting for reply',
      'Follow up Friday', ''
    ]
  ];

  return new FakeSpreadsheet([
    new FakeSheet('Tasks', [TASK_HEADERS, ...taskRows]),
    new FakeSheet('Projects', [PROJECT_HEADERS, ...projectRows]),
    new FakeSheet('Updates', [UPDATE_HEADERS, ...updateRows]),
    new FakeSheet('Settings', [
      SETTINGS_HEADERS,
      ['Program Name', 'Storm King School START Committee', ''],
      ['Student Lead', 'Steven Chen', ''],
      ['System Steward', 'Maya Patel', ''],
      ['Committee Members', 'Steven Chen | Jordan Lee | Maya Patel', '']
    ])
  ]);
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

vm.createContext(sandbox);
const serverPath = path.join(__dirname, '..', 'apps-script', 'Code.gs');
vm.runInContext(fs.readFileSync(serverPath, 'utf8'), sandbox, {
  filename: serverPath
});

const tests = [];

function test(name, work) {
  tests.push({ name, work });
}

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

test('opens the dashboard HTML entry point', () => {
  const output = sandbox.doGet();
  assert.equal(output.file, 'Index');
  assert.equal(output.title, 'START Command Center');
  assert.equal(output.meta.viewport, 'width=device-width, initial-scale=1');
});

test('reads Tasks, Projects, Settings identity, updates, and summary counts', () => {
  reset();
  const data = sandbox.getDashboardData('Steven Chen');

  assert.equal(data.viewer.identity, 'Steven Chen');
  assert.equal(data.viewer.authMode, 'settings_selector');
  assert.deepEqual(Array.from(data.members), ['Steven Chen', 'Maya Patel', 'Jordan Lee']);
  assert.equal(data.tasks.length, 3);
  assert.equal(data.projects.length, 3);
  assert.equal(data.summary.openTasks, 1);
  assert.equal(data.summary.myTasks, 1);
  assert.equal(data.summary.activeProjects, 2);
  assert.equal(data.summary.waitingOnSchool, 2);
  assert.equal(data.projects[1].schoolFeedback, 'Facilities is reviewing access');
  assert.equal(data.projects[1].nextAction, 'Schedule facilities meeting');
  assert.equal(data.projects[1].projectLead, 'Jordan Lee');
});

test('claims an open task and persists the owner, status, and update log', () => {
  reset();
  const data = sandbox.claimTask('T-001', 'Steven Chen');
  const row = taskRow('T-001');

  assert.equal(row.Status, 'Claimed');
  assert.equal(row['Claimed By'], 'Steven Chen');
  assert.equal(data.tasks.find((task) => task.taskId === 'T-001').isMine, true);
  assert.equal(spreadsheet.getSheetByName('Updates').getLastRow(), 3);
  assert.equal(flushCount, 1);

  const refreshed = sandbox.getDashboardData('Steven Chen');
  assert.equal(
    refreshed.tasks.find((task) => task.taskId === 'T-001').status,
    'Claimed'
  );
});

test('moves a claimed task through progress, waiting, blocker, and done', () => {
  reset();
  sandbox.claimTask('T-001', 'Steven Chen');

  sandbox.updateTask(
    'T-001',
    'Steven Chen',
    'In Progress',
    'Counted the first lunch period',
    ''
  );
  assert.equal(taskRow('T-001').Status, 'In Progress');

  sandbox.updateTask(
    'T-001',
    'Steven Chen',
    'Waiting',
    'Shared the first count',
    'Need dining staff confirmation'
  );
  assert.equal(taskRow('T-001').Status, 'Waiting');
  assert.equal(taskRow('T-001').Blocker, 'Need dining staff confirmation');

  const completed = sandbox.updateTask(
    'T-001',
    'Steven Chen',
    'Done',
    'Audit complete',
    ''
  );
  assert.equal(taskRow('T-001').Status, 'Done');
  assert.equal(taskRow('T-001').Blocker, '');
  assert.equal(
    completed.tasks.find((task) => task.taskId === 'T-001').status,
    'Done'
  );
  assert.equal(spreadsheet.getSheetByName('Updates').getLastRow(), 6);
});

test('prevents a second member from taking or editing someone else\'s task', () => {
  reset();
  sandbox.claimTask('T-001', 'Steven Chen');
  assert.throws(
    () => sandbox.claimTask('T-001', 'Jordan Lee'),
    /no longer open/
  );
  assert.throws(
    () => sandbox.updateTask('T-001', 'Jordan Lee', 'Done', '', ''),
    /Only Steven Chen/
  );
});

test('rejects identities that are not configured in Settings', () => {
  reset();
  const data = sandbox.getDashboardData('Unlisted Student');
  assert.equal(data.viewer.identity, '');
  assert.throws(
    () => sandbox.claimTask('T-001', 'Unlisted Student'),
    /listed in Settings/
  );
  assert.equal(taskRow('T-001').Status, 'Open');
});

test('uses a Google account email when Apps Script exposes it', () => {
  reset();
  sessionEmail = 'student@sks.org';
  const data = sandbox.claimTask('T-001', 'Steven Chen');
  assert.equal(data.viewer.identity, 'student@sks.org');
  assert.equal(data.viewer.authMode, 'google');
  assert.equal(taskRow('T-001')['Claimed By'], 'student@sks.org');
});

test('returns useful empty collections when Tasks and Projects have headers only', () => {
  reset({ empty: true });
  const data = sandbox.getDashboardData('Steven Chen');

  assert.equal(data.tasks.length, 0);
  assert.equal(data.projects.length, 0);
  assert.equal(data.updates.length, 0);
  assert.equal(data.summary.openTasks, 0);
  assert.equal(data.summary.activeProjects, 0);
  assert.equal(data.summary.waitingOnSchool, 0);
});

test('maps small supported header variations defensively', () => {
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

  const data = sandbox.getDashboardData('Steven Chen');
  assert.equal(data.tasks[0].task, 'Check alias mapping');
  assert.equal(data.tasks[0].status, 'Open');
  assert.equal(data.projects[0].projectName, 'Alias project');
  assert.equal(data.projects[0].nextAction, 'Talk to students');
});

test('stores user-entered formula markers as literal text', () => {
  reset();
  sandbox.claimTask('T-001', 'Steven Chen');
  sandbox.updateTask(
    'T-001',
    'Steven Chen',
    'Waiting',
    '=HYPERLINK("https://example.test", "progress")',
    '+SUM(1, 1)'
  );

  assert.equal(taskRow('T-001').Blocker, "'+SUM(1, 1)");
  const updates = spreadsheet.getSheetByName('Updates');
  const newest = updates.rowObject(updates.getLastRow());
  assert.equal(newest.Update, "'=HYPERLINK(\"https://example.test\", \"progress\")");
  assert.equal(newest.Blocker, "'+SUM(1, 1)");
});

test('keeps a blank-ID task action attached after the sheet is sorted', () => {
  reset();
  const tasks = spreadsheet.getSheetByName('Tasks');
  tasks.rows.push([
    '', 'Task without an ID', 'Waste Reduction', 'M-01', 'Data', '10 min',
    '2026-09-08', 'Open', '', '', '', ''
  ]);
  const key = sandbox.getDashboardData('Steven Chen').tasks
    .find((task) => task.task === 'Task without an ID').taskKey;

  const moved = tasks.rows.pop();
  tasks.rows.splice(1, 0, moved);
  sandbox.claimTask(key, 'Steven Chen');

  const movedRow = tasks.rows.findIndex((row) => row[1] === 'Task without an ID') + 1;
  assert.equal(tasks.rowObject(movedRow).Status, 'Claimed');
  assert.equal(tasks.rowObject(movedRow)['Claimed By'], 'Steven Chen');
  assert.equal(taskRow('T-001').Status, 'Open');
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
