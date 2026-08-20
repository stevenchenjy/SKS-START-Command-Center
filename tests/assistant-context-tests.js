#!/usr/bin/env node

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const SOURCES = [
  'apps-script/Config.gs',
  'apps-script/ProgramSnapshot.gs',
  'apps-script/AssistantContext.gs',
  'apps-script/AssistantSchema.gs'
].map((relativePath) => ({
  path: path.join(ROOT, relativePath),
  source: fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
}));
const tests = [];

function test(name, work) {
  tests.push({ name, work });
}

function loadContext(order = SOURCES) {
  const context = vm.createContext({});
  order.forEach((file) => new vm.Script(file.source, { filename: file.path }).runInContext(context));
  return context;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function task(overrides = {}) {
  return {
    taskId: 'T-1',
    task: 'Inspect water use',
    status: 'Open',
    claimedBy: '',
    claimedByDisplay: '',
    relatedProject: '',
    relatedMetric: '',
    interestTag: 'Water',
    estimatedTime: '30 minutes',
    dueDateMachine: '2026-08-25',
    lastUpdateMachine: '2026-08-20T10:00:00.000Z',
    blocker: '',
    supportingLink: 'https://private.example/task',
    isMine: false,
    claimedByProfileKey: 'private-profile',
    ...overrides
  };
}

function project(overrides = {}) {
  return {
    projectId: 'P-1',
    projectKey: 'P-1',
    sourceRowNumber: 42,
    projectName: 'Water Audit',
    projectLabel: 'P-1: Water Audit',
    stage: 'Validation',
    problemOpportunity: 'Water use is not yet measured consistently.',
    linkedMetricNames: ['Water Use'],
    startImpact: 'Recorded impact',
    startDifficulty: 'Recorded difficulty',
    startCost: 'Recorded cost',
    localFeasibility: 'Can use existing meters.',
    recommendation: 'Continue validation.',
    schoolFeedback: 'Facilities asked for a baseline.',
    schoolContact: 'Facilities team',
    nextAction: 'Read the meters.',
    projectLead: 'Avery',
    projectLeadProfileKey: 'private-lead',
    validationEvidence: 'Three readings collected.',
    successMeasure: 'Weekly readings completed.',
    knownConcerns: 'Meter access.',
    decisionNotes: 'No decision yet.',
    completedWork: '',
    observedResult: '',
    resultsLink: 'https://private.example/result',
    relatedTasks: [],
    recentUpdates: [],
    ...overrides
  };
}

function metric(overrides = {}) {
  return {
    metric: 'Water Use',
    category: 'Water',
    currentTier: 'Recorded tier only',
    status: 'Working',
    staffContact: 'Facilities',
    waitingOn: '',
    lastAction: 'Read meter',
    lastUpdated: '2026-08-20',
    supportingLink: 'https://private.example/metric',
    updatedByProfileKey: 'private-updater',
    ...overrides
  };
}

function update(overrides = {}) {
  return {
    timestampMachine: '2026-08-20T10:00:00.000Z',
    timestamp: '8/20/2026',
    member: 'Avery',
    memberProfileKey: 'private-member',
    taskProject: 'P-1: Water Audit',
    update: 'Collected a meter reading.',
    blocker: '',
    nextStep: 'Collect another reading.',
    link: 'https://private.example/update',
    ...overrides
  };
}

function dashboard(overrides = {}) {
  return {
    viewer: {
      profileKey: 'private-viewer',
      displayName: 'Avery',
      email: 'avery@student.example'
    },
    members: [{ profileKey: 'private-member', displayName: 'Avery', email: 'avery@student.example' }],
    tasks: [],
    projects: [],
    metrics: [],
    updates: [],
    generatedAt: '2026-08-20T12:00:00.000Z',
    today: '2026-08-20',
    ...overrides
  };
}

test('validates the compact request contract and exact project requirement', () => {
  const context = loadContext();
  assert.deepEqual(
    plain(context.validateAssistantRequest_({ question: '  What is next?  ' })),
    { question: 'What is next?', scope: 'auto', projectId: '' }
  );
  assert.equal(
    context.validateAssistantRequest_({ question: 'Ask student@sks.org' }).question,
    'Ask [email removed]'
  );
  assert.throws(() => context.validateAssistantRequest_(null), /must be an object/);
  assert.throws(() => context.validateAssistantRequest_({ question: '' }), /between 1 and 800/);
  assert.throws(
    () => context.validateAssistantRequest_({ question: 'x'.repeat(801) }),
    /between 1 and 800/
  );
  assert.throws(
    () => context.validateAssistantRequest_({ question: 'x', scope: 'ranking' }),
    /scope must be/
  );
  assert.throws(
    () => context.validateAssistantRequest_({ question: 'x', scope: 'project' }),
    /require an exact Project ID/
  );
  assert.throws(
    () => context.validateAssistantRequest_({ question: 'x', scope: 'project', projectId: 'P-1\nrow:42' }),
    /single-line exact Project ID/
  );
  assert.throws(
    () => context.validateAssistantRequest_({ question: 'x', scope: 'project', projectId: 'row:42' }),
    /internal fallback row key/
  );
  assert.throws(
    () => context.validateAssistantRequest_({ question: 'x', unexpected: true }),
    /unsupported field/
  );
});

test('resolves auto scope deterministically without fuzzy or model classification', () => {
  const context = loadContext();
  const data = dashboard({
    projects: [
      project(),
      project({ projectId: 'P-2', projectName: 'Garden Beds', projectLabel: 'P-2: Garden Beds' })
    ]
  });
  assert.deepEqual(
    plain(context.resolveAssistantScope_({ question: 'Draft the proposal', projectId: 'P-1' }, data)),
    { scope: 'proposal', projectId: 'P-1' }
  );
  assert.equal(context.resolveAssistantScope_({ question: 'Tell me about P-2' }, data).projectId, 'P-2');
  assert.equal(context.resolveAssistantScope_({ question: 'What is next for Water Audit?' }, data).scope, 'project');
  assert.equal(context.resolveAssistantScope_({ question: 'What is waiting on school?' }, data).scope, 'waiting');
  assert.equal(context.resolveAssistantScope_({ question: 'What can I work on?' }, data).scope, 'work');
  assert.equal(context.resolveAssistantScope_({ question: 'Give an overall summary.' }, data).scope, 'program');
  assert.equal(context.resolveAssistantScope_({ question: 'Hello' }, data).scope, 'program');
});

test('never name-matches a duplicated project name', () => {
  const context = loadContext();
  const data = dashboard({
    projects: [
      project({ projectId: 'P-1', projectName: 'Garden' }),
      project({ projectId: 'P-2', projectName: 'Garden' })
    ]
  });
  const resolved = plain(context.resolveAssistantScope_({ question: 'Tell me about Garden' }, data));
  assert.deepEqual(resolved, { scope: 'program', projectId: '' });
});

test('specific-project context uses only unambiguous associations and all required factual fields', () => {
  const context = loadContext();
  const selected = project({
    recentUpdates: [
      update({ timestamp: '8/20/2026', update: 'Exact update' }),
      update({
        timestampMachine: '2026-08-20T11:00:00.000Z',
        timestamp: '8/20/2026',
        update: 'Exact update'
      })
    ]
  });
  const duplicateName = project({ projectId: 'P-2', projectName: 'Water Audit', projectLabel: 'P-2: Water Audit' });
  const data = dashboard({
    projects: [selected, duplicateName, project({ projectId: 'P-3', projectName: 'Garden' })],
    tasks: [
      task({ taskId: 'T-ID', task: 'Read P-1 meter', relatedProject: 'P-1' }),
      task({ taskId: 'T-LABEL', relatedProject: 'p-1: water audit' }),
      task({ taskId: 'T-NAME', relatedProject: 'Water Audit' }),
      task({ taskId: 'T-OTHER', relatedProject: 'P-3' })
    ],
    updates: [
      update({ update: 'Exact update' }),
      update({ timestampMachine: '2026-08-20T11:00:00.000Z', update: 'Exact update' }),
      update({ taskProject: 'T-ID: Read P-1 meter', update: 'Task progress' }),
      update({ taskProject: 'Water Audit', update: 'Ambiguous update' }),
      update({ taskProject: 'P-3: Garden', update: 'Irrelevant update' })
    ],
    metrics: [metric(), metric({ metric: 'Energy Use' })]
  });
  const result = plain(context.buildAssistantContext_(data, {
    question: 'What is happening?', scope: 'project', projectId: 'P-1'
  }));

  assert.equal(result.scope, 'project');
  assert.equal(result.commandCenter.selectedProject.id, 'P-1');
  [
    'startImpact', 'startDifficulty', 'startCost', 'localFeasibility', 'recommendation',
    'schoolFeedback', 'schoolContact', 'nextAction', 'lead', 'validationEvidence',
    'successMeasure', 'knownConcerns', 'decisionNotes', 'completedWork', 'observedResult'
  ].forEach((key) => assert.ok(Object.hasOwn(result.commandCenter.selectedProject, key), key));
  assert.deepEqual(result.commandCenter.relatedTasks.map((item) => item.id), ['T-ID', 'T-LABEL']);
  assert.deepEqual(
    result.commandCenter.recentUpdates.map((item) => item.update),
    ['Exact update', 'Exact update', 'Task progress']
  );
  assert.equal(
    result.commandCenter.recentUpdates.filter((item) => item.update === 'Exact update').length,
    2,
    'enriched copies are deduplicated by full instant without collapsing legitimate repeats'
  );
  assert.equal(result.commandCenter.recentUpdates[0].sourceId, 'update:1');
  assert.deepEqual(result.commandCenter.linkedMetrics.map((item) => item.metric), ['Water Use']);
  assert.ok(result.sourceCatalog.some((item) => item.sourceId === 'project:P-1' && item.navigable));
  assert.ok(result.sourceCatalog.some((item) => item.sourceId === 'task:T-ID' && item.navigable));
  assert.ok(result.sourceCatalog.some((item) => item.sourceId === 'metric:water-use' && item.navigable));
  assert.ok(result.sourceCatalog.some((item) =>
    item.sourceId === 'update:1' && item.type === 'update' && item.navigable === false
  ));
  assert.throws(
    () => context.buildAssistantContext_(data, { question: 'x', scope: 'project', projectId: 'P-404' }),
    /not found/
  );
});

test('work context applies exact caps and prioritizes blocked current-member work', () => {
  const context = loadContext();
  const tasks = [];
  for (let index = 20; index >= 1; index -= 1) {
    tasks.push(task({ taskId: `OPEN-${String(index).padStart(2, '0')}`, dueDateMachine: `2026-09-${String(index).padStart(2, '0')}` }));
  }
  for (let index = 1; index <= 7; index += 1) {
    tasks.push(task({
      taskId: `DOING-${index}`, status: 'Doing', claimedBy: 'private@example.org',
      claimedByDisplay: 'Avery', isMine: true
    }));
    tasks.push(task({
      taskId: `BLOCKED-${index}`, status: 'Blocked', claimedBy: 'private@example.org',
      claimedByDisplay: 'Avery', isMine: true, blocker: 'Waiting'
    }));
  }
  const projects = Array.from({ length: 13 }, (_, index) => project({
    projectId: `ACTIVE-${String(index + 1).padStart(2, '0')}`,
    projectName: `Active ${index + 1}`,
    stage: 'Active'
  }));
  const result = plain(context.buildAssistantContext_(dashboard({ tasks, projects }), {
    question: 'What can I work on?', scope: 'work'
  }));
  assert.equal(result.commandCenter.openTasks.length, 15);
  assert.equal(result.commandCenter.currentMemberWork.length, 10);
  assert.equal(result.commandCenter.activeProjects.length, 10);
  assert.ok(result.commandCenter.currentMemberWork.slice(0, 7).every((item) => item.status === 'Blocked'));
  assert.deepEqual(
    result.commandCenter.openTasks.slice(0, 2).map((item) => item.id),
    ['OPEN-01', 'OPEN-02']
  );
});

test('waiting context includes school-review projects, blocked tasks, and waiting or linked metrics', () => {
  const context = loadContext();
  const result = plain(context.buildAssistantContext_(dashboard({
    projects: [
      project({ projectId: 'P-WAIT', stage: 'School Review', linkedMetricNames: ['Water Use'] }),
      project({ projectId: 'P-ACTIVE', stage: 'Active', linkedMetricNames: ['Energy Use'] })
    ],
    tasks: [
      task({ taskId: 'T-BLOCK', status: 'Blocked', blocker: 'School response', relatedMetric: 'Waste' }),
      task({ taskId: 'T-PROJECT', status: 'Blocked', blocker: 'Supplier delay', relatedProject: 'P-WAIT' }),
      task({ taskId: 'T-UNRELATED', status: 'Blocked', blocker: 'Waiting for equipment delivery' })
    ],
    metrics: [
      metric(),
      metric({ metric: 'Waste' }),
      metric({ metric: 'Energy Use', waitingOn: 'Teacher reply' }),
      metric({ metric: 'Biodiversity' })
    ]
  }), { question: 'What is waiting?', scope: 'waiting' }));
  assert.deepEqual(result.commandCenter.schoolReviewProjects.map((item) => item.id), ['P-WAIT']);
  assert.deepEqual(result.commandCenter.blockedTasks.map((item) => item.id), ['T-BLOCK', 'T-PROJECT']);
  assert.deepEqual(
    result.commandCenter.metrics.map((item) => item.metric),
    ['Energy Use', 'Waste', 'Water Use']
  );
});

test('program context reuses snapshot counts and limits activity and active projects', () => {
  const context = loadContext();
  const projects = Array.from({ length: 12 }, (_, index) => project({
    projectId: `P-${index + 1}`,
    projectName: `Project ${index + 1}`,
    stage: index < 11 ? 'Active' : 'School Review'
  }));
  const updates = Array.from({ length: 15 }, (_, index) => update({
    timestampMachine: `2026-08-${String(20 - index).padStart(2, '0')}T10:00:00.000Z`,
    update: `Update ${index + 1}`
  }));
  const result = plain(context.buildAssistantContext_(dashboard({
    tasks: [task({ taskId: 'T-B', status: 'Blocked', blocker: 'Waiting' })],
    projects,
    updates
  }), { question: 'Program overview', scope: 'program' }));
  assert.equal(result.commandCenter.programSnapshot.summary.tasks.blocked, 1);
  assert.equal(result.commandCenter.programSnapshot.summary.projects.active, 11);
  assert.equal(result.commandCenter.activeProjects.length, 10);
  assert.equal(result.commandCenter.recentUpdates.length, 12);
});

test('recent update source IDs remain stable after shuffled input and are citable but non-navigable', () => {
  const context = loadContext();
  const updates = [
    update({
      timestampMachine: '2026-08-20T10:00:00.000Z',
      member: 'Jordan',
      taskProject: 'P-1: Water Audit',
      update: 'Recorded the baseline.'
    }),
    update({
      timestampMachine: '2026-08-20T10:00:00.000Z',
      member: 'Avery',
      taskProject: 'P-1: Water Audit',
      update: 'Recorded the baseline.',
      nextStep: 'Check another meter.'
    }),
    update({
      timestampMachine: '2026-08-19T10:00:00.000Z',
      taskProject: 'P-1: Water Audit',
      update: 'Opened the audit.'
    })
  ];
  const build = (orderedUpdates, scope = 'program') => plain(context.buildAssistantContext_(dashboard({
    projects: [project()],
    updates: orderedUpdates
  }), scope === 'project'
    ? { question: 'Project update summary', scope: 'project', projectId: 'P-1' }
    : { question: 'Program update summary', scope: 'program' }));
  const first = build(updates);
  const shuffled = build([updates[2], updates[0], updates[1]]);
  const sources = (result) => result.commandCenter.recentUpdates.map((item) => ({
    sourceId: item.sourceId,
    timestamp: item.timestamp,
    member: item.member,
    update: item.update,
    nextStep: item.nextStep
  }));
  assert.deepEqual(sources(first), sources(shuffled));
  assert.deepEqual(first.commandCenter.recentUpdates.map((item) => item.sourceId), [
    'update:1', 'update:2', 'update:3'
  ]);
  const updateSources = first.sourceCatalog.filter((item) => item.type === 'update');
  assert.equal(updateSources.length, 3);
  assert.ok(updateSources.every((item) => item.navigable === false && item.itemId === ''));
  assert.ok(updateSources.every((item) => item.label));

  const projectFirst = build(updates, 'project');
  const projectShuffled = build([updates[1], updates[2], updates[0]], 'project');
  assert.deepEqual(sources(projectFirst), sources(projectShuffled));

  const normalizedTie = [
    update({ member: 'Avery', taskProject: 'Program', update: 'Same update', nextStep: '' }),
    update({ member: 'avery', taskProject: 'Program', update: 'Same update', nextStep: '' })
  ];
  assert.deepEqual(
    sources(build(normalizedTie)),
    sources(build(normalizedTie.slice().reverse())),
    'case-only normalized ties have an exact deterministic tiebreaker'
  );

  const cited = plain(context.validateAssistantModelResponse_({
    answer: 'A baseline was recorded.',
    knownFacts: [{ fact: 'A baseline was recorded.', sourceIds: ['update:1'] }],
    missingInformation: [],
    suggestedNextActions: [],
    relevantItemIds: []
  }, first.sourceCatalog, []));
  assert.deepEqual(cited.knownFacts[0].sourceIds, ['update:1']);
  assert.throws(() => context.validateAssistantModelResponse_({
    answer: 'A baseline was recorded.',
    knownFacts: [{ fact: 'A baseline was recorded.', sourceIds: ['update:1'] }],
    missingInformation: [],
    suggestedNextActions: [],
    relevantItemIds: ['update:1']
  }, first.sourceCatalog, []), /relevantItemIds contains an unavailable item/);
});

test('proposal context preserves factual empty fields and excludes unrelated task data', () => {
  const context = loadContext();
  const result = plain(context.buildAssistantContext_(dashboard({
    projects: [project({ validationEvidence: '', successMeasure: '', knownConcerns: '', schoolFeedback: '' })],
    tasks: [task({ relatedProject: 'P-1' })],
    updates: [update()]
  }), { question: 'Draft a proposal', scope: 'proposal', projectId: 'P-1' }));
  assert.equal(result.commandCenter.selectedProject.validationEvidence, '');
  assert.equal(result.commandCenter.selectedProject.successMeasure, '');
  assert.equal(result.commandCenter.selectedProject.knownConcerns, '');
  assert.ok(!Object.hasOwn(result.commandCenter, 'relatedTasks'));
  assert.equal(result.commandCenter.recentUpdates.length, 1);
});

test('context is privacy-minimized and recursively redacts email from model input', () => {
  const context = loadContext();
  const result = plain(context.buildAssistantContext_(dashboard({
    projects: [project({ schoolFeedback: 'Email teacher@sks.org instead.' })],
    tasks: [task({ relatedProject: 'P-1', claimedByDisplay: 'owner@sks.org' })],
    updates: [update({ member: 'member@sks.org', update: 'See member@sks.org' })],
    metrics: [metric()]
  }), {
    question: 'Ask student@sks.org about this', scope: 'project', projectId: 'P-1'
  }, {
    knowledge: [{
      title: 'Contact teacher@sks.org',
      mimeType: 'text/plain',
      excerpt: 'Read https://private.example/doc and email teacher@sks.org'
    }]
  }));
  const serialized = JSON.stringify(result);
  [
    'student@sks.org', 'teacher@sks.org', 'owner@sks.org', 'member@sks.org',
    'private-profile', 'private-viewer', 'private-lead', 'sourceRowNumber',
    'supportingLink', 'resultsLink', 'https://private.example/result',
    'https://private.example/doc'
  ].forEach((privateValue) => assert.ok(!serialized.includes(privateValue), privateValue));
  assert.ok(serialized.includes('[email removed]'));
});

test('24k budget is deterministic, removes optional collections first, and keeps selected-project core', () => {
  const context = loadContext();
  const long = 'Detailed factual text '.repeat(150);
  const selected = project({
    problemOpportunity: long,
    startImpact: long,
    startDifficulty: long,
    startCost: long,
    localFeasibility: long,
    recommendation: long,
    schoolFeedback: long,
    schoolContact: long,
    nextAction: long,
    validationEvidence: long,
    successMeasure: long,
    knownConcerns: long,
    decisionNotes: long,
    completedWork: long,
    observedResult: long
  });
  const data = dashboard({
    projects: [selected],
    tasks: Array.from({ length: 12 }, (_, index) => task({
      taskId: `T-${index}`, relatedProject: 'P-1', blocker: long
    })),
    updates: Array.from({ length: 8 }, (_, index) => update({ update: `${index} ${long}` })),
    metrics: Array.from({ length: 8 }, (_, index) => metric({ metric: `Metric ${index}` }))
  });
  selected.linkedMetricNames = data.metrics.map((item) => item.metric);
  const knowledge = Array.from({ length: 5 }, (_, index) => ({
    title: `Knowledge ${index}`,
    mimeType: 'text/plain',
    excerpt: long
  }));
  const request = { question: 'Explain the project', scope: 'project', projectId: 'P-1' };
  const first = plain(context.buildAssistantContext_(data, request, { knowledge }));
  const second = plain(context.buildAssistantContext_(data, request, { knowledge }));
  assert.deepEqual(first, second);
  assert.ok(JSON.stringify(first).length <= 24000);
  assert.equal(first.commandCenter.selectedProject.id, 'P-1');
  assert.ok(Object.hasOwn(first.commandCenter.selectedProject, 'observedResult'));
  assert.ok(first.truncation.omitted.knowledge > 0);
  assert.ok(first.truncation.finalCharacters <= first.truncation.limit);
});

test('modules are load-order independent because they expose function declarations only', () => {
  const reversed = loadContext(SOURCES.slice().reverse());
  assert.equal(typeof reversed.buildAssistantContext_, 'function');
  assert.equal(typeof reversed.validateAssistantRequest_, 'function');
  assert.equal(
    reversed.validateAssistantRequest_({ question: 'Hello' }).scope,
    'auto'
  );
});

let passed = 0;
for (const current of tests) {
  try {
    current.work();
    passed += 1;
    console.log(`✓ ${current.name}`);
  } catch (error) {
    console.error(`✗ ${current.name}`);
    throw error;
  }
}
console.log(`\n${passed}/${tests.length} assistant context tests passed.`);
