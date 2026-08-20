function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('START Command Center')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function getDashboardData(profileKey) {
  return buildDashboardData_(getSpreadsheet_(), profileKey);
}

function askStartAssistant(profileKey, request) {
  return askStartAssistantWithDependencies_(profileKey, request, null);
}

function inspectStartSchema() {
  return inspectStartSchema_(getSpreadsheet_());
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
