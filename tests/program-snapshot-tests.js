#!/usr/bin/env node

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'apps-script', 'Config.gs');
const SOURCE_PATH = path.join(ROOT, 'apps-script', 'ProgramSnapshot.gs');
const CONFIG_SOURCE = fs.readFileSync(CONFIG_PATH, 'utf8');
const SOURCE = fs.readFileSync(SOURCE_PATH, 'utf8');
const AS_OF = '2026-08-20T12:00:00.000Z';
const TODAY = '2026-08-20';
const tests = [];

function test(name, work) {
  tests.push({ name, work });
}

function loadBuilder() {
  const context = vm.createContext({});
  new vm.Script(CONFIG_SOURCE, { filename: CONFIG_PATH }).runInContext(context);
  new vm.Script(SOURCE, { filename: SOURCE_PATH }).runInContext(context);
  assert.equal(typeof context.buildProgramSnapshot_, 'function');
  return context.buildProgramSnapshot_;
}

const buildSnapshot = loadBuilder();

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function snapshot(dashboard = {}, options = {}) {
  return plain(buildSnapshot(dashboard, { asOf: AS_OF, today: TODAY, ...options }));
}

function task(overrides = {}) {
  return {
    taskId: 'TASK-001',
    task: 'Default task',
    status: 'Open',
    claimedBy: '',
    claimedByDisplay: '',
    isMine: false,
    dueDate: '',
    lastUpdate: '',
    blocker: '',
    relatedProject: '',
    relatedMetric: '',
    interestTag: '',
    estimatedTime: '',
    ...overrides
  };
}

function project(overrides = {}) {
  return {
    projectId: 'PRJ-001',
    projectName: 'Default project',
    projectLabel: 'PRJ-001: Default project',
    stage: 'Idea',
    projectLead: '',
    problemOpportunity: '',
    linkedMetricNames: [],
    startImpact: '',
    startDifficulty: '',
    startCost: '',
    localFeasibility: '',
    recommendation: '',
    schoolFeedback: '',
    nextAction: 'Start validation',
    validationEvidence: '',
    successMeasure: '',
    knownConcerns: '',
    decisionNotes: '',
    completedWork: '',
    observedResult: '',
    recentUpdates: [],
    ...overrides
  };
}

function update(overrides = {}) {
  return {
    timestamp: '2026-08-20T10:00:00.000Z',
    member: 'Avery',
    taskProject: 'PRJ-001: Default project',
    update: 'Checked the current state',
    blocker: '',
    nextStep: '',
    ...overrides
  };
}

test('returns every fixed collection and zero summary for an empty workbook', () => {
  const result = snapshot({ tasks: [], projects: [], updates: [] });
  assert.equal(result.schemaVersion, 'program-snapshot/v1');
  assert.equal(result.asOf, AS_OF);
  assert.equal(result.today, TODAY);
  assert.deepEqual(result.summary.tasks, {
    total: 0,
    open: 0,
    doing: 0,
    blocked: 0,
    completed: 0,
    currentMemberWork: 0,
    overdue: 0
  });
  assert.deepEqual(Object.keys(result.tasks), [
    'open', 'doing', 'blocked', 'completed', 'currentMemberWork', 'overdue'
  ]);
  assert.deepEqual(Object.keys(result.projects), [
    'ideas', 'validation', 'schoolReview', 'active', 'completed', 'paused', 'rejected'
  ]);
  Object.values(result.tasks).forEach((items) => assert.deepEqual(items, []));
  Object.values(result.projects).forEach((items) => assert.deepEqual(items, []));
  Object.values(result.attention).forEach((items) => assert.deepEqual(items, []));
  Object.values(result.activity).forEach((items) => assert.deepEqual(items, []));
  assert.equal(result.truncation.truncated, false);
});

test('requires an externally supplied strict as-of date and validates bounds', () => {
  assert.throws(
    () => buildSnapshot({}, {}),
    /requires a valid asOf date or RFC 3339 timestamp/
  );
  assert.throws(
    () => buildSnapshot({}, { asOf: '08/20/2026' }),
    /requires a valid asOf/
  );
  assert.throws(
    () => buildSnapshot({}, { asOf: '2026-02-30T12:00:00Z' }),
    /requires a valid asOf/
  );
  assert.throws(
    () => buildSnapshot({}, { asOf: '0001-01-01' }),
    /requires a valid asOf/
  );
  assert.throws(
    () => buildSnapshot({}, { asOf: AS_OF, today: TODAY, limits: { recentUpdates: 101 } }),
    /limits\.recentUpdates must be an integer from 0 to 100/
  );
  assert.throws(
    () => buildSnapshot({}, { asOf: AS_OF, today: TODAY, recentDays: 0 }),
    /recentDays must be an integer from 1 to 3650/
  );
  assert.throws(
    () => buildSnapshot({}, { asOf: AS_OF }),
    /requires an injected today date/
  );
  assert.throws(
    () => buildSnapshot({}, { asOf: AS_OF, today: '2026-02-30' }),
    /requires an injected today date/
  );

  const fromDashboard = plain(buildSnapshot({ generatedAt: AS_OF, today: TODAY }, {}));
  assert.equal(fromDashboard.asOf, AS_OF);
});

test('groups mixed task states and detects current-member and overdue work', () => {
  const result = snapshot({
    tasks: [
      task({ taskId: 'OPEN', task: 'Open overdue', dueDate: '2026-08-19' }),
      task({
        taskId: 'DOING', task: 'My current work', status: 'Doing', isMine: true,
        claimedByDisplay: 'Avery', dueDate: '2026-08-20', lastUpdate: '2026-08-20T09:00:00Z'
      }),
      task({
        taskId: 'BLOCKED', task: 'Blocked work', status: 'Blocked',
        claimedByDisplay: 'Jordan', blocker: 'Waiting for room access', dueDate: '2026-08-18'
      }),
      task({
        taskId: 'DONE', task: 'Finished work', status: 'Done', isMine: true,
        dueDate: '2026-08-01', lastUpdate: '2026-08-18T09:00:00Z'
      }),
      task({ taskId: 'UNKNOWN', task: 'Needs cleanup', status: 'Someday' })
    ]
  });

  assert.deepEqual(result.summary.tasks, {
    total: 5,
    open: 1,
    doing: 1,
    blocked: 1,
    completed: 1,
    currentMemberWork: 1,
    overdue: 2
  });
  assert.deepEqual(result.tasks.currentMemberWork.map((item) => item.id), ['DOING']);
  assert.deepEqual(result.tasks.overdue.map((item) => item.id), ['BLOCKED', 'OPEN']);
  assert.equal(result.tasks.doing[0].owner, 'Avery');
  assert.equal(result.tasks.completed[0].isOverdue, false);
  assert.equal(result.dataQuality.tasks.unknownStatus, 1);
});

test('prefers strict machine dates and uses the injected school-local today', () => {
  const beforeMidnightAtSchool = snapshot({
    tasks: [task({
      taskId: 'DUE-TODAY',
      dueDate: '8/20/2026',
      dueDateMachine: '2026-08-20',
      lastUpdate: '8/20/2026 8:15:00 PM',
      lastUpdateMachine: '2026-08-21T00:15:00.000Z'
    })],
    updates: [update({
      timestamp: '8/20/2026 8:15:00 PM',
      timestampMachine: '2026-08-21T00:15:00.000Z'
    })]
  }, {
    asOf: '2026-08-21T02:00:00.000Z',
    today: '2026-08-20'
  });

  assert.equal(beforeMidnightAtSchool.tasks.open[0].isOverdue, false);
  assert.equal(beforeMidnightAtSchool.tasks.open[0].dueDate, '2026-08-20');
  assert.equal(beforeMidnightAtSchool.tasks.open[0].lastUpdatedAt, '2026-08-21T00:15:00.000Z');
  assert.equal(beforeMidnightAtSchool.activity.recentUpdates.length, 1);
  assert.equal(beforeMidnightAtSchool.dataQuality.tasks.invalidDueDate, 0);
  assert.equal(beforeMidnightAtSchool.dataQuality.tasks.invalidLastUpdate, 0);
  assert.equal(beforeMidnightAtSchool.dataQuality.activity.invalidTimestamp, 0);

  const nextSchoolDay = snapshot({
    tasks: [task({ taskId: 'DUE-YESTERDAY', dueDateMachine: '2026-08-20' })]
  }, {
    asOf: '2026-08-21T12:00:00.000Z',
    today: '2026-08-21'
  });
  assert.equal(nextSchoolDay.tasks.open[0].isOverdue, true);

  const winterEvening = snapshot({
    tasks: [task({ taskId: 'WINTER-DUE', dueDateMachine: '2026-01-15' })]
  }, {
    asOf: '2026-01-16T02:00:00.000Z',
    today: '2026-01-15'
  });
  assert.equal(winterEvening.tasks.open[0].isOverdue, false);
});

test('creates all seven project lifecycle groups and narrowly scopes missing actions', () => {
  const stages = ['Idea', 'Validation', 'School Review', 'Active', 'Completed', 'Paused', 'Rejected'];
  const projects = stages.map((stage, index) => project({
    projectId: `P${index + 1}`,
    projectName: `${stage} project`,
    projectLabel: `P${index + 1}: ${stage} project`,
    stage,
    nextAction: ['Validation', 'Active'].includes(stage) ? '' : `Next for ${stage}`
  }));
  const result = snapshot({ projects });

  assert.deepEqual(result.summary.projects, {
    total: 7,
    ideas: 1,
    validation: 1,
    schoolReview: 1,
    active: 1,
    completed: 1,
    paused: 1,
    rejected: 1
  });
  assert.deepEqual(result.attention.waitingOnSchool.map((item) => item.id), ['P3']);
  assert.deepEqual(result.attention.ideasWaitingForValidation.map((item) => item.id), ['P1']);
  assert.deepEqual(
    result.attention.missingNextActions.map((item) => item.id),
    ['P4', 'P2'],
    'stable name sorting, restricted to Active/Validation/School Review'
  );
  assert.equal(result.dataQuality.projects.workingStageWithoutNextAction, 2);
});

test('normalizes legacy and already-normalized task statuses and project stages', () => {
  const result = snapshot({
    tasks: [
      task({ taskId: 'T1', status: 'Claimed' }),
      task({ taskId: 'T2', status: 'In Progress' }),
      task({ taskId: 'T3', status: 'Waiting' }),
      task({ taskId: 'T4', status: 'Completed' }),
      task({ taskId: 'T5', status: 'Doing' })
    ],
    projects: [
      project({ projectId: 'P1', stage: 'Proposal Ready' }),
      project({ projectId: 'P2', stage: 'Pilot' }),
      project({ projectId: 'P3', stage: 'Concept' }),
      project({ projectId: 'P4', stage: 'Declined' }),
      project({ projectId: 'P5', stage: 'School Review' })
    ]
  });

  assert.deepEqual(result.tasks.doing.map((item) => item.id), ['T1', 'T2', 'T5']);
  assert.deepEqual(result.tasks.blocked.map((item) => item.id), ['T3']);
  assert.deepEqual(result.tasks.completed.map((item) => item.id), ['T4']);
  assert.equal(result.projects.schoolReview.length, 2);
  assert.equal(result.projects.active.length, 1);
  assert.equal(result.projects.ideas.length, 1);
  assert.equal(result.projects.rejected.length, 1);
});

test('handles missing dates without error and rejects ambiguous or impossible dates', () => {
  const result = snapshot({
    tasks: [
      task({ taskId: 'MISSING', dueDate: '', lastUpdate: '' }),
      task({ taskId: 'AMBIGUOUS', dueDate: '08/19/2026', lastUpdate: 'August 19, 2026' }),
      task({ taskId: 'IMPOSSIBLE', dueDate: '2026-02-30', lastUpdate: '2026-13-01T00:00:00Z' }),
      task({ taskId: 'LEAP', dueDate: '2024-02-29', lastUpdate: '2026-08-19T10:00:00+08:00' })
    ],
    updates: [
      update({ timestamp: '' }),
      update({ timestamp: 'yesterday', update: 'Ambiguous' }),
      update({ timestamp: '2026-08-21T00:00:00Z', update: 'Future' }),
      update({ timestamp: '2026-08-19T10:00:00+08:00', update: 'Valid offset' })
    ]
  });

  assert.equal(result.dataQuality.tasks.invalidDueDate, 2);
  assert.equal(result.dataQuality.tasks.invalidLastUpdate, 2);
  assert.equal(result.dataQuality.activity.invalidTimestamp, 2);
  assert.equal(result.dataQuality.activity.futureTimestamp, 1);
  assert.equal(result.activity.recentUpdates.length, 1);
  assert.equal(result.activity.recentUpdates[0].timestamp, '2026-08-19T02:00:00.000Z');
  assert.equal(result.tasks.open.find((item) => item.id === 'LEAP').dueDate, '2024-02-29');
});

test('sorts and deduplicates recent updates while excluding records outside the window', () => {
  const duplicate = update({ timestamp: '2026-08-20T10:00:00Z', update: 'Duplicate event' });
  const result = snapshot({
    updates: [
      update({ timestamp: '2026-08-20T09:00:00Z', taskProject: 'Z item', update: 'Later alphabetically' }),
      duplicate,
      update({ timestamp: '2026-08-20T10:00:00Z', taskProject: 'A item', update: 'Same-time event' }),
      update({ timestamp: '2026-07-01T10:00:00Z', update: 'Outside window' })
    ],
    projects: [project({ recentUpdates: [duplicate] })]
  });

  assert.equal(result.summary.activity.recentUpdates, 3);
  assert.deepEqual(
    result.activity.recentUpdates.map((item) => item.item),
    ['A item', 'PRJ-001: Default project', 'Z item']
  );
  assert.ok(!JSON.stringify(result).includes('Outside window'));
});

test('infers only known server-generated project transitions', () => {
  const targets = [
    ['IDEA', 'Idea', 'Idea target'],
    ['VALIDATION', 'Validation', 'Validation target'],
    ['SCHOOL', 'School Review', 'School target'],
    ['PAUSED', 'Paused', 'Paused target'],
    ['ACTIVE', 'Active', 'Active target'],
    ['REJECTED', 'Rejected', 'Rejected target'],
    ['COMPLETED', 'Completed', 'Completed target']
  ];
  const projects = targets.map(([projectId, stage, projectName]) => project({
    projectId,
    projectName,
    projectLabel: `${projectId}: ${projectName}`,
    stage,
    completedWork: stage === 'Completed' ? 'Installed stations' : ''
  }));
  const transitionUpdates = [
    ['2026-08-20T11:00:00Z', 'IDEA', 'Idea target', 'Created project idea'],
    ['2026-08-20T10:00:00Z', 'VALIDATION', 'Validation target', 'Started validation'],
    ['2026-08-20T09:00:00Z', 'SCHOOL', 'School target', 'Validation completed — ready for school review'],
    ['2026-08-20T08:00:00Z', 'PAUSED', 'Paused target', 'Paused during validation: Need evidence'],
    ['2026-08-20T07:00:00Z', 'ACTIVE', 'Active target', 'School review approved: Proceed'],
    ['2026-08-20T06:00:00Z', 'VALIDATION', 'Validation target', 'School review requested revision: Clarify timing'],
    ['2026-08-20T05:00:00Z', 'REJECTED', 'Rejected target', 'School review declined the project: Not feasible'],
    ['2026-08-20T04:00:00Z', 'COMPLETED', 'Completed target', 'Completed project: Installed stations. Observed result: In use'],
    ['2026-08-20T03:00:00Z', 'PAUSED', 'Paused target', 'Paused project: Waiting for next term'],
    ['2026-08-20T02:00:00Z', 'COMPLETED', 'Completed target', 'Student says project is probably completed']
  ].map(([timestamp, projectId, projectName, text]) => update({
    timestamp,
    taskProject: `${projectId}: ${projectName}`,
    update: text
  }));
  const result = snapshot({
    projects,
    updates: transitionUpdates
  });

  assert.deepEqual(
    result.activity.recentProjectTransitions.map((item) => item.event),
    [
      'created_idea', 'started_validation', 'ready_for_school_review',
      'paused_during_validation', 'school_review_approved',
      'school_review_revision', 'school_review_declined',
      'completed_project', 'paused_project'
    ]
  );
  const completed = result.activity.recentProjectTransitions.find((item) => item.event === 'completed_project');
  assert.deepEqual(
    { from: completed.fromStage, to: completed.toStage, id: completed.projectId },
    { from: 'Active', to: 'Completed', id: 'COMPLETED' }
  );
  result.activity.recentProjectTransitions.forEach((item) => {
    assert.equal(item.evidence, 'update_text_inference');
  });
  const genericPause = result.activity.recentProjectTransitions.find((item) => item.event === 'paused_project');
  assert.equal(genericPause.fromStage, '', 'does not invent an unknowable previous stage');
  assert.equal(result.activity.recentlyCompleted[0].completedWork, 'Installed stations');
});

test('never treats free-form transition-like text as a fact when current state disagrees', () => {
  const result = snapshot({
    projects: [project({
      projectId: 'ACTIVE',
      projectName: 'Still active',
      projectLabel: 'ACTIVE: Still active',
      stage: 'Active',
      completedWork: ''
    })],
    updates: [update({
      taskProject: 'ACTIVE: Still active',
      update: 'Completed project: these are only words in a student update'
    })]
  });

  assert.deepEqual(result.activity.recentProjectTransitions, []);
  assert.deepEqual(result.activity.recentlyCompleted, []);
  assert.equal(result.dataQuality.activity.unverifiedTransitionText, 1);
});

test('derives recently completed task and project work only from dated facts', () => {
  const result = snapshot({
    tasks: [
      task({ taskId: 'RECENT', task: 'Recent task', status: 'Done', lastUpdate: '2026-08-19T08:00:00Z' }),
      task({ taskId: 'OLD', task: 'Old task', status: 'Done', lastUpdate: '2026-06-01T08:00:00Z' }),
      task({ taskId: 'UNDATED', task: 'Undated task', status: 'Done', lastUpdate: '' })
    ],
    projects: [project({ stage: 'Completed', completedWork: 'Finished pilot' })],
    updates: [update({
      timestamp: '2026-08-20T07:00:00Z',
      update: 'Completed project: Finished pilot. Observed result: Students used it'
    })]
  });

  assert.deepEqual(
    result.activity.recentlyCompleted.map((item) => `${item.type}:${item.id}`),
    ['project:PRJ-001', 'task:RECENT']
  );
  assert.ok(!JSON.stringify(result.activity.recentlyCompleted).includes('UNDATED'));
  assert.ok(!JSON.stringify(result.activity.recentlyCompleted).includes('OLD'));
});

test('bounds every collection and reports available, included, and omitted counts', () => {
  const tasks = [];
  ['Open', 'Doing', 'Blocked', 'Done'].forEach((status) => {
    for (let index = 1; index <= 2; index += 1) {
      tasks.push(task({
        taskId: `${status}-${index}`,
        task: `${status} task ${index}`,
        status,
        isMine: status === 'Doing',
        dueDate: status === 'Open' ? `2026-08-0${index}` : '',
        lastUpdate: status === 'Done' ? `2026-08-1${index}T08:00:00Z` : '',
        blocker: status === 'Blocked' ? `Blocker ${index}` : ''
      }));
    }
  });
  const projects = [];
  ['Idea', 'Validation', 'School Review', 'Active', 'Completed', 'Paused', 'Rejected']
    .forEach((stage) => {
      for (let index = 1; index <= 2; index += 1) {
        const id = `${stage.replace(/\s/g, '').toUpperCase()}-${index}`;
        projects.push(project({
          projectId: id,
          projectName: `${stage} project ${index}`,
          projectLabel: `${id}: ${stage} project ${index}`,
          stage,
          nextAction: ['Validation', 'School Review', 'Active'].includes(stage) ? '' : `Next ${index}`,
          completedWork: stage === 'Completed' ? `Completed work ${index}` : ''
        }));
      }
    });
  const updates = [
    update({ timestamp: '2026-08-20T11:00:00Z', taskProject: 'COMPLETED-1: Completed project 1', update: 'Completed project: Work one' }),
    update({ timestamp: '2026-08-20T10:00:00Z', taskProject: 'COMPLETED-2: Completed project 2', update: 'Completed project: Work two' })
  ];
  const result = snapshot(
    { tasks, projects, updates },
    {
      limits: {
        tasksPerStatus: 1,
        overdue: 1,
        attentionPerGroup: 1,
        currentMemberWork: 1,
        projectsPerStage: 1,
        recentUpdates: 1,
        recentTransitions: 1,
        recentlyCompleted: 1
      }
    }
  );

  assert.equal(result.summary.tasks.open, 2, 'summary describes the full source');
  assert.equal(result.tasks.open.length, 1);
  assert.equal(result.tasks.overdue.length, 1);
  assert.equal(result.truncation.truncated, true);
  Object.entries(result.truncation.collections).forEach(([path, state]) => {
    assert.ok(state.available >= 2, `${path} has a nonempty over-limit fixture`);
    assert.deepEqual(state, {
      available: state.available,
      included: 1,
      omitted: state.available - 1
    });
  });
});

test('caps every text field and linked-metric list with explicit truncation totals', () => {
  const huge = 'x'.repeat(50000);
  const linkedMetrics = Array.from({ length: 20 }, (_, index) => `Metric ${String(index).padStart(2, '0')}`);
  const result = snapshot({
    tasks: [task({ taskId: huge, task: huge, blocker: huge })],
    projects: [project({
      projectId: 'P-LONG',
      projectName: huge,
      problemOpportunity: huge,
      startImpact: huge,
      startDifficulty: huge,
      startCost: huge,
      linkedMetricNames: linkedMetrics
    })]
  });

  assert.equal(result.tasks.open[0].id.length, result.limits.fieldCharacters.id);
  assert.equal(result.tasks.open[0].title.length, result.limits.fieldCharacters.label);
  assert.equal(result.tasks.open[0].blocker.length, result.limits.fieldCharacters.longText);
  assert.equal(result.projects.ideas[0].name.length, result.limits.fieldCharacters.label);
  assert.equal(
    result.projects.ideas[0].problemOpportunity.length,
    result.limits.fieldCharacters.longText
  );
  assert.equal(result.projects.ideas[0].startImpact.length, result.limits.fieldCharacters.longText);
  assert.equal(result.projects.ideas[0].startDifficulty.length, result.limits.fieldCharacters.longText);
  assert.equal(result.projects.ideas[0].startCost.length, result.limits.fieldCharacters.longText);
  assert.equal(result.projects.ideas[0].linkedMetrics.length, result.limits.linkedMetricsPerProject);
  assert.ok(result.truncation.text.fieldsTruncated >= 5);
  assert.ok(result.truncation.text.charactersOmitted > 0);
  assert.equal(result.truncation.lists.listsTruncated, 1);
  assert.equal(result.truncation.lists.itemsOmitted, 8);
});

test('enforces an overall serialized-character budget by trimming collection tails', () => {
  const longText = 'detail '.repeat(300);
  const projects = Array.from({ length: 20 }, (_, index) => project({
    projectId: `P-${index}`,
    projectName: `Large project ${index}`,
    projectLabel: `P-${index}: Large project ${index}`,
    stage: 'Active',
    problemOpportunity: longText,
    schoolFeedback: longText,
    nextAction: longText,
    validationEvidence: longText,
    successMeasure: longText,
    knownConcerns: longText
  }));
  const result = snapshot({ projects }, {
    limits: {
      projectsPerStage: 100,
      attentionPerGroup: 100,
      maxSerializedCharacters: 8000
    }
  });
  const serialized = JSON.stringify(result);

  assert.ok(result.truncation.serialized.initialCharacters > 8000);
  assert.ok(result.truncation.serialized.itemsOmitted > 0);
  assert.ok(serialized.length <= 8000);
  assert.equal(result.truncation.serialized.finalCharacters, serialized.length);
});

test('uses stable ordering independent of input row order', () => {
  const tasks = [
    task({ taskId: 'B', task: 'Beta', dueDate: '2026-08-19', lastUpdate: '2026-08-19T01:00:00Z' }),
    task({ taskId: 'A', task: 'Alpha', dueDate: '2026-08-19', lastUpdate: '2026-08-19T01:00:00Z' }),
    task({ taskId: 'DUP', task: 'Duplicate identity', interestTag: 'Zulu' }),
    task({ taskId: 'DUP', task: 'Duplicate identity', interestTag: 'Alpha' }),
    task({ taskId: 'C', task: 'Gamma', dueDate: '' })
  ];
  const projects = [
    project({ projectId: 'P2', projectName: 'Zulu', projectLabel: 'P2: Zulu' }),
    project({ projectId: 'P1', projectName: 'Alpha', projectLabel: 'P1: Alpha' })
  ];
  const updates = [
    update({ taskProject: 'Z item', update: 'B' }),
    update({ taskProject: 'A item', update: 'A' })
  ];
  const forward = snapshot({ tasks, projects, updates });
  const reverse = snapshot({
    tasks: tasks.slice().reverse(),
    projects: projects.slice().reverse(),
    updates: updates.slice().reverse()
  });
  assert.deepEqual(forward, reverse);
  assert.deepEqual(forward.tasks.open.map((item) => item.id), ['A', 'B', 'C', 'DUP', 'DUP']);
  assert.deepEqual(
    forward.tasks.open.filter((item) => item.id === 'DUP').map((item) => item.interestTag),
    ['Alpha', 'Zulu']
  );
  assert.deepEqual(forward.projects.ideas.map((item) => item.id), ['P1', 'P2']);
});

test('returns display names only and cannot leak email, profile, row, or Sheet internals', () => {
  const fakeSheet = { secretCell: 'private-cell-value' };
  fakeSheet.self = fakeSheet;
  const result = snapshot({
    viewer: {
      profileKey: 'viewer.private@sks.org',
      email: 'viewer.private@sks.org',
      displayName: 'Viewer'
    },
    tasks: [task({
      taskId: '',
      taskKey: 'row:22:secretfingerprint',
      sourceRowNumber: 22,
      task: 'Ask owner.private@sks.org for access',
      claimedBy: 'owner.private@sks.org',
      claimedByProfileKey: 'owner.private@sks.org',
      claimedByDisplay: 'Avery Student',
      sheet: fakeSheet
    })],
    projects: [project({
      projectId: '',
      projectKey: 'row:9:secretproject',
      sourceRowNumber: 9,
      projectLead: 'lead.private@sks.org',
      schoolContact: 'teacher.private@sks.org',
      problemOpportunity: 'Contact helper.private@sks.org',
      recentUpdates: [update({
        member: 'member.private@sks.org',
        memberProfileKey: 'member.private@sks.org',
        update: 'Emailed staff.private@sks.org'
      })],
      sheet: fakeSheet
    })]
  });
  const serialized = JSON.stringify(result);

  assert.doesNotMatch(serialized, /@/);
  assert.doesNotMatch(serialized, /profileKey|sourceRow|secretfingerprint|secretproject|private-cell-value/i);
  assert.equal(result.tasks.open[0].owner, 'Avery Student');
  assert.equal(result.tasks.open[0].id, '');
  assert.equal(result.projects.ideas[0].lead, '');
  assert.match(result.tasks.open[0].title, /\[redacted\]/);
  assert.match(result.projects.ideas[0].problemOpportunity, /\[redacted\]/);
});

test('is deterministic, pure, preserves recorded START facts, and omits carbon/scoring internals', () => {
  const dashboard = {
    tasks: [task({ taskId: 'T1' })],
    projects: [project({
      projectId: 'P1',
      startImpact: 'High',
      startDifficulty: 'Medium',
      startCost: 'Low',
      carbonTrack: 'Estimated savings'
    })]
  };
  const before = JSON.stringify(dashboard);
  const first = snapshot(dashboard);
  const second = snapshot(dashboard);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(dashboard), before, 'input was not mutated');
  assert.equal(first.projects.ideas[0].startImpact, 'High');
  assert.equal(first.projects.ideas[0].startDifficulty, 'Medium');
  assert.equal(first.projects.ideas[0].startCost, 'Low');
  assert.doesNotMatch(JSON.stringify(first), /carbonTrack|score/i);
  assert.doesNotMatch(SOURCE, /new Date\s*\(\s*\)/, 'module never reads the clock');
  assert.doesNotMatch(SOURCE, /SpreadsheetApp|PropertiesService|DriveApp|UrlFetchApp/);
});

let passed = 0;
for (const { name, work } of tests) {
  try {
    work();
    passed += 1;
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

console.log(`\n${passed}/${tests.length} Program Snapshot tests passed.`);
