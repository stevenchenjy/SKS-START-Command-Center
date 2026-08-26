function buildDashboardData_(spreadsheet, requestedProfileKey) {
  var access = resolveOperationalAccess_(spreadsheet);
  if (!access.allowed) return buildAccessDeniedDashboard_(access);
  var directory = access.directory;
  var viewer = authorizedViewer_(access);

  var tasks = mapTasks_(readTable_(spreadsheet, 'Tasks'), access.member, directory.all);
  var metrics = mapMetrics_(readTable_(spreadsheet, 'Metrics'), directory.all);
  var allUpdates = mapUpdates_(readTable_(spreadsheet, 'Updates'), directory.all);
  enrichTasks_(tasks, allUpdates);
  var projectsTable = readTable_(spreadsheet, 'Projects');
  var projects = enrichProjects_(mapProjects_(projectsTable, directory.all), tasks, allUpdates, metrics);
  var recentUpdates = allUpdates.slice(0, 20);
  var workflow = projectWorkflowState_(projectsTable, readTable_(spreadsheet, 'Settings'));
  var generatedNow = new Date();
  var today = dashboardMachineDateOnly_(generatedNow);
  var summary = summarize_(tasks, projects, recentUpdates);
  var snapshot = buildProgramSnapshot_({
    tasks: tasks,
    projects: projects,
    metrics: metrics,
    updates: allUpdates,
    summary: summary,
    today: today,
    generatedAt: generatedNow.toISOString()
  });
  var decisionProjects = projects.filter(function (project) {
    return project.stage !== 'Completed' && project.stage !== 'Rejected';
  });

  return {
    accessDenied: false,
    accessReason: '',
    viewer: viewer,
    members: publicMembers_(directory.active),
    membersSource: directory.source,
    membersSheetMissing: directory.source === 'settings',
    tasks: tasks,
    projects: projects,
    metrics: metrics,
    updates: recentUpdates,
    summary: summary,
    decisionComparison: buildProjectDecisionComparison_(decisionProjects),
    reporting: buildStartReportingData_(snapshot),
    capabilities: getPublicCapabilities_(),
    projectWorkflowSetupNeeded: workflow.setupNeeded,
    projectWorkflow: workflow,
    today: today,
    generatedAt: generatedNow.toISOString()
  };
}

function buildAccessDeniedDashboard_(access) {
  var context = access && typeof access === 'object'
    ? access
    : deniedAccessContext_(access || 'access_denied');
  var reason = context.reason || 'access_denied';
  var generatedNow = new Date();
  return {
    accessDenied: true,
    accessReason: reason || 'access_denied',
    viewer: deniedViewer_(reason, context.canAdmin),
    members: [],
    membersSource: 'unavailable',
    membersSheetMissing: false,
    tasks: [],
    projects: [],
    metrics: [],
    updates: [],
    summary: {
      openTasks: 0,
      claimedTasks: 0,
      doingTasks: 0,
      blockedTasks: 0,
      myTasks: 0,
      activeProjects: 0,
      ideasNeedingValidation: 0,
      waitingOnSchoolProjects: 0,
      waitingOnSchool: 0,
      waitingItems: [],
      recentUpdates: 0
    },
    decisionComparison: {
      schemaVersion: 'project-decision-comparison/v1',
      comparisonFields: [],
      requestedProjectIds: [],
      notFoundProjectIds: [],
      projects: [],
      selection: {},
      humanDecisionRequired: true
    },
    reporting: {
      schemaVersion: 'start-reporting-data/v1',
      schoolDecisionQueue: [],
      completedProjects: [],
      activeWork: { projects: [], tasks: [] },
      blockers: [],
      upcomingPriorities: [],
      observedResults: [],
      humanDecisionRequired: true
    },
    capabilities: getPublicCapabilities_(),
    projectWorkflowSetupNeeded: false,
    projectWorkflow: { setupNeeded: false },
    today: dashboardMachineDateOnly_(generatedNow),
    generatedAt: generatedNow.toISOString()
  };
}

function publicMembers_(profiles) {
  var result = [];
  (profiles || []).forEach(function (profile) {
    var publicProfile = publicMember_(profile);
    var exists = result.some(function (candidate) {
      return sameIdentity_(candidate.displayName, publicProfile.displayName);
    });
    if (!exists) result.push(publicProfile);
  });
  return result;
}

function mapTasks_(table, viewerMember, members) {
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
    var claimedByDisplay = ownerDisplayName_(claimedBy, members);

    return {
      taskKey: taskId || taskFallbackKey_(row, columns),
      taskId: taskId,
      task: cell_(row.values, columns.task),
      relatedProject: cell_(row.values, columns.relatedProject),
      relatedMetric: cell_(row.values, columns.relatedMetric),
      interestTag: cell_(row.values, columns.interestTag),
      estimatedTime: cell_(row.values, columns.estimatedTime),
      dueDate: cell_(row.values, columns.dueDate),
      dueDateMachine: dashboardMachineDateOnly_(rawCell_(row.rawValues, columns.dueDate)),
      status: status,
      claimedBy: claimedByDisplay,
      claimedByProfileKey: claimedByDisplay,
      claimedByDisplay: claimedByDisplay,
      lastUpdate: cell_(row.values, columns.lastUpdate),
      lastUpdateMachine: dashboardMachineTimestamp_(rawCell_(row.rawValues, columns.lastUpdate)),
      blocker: cell_(row.values, columns.blocker),
      supportingLink: cell_(row.values, columns.supportingLink),
      isOpen: status === 'Open' && !claimedBy,
      isMine: !!viewerMember && memberMatchesIdentity_(claimedBy, viewerMember, members)
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
      projectLeadProfileKey: leadProfile ? leadProfile.displayName : ownerDisplayName_(projectLead, members),
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

function enrichTasks_(tasks, updates) {
  var titleCounts = {};
  (tasks || []).forEach(function (task) {
    var titleKey = normalizeIdentity_(task.task);
    if (titleKey) titleCounts[titleKey] = (titleCounts[titleKey] || 0) + 1;
  });
  (tasks || []).forEach(function (task) {
    var matching = (updates || []).filter(function (update) {
      return taskUpdateMatches_(update.taskProject, task, titleCounts);
    });
    task.recentUpdates = matching.slice(0, 8).map(function (update) {
      return {
        timestamp: update.timestamp,
        timestampMachine: update.timestampMachine,
        member: update.member,
        taskProject: update.taskProject,
        update: update.update,
        blocker: update.blocker,
        nextStep: update.nextStep,
        link: update.link,
        associationType: 'task',
        taskKey: task.taskKey
      };
    });
  });
  return tasks;
}

function taskUpdateMatches_(storedReference, task, titleCounts) {
  var reference = string_(storedReference).trim();
  if (!reference) return false;
  var taskId = string_(task.taskId).trim();
  var title = string_(task.task).trim();
  if (taskId) {
    if (sameIdentity_(reference, taskId)) return true;
    if (sameIdentity_(reference, taskId + ': ' + title)) return true;
    if (reference.toLowerCase().indexOf(taskId.toLowerCase() + ':') === 0) return true;
  }
  var titleKey = normalizeIdentity_(title);
  return !!titleKey && titleCounts[titleKey] === 1 && sameIdentity_(reference, title);
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
      updatedByProfileKey: updatedByProfile ? updatedByProfile.displayName : ownerDisplayName_(updatedBy, members),
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
      timestampMachine: dashboardMachineTimestamp_(rawCell_(row.rawValues, columns.timestamp)),
      member: ownerDisplayName_(memberValue, members),
      memberProfileKey: memberProfile ? memberProfile.displayName : ownerDisplayName_(memberValue, members),
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

/**
 * Converts a real Sheet Date into an unambiguous school-local calendar date.
 * Text cells stay in their display form for the UI; only already-strict text is
 * mirrored into the machine field. Locale-formatted text is intentionally not
 * parsed because its meaning can differ by account locale.
 */
function dashboardMachineDateOnly_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') {
    if (isNaN(value.getTime())) return '';
    if (typeof Utilities !== 'undefined' && Utilities && typeof Utilities.formatDate === 'function') {
      return Utilities.formatDate(value, START_SCHOOL_TIME_ZONE, 'yyyy-MM-dd');
    }
    return value.toISOString().slice(0, 10);
  }
  var text = string_(value).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

/**
 * Converts a real Sheet Date into an absolute timestamp without parsing any
 * locale-formatted display value. Strict text is validated by the snapshot
 * layer when it is used.
 */
function dashboardMachineTimestamp_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') {
    if (isNaN(value.getTime())) return '';
    return value.toISOString();
  }
  var text = string_(value).trim();
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(text)
    ? text
    : '';
}
