/**
 * SKS START Command Center - Google Apps Script server.
 *
 * The web app opens the existing workbook by ID because container-bound
 * "active spreadsheet" methods are not reliable from a deployed web app.
 */

var START_SPREADSHEET_ID = '1XFTIrKIcckrwavS-tJ5E_fReKVR3BlLtsbLUXRhto6I';
var START_STATUSES = ['Open', 'Doing', 'Blocked', 'Done'];
var PROJECT_STAGES = ['Idea', 'Validation', 'School Review', 'Active', 'Completed', 'Paused', 'Rejected'];
var PROJECT_STAGE_OPTIONS = PROJECT_STAGES.join(' | ');

var TASK_FIELDS = {
  taskId: ['Task ID', 'TaskID', 'ID'],
  task: ['Task', 'Task Name', 'Title', 'Action Item'],
  relatedProject: ['Related Project', 'Project', 'Project Name'],
  relatedMetric: ['Related Metric', 'Linked Metric', 'START Metric', 'Metric'],
  interestTag: ['Interest Tag', 'Interest', 'Tag', 'Category'],
  estimatedTime: ['Estimated Time', 'Time Estimate', 'Estimate'],
  dueDate: ['Due Date', 'Deadline', 'Due'],
  status: ['Status', 'Task Status'],
  claimedBy: ['Claimed By', 'ClaimedBy', 'Owner', 'Assignee', 'Assigned To'],
  lastUpdate: ['Last Update', 'Last Updated', 'Updated'],
  blocker: ['Blocker', 'Blockers', 'Current Blocker'],
  supportingLink: ['Supporting Link', 'Link', 'URL', 'Resource Link']
};

var PROJECT_FIELDS = {
  projectId: ['Project ID', 'ProjectID', 'ID'],
  projectName: ['Project Name', 'Project', 'Name', 'Title'],
  problemOpportunity: ['Problem / Opportunity', 'Problem or Opportunity', 'Problem', 'Opportunity'],
  linkedStartMetrics: ['Linked START Metrics', 'Linked Metrics', 'START Metrics', 'Metrics'],
  carbonTrack: ['Carbon Track', 'Carbon'],
  stage: ['Stage', 'Project Stage', 'Status'],
  startImpact: ['START Impact', 'Impact'],
  startDifficulty: ['START Difficulty', 'Difficulty'],
  startCost: ['START Cost', 'Cost'],
  localFeasibility: ['Local Feasibility', 'Feasibility'],
  recommendation: ['Recommendation', 'Recommended Action'],
  schoolFeedback: ['School Feedback', 'Staff Feedback', 'Feedback'],
  nextAction: ['Next Action', 'Next Step'],
  projectLead: ['Project Lead', 'Lead', 'Owner'],
  resultsLink: ['Results Link', 'Result Link', 'Link', 'URL'],
  validationEvidence: ['Validation Evidence', 'Evidence', 'Opportunity Evidence'],
  successMeasure: ['Success Measure', 'Success Measures', 'Measure of Success'],
  schoolContact: ['School Contact', 'School Contacts', 'Consulted', 'Department Consulted'],
  knownConcerns: ['Known Concerns', 'Concerns', 'Validation Concerns'],
  decisionNotes: ['Decision Notes', 'Decision Note', 'Pause / Decision Reason'],
  completedWork: ['Completed Work', 'Work Completed', 'What Was Completed'],
  observedResult: ['Observed Result', 'Observed Results', 'Result Observed']
};

var PROJECT_WORKFLOW_HEADERS = [
  { field: 'validationEvidence', canonical: 'Validation Evidence' },
  { field: 'successMeasure', canonical: 'Success Measure' },
  { field: 'schoolContact', canonical: 'School Contact' },
  { field: 'knownConcerns', canonical: 'Known Concerns' },
  { field: 'decisionNotes', canonical: 'Decision Notes' },
  { field: 'completedWork', canonical: 'Completed Work' },
  { field: 'observedResult', canonical: 'Observed Result' }
];

var UPDATE_FIELDS = {
  timestamp: ['Timestamp', 'Time', 'Date'],
  member: ['Member', 'Updated By', 'Author'],
  taskProject: ['Task / Project', 'Task or Project', 'Task Project', 'Item'],
  update: ['Update', 'Progress Update', 'Note'],
  blocker: ['Blocker', 'Blockers'],
  nextStep: ['Next Step', 'Next Action'],
  link: ['Link', 'URL', 'Supporting Link']
};

var SETTINGS_FIELDS = {
  setting: ['Setting', 'Key', 'Name'],
  value: ['Value', 'Setting Value'],
  notes: ['Notes', 'Note']
};

var MEMBER_FIELDS = {
  email: ['Email', 'Email Address', 'Google Email'],
  displayName: ['Display Name', 'Name', 'Member Name'],
  active: ['Active', 'Enabled', 'Current']
};

var METRIC_FIELDS = {
  metric: ['Metric', 'Metric Name', 'START Metric'],
  category: ['Category'],
  currentTier: ['Current Tier', 'Tier'],
  status: ['Status'],
  staffContact: ['Staff Contact', 'Contact'],
  waitingOn: ['Waiting On', 'Waiting For'],
  lastAction: ['Last Action', 'Latest Action'],
  lastUpdated: ['Last Updated', 'Updated'],
  updatedBy: ['Updated By', 'Member'],
  supportingLink: ['Supporting Link', 'Link', 'URL'],
  legacyAssignedTo: ['Legacy Assigned To', 'Assigned To']
};

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('START Command Center')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function getDashboardData(profileKey) {
  return buildDashboardData_(getSpreadsheet_(), profileKey);
}

function claimTask(taskKey, profileKey) {
  return mutateTask_(taskKey, profileKey, 'claim', '');
}

function addTaskUpdate(taskKey, profileKey, updateText) {
  return mutateTask_(taskKey, profileKey, 'add_update', updateText);
}

function blockTask(taskKey, profileKey, blocker) {
  return mutateTask_(taskKey, profileKey, 'block', blocker);
}

function resumeTask(taskKey, profileKey) {
  return mutateTask_(taskKey, profileKey, 'resume', '');
}

function completeTask(taskKey, profileKey) {
  return mutateTask_(taskKey, profileKey, 'done', '');
}

function releaseTask(taskKey, profileKey) {
  return mutateTask_(taskKey, profileKey, 'release', '');
}

/**
 * Backwards-compatible entry point for a briefly deployed v0.1 client.
 * Legacy status labels are accepted as input, but this function only writes
 * the four canonical statuses.
 */
function updateTask(taskKey, profileKey, status, updateText, blocker) {
  return mutateTask_(taskKey, profileKey, 'legacy_update', {
    status: validateStatus_(status),
    updateText: updateText,
    blocker: blocker
  });
}

function mutateTask_(taskKey, profileKey, action, input) {
  return withMutationLock_(function () {
    var spreadsheet = getSpreadsheet_();
    var member = resolveMutationMember_(spreadsheet, profileKey);
    var tasksTable = readTable_(spreadsheet, 'Tasks');
    var updatesTable = readTable_(spreadsheet, 'Updates');
    var taskRow = findTaskRow_(tasksTable, taskKey);
    var needsBlocker = action === 'block' || action === 'resume' || action === 'done' ||
      action === 'release' || action === 'legacy_update';
    var taskColumns = taskColumnsForWrite_(tasksTable, needsBlocker);
    var currentStatus = normalizeReadStatus_(cell_(taskRow.values, taskColumns.status));
    var currentOwner = cell_(taskRow.values, taskColumns.claimedBy).trim();
    var currentBlocker = cell_(taskRow.values, taskColumns.blocker).trim();
    var nextStatus = currentStatus;
    var nextOwner = memberStorageKey_(member);
    var nextBlocker = currentBlocker;
    var updateText = '';
    var historyBlocker = '';

    assertUpdateColumns_(updatesTable);

    if (action === 'claim') {
      if (currentStatus !== 'Open') {
        fail_('This task is no longer open; its current status is "' + currentStatus + '". Refresh the dashboard and try again.');
      }
      if (currentOwner) {
        fail_('This task is already assigned to ' + ownerDisplayName_(currentOwner, readMemberDirectory_(spreadsheet).all) + '. Refresh the dashboard to see the latest owner.');
      }
      nextStatus = 'Doing';
      nextBlocker = '';
      updateText = 'Claimed task';
    } else {
      assertTaskOwner_(currentOwner, member, spreadsheet);

      if (action === 'add_update') {
        assertWorkingStatus_(currentStatus, ['Doing', 'Blocked'], 'add an update to');
        updateText = validateText_(input, 'Update', 1000, true);
      } else if (action === 'block') {
        assertWorkingStatus_(currentStatus, ['Doing'], 'mark');
        nextStatus = 'Blocked';
        nextBlocker = validateText_(input, 'Blocker', 500, true);
        updateText = 'Marked blocked';
        historyBlocker = nextBlocker;
      } else if (action === 'resume') {
        assertWorkingStatus_(currentStatus, ['Blocked'], 'resume');
        nextStatus = 'Doing';
        nextBlocker = '';
        updateText = 'Resumed work';
        historyBlocker = currentBlocker;
      } else if (action === 'done') {
        assertWorkingStatus_(currentStatus, ['Doing', 'Blocked'], 'complete');
        nextStatus = 'Done';
        nextBlocker = '';
        updateText = 'Marked done';
        historyBlocker = currentBlocker;
      } else if (action === 'release') {
        assertWorkingStatus_(currentStatus, ['Doing'], 'release');
        nextStatus = 'Open';
        nextOwner = '';
        nextBlocker = '';
        updateText = 'Released task';
        historyBlocker = currentBlocker;
      } else if (action === 'legacy_update') {
        var legacy = input || {};
        nextStatus = validateStatus_(legacy.status);
        assertLegacyTaskTransition_(currentStatus, nextStatus);
        updateText = validateText_(legacy.updateText, 'Update', 1000, false) || 'Status changed to ' + nextStatus;
        if (nextStatus === 'Blocked') {
          nextBlocker = validateText_(legacy.blocker, 'Blocker', 500, true);
          historyBlocker = nextBlocker;
        } else if (nextStatus === 'Open') {
          nextOwner = '';
          nextBlocker = '';
          historyBlocker = currentBlocker;
        } else if (nextStatus === 'Doing' && currentStatus === 'Blocked') {
          nextBlocker = '';
          historyBlocker = currentBlocker;
        } else if (nextStatus === 'Done') {
          nextBlocker = '';
          historyBlocker = currentBlocker;
        }
      } else {
        fail_('Unsupported task action.');
      }
    }

    var now = new Date();
    var changes = [
      { column: taskColumns.status, value: nextStatus },
      { column: taskColumns.claimedBy, value: literalSheetText_(nextOwner) },
      { column: taskColumns.lastUpdate, value: now }
    ];
    if (taskColumns.blocker >= 0 && (needsBlocker || action === 'claim')) {
      changes.push({ column: taskColumns.blocker, value: literalSheetText_(nextBlocker) });
    }
    setCells_(tasksTable.sheet, taskRow.rowNumber, changes);

    appendUpdate_(updatesTable, {
      timestamp: now,
      member: member.displayName,
      taskProject: taskLabel_(taskRow.values, taskColumns, taskKey),
      update: updateText,
      blocker: historyBlocker,
      nextStep: '',
      link: cell_(taskRow.values, taskColumns.supportingLink)
    });

    flush_();
    return buildDashboardData_(spreadsheet, member.profileKey);
  });
}

function createProjectIdea(profileKey, idea) {
  return withMutationLock_(function () {
    var spreadsheet = getSpreadsheet_();
    var member = resolveMutationMember_(spreadsheet, profileKey);
    var input = objectInput_(idea, 'Project idea');
    var projectName = singleLineText_(input.projectName, 'Project name', 160, true);
    var problem = validateText_(input.problemOpportunity, 'Problem or opportunity', 1500, true);
    var note = validateText_(input.note, 'Idea note', 600, false);
    var projectsTable = readTable_(spreadsheet, 'Projects');
    var updatesTable = readTable_(spreadsheet, 'Updates');
    var columns = projectColumnsForWrite_(projectsTable, ['projectId', 'projectName', 'problemOpportunity', 'stage']);
    var projectId = generateUniqueId_('PRJ', projectsTable, columns.projectId);
    var linkedMetrics = '';

    assertUpdateColumns_(updatesTable);
    if (hasOwn_(input, 'linkedStartMetrics')) {
      linkedMetrics = validateLinkedMetrics_(spreadsheet, input.linkedStartMetrics);
      requireColumn_(columns.linkedStartMetrics, 'Linked START Metrics', 'Projects');
    }

    var now = new Date();
    var row = projectsTable.headers.map(function () { return ''; });
    row[columns.projectId] = literalSheetText_(projectId);
    row[columns.projectName] = literalSheetText_(projectName);
    row[columns.problemOpportunity] = literalSheetText_(problem);
    row[columns.stage] = 'Idea';
    if (columns.linkedStartMetrics >= 0) row[columns.linkedStartMetrics] = literalSheetText_(linkedMetrics);
    if (columns.nextAction >= 0) row[columns.nextAction] = 'Start validation';
    projectsTable.sheet.getRange(projectsTable.sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);

    appendUpdate_(updatesTable, {
      timestamp: now,
      member: member.displayName,
      taskProject: projectLabelFromParts_(projectId, projectName),
      update: note ? note + ' — submitted with new project idea' : 'Created project idea',
      blocker: '',
      nextStep: 'Start validation',
      link: ''
    });

    flush_();
    return projectMutationResult_(spreadsheet, member.profileKey, 'create_idea', projectId, '');
  });
}

function startProjectValidation(projectKey, profileKey) {
  return withMutationLock_(function () {
    var context = loadProjectMutation_(projectKey, profileKey, ['stage', 'nextAction']);
    assertProjectStage_(context.stage, ['Idea'], 'start validation for');
    var now = new Date();
    setCells_(context.projectsTable.sheet, context.projectRow.rowNumber, [
      { column: context.columns.stage, value: 'Validation' },
      { column: context.columns.nextAction, value: 'Complete validation questions' }
    ]);
    appendProjectUpdate_(context, now, 'Started validation', 'Complete validation questions', '');
    flush_();
    return projectMutationResult_(context.spreadsheet, context.member.profileKey, 'start_validation', context.projectKey, '');
  });
}

function saveProjectValidation(projectKey, profileKey, validation) {
  return withMutationLock_(function () {
    var required = ['stage', 'validationEvidence', 'successMeasure', 'schoolContact', 'knownConcerns',
      'decisionNotes', 'nextAction', 'localFeasibility', 'linkedStartMetrics'];
    var context = loadProjectMutation_(projectKey, profileKey, required);
    assertProjectStage_(context.stage, ['Validation'], 'save validation for');
    var input = objectInput_(validation, 'Validation');
    var outcome = validateChoice_(input.outcome, 'Validation outcome', {
      moreinfo: 'more_info',
      moreinformation: 'more_info',
      schoolreview: 'school_review',
      readyforschoolreview: 'school_review',
      pause: 'pause',
      paused: 'pause'
    });
    var evidence = projectTextValue_(context, input, 'validationEvidence', 'Validation evidence', 1500);
    var successMeasure = projectTextValue_(context, input, 'successMeasure', 'Success measure', 1000);
    var schoolContact = projectTextValue_(context, input, 'schoolContact', 'School contact', 500);
    var concerns = projectTextValue_(context, input, 'knownConcerns', 'Known concerns', 1500);
    var nextAction = projectTextValue_(context, input, 'nextAction', 'Next action', 600);
    var localFeasibility = hasOwn_(input, 'localFeasibility')
      ? validateLocalFeasibility_(input.localFeasibility, false)
      : cell_(context.projectRow.values, context.columns.localFeasibility).trim();
    var linkedMetrics = hasOwn_(input, 'linkedStartMetrics')
      ? validateLinkedMetrics_(context.spreadsheet, input.linkedStartMetrics)
      : cell_(context.projectRow.values, context.columns.linkedStartMetrics).trim();
    var nextStage = 'Validation';
    var decisionNote = 'Needs more information';
    var updateText = 'Validation saved — more information needed';

    if (outcome === 'school_review') {
      validateText_(evidence, 'Validation evidence', 1500, true);
      validateText_(successMeasure, 'Success measure', 1000, true);
      validateText_(schoolContact, 'School contact', 500, true);
      validateText_(concerns, 'Known concerns', 1500, true);
      nextStage = 'School Review';
      nextAction = 'Waiting on school review';
      decisionNote = 'Ready for school review';
      updateText = 'Validation completed — ready for school review';
    } else if (outcome === 'more_info') {
      validateText_(nextAction, 'Next action', 600, true);
    } else {
      var pauseReason = validateText_(input.pauseReason || concerns, 'Pause reason', 1000, true);
      nextStage = 'Paused';
      decisionNote = pauseReason;
      updateText = 'Paused during validation: ' + pauseReason;
    }

    var validationChanges = [
      { column: context.columns.validationEvidence, value: literalSheetText_(evidence) },
      { column: context.columns.successMeasure, value: literalSheetText_(successMeasure) },
      { column: context.columns.schoolContact, value: literalSheetText_(schoolContact) },
      { column: context.columns.knownConcerns, value: literalSheetText_(concerns) },
      { column: context.columns.decisionNotes, value: literalSheetText_(decisionNote) },
      { column: context.columns.nextAction, value: literalSheetText_(nextAction) },
      { column: context.columns.stage, value: nextStage }
    ];
    if (hasOwn_(input, 'localFeasibility')) {
      validationChanges.push({ column: context.columns.localFeasibility, value: literalSheetText_(localFeasibility) });
    }
    if (hasOwn_(input, 'linkedStartMetrics')) {
      validationChanges.push({ column: context.columns.linkedStartMetrics, value: literalSheetText_(linkedMetrics) });
    }
    setCells_(context.projectsTable.sheet, context.projectRow.rowNumber, validationChanges);
    appendProjectUpdate_(context, new Date(), updateText, nextAction, '');
    flush_();
    return projectMutationResult_(context.spreadsheet, context.member.profileKey, 'save_validation', context.projectKey, '');
  });
}

function recordSchoolReview(projectKey, profileKey, review) {
  return withMutationLock_(function () {
    var required = ['stage', 'schoolContact', 'schoolFeedback', 'nextAction', 'recommendation',
      'decisionNotes', 'localFeasibility'];
    var context = loadProjectMutation_(projectKey, profileKey, required);
    assertProjectStage_(context.stage, ['School Review'], 'record a school review for');
    var input = objectInput_(review, 'School review');
    var outcome = validateChoice_(input.outcome, 'School review outcome', {
      approved: 'approved',
      revision: 'revision',
      needsrevision: 'revision',
      declined: 'declined',
      rejected: 'declined'
    });
    var consulted = singleLineText_(input.consulted || cell_(context.projectRow.values, context.columns.schoolContact), 'School contact', 500, true);
    var feedback = validateText_(input.schoolFeedback, 'School feedback', 1500, true);
    var nextAction = validateText_(input.nextAction, 'Next action', 600, false);
    var localFeasibility = hasOwn_(input, 'localFeasibility')
      ? validateLocalFeasibility_(input.localFeasibility, false)
      : cell_(context.projectRow.values, context.columns.localFeasibility).trim();
    var nextStage;
    var recommendation;
    var updateText;

    if (outcome === 'approved') {
      nextStage = 'Active';
      recommendation = 'Approved';
      updateText = 'School review approved';
      validateText_(nextAction, 'Next action', 600, true);
    } else if (outcome === 'revision') {
      nextStage = 'Validation';
      recommendation = 'Needs Revision';
      updateText = 'School review requested revision';
      validateText_(nextAction, 'Next action', 600, true);
    } else {
      nextStage = 'Rejected';
      recommendation = 'Declined';
      updateText = 'School review declined the project';
    }

    var reviewChanges = [
      { column: context.columns.schoolContact, value: literalSheetText_(consulted) },
      { column: context.columns.schoolFeedback, value: literalSheetText_(feedback) },
      { column: context.columns.nextAction, value: literalSheetText_(nextAction) },
      { column: context.columns.recommendation, value: recommendation },
      { column: context.columns.decisionNotes, value: literalSheetText_(feedback) },
      { column: context.columns.stage, value: nextStage }
    ];
    if (hasOwn_(input, 'localFeasibility')) {
      reviewChanges.push({ column: context.columns.localFeasibility, value: literalSheetText_(localFeasibility) });
    }
    setCells_(context.projectsTable.sheet, context.projectRow.rowNumber, reviewChanges);
    appendProjectUpdate_(context, new Date(), updateText + ': ' + feedback, nextAction, '');
    flush_();
    return projectMutationResult_(context.spreadsheet, context.member.profileKey, 'school_review_' + outcome, context.projectKey, '');
  });
}

function setProjectLead(projectKey, profileKey, leadProfileKey) {
  return withMutationLock_(function () {
    var context = loadProjectMutation_(projectKey, profileKey, ['stage', 'projectLead']);
    assertProjectStage_(context.stage, ['Idea', 'Validation', 'School Review', 'Active', 'Paused'], 'set a lead for');
    var requestedLead = singleLineText_(leadProfileKey, 'Project lead', 160, false);
    var storedLead = '';
    var leadDisplay = '';
    if (requestedLead) {
      var directory = readMemberDirectory_(context.spreadsheet);
      var lead = findMemberProfile_(requestedLead, directory.active);
      if (!lead) fail_('Choose an active member as Project Lead.');
      storedLead = memberStorageKey_(lead);
      leadDisplay = lead.displayName;
    }
    context.projectsTable.sheet.getRange(context.projectRow.rowNumber, context.columns.projectLead + 1)
      .setValue(literalSheetText_(storedLead));
    appendProjectUpdate_(context, new Date(), leadDisplay ? 'Set Project Lead to ' + leadDisplay : 'Cleared Project Lead', '', '');
    flush_();
    return projectMutationResult_(context.spreadsheet, context.member.profileKey, 'set_lead', context.projectKey, '');
  });
}

function addProjectTask(projectKey, profileKey, task) {
  return withMutationLock_(function () {
    var context = loadProjectMutation_(projectKey, profileKey, ['stage', 'linkedStartMetrics']);
    assertProjectStage_(context.stage, ['Active'], 'add a task to');
    var input = objectInput_(task, 'Project task');
    var taskName = validateText_(input.task, 'Task', 500, true);
    var interestTag = singleLineText_(input.interestTag, 'Interest tag', 120, true);
    var estimatedTime = singleLineText_(input.estimatedTime, 'Estimated time', 120, true);
    var dueDate = singleLineText_(input.dueDate, 'Due date', 120, false);
    var supportingLink = singleLineText_(input.supportingLink, 'Supporting link', 500, false);
    var tasksTable = readTable_(context.spreadsheet, 'Tasks');
    var taskColumns = taskCreationColumns_(tasksTable);
    var taskId = generateUniqueId_('TASK', tasksTable, taskColumns.taskId);
    var metrics = mapMetrics_(readTable_(context.spreadsheet, 'Metrics'), readMemberDirectory_(context.spreadsheet).all);
    var relatedMetric = singleObviousMetric_(cell_(context.projectRow.values, context.columns.linkedStartMetrics), metrics);
    var now = new Date();
    var row = tasksTable.headers.map(function () { return ''; });

    row[taskColumns.taskId] = literalSheetText_(taskId);
    row[taskColumns.task] = literalSheetText_(taskName);
    row[taskColumns.relatedProject] = literalSheetText_(context.projectLabel);
    row[taskColumns.relatedMetric] = literalSheetText_(relatedMetric);
    row[taskColumns.interestTag] = literalSheetText_(interestTag);
    row[taskColumns.estimatedTime] = literalSheetText_(estimatedTime);
    row[taskColumns.dueDate] = literalSheetText_(dueDate);
    row[taskColumns.status] = 'Open';
    row[taskColumns.claimedBy] = '';
    row[taskColumns.lastUpdate] = now;
    row[taskColumns.blocker] = '';
    row[taskColumns.supportingLink] = literalSheetText_(supportingLink);
    tasksTable.sheet.getRange(tasksTable.sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);

    appendProjectUpdate_(context, now, 'Added task ' + taskId + ': ' + taskName, '', supportingLink);
    flush_();
    return projectMutationResult_(context.spreadsheet, context.member.profileKey, 'add_task', context.projectKey, taskId);
  });
}

function addProjectUpdate(projectKey, profileKey, updateText, nextAction) {
  return withMutationLock_(function () {
    var context = loadProjectMutation_(projectKey, profileKey, ['stage', 'nextAction']);
    assertProjectStage_(context.stage, ['Active'], 'update');
    var update = validateText_(updateText, 'Project update', 1000, true);
    var next = validateText_(nextAction, 'Next action', 600, false);
    if (next) {
      context.projectsTable.sheet.getRange(context.projectRow.rowNumber, context.columns.nextAction + 1)
        .setValue(literalSheetText_(next));
    }
    appendProjectUpdate_(context, new Date(), update, next, '');
    flush_();
    return projectMutationResult_(context.spreadsheet, context.member.profileKey, 'add_project_update', context.projectKey, '');
  });
}

function editProjectNextAction(projectKey, profileKey, nextAction) {
  return withMutationLock_(function () {
    var context = loadProjectMutation_(projectKey, profileKey, ['stage', 'nextAction']);
    assertProjectStage_(context.stage, ['Active'], 'edit the next action for');
    var next = validateText_(nextAction, 'Next action', 600, true);
    context.projectsTable.sheet.getRange(context.projectRow.rowNumber, context.columns.nextAction + 1)
      .setValue(literalSheetText_(next));
    appendProjectUpdate_(context, new Date(), 'Updated the next action', next, '');
    flush_();
    return projectMutationResult_(context.spreadsheet, context.member.profileKey, 'edit_next_action', context.projectKey, '');
  });
}

function completeProject(projectKey, profileKey, completion) {
  return withMutationLock_(function () {
    var context = loadProjectMutation_(projectKey, profileKey,
      ['stage', 'completedWork', 'observedResult', 'resultsLink', 'nextAction', 'decisionNotes']);
    assertProjectStage_(context.stage, ['Active'], 'complete');
    var input = objectInput_(completion, 'Project completion');
    var completedWork = validateText_(input.completedWork, 'Completed work', 1500, true);
    var observedResult = validateText_(input.observedResult, 'Observed result', 1500, true);
    var resultsLink = singleLineText_(input.resultsLink, 'Results link', 500, false);
    setCells_(context.projectsTable.sheet, context.projectRow.rowNumber, [
      { column: context.columns.completedWork, value: literalSheetText_(completedWork) },
      { column: context.columns.observedResult, value: literalSheetText_(observedResult) },
      { column: context.columns.resultsLink, value: literalSheetText_(resultsLink) },
      { column: context.columns.nextAction, value: '' },
      { column: context.columns.decisionNotes, value: 'Completed' },
      { column: context.columns.stage, value: 'Completed' }
    ]);
    appendProjectUpdate_(context, new Date(),
      'Completed project: ' + completedWork + (/[.!?]$/.test(completedWork) ? ' ' : '. ') + 'Observed result: ' + observedResult,
      '', resultsLink);
    flush_();
    return projectMutationResult_(context.spreadsheet, context.member.profileKey, 'complete_project', context.projectKey, '');
  });
}

function pauseProject(projectKey, profileKey, reason, nextAction) {
  return withMutationLock_(function () {
    var context = loadProjectMutation_(projectKey, profileKey,
      ['stage', 'decisionNotes', 'nextAction', 'recommendation']);
    assertProjectStage_(context.stage, ['Idea', 'Validation', 'School Review', 'Active'], 'pause');
    var pauseReason = validateText_(reason, 'Pause reason', 1000, true);
    var next = validateText_(nextAction, 'Next reconsideration step', 600, false);
    setCells_(context.projectsTable.sheet, context.projectRow.rowNumber, [
      { column: context.columns.decisionNotes, value: literalSheetText_(pauseReason) },
      { column: context.columns.nextAction, value: literalSheetText_(next) },
      { column: context.columns.recommendation, value: 'Paused' },
      { column: context.columns.stage, value: 'Paused' }
    ]);
    appendProjectUpdate_(context, new Date(), 'Paused project: ' + pauseReason, next, '');
    flush_();
    return projectMutationResult_(context.spreadsheet, context.member.profileKey, 'pause_project', context.projectKey, '');
  });
}

function buildDashboardData_(spreadsheet, requestedProfileKey) {
  var directory = readMemberDirectory_(spreadsheet);
  var viewer = resolveViewer_(requestedProfileKey, directory);

  var tasks = mapTasks_(readTable_(spreadsheet, 'Tasks'), viewer, directory.all);
  var metrics = mapMetrics_(readTable_(spreadsheet, 'Metrics'), directory.all);
  var allUpdates = mapUpdates_(readTable_(spreadsheet, 'Updates'), directory.all);
  var projectsTable = readTable_(spreadsheet, 'Projects');
  var projects = enrichProjects_(mapProjects_(projectsTable, directory.all), tasks, allUpdates, metrics);
  var recentUpdates = allUpdates.slice(0, 20);
  var workflow = projectWorkflowState_(projectsTable, readTable_(spreadsheet, 'Settings'));

  return {
    viewer: viewer,
    members: directory.active.map(publicMember_),
    membersSource: directory.source,
    membersSheetMissing: directory.source === 'settings',
    tasks: tasks,
    projects: projects,
    metrics: metrics,
    updates: recentUpdates,
    summary: summarize_(tasks, projects, recentUpdates),
    projectWorkflowSetupNeeded: workflow.setupNeeded,
    projectWorkflow: workflow,
    generatedAt: new Date().toISOString()
  };
}

function mapTasks_(table, viewer, members) {
  if (!table.headers.length) return [];

  var columns = indexes_(table, TASK_FIELDS);
  requireColumn_(columns.task, 'Task', 'Tasks');
  requireColumn_(columns.status, 'Status', 'Tasks');
  requireColumn_(columns.claimedBy, 'Claimed By', 'Tasks');

  return table.rows.filter(function (row) {
    return hasContent_(row.values);
  }).map(function (row) {
    var taskId = cell_(row.values, columns.taskId).trim();
    var claimedBy = cell_(row.values, columns.claimedBy).trim();
    var status = normalizeReadStatus_(cell_(row.values, columns.status));
    var ownerProfile = findMemberProfile_(claimedBy, members);

    return {
      taskKey: taskId || taskFallbackKey_(row, columns),
      taskId: taskId,
      task: cell_(row.values, columns.task),
      relatedProject: cell_(row.values, columns.relatedProject),
      relatedMetric: cell_(row.values, columns.relatedMetric),
      interestTag: cell_(row.values, columns.interestTag),
      estimatedTime: cell_(row.values, columns.estimatedTime),
      dueDate: cell_(row.values, columns.dueDate),
      status: status,
      claimedBy: claimedBy,
      claimedByProfileKey: ownerProfile ? ownerProfile.profileKey : claimedBy,
      claimedByDisplay: ownerDisplayName_(claimedBy, members),
      lastUpdate: cell_(row.values, columns.lastUpdate),
      blocker: cell_(row.values, columns.blocker),
      supportingLink: cell_(row.values, columns.supportingLink),
      isOpen: status === 'Open' && !claimedBy,
      isMine: !!viewer.profileKey && viewer.isActive && memberMatchesIdentity_(claimedBy, viewer, members)
    };
  });
}

function mapProjects_(table, members) {
  if (!table.headers.length) return [];

  var columns = indexes_(table, PROJECT_FIELDS);
  requireColumn_(columns.projectName, 'Project Name', 'Projects');
  requireColumn_(columns.stage, 'Stage', 'Projects');

  return table.rows.filter(function (row) {
    return hasContent_(row.values);
  }).map(function (row) {
    var projectId = cell_(row.values, columns.projectId).trim();
    var projectName = cell_(row.values, columns.projectName);
    var stage = normalizeReadProjectStage_(cell_(row.values, columns.stage));
    var localFeasibility = cell_(row.values, columns.localFeasibility);
    var recommendation = cell_(row.values, columns.recommendation);
    var projectLead = cell_(row.values, columns.projectLead);
    var leadProfile = findMemberProfile_(projectLead, members);
    return {
      projectKey: projectId || projectFallbackKey_(row, columns),
      sourceRowNumber: row.rowNumber,
      projectId: projectId,
      projectName: projectName,
      projectLabel: projectLabelFromParts_(projectId, projectName),
      problemOpportunity: cell_(row.values, columns.problemOpportunity),
      linkedStartMetrics: cell_(row.values, columns.linkedStartMetrics),
      carbonTrack: cell_(row.values, columns.carbonTrack),
      stage: stage,
      startImpact: cell_(row.values, columns.startImpact),
      startDifficulty: cell_(row.values, columns.startDifficulty),
      startCost: cell_(row.values, columns.startCost),
      localFeasibility: localFeasibility,
      recommendation: recommendation,
      schoolFeedback: cell_(row.values, columns.schoolFeedback),
      nextAction: cell_(row.values, columns.nextAction),
      projectLead: ownerDisplayName_(projectLead, members),
      projectLeadProfileKey: leadProfile ? leadProfile.profileKey : projectLead,
      resultsLink: cell_(row.values, columns.resultsLink),
      validationEvidence: cell_(row.values, columns.validationEvidence),
      successMeasure: cell_(row.values, columns.successMeasure),
      schoolContact: cell_(row.values, columns.schoolContact),
      knownConcerns: cell_(row.values, columns.knownConcerns),
      decisionNotes: cell_(row.values, columns.decisionNotes),
      pauseReason: stage === 'Paused' ? cell_(row.values, columns.decisionNotes) : '',
      rejectionReason: stage === 'Rejected'
        ? cell_(row.values, columns.decisionNotes) || cell_(row.values, columns.schoolFeedback)
        : '',
      completedWork: cell_(row.values, columns.completedWork),
      observedResult: cell_(row.values, columns.observedResult),
      submittedBy: '',
      ideaNote: '',
      linkedMetricNames: linkedMetricValues_(cell_(row.values, columns.linkedStartMetrics), []),
      relatedTasks: [],
      recentUpdates: [],
      isActive: stage === 'Active',
      isWaitingOnSchool: stage === 'School Review',
      isTerminal: stage === 'Completed' || stage === 'Rejected'
    };
  });
}

function mapMetrics_(table, members) {
  if (!table.headers.length) return [];
  var columns = indexes_(table, METRIC_FIELDS);
  requireColumn_(columns.metric, 'Metric', 'Metrics');
  return table.rows.filter(function (row) {
    return hasContent_(row.values) && cell_(row.values, columns.metric).trim();
  }).map(function (row) {
    var updatedBy = cell_(row.values, columns.updatedBy);
    var updatedByProfile = findMemberProfile_(updatedBy, members);
    var legacyAssignedTo = cell_(row.values, columns.legacyAssignedTo);
    return {
      metric: cell_(row.values, columns.metric),
      category: cell_(row.values, columns.category),
      currentTier: cell_(row.values, columns.currentTier),
      status: cell_(row.values, columns.status),
      staffContact: cell_(row.values, columns.staffContact),
      waitingOn: cell_(row.values, columns.waitingOn),
      lastAction: cell_(row.values, columns.lastAction),
      lastUpdated: cell_(row.values, columns.lastUpdated),
      updatedBy: ownerDisplayName_(updatedBy, members),
      updatedByProfileKey: updatedByProfile ? updatedByProfile.profileKey : updatedBy,
      supportingLink: cell_(row.values, columns.supportingLink),
      legacyAssignedTo: ownerDisplayName_(legacyAssignedTo, members)
    };
  });
}

function enrichProjects_(projects, tasks, updates, metrics) {
  var projectNameCounts = {};
  projects.forEach(function (project) {
    var normalizedName = normalizeIdentity_(project.projectName);
    if (normalizedName) projectNameCounts[normalizedName] = (projectNameCounts[normalizedName] || 0) + 1;
  });
  projects.forEach(function (project) {
    var allowNameOnlyMatch = projectNameCounts[normalizeIdentity_(project.projectName)] === 1;
    project.relatedTasks = tasks.filter(function (task) {
      return relatedProjectMatches_(task.relatedProject, project, allowNameOnlyMatch);
    });
    var projectUpdates = updates.filter(function (update) {
      return relatedProjectMatches_(update.taskProject, project, allowNameOnlyMatch);
    });
    project.recentUpdates = projectUpdates.slice(0, 12).map(function (update) {
      return projectUpdatePayload_(update, project.projectKey);
    });
    for (var updateIndex = projectUpdates.length - 1; updateIndex >= 0; updateIndex -= 1) {
      var creationUpdate = projectUpdates[updateIndex];
      if (/created project idea|submitted with new project idea/i.test(creationUpdate.update)) {
        project.submittedBy = creationUpdate.member;
        project.ideaNote = string_(creationUpdate.update)
          .replace(/\s+—\s+submitted with new project idea$/i, '')
          .replace(/^created project idea:\s*/i, '')
          .replace(/^created project idea$/i, '');
        break;
      }
    }
    project.linkedMetricNames = linkedMetricValues_(project.linkedStartMetrics, metrics);
  });
  return projects;
}

function projectUpdatePayload_(update, projectKey) {
  return {
    timestamp: update.timestamp,
    member: update.member,
    memberProfileKey: update.memberProfileKey,
    taskProject: update.taskProject,
    update: update.update,
    blocker: update.blocker,
    nextStep: update.nextStep,
    link: update.link,
    associationType: 'project',
    projectKey: projectKey
  };
}

function mapUpdates_(table, members) {
  if (!table.headers.length) return [];

  var columns = indexes_(table, UPDATE_FIELDS);
  requireColumn_(columns.timestamp, 'Timestamp', 'Updates');
  requireColumn_(columns.member, 'Member', 'Updates');
  requireColumn_(columns.taskProject, 'Task / Project', 'Updates');
  requireColumn_(columns.update, 'Update', 'Updates');

  var rows = table.rows.filter(function (row) {
    return hasContent_(row.values);
  });

  rows.sort(function (left, right) {
    var leftTime = timestampMillis_(rawCell_(left.rawValues, columns.timestamp));
    var rightTime = timestampMillis_(rawCell_(right.rawValues, columns.timestamp));
    if (leftTime !== null && rightTime !== null && leftTime !== rightTime) return rightTime - leftTime;
    if (leftTime !== null && rightTime === null) return -1;
    if (leftTime === null && rightTime !== null) return 1;
    return right.rowNumber - left.rowNumber;
  });

  return rows.map(function (row) {
    var memberValue = cell_(row.values, columns.member);
    var memberProfile = findMemberProfile_(memberValue, members);
    return {
      timestamp: cell_(row.values, columns.timestamp),
      member: ownerDisplayName_(memberValue, members),
      memberProfileKey: memberProfile ? memberProfile.profileKey : memberValue,
      taskProject: cell_(row.values, columns.taskProject),
      update: cell_(row.values, columns.update),
      blocker: cell_(row.values, columns.blocker),
      nextStep: cell_(row.values, columns.nextStep),
      link: cell_(row.values, columns.link)
    };
  });
}

function summarize_(tasks, projects, updates) {
  var openTasks = 0;
  var claimedTasks = 0;
  var myTasks = 0;
  var doingTasks = 0;
  var blockedTasks = 0;

  tasks.forEach(function (task) {
    if (task.status === 'Open' && !task.claimedBy) openTasks += 1;
    if (task.claimedBy && task.status !== 'Done') claimedTasks += 1;
    if (task.isMine && task.status !== 'Done') myTasks += 1;
    if (task.status === 'Doing') doingTasks += 1;
    if (task.status === 'Blocked') blockedTasks += 1;
  });

  var activeProjects = projects.filter(function (project) {
    return project.stage === 'Active';
  }).length;
  var ideasNeedingValidation = projects.filter(function (project) {
    return project.stage === 'Idea';
  }).length;
  var waitingOnSchoolProjects = projects.filter(function (project) {
    return project.stage === 'School Review';
  }).length;
  var waitingItems = buildWaitingItems_(tasks, projects);

  return {
    openTasks: openTasks,
    claimedTasks: claimedTasks,
    doingTasks: doingTasks,
    blockedTasks: blockedTasks,
    myTasks: myTasks,
    activeProjects: activeProjects,
    ideasNeedingValidation: ideasNeedingValidation,
    waitingOnSchoolProjects: waitingOnSchoolProjects,
    waitingOnSchool: waitingItems.length,
    waitingItems: waitingItems,
    recentUpdates: updates.length
  };
}

function buildWaitingItems_(tasks, projects) {
  var taskItems = tasks.filter(function (task) {
    return task.status === 'Blocked';
  }).map(function (task) {
    return {
      key: 'task:' + task.taskKey,
      title: task.task,
      detail: task.blocker || 'Task is marked Blocked',
      type: 'Task'
    };
  });

  var projectItems = projects.filter(function (project) {
    return project.isWaitingOnSchool;
  }).map(function (project, index) {
    return {
      key: 'project:' + (project.projectId || project.projectName || index),
      title: project.projectName,
      detail: project.schoolFeedback || project.nextAction || project.localFeasibility || project.recommendation,
      type: 'Project'
    };
  });

  return taskItems.concat(projectItems);
}

function readMemberDirectory_(spreadsheet) {
  var membersSheet = spreadsheet.getSheetByName('Members');
  if (!membersSheet) {
    var legacy = readLegacyMemberProfiles_(readTable_(spreadsheet, 'Settings'));
    return { all: legacy, active: legacy, source: 'settings' };
  }

  var table = readTable_(spreadsheet, 'Members');
  if (!table.headers.length) {
    fail_('The Members sheet is empty. Run setupMembersSheet() once to add the Email, Display Name, and Active headers.');
  }
  var columns = indexes_(table, MEMBER_FIELDS);
  requireColumn_(columns.email, 'Email', 'Members');
  requireColumn_(columns.displayName, 'Display Name', 'Members');
  requireColumn_(columns.active, 'Active', 'Members');
  var profiles = [];

  table.rows.forEach(function (row) {
    var email = normalizeEmail_(cell_(row.values, columns.email));
    var configuredName = cell_(row.values, columns.displayName).trim();
    if (!email && !configuredName) return;
    var displayName = configuredName || temporaryDisplayName_(email);
    var profile = {
      email: email,
      profileKey: email || configuredName,
      displayName: displayName,
      active: memberIsActive_(cell_(row.values, columns.active)),
      needsDisplayName: !configuredName,
      source: 'members',
      rowNumber: row.rowNumber
    };
    addUniqueProfile_(profiles, profile);
  });

  return {
    all: profiles,
    active: profiles.filter(function (profile) { return profile.active; }),
    source: 'members'
  };
}

function readLegacyMemberProfiles_(table) {
  if (!table.headers.length) return [];

  var columns = indexes_(table, SETTINGS_FIELDS);
  requireColumn_(columns.setting, 'Setting', 'Settings');
  requireColumn_(columns.value, 'Value', 'Settings');
  var names = [];

  table.rows.forEach(function (row) {
    var setting = cell_(row.values, columns.setting).trim();
    var value = cell_(row.values, columns.value).trim();
    var key = normalizeHeader_(setting);
    var isMemberList = key === 'member' || key === 'members' ||
      key === 'committeemember' || key === 'committeemembers';
    var isRole = /(lead|chair|advisor|coordinator|secretary|treasurer|liaison|sponsor|representative|steward)$/.test(key);

    if (value && (isMemberList || isRole)) {
      value.split(/[|,;\n]+/).forEach(function (name) {
        addUnique_(names, name);
      });
    }
  });

  return names.map(function (name) {
    return {
      email: '',
      profileKey: name,
      displayName: name,
      active: true,
      needsDisplayName: false,
      source: 'settings'
    };
  });
}

function resolveViewer_(requestedProfileKey, directory) {
  var email = normalizeEmail_(activeUserEmail_());
  var profile;

  if (email) {
    profile = findMemberProfile_(email, directory.all);
    if (!profile) profile = temporaryEmailProfile_(email);
    return viewerFromProfile_(profile, 'google', email);
  }

  var requested = validateText_(requestedProfileKey, 'Member profile', 160, false);
  if (/[\r\n]/.test(requested)) fail_('Member profile must be a single line.');
  profile = findMemberProfile_(requested, directory.active);
  if (!profile) {
    return {
      email: '',
      identity: '',
      profileKey: '',
      displayName: '',
      authMode: directory.source === 'members' ? 'members_selector' : 'settings_selector',
      needsDisplayName: false,
      needsProfileSelection: true,
      isActive: false
    };
  }
  return viewerFromProfile_(profile, directory.source === 'members' ? 'members_selector' : 'settings_selector', '');
}

function resolveMutationMember_(spreadsheet, requestedProfileKey) {
  var directory = readMemberDirectory_(spreadsheet);
  var email = normalizeEmail_(activeUserEmail_());
  var profile;

  if (email) {
    profile = findMemberProfile_(email, directory.all);
    if (profile && !profile.active) {
      fail_('Your member profile is inactive. Ask a coordinator to mark it Active before making changes.');
    }
    return profile || temporaryEmailProfile_(email);
  }

  var requested = validateText_(requestedProfileKey, 'Member profile', 160, true);
  if (/[\r\n]/.test(requested)) fail_('Member profile must be a single line.');
  profile = findMemberProfile_(requested, directory.active);
  if (!profile) {
    fail_('Choose an active member profile before making changes.');
  }
  return profile;
}

function saveMyDisplayName(displayName) {
  return withMutationLock_(function () {
    var email = normalizeEmail_(activeUserEmail_());
    if (!email) {
      fail_('Google did not provide your email, so your display name must be managed in the Members sheet.');
    }
    var cleanName = validateText_(displayName, 'Display name', 120, true);
    if (/[\r\n]/.test(cleanName)) fail_('Display name must be a single line.');

    var spreadsheet = getSpreadsheet_();
    ensureMembersSheet_(spreadsheet);
    var table = readTable_(spreadsheet, 'Members');
    var columns = indexes_(table, MEMBER_FIELDS);
    requireColumn_(columns.email, 'Email', 'Members');
    requireColumn_(columns.displayName, 'Display Name', 'Members');
    requireColumn_(columns.active, 'Active', 'Members');
    var matches = table.rows.filter(function (row) {
      return normalizeEmail_(cell_(row.values, columns.email)) === email;
    });

    if (matches.length > 1) {
      fail_('Your email appears more than once in Members. Remove the duplicate before saving a display name.');
    }
    if (matches.length === 1) {
      table.sheet.getRange(matches[0].rowNumber, columns.displayName + 1).setValue(literalSheetText_(cleanName));
    } else {
      var row = table.headers.map(function () { return ''; });
      row[columns.email] = literalSheetText_(email);
      row[columns.displayName] = literalSheetText_(cleanName);
      row[columns.active] = true;
      table.sheet.getRange(table.sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
    }

    flush_();
    return buildDashboardData_(spreadsheet, email);
  });
}

function setupMembersSheet() {
  return withMutationLock_(function () {
    var spreadsheet = getSpreadsheet_();
    var setup = ensureMembersSheet_(spreadsheet);
    flush_();
    var dashboard = buildDashboardData_(spreadsheet, '');
    dashboard.setup = setup;
    return dashboard;
  });
}

function setupProjectWorkflow() {
  return withMutationLock_(function () {
    var spreadsheet = getSpreadsheet_();
    var projectsTable = readTable_(spreadsheet, 'Projects');
    var settingsTable = readTable_(spreadsheet, 'Settings');
    var addedHeaders = appendMissingProjectWorkflowHeaders_(projectsTable);
    var settingsChanged = setProjectStageOptions_(settingsTable);
    flush_();
    var dashboard = buildDashboardData_(spreadsheet, '');
    dashboard.setup = {
      sheetName: 'Projects',
      addedHeaders: addedHeaders,
      projectStageOptions: PROJECT_STAGE_OPTIONS,
      settingsChanged: settingsChanged,
      message: addedHeaders.length || settingsChanged
        ? 'Project workflow columns and stage options are ready.'
        : 'Project workflow setup was already complete.'
    };
    return dashboard;
  });
}

function appendMissingProjectWorkflowHeaders_(projectsTable) {
  if (!projectsTable.headers.length) {
    fail_('The Projects sheet is empty and has no header row. Restore its existing headers before setup.');
  }
  var missing = PROJECT_WORKFLOW_HEADERS.filter(function (header) {
    return columnIndex_(projectsTable, PROJECT_FIELDS[header.field]) < 0;
  }).map(function (header) {
    return header.canonical;
  });
  if (!missing.length) return [];

  var firstNewColumn = projectsTable.headers.length + 1;
  ensureSheetCapacity_(projectsTable.sheet, firstNewColumn + missing.length - 1);
  projectsTable.sheet.getRange(1, firstNewColumn, 1, missing.length).setValues([missing]);
  return missing;
}

function ensureSheetCapacity_(sheet, requiredColumns) {
  if (typeof sheet.getMaxColumns !== 'function' || typeof sheet.insertColumnsAfter !== 'function') return;
  var currentColumns = sheet.getMaxColumns();
  if (currentColumns < requiredColumns) {
    sheet.insertColumnsAfter(currentColumns, requiredColumns - currentColumns);
  }
}

function setProjectStageOptions_(settingsTable) {
  if (!settingsTable.headers.length) {
    fail_('The Settings sheet is empty and has no header row.');
  }
  var columns = indexes_(settingsTable, SETTINGS_FIELDS);
  requireColumn_(columns.setting, 'Setting', 'Settings');
  requireColumn_(columns.value, 'Value', 'Settings');
  var matches = settingsTable.rows.filter(function (row) {
    return normalizeHeader_(cell_(row.values, columns.setting)) === 'projectstageoptions';
  });
  if (matches.length > 1) {
    fail_('Project Stage Options appears more than once in Settings. Keep one row before running setup.');
  }
  if (matches.length === 1) {
    var current = cell_(matches[0].values, columns.value).trim();
    if (current === PROJECT_STAGE_OPTIONS) return false;
    settingsTable.sheet.getRange(matches[0].rowNumber, columns.value + 1).setValue(PROJECT_STAGE_OPTIONS);
    return true;
  }

  var row = settingsTable.headers.map(function () { return ''; });
  row[columns.setting] = 'Project Stage Options';
  row[columns.value] = PROJECT_STAGE_OPTIONS;
  if (columns.notes >= 0) row[columns.notes] = 'Canonical project workflow stages';
  settingsTable.sheet.getRange(settingsTable.sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
  return true;
}

function ensureMembersSheet_(spreadsheet) {
  var requiredHeaders = [
    { canonical: 'Email', aliases: MEMBER_FIELDS.email },
    { canonical: 'Display Name', aliases: MEMBER_FIELDS.displayName },
    { canonical: 'Active', aliases: MEMBER_FIELDS.active }
  ];
  var sheet = spreadsheet.getSheetByName('Members');
  var created = false;
  if (!sheet) {
    sheet = spreadsheet.insertSheet('Members');
    created = true;
  }

  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();
  var existingHeaders = [];
  if (lastRow >= 1 && lastColumn >= 1) {
    var headerRange = sheet.getRange(1, 1, 1, lastColumn);
    existingHeaders = (typeof headerRange.getDisplayValues === 'function'
      ? headerRange.getDisplayValues()
      : headerRange.getValues())[0].map(string_);
  }
  var normalized = existingHeaders.map(normalizeHeader_);
  var missing = requiredHeaders.filter(function (header) {
    return !header.aliases.some(function (alias) {
      return normalized.indexOf(normalizeHeader_(alias)) >= 0;
    });
  }).map(function (header) {
    return header.canonical;
  });

  if (missing.length) {
    sheet.getRange(1, existingHeaders.length + 1, 1, missing.length).setValues([missing]);
  }
  if (typeof sheet.setFrozenRows === 'function') sheet.setFrozenRows(1);

  return {
    sheetName: 'Members',
    created: created,
    addedHeaders: missing,
    message: missing.length ? 'Members headers are ready.' : 'Members sheet was already ready.'
  };
}

function activeUserEmail_() {
  try {
    var email = Session.getActiveUser().getEmail();
    return string_(email).trim();
  } catch (error) {
    return '';
  }
}

function viewerFromProfile_(profile, authMode, googleEmail) {
  return {
    email: googleEmail || profile.email || '',
    identity: profile.profileKey,
    profileKey: profile.profileKey,
    displayName: profile.displayName,
    authMode: authMode,
    needsDisplayName: !!profile.needsDisplayName,
    needsProfileSelection: false,
    isActive: profile.active !== false
  };
}

function publicMember_(profile) {
  return {
    profileKey: profile.profileKey,
    displayName: profile.displayName,
    needsDisplayName: !!profile.needsDisplayName
  };
}

function temporaryEmailProfile_(email) {
  return {
    email: email,
    profileKey: email,
    displayName: temporaryDisplayName_(email),
    active: true,
    needsDisplayName: true,
    source: 'google'
  };
}

function temporaryDisplayName_(email) {
  var localPart = string_(email).split('@')[0]
    .replace(/[._+\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!localPart) return 'START member';
  return localPart.split(' ').map(function (word) {
    return word ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : '';
  }).join(' ');
}

function normalizeEmail_(value) {
  return string_(value).trim().toLowerCase();
}

function memberIsActive_(value) {
  var key = normalizeHeader_(value);
  return key === 'true' || key === 'yes' || key === 'y' || key === '1' ||
    key === 'active' || key === 'enabled';
}

function addUniqueProfile_(profiles, profile) {
  var key = normalizeIdentity_(profile.profileKey);
  var exists = profiles.some(function (candidate) {
    return normalizeIdentity_(candidate.profileKey) === key;
  });
  if (!exists) profiles.push(profile);
}

function findMemberProfile_(identity, profiles) {
  var target = normalizeIdentity_(identity);
  if (!target) return null;
  for (var index = 0; index < profiles.length; index += 1) {
    var profile = profiles[index];
    if (normalizeIdentity_(profile.profileKey) === target ||
        normalizeIdentity_(profile.email) === target) {
      return profile;
    }
  }
  for (var displayIndex = 0; displayIndex < profiles.length; displayIndex += 1) {
    if (normalizeIdentity_(profiles[displayIndex].displayName) === target) {
      return profiles[displayIndex];
    }
  }
  return null;
}

function memberStorageKey_(member) {
  return member.email || member.profileKey || member.displayName;
}

function memberMatchesIdentity_(storedIdentity, member, profiles) {
  var stored = normalizeIdentity_(storedIdentity);
  if (!stored || !member) return false;
  if (stored === normalizeIdentity_(member.profileKey) ||
      stored === normalizeIdentity_(member.email) ||
      stored === normalizeIdentity_(member.identity)) return true;
  if (stored !== normalizeIdentity_(member.displayName)) return false;
  if (!profiles) return true;
  var displayMatches = profiles.filter(function (profile) {
    return normalizeIdentity_(profile.displayName) === stored;
  });
  return displayMatches.length === 1;
}

function ownerDisplayName_(storedIdentity, profiles) {
  var stored = string_(storedIdentity).trim();
  if (!stored) return '';
  var profile = findMemberProfile_(stored, profiles || []);
  if (profile) return profile.displayName;
  if (/^[^@\s]+@[^@\s]+$/.test(stored)) return temporaryDisplayName_(stored);
  return stored;
}

function assertTaskOwner_(storedOwner, member, spreadsheet) {
  if (!storedOwner) {
    fail_('This task is not owned. Claim it before changing it.');
  }
  var directory = readMemberDirectory_(spreadsheet);
  if (!memberMatchesIdentity_(storedOwner, member, directory.all)) {
    fail_('Only ' + ownerDisplayName_(storedOwner, directory.all) + ', the member who owns this task, can change it.');
  }
}

function assertWorkingStatus_(status, allowed, verb) {
  if (allowed.indexOf(status) < 0) {
    fail_('You cannot ' + verb + ' a task while it is ' + status + '. Refresh the dashboard and try again.');
  }
}

function assertLegacyTaskTransition_(currentStatus, nextStatus) {
  var allowed = {
    Doing: ['Open', 'Doing', 'Blocked', 'Done'],
    Blocked: ['Doing', 'Blocked', 'Done']
  };
  if (!allowed[currentStatus] || allowed[currentStatus].indexOf(nextStatus) < 0) {
    fail_('You cannot change a task from ' + currentStatus + ' to ' + nextStatus + '. Refresh the dashboard and use the action shown for its current state.');
  }
}

function objectInput_(value, label) {
  if (!value || Object.prototype.toString.call(value) !== '[object Object]') {
    fail_(label + ' details are required.');
  }
  return value;
}

function hasOwn_(object, property) {
  return Object.prototype.hasOwnProperty.call(object || {}, property);
}

function singleLineText_(value, label, maxLength, required) {
  var text = validateText_(value, label, maxLength, required);
  if (/[\r\n]/.test(text)) fail_(label + ' must be a single line.');
  return text;
}

function validateChoice_(value, label, choices) {
  var key = normalizeHeader_(value);
  if (!choices[key]) {
    fail_(label + ' is not supported.');
  }
  return choices[key];
}

function loadProjectMutation_(projectKey, profileKey, requiredFields) {
  var spreadsheet = getSpreadsheet_();
  var member = resolveMutationMember_(spreadsheet, profileKey);
  var projectsTable = readTable_(spreadsheet, 'Projects');
  var updatesTable = readTable_(spreadsheet, 'Updates');
  var projectRow = findProjectRow_(projectsTable, projectKey);
  var columns = projectColumnsForWrite_(projectsTable, requiredFields || []);
  var resolvedId = cell_(projectRow.values, columns.projectId).trim();
  var resolvedName = cell_(projectRow.values, columns.projectName).trim();

  assertUpdateColumns_(updatesTable);
  return {
    spreadsheet: spreadsheet,
    member: member,
    projectsTable: projectsTable,
    updatesTable: updatesTable,
    projectRow: projectRow,
    columns: columns,
    stage: normalizeReadProjectStage_(cell_(projectRow.values, columns.stage)),
    projectKey: resolvedId || projectFallbackKey_(projectRow, columns),
    projectLabel: projectLabelFromParts_(resolvedId, resolvedName)
  };
}

function projectColumnsForWrite_(table, requiredFields) {
  var columns = indexes_(table, PROJECT_FIELDS);
  requireColumn_(columns.projectId, 'Project ID', 'Projects');
  requireColumn_(columns.projectName, 'Project Name', 'Projects');
  requireColumn_(columns.stage, 'Stage', 'Projects');
  (requiredFields || []).forEach(function (field) {
    var header = PROJECT_FIELDS[field] && PROJECT_FIELDS[field][0] ? PROJECT_FIELDS[field][0] : field;
    requireColumn_(columns[field], header, 'Projects');
  });
  return columns;
}

function findProjectRow_(table, projectKey) {
  if (!table.headers.length) fail_('The Projects sheet is empty and has no header row.');
  var key = singleLineText_(projectKey, 'Project key', 300, true);
  var columns = indexes_(table, PROJECT_FIELDS);
  requireColumn_(columns.projectName, 'Project Name', 'Projects');
  requireColumn_(columns.stage, 'Stage', 'Projects');
  var idMatches = [];
  var nameMatches = [];

  table.rows.forEach(function (row) {
    if (!hasContent_(row.values)) return;
    var id = cell_(row.values, columns.projectId).trim();
    var name = cell_(row.values, columns.projectName).trim();
    if (id && (sameIdentity_(id, key) || sameIdentity_(projectLabelFromParts_(id, name), key))) idMatches.push(row);
    if (name && sameIdentity_(name, key)) nameMatches.push(row);
  });
  if (idMatches.length > 1) fail_('Project ID "' + key + '" appears more than once. Make Project IDs unique before updating it.');
  if (idMatches.length === 1) return idMatches[0];

  var rowMatch = /^row:(\d+):([a-z0-9]+)$/.exec(key);
  if (rowMatch) {
    var fingerprintMatches = table.rows.filter(function (row) {
      return !cell_(row.values, columns.projectId).trim() && hasContent_(row.values) &&
        projectFingerprint_(row.values, columns) === rowMatch[2];
    });
    if (fingerprintMatches.length === 1) return fingerprintMatches[0];
    if (fingerprintMatches.length > 1) {
      fail_('This project has no Project ID and now matches more than one row. Add unique Project IDs, then refresh.');
    }
  }

  if (nameMatches.length > 1) fail_('Project name "' + key + '" appears more than once. Use a Project ID instead.');
  if (nameMatches.length === 1) return nameMatches[0];
  fail_('Project "' + key + '" was not found. Refresh the dashboard; it may have moved or been removed.');
}

function projectFallbackKey_(row, columns) {
  return 'row:' + row.rowNumber + ':' + projectFingerprint_(row.values, columns);
}

function projectFingerprint_(values, columns) {
  var identity = [
    cell_(values, columns.projectName),
    cell_(values, columns.problemOpportunity),
    cell_(values, columns.linkedStartMetrics),
    cell_(values, columns.stage),
    cell_(values, columns.nextAction),
    cell_(values, columns.projectLead),
    cell_(values, columns.resultsLink)
  ].map(function (value) {
    return string_(value).trim().replace(/\s+/g, ' ').toLowerCase();
  }).join('|');
  var hash = 0;
  for (var index = 0; index < identity.length; index += 1) {
    hash = ((hash << 5) - hash + identity.charCodeAt(index)) | 0;
  }
  return (hash >>> 0).toString(36);
}

function projectLabelFromParts_(projectId, projectName) {
  var id = string_(projectId).trim();
  var name = string_(projectName).trim();
  if (id && name) return id + ': ' + name;
  return id || name;
}

function appendProjectUpdate_(context, timestamp, updateText, nextStep, link) {
  appendUpdate_(context.updatesTable, {
    timestamp: timestamp,
    member: context.member.displayName,
    taskProject: context.projectLabel,
    update: updateText,
    blocker: '',
    nextStep: nextStep || '',
    link: link || ''
  });
}

function projectMutationResult_(spreadsheet, profileKey, action, projectKey, taskKey) {
  var dashboard = buildDashboardData_(spreadsheet, profileKey);
  var resolvedProjectKey = projectKey || '';
  var rowMatch = /^row:(\d+):/.exec(resolvedProjectKey);
  if (rowMatch) {
    var sourceRow = Number(rowMatch[1]);
    var refreshed = dashboard.projects.filter(function (project) {
      return project.sourceRowNumber === sourceRow;
    });
    if (refreshed.length === 1) resolvedProjectKey = refreshed[0].projectKey;
  }
  dashboard.mutation = {
    action: action,
    projectKey: resolvedProjectKey,
    taskKey: taskKey || ''
  };
  return dashboard;
}

function projectTextValue_(context, input, field, label, maxLength) {
  var value = hasOwn_(input, field) ? input[field] : cell_(context.projectRow.values, context.columns[field]);
  return validateText_(value, label, maxLength, false);
}

function validateLocalFeasibility_(value, required) {
  var text = validateText_(value, 'Local feasibility', 120, required);
  if (!text) return '';
  return validateChoice_(text, 'Local feasibility', {
    ready: 'Ready',
    needsconversation: 'Needs Conversation',
    blocked: 'Blocked'
  });
}

function assertProjectStage_(stage, allowed, verb) {
  if (allowed.indexOf(stage) < 0) {
    fail_('You cannot ' + verb + ' a project while it is ' + stage + '. Refresh the dashboard and try again.');
  }
}

function taskCreationColumns_(table) {
  var columns = indexes_(table, TASK_FIELDS);
  [
    ['taskId', 'Task ID'], ['task', 'Task'], ['relatedProject', 'Related Project'],
    ['relatedMetric', 'Related Metric'], ['interestTag', 'Interest Tag'],
    ['estimatedTime', 'Estimated Time'], ['dueDate', 'Due Date'], ['status', 'Status'],
    ['claimedBy', 'Claimed By'], ['lastUpdate', 'Last Update'], ['blocker', 'Blocker'],
    ['supportingLink', 'Supporting Link']
  ].forEach(function (field) {
    requireColumn_(columns[field[0]], field[1], 'Tasks');
  });
  return columns;
}

function generateUniqueId_(prefix, table, idColumn) {
  requireColumn_(idColumn, prefix === 'PRJ' ? 'Project ID' : 'Task ID', prefix === 'PRJ' ? 'Projects' : 'Tasks');
  var now = new Date();
  var datePart = now.getUTCFullYear() + padNumber_(now.getUTCMonth() + 1, 2) + padNumber_(now.getUTCDate(), 2);
  var base = prefix + '-' + datePart + '-';
  var used = {};
  var maximum = 0;
  table.rows.forEach(function (row) {
    var id = cell_(row.values, idColumn).trim();
    if (!id) return;
    used[normalizeIdentity_(id)] = true;
    var match = new RegExp('^' + prefix + '-' + datePart + '-(\\d+)$', 'i').exec(id);
    if (match) maximum = Math.max(maximum, parseInt(match[1], 10));
  });
  var sequence = maximum + 1;
  var candidate = base + padNumber_(sequence, 3);
  while (used[normalizeIdentity_(candidate)]) {
    sequence += 1;
    candidate = base + padNumber_(sequence, 3);
  }
  return candidate;
}

function padNumber_(value, width) {
  var text = String(value);
  while (text.length < width) text = '0' + text;
  return text;
}

function relatedProjectMatches_(storedReference, project, allowNameOnlyMatch) {
  var reference = normalizeIdentity_(storedReference);
  if (!reference) return false;
  var id = normalizeIdentity_(project.projectId);
  var name = normalizeIdentity_(project.projectName);
  var label = normalizeIdentity_(project.projectLabel || projectLabelFromParts_(project.projectId, project.projectName));
  if (id && reference === id) return true;
  if (id && name && reference === label) return true;
  return !!allowNameOnlyMatch && reference === name;
}

function linkedMetricValues_(value, metrics) {
  var metricList = metrics || [];
  var rawValues;
  if (Array.isArray(value)) {
    rawValues = value;
  } else {
    var text = string_(value).trim();
    if (!text) return [];
    var exact = metricList.filter(function (metric) {
      return normalizeIdentity_(metric.metric) === normalizeIdentity_(text);
    });
    rawValues = exact.length === 1 ? [exact[0].metric] : text.split(/[|;,\n]+/);
  }
  var result = [];
  rawValues.forEach(function (item) {
    var clean = string_(item).trim();
    if (!clean) return;
    var match = metricList.filter(function (metric) {
      return normalizeIdentity_(metric.metric) === normalizeIdentity_(clean);
    });
    addUnique_(result, match.length === 1 ? match[0].metric : clean);
  });
  return result;
}

function validateLinkedMetrics_(spreadsheet, value) {
  var metrics = mapMetrics_(readTable_(spreadsheet, 'Metrics'), readMemberDirectory_(spreadsheet).all);
  var selected = linkedMetricValues_(value, metrics);
  if (!selected.length) return '';
  selected.forEach(function (name) {
    var exists = metrics.some(function (metric) {
      return normalizeIdentity_(metric.metric) === normalizeIdentity_(name);
    });
    if (!exists) fail_('Linked START Metric "' + name + '" was not found in Metrics.');
  });
  return selected.join(' | ');
}

function singleObviousMetric_(value, metrics) {
  var selected = linkedMetricValues_(value, metrics);
  if (metrics && metrics.length) {
    selected = selected.filter(function (name) {
      return metrics.some(function (metric) {
        return normalizeIdentity_(metric.metric) === normalizeIdentity_(name);
      });
    });
  }
  return selected.length === 1 ? selected[0] : '';
}

function findTaskRow_(table, taskKey) {
  if (!table.headers.length) {
    fail_('The Tasks sheet is empty and has no header row.');
  }

  var key = validateText_(taskKey, 'Task key', 250, true);
  if (/[\r\n]/.test(key)) fail_('Task key must be a single line.');
  var columns = indexes_(table, TASK_FIELDS);
  requireColumn_(columns.task, 'Task', 'Tasks');
  requireColumn_(columns.status, 'Status', 'Tasks');
  requireColumn_(columns.claimedBy, 'Claimed By', 'Tasks');

  var idMatches = [];
  if (columns.taskId >= 0) {
    table.rows.forEach(function (row) {
      if (cell_(row.values, columns.taskId).trim() === key) idMatches.push(row);
    });
  }

  if (idMatches.length > 1) {
    fail_('Task ID "' + key + '" appears more than once. Make Task IDs unique before updating it.');
  }
  if (idMatches.length === 1) return idMatches[0];

  var rowMatch = /^row:(\d+):([a-z0-9]+)$/.exec(key);
  if (rowMatch) {
    var expectedFingerprint = rowMatch[2];
    var fallbackMatches = [];

    for (var index = 0; index < table.rows.length; index += 1) {
      var candidate = table.rows[index];
      var hasTaskId = columns.taskId >= 0 && cell_(candidate.values, columns.taskId).trim();
      if (!hasTaskId && hasContent_(candidate.values) && taskFingerprint_(candidate.values, columns) === expectedFingerprint) {
        fallbackMatches.push(candidate);
      }
    }

    if (fallbackMatches.length === 1) return fallbackMatches[0];
    if (fallbackMatches.length > 1) {
      fail_('This task has no Task ID and now matches more than one row. Add unique Task IDs, then refresh.');
    }
  }

  fail_('Task "' + key + '" was not found. Refresh the dashboard; the row may have moved or been removed.');
}

function taskColumnsForWrite_(table, needsBlocker) {
  var columns = indexes_(table, TASK_FIELDS);
  requireColumn_(columns.task, 'Task', 'Tasks');
  requireColumn_(columns.status, 'Status', 'Tasks');
  requireColumn_(columns.claimedBy, 'Claimed By', 'Tasks');
  requireColumn_(columns.lastUpdate, 'Last Update', 'Tasks');
  if (needsBlocker) requireColumn_(columns.blocker, 'Blocker', 'Tasks');
  return columns;
}

function assertUpdateColumns_(table) {
  if (!table.headers.length) {
    fail_('The Updates sheet is empty and has no header row. Add its existing headers before changing tasks.');
  }
  var columns = indexes_(table, UPDATE_FIELDS);
  requireColumn_(columns.timestamp, 'Timestamp', 'Updates');
  requireColumn_(columns.member, 'Member', 'Updates');
  requireColumn_(columns.taskProject, 'Task / Project', 'Updates');
  requireColumn_(columns.update, 'Update', 'Updates');
  requireColumn_(columns.blocker, 'Blocker', 'Updates');
  requireColumn_(columns.nextStep, 'Next Step', 'Updates');
  requireColumn_(columns.link, 'Link', 'Updates');
}

function appendUpdate_(table, update) {
  var columns = indexes_(table, UPDATE_FIELDS);
  var row = table.headers.map(function () { return ''; });
  row[columns.timestamp] = update.timestamp;
  row[columns.member] = literalSheetText_(update.member);
  row[columns.taskProject] = literalSheetText_(update.taskProject);
  row[columns.update] = literalSheetText_(update.update);
  row[columns.blocker] = literalSheetText_(update.blocker);
  row[columns.nextStep] = literalSheetText_(update.nextStep);
  row[columns.link] = literalSheetText_(update.link);
  table.sheet.getRange(table.sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
}

function taskLabel_(values, columns, fallbackKey) {
  var id = cell_(values, columns.taskId).trim();
  var title = cell_(values, columns.task).trim();
  if (id && title) return id + ': ' + title;
  return title || id || fallbackKey;
}

function taskFallbackKey_(row, columns) {
  return 'row:' + row.rowNumber + ':' + taskFingerprint_(row.values, columns);
}

function taskFingerprint_(values, columns) {
  var identity = [
    cell_(values, columns.task),
    cell_(values, columns.relatedProject),
    cell_(values, columns.relatedMetric),
    cell_(values, columns.interestTag),
    cell_(values, columns.estimatedTime),
    cell_(values, columns.dueDate),
    cell_(values, columns.status),
    cell_(values, columns.claimedBy),
    cell_(values, columns.lastUpdate),
    cell_(values, columns.blocker),
    cell_(values, columns.supportingLink)
  ].map(function (value) {
    return string_(value).trim().replace(/\s+/g, ' ').toLowerCase();
  }).join('|');
  var hash = 0;
  for (var index = 0; index < identity.length; index += 1) {
    hash = ((hash << 5) - hash + identity.charCodeAt(index)) | 0;
  }
  return (hash >>> 0).toString(36);
}

function readTable_(spreadsheet, sheetName) {
  var sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) fail_('Required sheet "' + sheetName + '" was not found in START Control Center.');

  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();
  if (lastRow < 1 || lastColumn < 1) {
    return { sheet: sheet, headers: [], rows: [], headerIndex: {} };
  }

  var range = sheet.getRange(1, 1, lastRow, lastColumn);
  var rawValues = typeof range.getValues === 'function' ? range.getValues() : [];
  var displayValues = typeof range.getDisplayValues === 'function' ? range.getDisplayValues() : rawValues;
  var values = displayValues.map(function (row) {
    return row.map(string_);
  });
  var headers = values[0];
  var headerIndex = {};

  headers.forEach(function (header, index) {
    var normalized = normalizeHeader_(header);
    if (normalized && typeof headerIndex[normalized] === 'undefined') {
      headerIndex[normalized] = index;
    }
  });

  return {
    sheet: sheet,
    headers: headers,
    headerIndex: headerIndex,
    rows: values.slice(1).map(function (row, index) {
      return {
        rowNumber: index + 2,
        values: row,
        rawValues: rawValues[index + 1] || row
      };
    })
  };
}

function indexes_(table, fields) {
  var result = {};
  Object.keys(fields).forEach(function (field) {
    result[field] = columnIndex_(table, fields[field]);
  });
  return result;
}

function columnIndex_(table, aliases) {
  for (var index = 0; index < aliases.length; index += 1) {
    var normalized = normalizeHeader_(aliases[index]);
    if (typeof table.headerIndex[normalized] !== 'undefined') {
      return table.headerIndex[normalized];
    }
  }
  return -1;
}

function requireColumn_(index, columnName, sheetName) {
  if (index < 0) {
    fail_('The ' + sheetName + ' sheet is missing the required "' + columnName + '" column. Check row 1 for a supported header.');
  }
}

function normalizeHeader_(value) {
  return string_(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function normalizeReadStatus_(value) {
  var key = normalizeHeader_(value);
  if (!key || key === 'open' || key === 'unclaimed' || key === 'todo' || key === 'notstarted') return 'Open';
  if (key === 'doing' || key === 'claimed' || key === 'assigned' || key === 'inprogress' || key === 'started' || key === 'active') return 'Doing';
  if (key === 'blocked' || key === 'waiting' || key === 'waitingonschool' || key === 'onhold') return 'Blocked';
  if (key === 'done' || key === 'complete' || key === 'completed' || key === 'closed') return 'Done';
  return string_(value).trim();
}

function validateStatus_(value) {
  var key = normalizeHeader_(value);
  var allowed = {
    open: 'Open',
    doing: 'Doing',
    claimed: 'Doing',
    inprogress: 'Doing',
    blocked: 'Blocked',
    waiting: 'Blocked',
    done: 'Done'
  };
  if (!allowed[key]) {
    fail_('Unsupported task status. Use one of: ' + START_STATUSES.join(', ') + '.');
  }
  return allowed[key];
}

function normalizeReadProjectStage_(value) {
  var key = normalizeHeader_(value);
  if (!key || key === 'idea' || key === 'concept' || key === 'proposed') return 'Idea';
  if (key === 'validation' || key === 'validating' || key === 'evaluation') return 'Validation';
  if (key === 'schoolreview' || key === 'proposalready' || key === 'awaitingschoolreview' || key === 'pendingapproval') return 'School Review';
  if (key === 'active' || key === 'pilot' || key === 'implementation' || key === 'inprogress') return 'Active';
  if (key === 'completed' || key === 'complete' || key === 'done' || key === 'closed') return 'Completed';
  if (key === 'paused' || key === 'pause' || key === 'onhold') return 'Paused';
  if (key === 'rejected' || key === 'declined' || key === 'notpursuing' || key === 'cancelled' || key === 'canceled') return 'Rejected';
  return string_(value).trim();
}

function projectWorkflowState_(projectsTable, settingsTable) {
  var missingHeaders = PROJECT_WORKFLOW_HEADERS.filter(function (header) {
    return columnIndex_(projectsTable, PROJECT_FIELDS[header.field]) < 0;
  }).map(function (header) {
    return header.canonical;
  });
  var stageOptions = '';
  if (settingsTable.headers.length) {
    var columns = indexes_(settingsTable, SETTINGS_FIELDS);
    if (columns.setting >= 0 && columns.value >= 0) {
      settingsTable.rows.some(function (row) {
        if (normalizeHeader_(cell_(row.values, columns.setting)) !== 'projectstageoptions') return false;
        stageOptions = cell_(row.values, columns.value).trim();
        return true;
      });
    }
  }
  var stageOptionsCurrent = stageOptions === PROJECT_STAGE_OPTIONS;
  return {
    missingHeaders: missingHeaders,
    stageOptions: stageOptions,
    requiredStageOptions: PROJECT_STAGE_OPTIONS,
    stageOptionsCurrent: stageOptionsCurrent,
    setupNeeded: missingHeaders.length > 0 || !stageOptionsCurrent
  };
}

function normalizedOptionList_(value) {
  return string_(value).split('|').map(function (item) {
    return normalizeHeader_(item);
  }).filter(function (item) {
    return !!item;
  }).join('|');
}

function isActiveProjectStage_(stage) {
  return normalizeReadProjectStage_(stage) === 'Active';
}

function isProjectWaitingOnSchool_(stage, localFeasibility, recommendation) {
  return normalizeReadProjectStage_(stage) === 'School Review' ||
    /needs conversation|blocked/i.test(string_(localFeasibility)) ||
    /needs school decision/i.test(string_(recommendation));
}

function validateText_(value, label, maxLength, required) {
  var text = string_(value).trim();
  if (required && !text) fail_(label + ' is required.');
  if (text.length > maxLength) fail_(label + ' must be ' + maxLength + ' characters or fewer.');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) {
    fail_(label + ' contains unsupported control characters.');
  }
  return text;
}

function literalSheetText_(value) {
  var text = string_(value);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function string_(value) {
  if (value === null || typeof value === 'undefined') return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return isNaN(value.getTime()) ? '' : value.toISOString();
  }
  return String(value);
}

function cell_(row, column) {
  return column >= 0 && column < row.length ? string_(row[column]) : '';
}

function rawCell_(row, column) {
  return row && column >= 0 && column < row.length ? row[column] : '';
}

function timestampMillis_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return isNaN(value.getTime()) ? null : value.getTime();
  }
  var millis = new Date(string_(value)).getTime();
  return isNaN(millis) ? null : millis;
}

function setCells_(sheet, row, changes) {
  var ordered = changes.slice().sort(function (left, right) {
    return left.column - right.column;
  });
  var consecutive = ordered.every(function (change, index) {
    return index === 0 || change.column === ordered[index - 1].column + 1;
  });

  if (consecutive) {
    sheet.getRange(row, ordered[0].column + 1, 1, ordered.length)
      .setValues([ordered.map(function (change) { return change.value; })]);
    return;
  }

  ordered.forEach(function (change) {
    sheet.getRange(row, change.column + 1).setValue(change.value);
  });
}

function hasContent_(row) {
  return row.some(function (value) { return string_(value).trim() !== ''; });
}

function addUnique_(items, value) {
  var clean = string_(value).trim();
  if (!clean) return;
  var normalized = normalizeIdentity_(clean);
  var exists = items.some(function (item) {
    return normalizeIdentity_(item) === normalized;
  });
  if (!exists) items.push(clean);
}

function normalizeIdentity_(value) {
  return string_(value).trim().toLowerCase().replace(/\s+/g, ' ');
}

function sameIdentity_(left, right) {
  return !!normalizeIdentity_(left) && normalizeIdentity_(left) === normalizeIdentity_(right);
}

function withMutationLock_(work) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    fail_('Another member is saving a change. Wait a moment and try again.');
  }
  try {
    return work();
  } finally {
    lock.releaseLock();
  }
}

function getSpreadsheet_() {
  try {
    var spreadsheet = SpreadsheetApp.openById(START_SPREADSHEET_ID);
    if (!spreadsheet) fail_('Could not open the START Control Center spreadsheet.');
    return spreadsheet;
  } catch (error) {
    if (error && /^START Command Center:/.test(string_(error.message))) throw error;
    fail_('Could not open the START Control Center spreadsheet. Check the deployment account\'s Sheet access.');
  }
}

function flush_() {
  if (typeof SpreadsheetApp.flush === 'function') SpreadsheetApp.flush();
}

function fail_(message) {
  throw new Error('START Command Center: ' + message);
}
