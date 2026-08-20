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
