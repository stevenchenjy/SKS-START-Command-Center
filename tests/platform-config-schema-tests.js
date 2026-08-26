#!/usr/bin/env node

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const SERVER_DIRECTORY = path.join(ROOT, 'apps-script');
const FALLBACK_SPREADSHEET_ID = '1XFTIrKIcckrwavS-tJ5E_fReKVR3BlLtsbLUXRhto6I';
const PROJECT_STAGE_OPTIONS =
  'Idea | Validation | School Review | Active | Completed | Paused | Rejected';
const PROJECT_WORKFLOW_HEADERS = [
  'Validation Evidence', 'Success Measure', 'School Contact',
  'Known Concerns', 'Decision Notes', 'Completed Work', 'Observed Result'
];
const EXPECTED_CANONICAL_SCHEMA = {
  Tasks: [
    'Task ID', 'Task', 'Related Project', 'Related Metric', 'Interest Tag',
    'Estimated Time', 'Due Date', 'Status', 'Claimed By', 'Last Update',
    'Blocker', 'Supporting Link'
  ],
  Projects: [
    'Project ID', 'Project Name', 'Problem / Opportunity',
    'Linked START Metrics', 'Carbon Track', 'Stage', 'START Impact',
    'START Difficulty', 'START Cost', 'Local Feasibility', 'Recommendation',
    'School Feedback', 'Next Action', 'Project Lead', 'Results Link',
    ...PROJECT_WORKFLOW_HEADERS
  ],
  Metrics: ['Metric'],
  Updates: ['Timestamp', 'Member', 'Task / Project', 'Update', 'Blocker', 'Next Step', 'Link'],
  Settings: ['Setting', 'Value'],
  Members: ['Email', 'Display Name', 'Active']
};
const tests = [];

function test(name, work) {
  tests.push({ name, work });
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

class ReadOnlyRange {
  constructor(sheet, row, column, rowCount, columnCount) {
    this.sheet = sheet;
    this.row = row;
    this.column = column;
    this.rowCount = rowCount;
    this.columnCount = columnCount;
  }

  values() {
    return Array.from({ length: this.rowCount }, (_, rowOffset) => (
      Array.from({ length: this.columnCount }, (_, columnOffset) => (
        this.sheet.rows[this.row + rowOffset - 1]?.[this.column + columnOffset - 1] ?? ''
      ))
    ));
  }

  getValues() {
    return this.values();
  }

  getDisplayValues() {
    return this.values().map((row) => row.map((value) => String(value ?? '')));
  }

  setValue() {
    this.sheet.writeAttempts += 1;
    throw new Error('Schema inspection must not write.');
  }

  setValues() {
    this.sheet.writeAttempts += 1;
    throw new Error('Schema inspection must not write.');
  }
}

class ReadOnlySheet {
  constructor(name, rows) {
    this.name = name;
    this.rows = rows.map((row) => row.slice());
    this.writeAttempts = 0;
  }

  getLastRow() {
    return this.rows.length;
  }

  getLastColumn() {
    return this.rows.reduce((maximum, row) => Math.max(maximum, row.length), 0);
  }

  getRange(row, column, rowCount = 1, columnCount = 1) {
    return new ReadOnlyRange(this, row, column, rowCount, columnCount);
  }
}

class ReadOnlySpreadsheet {
  constructor(sheets) {
    this.sheets = Object.fromEntries(sheets.map((sheet) => [sheet.name, sheet]));
  }

  getSheetByName(name) {
    return this.sheets[name] || null;
  }

  writeAttempts() {
    return Object.values(this.sheets)
      .reduce((total, sheet) => total + sheet.writeAttempts, 0);
  }
}

const properties = {};
let activeSpreadsheet = null;
let lastOpenedSpreadsheetId = '';

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
  PropertiesService: {
    getScriptProperties() {
      return {
        getProperty(name) {
          return Object.prototype.hasOwnProperty.call(properties, name)
            ? properties[name]
            : null;
        }
      };
    }
  },
  SpreadsheetApp: {
    openById(id) {
      lastOpenedSpreadsheetId = id;
      return activeSpreadsheet;
    },
    flush() {
      throw new Error('Read-only tests must not flush.');
    }
  },
  Session: {
    getActiveUser() {
      return { getEmail: () => 'deployment.owner@sks.org' };
    },
    getEffectiveUser() {
      return { getEmail: () => 'deployment.owner@sks.org' };
    }
  },
  LockService: {
    getScriptLock() {
      throw new Error('Read-only tests must not request a mutation lock.');
    }
  },
  HtmlService: {}
};

vm.createContext(sandbox);
fs.readdirSync(SERVER_DIRECTORY)
  .filter((fileName) => fileName.endsWith('.gs'))
  .sort()
  .forEach((fileName) => {
    const filePath = path.join(SERVER_DIRECTORY, fileName);
    vm.runInContext(fs.readFileSync(filePath, 'utf8'), sandbox, { filename: filePath });
  });

function resetProperties(overrides = {}) {
  Object.keys(properties).forEach((key) => delete properties[key]);
  Object.assign(properties, overrides);
}

function schemaHeaders(useAliases) {
  return plain(sandbox.startSchemaDefinition_()).map((definition) => ({
    name: definition.sheetName,
    headers: definition.requiredFields.map((fieldName) => {
      const aliases = definition.fields[fieldName];
      return useAliases && aliases.length > 1 ? aliases[1] : aliases[0];
    })
  }));
}

function makeSchemaFixture({ aliases = false, members = true, projectWorkflow = true,
  projectStageOptions = PROJECT_STAGE_OPTIONS, duplicateProjectOptions = false } = {}) {
  const definitions = schemaHeaders(aliases);
  const sheets = definitions.filter((definition) => members || definition.name !== 'Members')
    .map((definition) => {
      let headers = definition.headers;
      if (definition.name === 'Projects' && !projectWorkflow) {
        headers = headers.filter((header) => !PROJECT_WORKFLOW_HEADERS.includes(header));
      }
      const rows = [headers];
      if (definition.name === 'Settings') {
        const settingColumn = 0;
        const valueColumn = 1;
        if (projectStageOptions !== null) {
          const settingRow = headers.map(() => '');
          settingRow[settingColumn] = 'Project Stage Options';
          settingRow[valueColumn] = projectStageOptions;
          rows.push(settingRow);
          if (duplicateProjectOptions) rows.push(settingRow.slice());
        }
      }
      return new ReadOnlySheet(definition.name, rows);
    });
  return new ReadOnlySpreadsheet(sheets);
}

test('all four future feature flags default off and require the exact literal true', () => {
  resetProperties();
  assert.deepEqual(plain(sandbox.getFeatureFlags_()), {
    aiHelper: false,
    driveKnowledge: false,
    decisionHelper: false,
    reporting: false
  });

  const featureKeys = plain(sandbox.START_FEATURE_PROPERTY_KEYS);
  Object.values(featureKeys).forEach((key) => {
    ['TRUE', 'True', '1', 'yes', ' true ', true].forEach((notStrictTrue) => {
      resetProperties({ [key]: notStrictTrue });
      assert.equal(sandbox.isFeatureEnabled_(key), false, `${key} rejects ${String(notStrictTrue)}`);
    });
    resetProperties({ [key]: 'true' });
    assert.equal(sandbox.isFeatureEnabled_(key), true, `${key} accepts literal true`);
  });
  resetProperties({ FEATURE_UNKNOWN: 'true' });
  assert.equal(sandbox.isFeatureEnabled_('FEATURE_UNKNOWN'), false);
});

test('central configuration uses the bound workbook fallback and trims private values', () => {
  resetProperties();
  assert.equal(sandbox.getConfiguredSpreadsheetId_(), FALLBACK_SPREADSHEET_ID);
  assert.equal(sandbox.getOpenAiApiKey_(), '');
  assert.equal(sandbox.getOpenAiModel_(), '');
  assert.deepEqual(plain(sandbox.getDriveKnowledgeFolderConfig_()), {
    sksStartFolderId: '',
    gsaResourceFolderId: ''
  });

  resetProperties({
    START_SPREADSHEET_ID: ' alternate-workbook-id ',
    OPENAI_API_KEY: ' private-test-key ',
    OPENAI_MODEL: ' configured-model ',
    SKS_START_FOLDER_ID: ' start-folder ',
    GSA_RESOURCE_FOLDER_ID: ' gsa-folder '
  });
  assert.equal(sandbox.getConfiguredSpreadsheetId_(), 'alternate-workbook-id');
  assert.deepEqual(plain(sandbox.getOpenAiConfig_()), {
    apiKey: 'private-test-key',
    model: 'configured-model'
  });
  assert.deepEqual(plain(sandbox.getDriveKnowledgeFolderConfig_()), {
    sksStartFolderId: 'start-folder',
    gsaResourceFolderId: 'gsa-folder'
  });
});

test('dashboard exposes only usable AI availability and never private configuration', () => {
  const secret = 'private-test-key-never-returned';
  resetProperties({
    FEATURE_AI_HELPER: 'true',
    FEATURE_DRIVE_KNOWLEDGE: 'true',
    FEATURE_DECISION_HELPER: 'true',
    FEATURE_REPORTING: 'true',
    OPENAI_API_KEY: secret,
    OPENAI_MODEL: 'configured-model',
    SKS_START_FOLDER_ID: 'private-start-folder',
    GSA_RESOURCE_FOLDER_ID: 'private-gsa-folder'
  });
  activeSpreadsheet = makeSchemaFixture();
  const dashboard = plain(sandbox.getDashboardData(''));

  assert.deepEqual(dashboard.capabilities, { aiHelper: true });
  assert.deepEqual(Object.keys(dashboard.capabilities), ['aiHelper']);
  const serialized = JSON.stringify(dashboard);
  [
    secret, 'configured-model', 'private-start-folder', 'private-gsa-folder',
    'FEATURE_AI_HELPER', 'FEATURE_DRIVE_KNOWLEDGE',
    'FEATURE_DECISION_HELPER', 'FEATURE_REPORTING'
  ].forEach((privateValue) => assert.ok(!serialized.includes(privateValue)));

  resetProperties({ FEATURE_AI_HELPER: 'true' });
  assert.deepEqual(plain(sandbox.getPublicCapabilities_()), { aiHelper: false });
  resetProperties({ OPENAI_API_KEY: secret });
  assert.deepEqual(plain(sandbox.getPublicCapabilities_()), { aiHelper: false });
});

test('runtime opens a configured workbook ID without changing the production fallback', () => {
  activeSpreadsheet = makeSchemaFixture();
  resetProperties({ START_SPREADSHEET_ID: 'alternate-workbook-id' });
  assert.equal(sandbox.getSpreadsheet_(), activeSpreadsheet);
  assert.equal(lastOpenedSpreadsheetId, 'alternate-workbook-id');

  resetProperties();
  assert.equal(sandbox.getSpreadsheet_(), activeSpreadsheet);
  assert.equal(lastOpenedSpreadsheetId, FALLBACK_SPREADSHEET_ID);
});

test('full current schema is ready, versioned, and inspected without writes', () => {
  activeSpreadsheet = makeSchemaFixture();
  const status = plain(sandbox.inspectStartSchema_(activeSpreadsheet));

  assert.equal(status.version, 1);
  assert.equal(status.ready, true);
  assert.equal(status.sheets.length, 6);
  assert.deepEqual(status.issues, []);
  assert.deepEqual(status.requiredSetups, []);
  assert.equal(activeSpreadsheet.writeAttempts(), 0);
});

test('schema definition retains the independently specified canonical workbook contract', () => {
  const actual = Object.fromEntries(plain(sandbox.startSchemaDefinition_()).map((definition) => [
    definition.sheetName,
    definition.requiredFields.map((fieldName) => definition.fields[fieldName][0])
  ]));

  assert.deepEqual(actual, EXPECTED_CANONICAL_SCHEMA);
  assert.ok(plain(sandbox.TASK_FIELDS.task).includes('Task Name'));
  assert.ok(plain(sandbox.PROJECT_FIELDS.stage).includes('Project Stage'));
  assert.ok(plain(sandbox.UPDATE_FIELDS.taskProject).includes('Task or Project'));
  assert.ok(plain(sandbox.MEMBER_FIELDS.displayName).includes('Member Name'));
});

test('supported header aliases satisfy schema readiness', () => {
  activeSpreadsheet = makeSchemaFixture({ aliases: true });
  const status = plain(sandbox.inspectStartSchema_(activeSpreadsheet));

  assert.equal(status.ready, true);
  assert.deepEqual(status.issues, []);
  assert.equal(activeSpreadsheet.writeAttempts(), 0);
});

test('ambiguous supported headers fail schema readiness without suggesting an unsafe setup', () => {
  activeSpreadsheet = makeSchemaFixture();
  activeSpreadsheet.sheets.Tasks.rows[0].push('Task Status');
  const status = plain(sandbox.inspectStartSchema_(activeSpreadsheet));
  const tasks = status.sheets.find((sheet) => sheet.name === 'Tasks');

  assert.equal(status.ready, false);
  assert.deepEqual(tasks.ambiguousHeaders, ['Status']);
  assert.ok(status.issues.some((issue) => (
    issue.code === 'AMBIGUOUS_HEADER' && issue.sheet === 'Tasks' && issue.header === 'Status'
  )));
  assert.equal(activeSpreadsheet.writeAttempts(), 0);
});

test('missing Members gets the safe setupMembersSheet recommendation', () => {
  activeSpreadsheet = makeSchemaFixture({ members: false });
  const status = plain(sandbox.inspectStartSchema_(activeSpreadsheet));

  assert.equal(status.ready, false);
  assert.ok(status.issues.some((issue) => (
    issue.code === 'MISSING_SHEET' && issue.sheet === 'Members'
  )));
  assert.ok(status.requiredSetups.includes('setupMembersSheet'));
  assert.equal(activeSpreadsheet.writeAttempts(), 0);
});

test('an empty Members tab also gets the safe setupMembersSheet recommendation', () => {
  activeSpreadsheet = makeSchemaFixture();
  activeSpreadsheet.sheets.Members = new ReadOnlySheet('Members', []);
  const status = plain(sandbox.inspectStartSchema_(activeSpreadsheet));

  assert.ok(status.issues.some((issue) => (
    issue.code === 'MISSING_HEADER_ROW' && issue.sheet === 'Members'
  )));
  assert.ok(status.requiredSetups.includes('setupMembersSheet'));
  assert.equal(activeSpreadsheet.writeAttempts(), 0);
});

test('legacy Projects workflow gets the safe setupProjectWorkflow recommendation', () => {
  activeSpreadsheet = makeSchemaFixture({
    projectWorkflow: false,
    projectStageOptions: null
  });
  const status = plain(sandbox.inspectStartSchema_(activeSpreadsheet));
  const projects = status.sheets.find((sheet) => sheet.name === 'Projects');

  assert.equal(status.ready, false);
  assert.deepEqual(projects.missingHeaders, PROJECT_WORKFLOW_HEADERS);
  assert.ok(status.issues.some((issue) => issue.code === 'PROJECT_STAGE_OPTIONS_OUTDATED'));
  assert.ok(status.requiredSetups.includes('setupProjectWorkflow'));
  assert.equal(activeSpreadsheet.writeAttempts(), 0);
});

test('duplicate project options are reported without recommending an unsafe setup run', () => {
  activeSpreadsheet = makeSchemaFixture({
    projectWorkflow: false,
    duplicateProjectOptions: true
  });
  const status = plain(sandbox.inspectStartSchema_(activeSpreadsheet));

  assert.ok(status.issues.some((issue) => issue.code === 'DUPLICATE_PROJECT_STAGE_OPTIONS'));
  assert.ok(!status.requiredSetups.includes('setupProjectWorkflow'));
  assert.equal(activeSpreadsheet.writeAttempts(), 0);
});

test('the public schema endpoint returns status only and honors the workbook override', () => {
  activeSpreadsheet = makeSchemaFixture();
  resetProperties({ START_SPREADSHEET_ID: 'schema-workbook-id' });
  const status = plain(sandbox.inspectStartSchema());

  assert.equal(status.ready, true);
  assert.equal(lastOpenedSpreadsheetId, 'schema-workbook-id');
  assert.equal(activeSpreadsheet.writeAttempts(), 0);
});


let passed = 0;
tests.forEach(({ name, work }) => {
  try {
    work();
    passed += 1;
    process.stdout.write(`✓ ${name}\n`);
  } catch (error) {
    process.stderr.write(`✗ ${name}\n${error.stack || error.message}\n`);
  }
});

process.stdout.write(`\n${passed}/${tests.length} platform configuration/schema tests passed.\n`);
if (passed !== tests.length) process.exitCode = 1;
