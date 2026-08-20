#!/usr/bin/env node

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'apps-script', 'Config.gs');
const SNAPSHOT_PATH = path.join(ROOT, 'apps-script', 'ProgramSnapshot.gs');
const SOURCE_PATH = path.join(ROOT, 'apps-script', 'DecisionReporting.gs');
const CONFIG_SOURCE = fs.readFileSync(CONFIG_PATH, 'utf8');
const SNAPSHOT_SOURCE = fs.readFileSync(SNAPSHOT_PATH, 'utf8');
const SOURCE = fs.readFileSync(SOURCE_PATH, 'utf8');
const tests = [];

function test(name, work) {
  tests.push({ name, work });
}

function loadHelpers() {
  const context = vm.createContext({});
  new vm.Script(CONFIG_SOURCE, { filename: CONFIG_PATH }).runInContext(context);
  new vm.Script(SNAPSHOT_SOURCE, { filename: SNAPSHOT_PATH }).runInContext(context);
  new vm.Script(SOURCE, { filename: SOURCE_PATH }).runInContext(context);
  assert.equal(typeof context.buildProjectDecisionRecord_, 'function');
  assert.equal(typeof context.buildProjectDecisionComparison_, 'function');
  assert.equal(typeof context.buildStartReportingData_, 'function');
  return {
    buildRecord: context.buildProjectDecisionRecord_,
    buildComparison: context.buildProjectDecisionComparison_,
    buildReport: context.buildStartReportingData_,
    buildSnapshot: context.buildProgramSnapshot_
  };
}

const helpers = loadHelpers();

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function project(overrides = {}) {
  return {
    projectId: 'PRJ-001',
    projectName: 'Default project',
    stage: 'Validation',
    startImpact: 'Medium',
    startDifficulty: 'Low',
    startCost: '$50 recorded estimate',
    localFeasibility: 'Possible with facilities coordination',
    recommendation: 'Continue validation',
    schoolFeedback: 'Confirm room access',
    validationEvidence: 'Two site observations recorded',
    successMeasure: 'Record weekly participation',
    knownConcerns: 'Storage space',
    nextAction: 'Meet the facilities contact',
    linkedMetrics: ['Waste', 'Student engagement'],
    completedWork: '',
    observedResult: '',
    ...overrides
  };
}

function task(overrides = {}) {
  return {
    id: 'TASK-001',
    title: 'Default task',
    status: 'Doing',
    owner: 'Avery',
    relatedProject: 'PRJ-001: Default project',
    dueDate: '2026-09-01',
    estimatedTime: '30 minutes',
    blocker: '',
    ...overrides
  };
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

function collectKeys(value, keys = []) {
  if (!value || typeof value !== 'object') return keys;
  if (Array.isArray(value)) {
    value.forEach((item) => collectKeys(item, keys));
    return keys;
  }
  Object.keys(value).forEach((key) => {
    keys.push(key);
    collectKeys(value[key], keys);
  });
  return keys;
}

function collectVerificationStatuses(value, statuses = []) {
  if (!value || typeof value !== 'object') return statuses;
  if (Array.isArray(value)) {
    value.forEach((item) => collectVerificationStatuses(item, statuses));
    return statuses;
  }
  Object.entries(value).forEach(([key, item]) => {
    if (key === 'verificationStatus') statuses.push(item);
    collectVerificationStatuses(item, statuses);
  });
  return statuses;
}

test('builds an explicit factual decision record without filling missing values', () => {
  const input = project({
    projectId: 'PRJ-FACT',
    projectName: 'Courtyard study',
    startImpact: 0,
    startDifficulty: '',
    recommendation: 'Recorded recommendation only',
    linkedMetrics: ['Water', 'energy', 'Water'],
    projectKey: 'row:student.private@example.org',
    sourceRowNumber: 42,
    projectLeadProfileKey: 'student.private@example.org'
  });
  const result = plain(helpers.buildRecord(input));

  assert.equal(result.schemaVersion, 'project-decision-record/v1');
  assert.equal(result.projectId, 'PRJ-FACT');
  assert.equal(result.startImpact, '0');
  assert.equal(result.startDifficulty, '');
  assert.equal(result.recordedRecommendation, 'Recorded recommendation only');
  assert.deepEqual(result.linkedMetrics, ['energy', 'Water']);
  assert.equal(result.humanDecisionRequired, true);
  assert.ok(result.missingInformation.some((item) => (
    item.field === 'startDifficulty' && item.label === 'START Difficulty'
  )));
  assert.ok(!result.missingInformation.some((item) => item.field === 'startImpact'));
  assert.equal(Object.hasOwn(result, 'projectKey'), false);
  assert.equal(Object.hasOwn(result, 'sourceRowNumber'), false);
  assert.equal(Object.hasOwn(result, 'projectLeadProfileKey'), false);
  assert.doesNotMatch(JSON.stringify(result), /student\.private@example\.org/i);
});

test('supports mapped and canonical header aliases while keeping every field bounded', () => {
  const longText = `Contact someone@example.org ${'x'.repeat(1600)}`;
  const result = plain(helpers.buildRecord({
    id: 'X'.repeat(220),
    name: 'N'.repeat(400),
    stage: 'School Review',
    'START Impact': 'Recorded high',
    'START Difficulty': 'Recorded medium',
    'START Cost': '$125',
    'Local Feasibility': longText,
    Recommendation: 'Wait for school response',
    'School Feedback': 'Pending',
    'Validation Evidence': 'Survey complete',
    'Success Measure': 'Participation count',
    'Known Concerns': 'Scheduling',
    'Next Action': 'Follow up next week',
    'Linked START Metrics': Array.from({ length: 20 }, (_, index) => `Metric ${index}`)
  }));

  assert.equal(result.projectId.length, 160);
  assert.equal(result.projectName.length, 300);
  assert.ok(result.localFeasibility.length <= 1200);
  assert.doesNotMatch(result.localFeasibility, /someone@example\.org/i);
  assert.match(result.localFeasibility, /\[email removed\]/);
  assert.equal(result.linkedMetrics.length, 12);
  assert.equal(result.startImpact, 'Recorded high');
  assert.equal(result.recordedRecommendation, 'Wait for school response');
});

test('compares exact requested IDs in stable identity order and reports missing IDs', () => {
  const projects = [
    project({ projectId: 'P-2', projectName: 'Second' }),
    project({ projectId: 'P-1', projectName: 'First' }),
    project({ projectId: 'P-3', projectName: 'Third' })
  ];
  const result = plain(helpers.buildComparison(projects, ['p-2', 'MISSING', 'P-1', 'P-2']));

  assert.deepEqual(result.requestedProjectIds, ['MISSING', 'P-1', 'p-2']);
  assert.deepEqual(result.projects.map((item) => item.projectId), ['P-1', 'P-2']);
  assert.deepEqual(result.notFoundProjectIds, ['MISSING']);
  assert.equal(result.selection.requestedProjectIds, 3);
  assert.equal(result.selection.matchedProjects, 2);
  assert.equal(result.selection.notFoundProjectIds, 1);
  assert.equal(result.humanDecisionRequired, true);
  result.projects.forEach((item) => assert.equal(item.humanDecisionRequired, true));

  const reversed = plain(helpers.buildComparison(projects.slice().reverse(), ['P-1', 'P-2', 'MISSING']));
  assert.deepEqual(reversed.projects, result.projects);
  assert.deepEqual(reversed.notFoundProjectIds, result.notFoundProjectIds);
});

test('distinguishes omitted selection from an explicitly empty selection', () => {
  const projects = [
    project({ projectId: 'B', projectName: 'Beta' }),
    project({ projectId: 'A', projectName: 'Alpha' })
  ];
  const all = plain(helpers.buildComparison(projects));
  const none = plain(helpers.buildComparison(projects, []));
  assert.deepEqual(all.projects.map((item) => item.projectId), ['A', 'B']);
  assert.deepEqual(none.projects, []);
  assert.deepEqual(none.requestedProjectIds, []);
});

test('bounds comparison projects, requested IDs, and diagnostic lists', () => {
  const projects = Array.from({ length: 30 }, (_, index) => project({
    projectId: `P-${String(index).padStart(2, '0')}`,
    projectName: `Project ${index}`
  }));
  const ids = projects.map((item) => item.projectId).concat(
    Array.from({ length: 15 }, (_, index) => `UNKNOWN-${index}`)
  );
  const result = plain(helpers.buildComparison(projects, ids));

  assert.equal(result.requestedProjectIds.length, 20);
  assert.equal(result.projects.length, 10);
  assert.equal(result.selection.requestedProjectIds, 45);
  assert.equal(result.selection.omittedRequestedProjectIds, 25);
  assert.equal(result.selection.includedProjects, 10);
  assert.equal(result.selection.omittedMatchedProjects, 10);

  const all = plain(helpers.buildComparison(projects));
  assert.equal(all.projects.length, 10);
  assert.equal(all.selection.omittedMatchedProjects, 20);
});

test('prepares all requested report sections from a mixed Program Snapshot', () => {
  const snapshot = {
    schemaVersion: 'program-snapshot/v1',
    asOf: '2026-08-20T12:00:00.000Z',
    today: '2026-08-20',
    summary: {
      tasks: { total: 8, open: 2, doing: 2, blocked: 1, completed: 3, currentMemberWork: 2, overdue: 1 },
      projects: { total: 5, ideas: 1, validation: 0, schoolReview: 1, active: 1, completed: 1, paused: 1, rejected: 0 },
      activity: { recentUpdates: 4, recentProjectTransitions: 1, recentlyCompleted: 2 }
    },
    projects: {
      ideas: [project({ projectId: 'IDEA', projectName: 'Idea', stage: 'Idea', nextAction: 'Validate need' })],
      validation: [],
      schoolReview: [project({
        projectId: 'REVIEW', projectName: 'Review project', stage: 'School Review',
        nextAction: 'Wait for recorded school response'
      })],
      active: [project({
        projectId: 'ACTIVE', projectName: 'Active project', stage: 'Active',
        nextAction: 'Run the recorded pilot step'
      })],
      completed: [project({
        projectId: 'DONE', projectName: 'Completed project', stage: 'Completed',
        completedWork: 'Installed the labeled collection bins',
        observedResult: 'Students reported using the new bins'
      })]
    },
    tasks: {
      doing: [task({ id: 'DOING', title: 'Run the pilot', owner: 'Avery' })],
      currentMemberWork: [
        task({ id: 'DOING', title: 'Run the pilot', owner: 'Avery' }),
        task({ id: 'BLOCKED', title: 'Book the room', status: 'Blocked', blocker: 'Awaiting room access' })
      ],
      blocked: [task({
        id: 'BLOCKED', title: 'Book the room', status: 'Blocked', blocker: 'Awaiting room access'
      })],
      overdue: [task({ id: 'OVERDUE', title: 'Record measurements', dueDate: '2026-08-18' })]
    },
    attention: {
      blockedTasks: [task({
        id: 'BLOCKED', title: 'Book the room', status: 'Blocked', blocker: 'Awaiting room access'
      })]
    }
  };
  const result = plain(helpers.buildReport(snapshot));

  assert.equal(result.schemaVersion, 'start-reporting-data/v1');
  assert.equal(result.sourceSnapshotSchemaVersion, 'program-snapshot/v1');
  assert.equal(result.semesterProgress.tasks.total, 8);
  assert.equal(result.semesterProgress.projects.schoolReview, 1);
  assert.equal(result.semesterProgress.activity.recentUpdates, 4);
  assert.deepEqual(result.schoolDecisionQueue.map((item) => item.projectId), ['REVIEW']);
  assert.deepEqual(result.activeWork.projects.map((item) => item.projectId), ['ACTIVE']);
  assert.deepEqual(result.activeWork.tasks.map((item) => item.taskId), ['DOING']);
  assert.deepEqual(result.blockers.map((item) => item.itemId), ['BLOCKED']);
  assert.equal(result.completedProjects[0].completedWork, 'Installed the labeled collection bins');
  assert.deepEqual(result.completedProjects[0].observedResult, {
    value: 'Students reported using the new bins',
    reportingStatus: 'reported',
    verificationStatus: 'not_verified',
    status: 'reported/not_verified'
  });
  assert.deepEqual(result.observedResults, [{
    projectId: 'DONE',
    projectName: 'Completed project',
    value: 'Students reported using the new bins',
    reportingStatus: 'reported',
    verificationStatus: 'not_verified',
    status: 'reported/not_verified'
  }]);
  assert.deepEqual(
    result.upcomingPriorities.map((item) => `${item.type}:${item.itemId}`),
    ['project:ACTIVE', 'project:IDEA', 'project:REVIEW', 'task:BLOCKED', 'task:DOING', 'task:OVERDUE']
  );
  assert.equal(result.humanDecisionRequired, true);
});

test('preserves recorded START facts and upstream omissions through the real snapshot-to-report path', () => {
  const projects = [
    project({
      projectId: 'A-REVIEW',
      projectName: 'First review',
      stage: 'School Review',
      startImpact: 'High recorded impact',
      startDifficulty: 'Medium recorded difficulty',
      startCost: '$125 recorded estimate',
      linkedMetricNames: ['Waste']
    }),
    project({
      projectId: 'B-REVIEW',
      projectName: 'Second review',
      stage: 'School Review'
    }),
    project({
      projectId: 'C-REVIEW',
      projectName: 'Third review',
      stage: 'School Review'
    })
  ];
  const snapshot = helpers.buildSnapshot({
    generatedAt: '2026-08-20T12:00:00.000Z',
    today: '2026-08-20',
    projects,
    tasks: [],
    updates: []
  }, {
    asOf: '2026-08-20T12:00:00.000Z',
    today: '2026-08-20',
    limits: { projectsPerStage: 1, attentionPerGroup: 1 }
  });
  const result = plain(helpers.buildReport(snapshot));

  assert.equal(result.schoolDecisionQueue.length, 1);
  assert.equal(result.schoolDecisionQueue[0].projectId, 'A-REVIEW');
  assert.equal(result.schoolDecisionQueue[0].startImpact, 'High recorded impact');
  assert.equal(result.schoolDecisionQueue[0].startDifficulty, 'Medium recorded difficulty');
  assert.equal(result.schoolDecisionQueue[0].startCost, '$125 recorded estimate');
  assert.ok(!result.schoolDecisionQueue[0].missingInformation.some((item) => (
    ['startImpact', 'startDifficulty', 'startCost'].includes(item.field)
  )));
  assert.equal(result.truncation.truncated, true);
  assert.deepEqual(result.truncation.collections.schoolDecisionQueue, {
    available: 1,
    included: 1,
    omitted: 0
  });
  assert.deepEqual(result.truncation.sourceSnapshot.collections['projects.schoolReview'], {
    available: 3,
    included: 1,
    omitted: 2
  });
});

test('returns a stable empty report with explicit zero counts and collection metadata', () => {
  const result = plain(helpers.buildReport({}));
  assert.deepEqual(result.semesterProgress.tasks, {
    total: 0,
    open: 0,
    doing: 0,
    blocked: 0,
    completed: 0,
    currentMemberWork: 0,
    overdue: 0
  });
  assert.equal(result.semesterProgress.dataAvailable.taskSummary, false);
  assert.deepEqual(result.schoolDecisionQueue, []);
  assert.deepEqual(result.completedProjects, []);
  assert.deepEqual(result.activeWork, { projects: [], tasks: [] });
  assert.deepEqual(result.blockers, []);
  assert.deepEqual(result.upcomingPriorities, []);
  assert.deepEqual(result.observedResults, []);
  assert.equal(result.truncation.truncated, false);
  assert.deepEqual(Object.keys(result.truncation.collections), [
    'schoolDecisionQueue',
    'completedProjects',
    'activeWork.projects',
    'activeWork.tasks',
    'blockers',
    'upcomingPriorities',
    'observedResults'
  ]);
});

test('bounds every report collection and labels every observed result as reported/not_verified', () => {
  const projects = Array.from({ length: 35 }, (_, index) => project({
    projectId: `P-${String(index).padStart(2, '0')}`,
    projectName: `Project ${index}`,
    stage: 'Completed',
    completedWork: 'x'.repeat(1800),
    observedResult: `Reported result ${index}`
  }));
  const active = Array.from({ length: 35 }, (_, index) => project({
    projectId: `A-${String(index).padStart(2, '0')}`,
    projectName: `Active ${index}`,
    stage: 'Active',
    nextAction: `Recorded next action ${index}`
  }));
  const blocked = Array.from({ length: 35 }, (_, index) => task({
    id: `B-${String(index).padStart(2, '0')}`,
    title: `Blocked ${index}`,
    status: 'Blocked',
    blocker: `Recorded blocker ${index}`
  }));
  const report = plain(helpers.buildReport({
    projects: { schoolReview: active, active, completed: projects, ideas: [], validation: [] },
    tasks: { doing: blocked, currentMemberWork: [], blocked, overdue: [] },
    attention: { blockedTasks: blocked }
  }));

  assert.equal(report.schoolDecisionQueue.length, 10);
  assert.equal(report.completedProjects.length, 20);
  assert.equal(report.activeWork.projects.length, 20);
  assert.equal(report.activeWork.tasks.length, 0);
  assert.equal(report.blockers.length, 20);
  assert.equal(report.upcomingPriorities.length, 24);
  assert.equal(report.observedResults.length, 20);
  assert.equal(report.truncation.truncated, true);
  assert.equal(report.truncation.collections.completedProjects.omitted, 15);
  assert.equal(report.completedProjects[0].completedWork.length, 1200);
  collectVerificationStatuses(report).forEach((status) => assert.equal(status, 'not_verified'));
  report.observedResults.forEach((item) => assert.equal(item.status, 'reported/not_verified'));
});

test('redacts email addresses and excludes private identity/source fields throughout report output', () => {
  const privateProject = project({
    projectId: 'PRIVATE',
    projectName: 'Contact student.name@example.org about the project',
    stage: 'School Review',
    schoolFeedback: 'Email teacher@example.org',
    projectLeadProfileKey: 'student.name@example.org',
    sourceRowNumber: 99
  });
  const report = plain(helpers.buildReport({
    projects: { schoolReview: [privateProject], active: [], completed: [], ideas: [], validation: [] },
    tasks: {
      doing: [task({ owner: 'student.name@example.org' })],
      currentMemberWork: [], blocked: [], overdue: []
    },
    attention: { blockedTasks: [] }
  }));
  const serialized = JSON.stringify(report);
  const keys = collectKeys(report).map((key) => key.toLowerCase());

  assert.doesNotMatch(serialized, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  assert.match(serialized, /\[email removed\]/);
  assert.ok(!keys.includes('profilekey'));
  assert.ok(!keys.includes('projectleadprofilekey'));
  assert.ok(!keys.includes('sourcerownumber'));
  assert.ok(!keys.includes('projectkey'));
});

test('is pure, deterministic, service-free, and contains no automated-decision fields', () => {
  const sourceProject = deepFreeze(project({ projectId: 'PURE', projectName: 'Pure input' }));
  const sourceSnapshot = deepFreeze({
    summary: { tasks: { total: 1 }, projects: { total: 1 }, activity: {} },
    projects: { schoolReview: [sourceProject], active: [], completed: [], ideas: [], validation: [] },
    tasks: { doing: [], currentMemberWork: [], blocked: [], overdue: [] },
    attention: { blockedTasks: [] }
  });
  const beforeProject = JSON.stringify(sourceProject);
  const beforeSnapshot = JSON.stringify(sourceSnapshot);
  const firstRecord = plain(helpers.buildRecord(sourceProject));
  const secondRecord = plain(helpers.buildRecord(sourceProject));
  const firstReport = plain(helpers.buildReport(sourceSnapshot));
  const secondReport = plain(helpers.buildReport(sourceSnapshot));

  assert.deepEqual(firstRecord, secondRecord);
  assert.deepEqual(firstReport, secondReport);
  assert.equal(JSON.stringify(sourceProject), beforeProject);
  assert.equal(JSON.stringify(sourceSnapshot), beforeSnapshot);
  assert.doesNotMatch(SOURCE, /\b(?:SpreadsheetApp|DriveApp|UrlFetchApp|PropertiesService|LockService)\b/);
  assert.doesNotMatch(SOURCE, /\b(?:new Date|Date\.now|Math\.random)\b/);
  assert.doesNotMatch(SOURCE, /^(?:var|let|const)\s+/m);

  const forbiddenKeys = new Set([
    'score', 'scores', 'rank', 'ranking', 'winner', 'selectedproject',
    'automaticdecision', 'autodecision'
  ]);
  collectKeys({ firstRecord, firstReport }).forEach((key) => {
    assert.equal(forbiddenKeys.has(key.toLowerCase()), false, `forbidden output field: ${key}`);
  });
  collectVerificationStatuses(firstReport).forEach((status) => assert.notEqual(status, 'verified'));
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
    console.error(`\n${failures} decision/reporting test(s) failed.`);
    process.exitCode = 1;
    return;
  }
  console.log(`\n${tests.length} decision/reporting tests passed.`);
})();
