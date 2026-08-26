const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const indexPath = path.join(root, 'apps-script', 'Index.html');
const html = fs.readFileSync(indexPath, 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);

assert(scriptMatch, 'Index.html must contain an inline client script');
const script = scriptMatch[1];
new Function(script);

const tests = [];

function test(name, check) {
  tests.push({ name, check });
}

function includesAll(source, values, message) {
  values.forEach((value) => assert(source.includes(value), `${message}: ${value}`));
}

test('uses the server-authorized viewer as the only browser identity', () => {
  includesAll(script, [
    'canRead: false',
    'canMutate: false',
    'isAdmin: false',
    "state.currentMember = state.canRead ? (viewerProfileKey || viewerDisplayName) : ''",
    "state.canMutate = state.canRead && bool(first(state.viewer, ['canMutate', 'mayMutate'], false), false)",
    "state.isAdmin = bool(first(state.viewer, ['isAdmin', 'canAdmin'], false), false)",
    "serverCall('getDashboardData', [state.currentMember])"
  ], 'missing authorization boundary');
  ['localStorage', 'profile-select', 'chooseProfile', 'switch-profile', 'requestedMember', 'profilePickerOpen'].forEach((value) => {
    assert(!html.includes(value), `legacy selectable identity path remains: ${value}`);
  });
});

test('clears and withholds operational state when read access is denied', () => {
  includesAll(script, [
    "state.tasks = (state.canRead ? list(payload.tasks) : []).map(normalizeTask)",
    "state.projects = (state.canRead ? list(payload.projects) : []).map(normalizeProject)",
    "state.updates = (state.canRead ? list(payload.updates) : []).map(normalizeUpdate)",
    'if (!state.canRead) {',
    'state.taskDrafts = {}',
    'state.projectDrafts = {}',
    'target.innerHTML = accessState()'
  ], 'denied-state sanitization is incomplete');
  assert(html.includes('[hidden] { display: none !important; }'), 'hidden navigation and controls must remain visually hidden');
});

test('keeps deployment-owner bootstrap operations separate from student data access', () => {
  assert(!script.includes('state.isAdmin = state.canRead &&'), 'administrator bootstrap must not require member read access');
  assert(html.includes('data-view-target="operations" data-requires-admin'), 'administrator navigation is missing');
  includesAll(script, [
    "state.isAdmin = bool(first(state.viewer, ['isAdmin', 'canAdmin'], false), false)",
    'if (!state.isAdmin) {',
    "serverCall('getOperationsData', [])"
  ], 'administrator bootstrap path is incomplete');
});

test('wires exact admin endpoints while keeping server authorization authoritative', () => {
  includesAll(script, [
    "runner.getAdminData()",
    "runner.saveMemberProfile(args[0])",
    "runner.setMemberActive(args[0], args[1])",
    "runner.releaseStrandedTask(args[0], args[1])",
    "runner.inspectStartSchema()",
    "runner.setupMembersSheet()",
    "runner.setupProjectWorkflow()",
    'Every read and mutation below is independently admin-gated on the server',
    'New records stay inactive until a coordinator explicitly reviews and activates them'
  ], 'admin operations wiring is incomplete');
  assert(!html.includes('name="active" checked'), 'new member activation must be an explicit review step');
});

test('provides the narrow administrator stranded-task recovery contract', () => {
  includesAll(html, [
    'Stranded task recovery',
    'data-task-recovery-form',
    'data-task-recovery-select=',
    'name="taskId" maxlength="250"',
    'name="reason" maxlength="300"',
    'Active owners must release their own work. Open and Done tasks are never eligible.'
  ], 'stranded-task recovery form or list aid is incomplete');
  includesAll(script, [
    "first(data, ['taskRecovery', 'strandedTaskRecovery'], {})",
    "runOperationsCommand('releaseStrandedTask', [recoveryInput.taskId, recoveryInput.reason]",
    "if (method === 'releaseStrandedTask') state.operationsTaskRecoveryDraft = { taskId: '', reason: '' }"
  ], 'stranded-task recovery client contract is incomplete');
});

test('provides factual Briefing comparison and reporting views without deciding', () => {
  includesAll(html, [
    'data-view-target="briefing"',
    'id="view-briefing"',
    'Project fact comparison',
    'Human decision required',
    'Missing information',
    'Waiting on school',
    'Active projects',
    'Completed projects',
    'Upcoming priorities',
    'Reported, not independently verified',
    'It does not rank projects'
  ], 'Briefing is missing a required factual section');
  includesAll(script, ['state.decisionComparison', 'state.reporting'], 'Briefing must use server-prepared data');
});

test('supports the complete task board and exact task navigation', () => {
  includesAll(script, [
    "var TASK_FILTERS = ['open', 'mine', 'overdue', 'blocked', 'completed', 'all']",
    "if (state.taskFilter === 'blocked') return task.status === 'Blocked'",
    "if (state.taskFilter === 'overdue') return isTaskOverdue(task)",
    "if (state.taskFilter === 'completed') return task.status === 'Done'",
    'data-open-task=',
    "navigate('tasks', 'all')",
    'data-task-action="release"',
    '<strong>Updated:</strong>',
    'Recent history ('
  ], 'task workflow completion is missing');
});

test('routes the Home overdue count to an actionable overdue-only task filter', () => {
  includesAll(script, [
    "label: 'Overdue'",
    "filter: 'overdue'",
    "overdue: 'Overdue'",
    "state.taskFilter === 'overdue' ? 'No overdue tasks'",
    "task.status !== 'Done' && dueKey < todayKey"
  ], 'overdue filtering is incomplete');
});

test('keeps unsent form drafts across navigation, refresh, and safe rerenders', () => {
  includesAll(script, [
    'function syncFormDraft(form)',
    "form.matches('[data-display-name-form]')",
    "form.matches('[data-member-form]')",
    "form.matches('[data-task-recovery-form]')",
    "form.matches('[data-task-composer-form]')",
    "form.matches('[data-project-form]')",
    "data.getAll('linkedStartMetrics')",
    "state.displayNameEditorOpen ? state.displayNameDraft : state.currentDisplayName",
    "draftField(values, 'nextAction', project.nextAction || '')",
    "draftField(values, 'leadProfileKey', project.projectLeadProfileKey || '')",
    "document.addEventListener('input'",
    "document.addEventListener('change'",
    "syncFormDraft(event.target.closest('form'))"
  ], 'delegated draft preservation is incomplete');
  assert.match(script, /if \(!state\.canRead\) \{[\s\S]*state\.taskDrafts = \{\}[\s\S]*state\.projectDrafts = \{\}/,
    'drafts should only be cleared wholesale when operational access is denied');
});

test('computes overdue state only from machine dates supplied by the server', () => {
  includesAll(script, [
    'dueDateMachine:',
    'lastUpdateMachine:',
    "first(payload, ['todayMachine', 'serverTodayMachine', 'today'])",
    'machineDateKey(task && task.dueDateMachine)',
    'dueKey < todayKey'
  ], 'machine-date support is incomplete');
  const dueFunction = script.match(/function dueInfo\([\s\S]*?\n      }\n\n      function isTaskOverdue/);
  assert(dueFunction, 'dueInfo function not found');
  assert(!/new Date\(\)/.test(dueFunction[0]), 'dueInfo must not use the browser clock');
});

test('lets people resume paused projects with an explicit stage and next action', () => {
  includesAll(script, [
    'data-project-form="resume"',
    "['Idea', 'Validation', 'School Review', 'Active']",
    'name="targetStage" required',
    'name="nextAction" maxlength="600" required',
    "runProjectAction('resumeProject'",
    'runner.resumeProject(args[0], args[1], args[2], args[3])'
  ], 'paused-project resume flow is incomplete');
});

test('includes accessible errors, slow-operation feedback, and mobile targets', () => {
  includesAll(html, [
    'role="alert" aria-live="assertive"',
    "toast.setAttribute('role', isError ? 'alert' : 'status')",
    "toast.setAttribute('aria-live', isError ? 'assertive' : 'polite')",
    'Still working. Leave this tab open; the request is continuing and has not been canceled.',
    '}, 1200);',
    'button, select, input:not([type="checkbox"]):not([type="radio"]) { min-height: 44px; }',
    '.task-history summary { min-height: 44px;',
    'Access check unavailable',
    'We could not confirm your school identity because the dashboard did not load.'
  ], 'accessibility or slow-operation feedback is incomplete');
});

test('escapes Sheet text and validates links before rendering histories and reports', () => {
  includesAll(script, [
    "replace(/&/g, '&amp;')",
    'function safeUrl(value)',
    'var link = safeUrl(update.link)',
    "h(update.update || update.nextStep || 'Task status updated')",
    "h(detail)"
  ], 'untrusted client rendering safeguards are incomplete');
});

let passed = 0;
tests.forEach(({ name, check }) => {
  check();
  passed += 1;
  console.log(`PASS ${name}`);
});
console.log(`\n${passed}/${tests.length} client UI tests passed.`);
