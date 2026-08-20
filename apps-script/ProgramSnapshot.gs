/**
 * Builds a bounded, factual view of the current START program.
 *
 * This function is intentionally pure. Callers must inject `options.asOf` (or
 * provide the already-injected `dashboard.generatedAt` value); it never reads
 * the clock, the workbook, Script Properties, or any other service.
 *
 * @param {Object} dashboard The mapped dashboard payload, not Sheet objects.
 * @param {Object=} options Snapshot bounds, an RFC 3339 as-of value, and the
 *   injected America/New_York date in `today`.
 * @return {Object} A JSON-safe, privacy-minimized program snapshot.
 */
function buildProgramSnapshot_(dashboard, options) {
  var source = programSnapshotObject_(dashboard);
  var settings = programSnapshotOptions_(source, options);
  var quality = programSnapshotEmptyQuality_();
  var truncation = {
    truncated: false,
    collections: {},
    text: { fieldsTruncated: 0, charactersOmitted: 0 },
    lists: { listsTruncated: 0, itemsOmitted: 0 }
  };
  var tasks = programSnapshotTasks_(source.tasks, settings, quality, truncation);
  var projects = programSnapshotProjects_(source.projects, settings, quality, truncation);
  var updates = programSnapshotUpdates_(source, projects.all, settings, quality, truncation);
  var transitions = programSnapshotTransitions_(updates, settings, quality);
  var completedWork = programSnapshotCompletedWork_(tasks.all, projects.all, transitions, settings);

  var taskGroups = {
    open: programSnapshotBound_(tasks.byStatus.Open, settings.limits.tasksPerStatus, 'tasks.open', truncation),
    doing: programSnapshotBound_(tasks.byStatus.Doing, settings.limits.tasksPerStatus, 'tasks.doing', truncation),
    blocked: programSnapshotBound_(tasks.byStatus.Blocked, settings.limits.tasksPerStatus, 'tasks.blocked', truncation),
    completed: programSnapshotBound_(tasks.byStatus.Done, settings.limits.tasksPerStatus, 'tasks.completed', truncation),
    currentMemberWork: programSnapshotBound_(tasks.currentMemberWork, settings.limits.currentMemberWork, 'tasks.currentMemberWork', truncation),
    overdue: programSnapshotBound_(tasks.overdue, settings.limits.overdue, 'tasks.overdue', truncation)
  };
  var projectGroups = {
    ideas: programSnapshotBound_(projects.byStage.Idea, settings.limits.projectsPerStage, 'projects.ideas', truncation),
    validation: programSnapshotBound_(projects.byStage.Validation, settings.limits.projectsPerStage, 'projects.validation', truncation),
    schoolReview: programSnapshotBound_(projects.byStage['School Review'], settings.limits.projectsPerStage, 'projects.schoolReview', truncation),
    active: programSnapshotBound_(projects.byStage.Active, settings.limits.projectsPerStage, 'projects.active', truncation),
    completed: programSnapshotBound_(projects.byStage.Completed, settings.limits.projectsPerStage, 'projects.completed', truncation),
    paused: programSnapshotBound_(projects.byStage.Paused, settings.limits.projectsPerStage, 'projects.paused', truncation),
    rejected: programSnapshotBound_(projects.byStage.Rejected, settings.limits.projectsPerStage, 'projects.rejected', truncation)
  };
  var attention = {
    blockedTasks: programSnapshotBound_(tasks.byStatus.Blocked, settings.limits.attentionPerGroup, 'attention.blockedTasks', truncation),
    waitingOnSchool: programSnapshotBound_(projects.byStage['School Review'], settings.limits.attentionPerGroup, 'attention.waitingOnSchool', truncation),
    ideasWaitingForValidation: programSnapshotBound_(projects.byStage.Idea, settings.limits.attentionPerGroup, 'attention.ideasWaitingForValidation', truncation),
    missingNextActions: programSnapshotBound_(projects.missingNextActions, settings.limits.attentionPerGroup, 'attention.missingNextActions', truncation)
  };
  var activity = {
    recentUpdates: programSnapshotBound_(updates.map(programSnapshotPublicUpdate_), settings.limits.recentUpdates, 'activity.recentUpdates', truncation),
    recentProjectTransitions: programSnapshotBound_(transitions, settings.limits.recentTransitions, 'activity.recentProjectTransitions', truncation),
    recentlyCompleted: programSnapshotBound_(completedWork, settings.limits.recentlyCompleted, 'activity.recentlyCompleted', truncation)
  };

  var snapshot = {
    schemaVersion: 'program-snapshot/v1',
    asOf: settings.asOf.iso,
    today: settings.today,
    window: {
      recentDays: settings.recentDays,
      startsAt: programSnapshotIso_(settings.windowStartMillis)
    },
    summary: {
      tasks: {
        total: tasks.all.length,
        open: tasks.byStatus.Open.length,
        doing: tasks.byStatus.Doing.length,
        blocked: tasks.byStatus.Blocked.length,
        completed: tasks.byStatus.Done.length,
        currentMemberWork: tasks.currentMemberWork.length,
        overdue: tasks.overdue.length
      },
      projects: {
        total: projects.all.length,
        ideas: projects.byStage.Idea.length,
        validation: projects.byStage.Validation.length,
        schoolReview: projects.byStage['School Review'].length,
        active: projects.byStage.Active.length,
        completed: projects.byStage.Completed.length,
        paused: projects.byStage.Paused.length,
        rejected: projects.byStage.Rejected.length
      },
      attention: {
        blockedTasks: tasks.byStatus.Blocked.length,
        waitingOnSchool: projects.byStage['School Review'].length,
        ideasWaitingForValidation: projects.byStage.Idea.length,
        missingNextActions: projects.missingNextActions.length
      },
      activity: {
        recentUpdates: updates.length,
        recentProjectTransitions: transitions.length,
        recentlyCompleted: completedWork.length
      }
    },
    tasks: taskGroups,
    projects: projectGroups,
    attention: attention,
    activity: activity,
    dataQuality: quality,
    limits: settings.limits,
    truncation: truncation
  };
  return programSnapshotApplySerializedBudget_(snapshot, settings.limits.maxSerializedCharacters);
}

function programSnapshotOptions_(dashboard, options) {
  var input = programSnapshotObject_(options);
  var asOfValue = Object.prototype.hasOwnProperty.call(input, 'asOf') ? input.asOf : dashboard.generatedAt;
  var asOf = programSnapshotDate_(asOfValue);
  if (!asOf) {
    throw new Error('Program snapshot requires a valid asOf date or RFC 3339 timestamp.');
  }
  var todayValue = Object.prototype.hasOwnProperty.call(input, 'today') ? input.today : dashboard.today;
  var today = programSnapshotDateOnly_(todayValue);
  if (!today) {
    throw new Error('Program snapshot requires an injected today date in yyyy-mm-dd format.');
  }
  var recentDays = programSnapshotInteger_(input.recentDays, 30, 1, 3650, 'recentDays');
  var requestedLimits = programSnapshotObject_(input.limits);
  var limits = {
    tasksPerStatus: programSnapshotInteger_(requestedLimits.tasksPerStatus, 40, 0, 100, 'limits.tasksPerStatus'),
    currentMemberWork: programSnapshotInteger_(requestedLimits.currentMemberWork, 40, 0, 100, 'limits.currentMemberWork'),
    overdue: programSnapshotInteger_(requestedLimits.overdue, 40, 0, 100, 'limits.overdue'),
    projectsPerStage: programSnapshotInteger_(requestedLimits.projectsPerStage, 30, 0, 100, 'limits.projectsPerStage'),
    attentionPerGroup: programSnapshotInteger_(requestedLimits.attentionPerGroup, 30, 0, 100, 'limits.attentionPerGroup'),
    recentUpdates: programSnapshotInteger_(requestedLimits.recentUpdates, 20, 0, 100, 'limits.recentUpdates'),
    recentTransitions: programSnapshotInteger_(requestedLimits.recentTransitions, 20, 0, 100, 'limits.recentTransitions'),
    recentlyCompleted: programSnapshotInteger_(requestedLimits.recentlyCompleted, 20, 0, 100, 'limits.recentlyCompleted'),
    linkedMetricsPerProject: PROGRAM_SNAPSHOT_LINKED_METRICS_LIMIT,
    maxSerializedCharacters: programSnapshotInteger_(
      requestedLimits.maxSerializedCharacters,
      PROGRAM_SNAPSHOT_SERIALIZED_CHARACTERS_LIMIT,
      8000,
      PROGRAM_SNAPSHOT_SERIALIZED_CHARACTERS_LIMIT,
      'limits.maxSerializedCharacters'
    ),
    fieldCharacters: {
      id: PROGRAM_SNAPSHOT_FIELD_LIMITS.id,
      member: PROGRAM_SNAPSHOT_FIELD_LIMITS.member,
      label: PROGRAM_SNAPSHOT_FIELD_LIMITS.label,
      shortText: PROGRAM_SNAPSHOT_FIELD_LIMITS.shortText,
      longText: PROGRAM_SNAPSHOT_FIELD_LIMITS.longText
    }
  };
  return {
    asOf: asOf,
    today: today,
    recentDays: recentDays,
    windowStartMillis: asOf.millis - recentDays * 24 * 60 * 60 * 1000,
    limits: limits
  };
}

function programSnapshotInteger_(value, fallback, minimum, maximum, label) {
  if (value === null || typeof value === 'undefined' || value === '') return fallback;
  var number = Number(value);
  if (!isFinite(number) || Math.floor(number) !== number || number < minimum || number > maximum) {
    throw new Error('Program snapshot ' + label + ' must be an integer from ' + minimum + ' to ' + maximum + '.');
  }
  return number;
}

function programSnapshotEmptyQuality_() {
  return {
    tasks: {
      missingIdentifier: 0,
      missingTitle: 0,
      unknownStatus: 0,
      invalidDueDate: 0,
      invalidLastUpdate: 0,
      openWithOwner: 0,
      blockedWithoutBlocker: 0
    },
    projects: {
      missingIdentifier: 0,
      missingName: 0,
      unknownStage: 0,
      workingStageWithoutNextAction: 0
    },
    activity: {
      invalidTimestamp: 0,
      futureTimestamp: 0,
      unverifiedTransitionText: 0
    }
  };
}

function programSnapshotTasks_(rawTasks, settings, quality, truncation) {
  var tasks = Array.isArray(rawTasks) ? rawTasks : [];
  var all = tasks.map(function (rawTask) {
    var source = programSnapshotObject_(rawTask);
    var status = programSnapshotTaskStatus_(source.status);
    var id = programSnapshotPublicId_(source.taskId, truncation);
    var title = programSnapshotText_(
      source.task || source.title,
      PROGRAM_SNAPSHOT_FIELD_LIMITS.label,
      truncation
    );
    var owner = programSnapshotDisplayName_(
      source.claimedByDisplay || source.ownerDisplay || source.owner,
      truncation
    );
    var dueValue = programSnapshotPreferredMachineValue_(source, 'dueDateMachine', 'dueDate');
    var lastUpdateValue = programSnapshotPreferredMachineValue_(source, 'lastUpdateMachine', 'lastUpdate');
    if (!programSnapshotHasText_(lastUpdateValue)) lastUpdateValue = source.lastUpdatedAt;
    var due = programSnapshotDate_(dueValue);
    var lastUpdate = programSnapshotDate_(lastUpdateValue);
    var dueWasPresent = programSnapshotHasText_(source.dueDate);
    var lastUpdateWasPresent = programSnapshotHasText_(source.lastUpdate || source.lastUpdatedAt);
    var blocker = programSnapshotText_(
      source.blocker,
      PROGRAM_SNAPSHOT_FIELD_LIMITS.longText,
      truncation
    );
    var isOverdue = !!due && status !== 'Done' && programSnapshotDueIsOverdue_(due, settings);

    if (!id) quality.tasks.missingIdentifier += 1;
    if (!title) quality.tasks.missingTitle += 1;
    if (!status) quality.tasks.unknownStatus += 1;
    if (dueWasPresent && !due) quality.tasks.invalidDueDate += 1;
    if (lastUpdateWasPresent && !lastUpdate) quality.tasks.invalidLastUpdate += 1;
    if (status === 'Open' && owner) quality.tasks.openWithOwner += 1;
    if (status === 'Blocked' && !blocker) quality.tasks.blockedWithoutBlocker += 1;

    return {
      id: id,
      title: title,
      status: status || 'Unknown',
      owner: owner,
      relatedProject: programSnapshotText_(source.relatedProject, PROGRAM_SNAPSHOT_FIELD_LIMITS.label, truncation),
      relatedMetric: programSnapshotText_(source.relatedMetric, PROGRAM_SNAPSHOT_FIELD_LIMITS.shortText, truncation),
      interestTag: programSnapshotText_(source.interestTag, PROGRAM_SNAPSHOT_FIELD_LIMITS.shortText, truncation),
      estimatedTime: programSnapshotText_(source.estimatedTime, PROGRAM_SNAPSHOT_FIELD_LIMITS.shortText, truncation),
      dueDate: due ? due.output : '',
      lastUpdatedAt: lastUpdate ? lastUpdate.iso : '',
      blocker: blocker,
      isCurrentMember: source.isMine === true,
      isOverdue: isOverdue,
      _dueMillis: due ? due.dueMillis : null,
      _lastUpdateMillis: lastUpdate ? lastUpdate.millis : null
    };
  });

  all.sort(programSnapshotTaskSort_);
  var byStatus = { Open: [], Doing: [], Blocked: [], Done: [] };
  var currentMemberWork = [];
  var overdue = [];
  all.forEach(function (task) {
    var publicTask = programSnapshotPublicTask_(task);
    if (byStatus[task.status]) byStatus[task.status].push(publicTask);
    if (task.isCurrentMember && task.status !== 'Done') currentMemberWork.push(publicTask);
    if (task.isOverdue) overdue.push(publicTask);
  });
  return { all: all, byStatus: byStatus, currentMemberWork: currentMemberWork, overdue: overdue };
}

function programSnapshotProjects_(rawProjects, settings, quality, truncation) {
  var projects = Array.isArray(rawProjects) ? rawProjects : [];
  var byStage = {
    Idea: [],
    Validation: [],
    'School Review': [],
    Active: [],
    Completed: [],
    Paused: [],
    Rejected: []
  };
  var all = projects.map(function (rawProject) {
    var source = programSnapshotObject_(rawProject);
    var id = programSnapshotPublicId_(source.projectId, truncation);
    var name = programSnapshotText_(
      source.projectName || source.name,
      PROGRAM_SNAPSHOT_FIELD_LIMITS.label,
      truncation
    );
    var stage = programSnapshotProjectStage_(source.stage);
    var nextAction = programSnapshotText_(
      source.nextAction,
      PROGRAM_SNAPSHOT_FIELD_LIMITS.longText,
      truncation
    );
    var linkedMetrics = programSnapshotStringList_(
      source.linkedMetricNames || source.linkedStartMetrics,
      settings.limits.linkedMetricsPerProject,
      truncation
    );
    var project = {
      id: id,
      name: name,
      stage: stage || 'Unknown',
      lead: programSnapshotDisplayName_(source.projectLeadDisplay || source.projectLead, truncation),
      problemOpportunity: programSnapshotText_(source.problemOpportunity, PROGRAM_SNAPSHOT_FIELD_LIMITS.longText, truncation),
      linkedMetrics: linkedMetrics,
      startImpact: programSnapshotText_(source.startImpact, PROGRAM_SNAPSHOT_FIELD_LIMITS.longText, truncation),
      startDifficulty: programSnapshotText_(source.startDifficulty, PROGRAM_SNAPSHOT_FIELD_LIMITS.longText, truncation),
      startCost: programSnapshotText_(source.startCost, PROGRAM_SNAPSHOT_FIELD_LIMITS.longText, truncation),
      localFeasibility: programSnapshotText_(source.localFeasibility, PROGRAM_SNAPSHOT_FIELD_LIMITS.longText, truncation),
      recommendation: programSnapshotText_(source.recommendation, PROGRAM_SNAPSHOT_FIELD_LIMITS.longText, truncation),
      schoolFeedback: programSnapshotText_(source.schoolFeedback, PROGRAM_SNAPSHOT_FIELD_LIMITS.longText, truncation),
      nextAction: nextAction,
      validationEvidence: programSnapshotText_(source.validationEvidence, PROGRAM_SNAPSHOT_FIELD_LIMITS.longText, truncation),
      successMeasure: programSnapshotText_(source.successMeasure, PROGRAM_SNAPSHOT_FIELD_LIMITS.longText, truncation),
      knownConcerns: programSnapshotText_(source.knownConcerns, PROGRAM_SNAPSHOT_FIELD_LIMITS.longText, truncation),
      decisionNotes: programSnapshotText_(source.decisionNotes, PROGRAM_SNAPSHOT_FIELD_LIMITS.longText, truncation),
      completedWork: programSnapshotText_(source.completedWork, PROGRAM_SNAPSHOT_FIELD_LIMITS.longText, truncation),
      observedResult: programSnapshotText_(source.observedResult, PROGRAM_SNAPSHOT_FIELD_LIMITS.longText, truncation),
      _labels: programSnapshotProjectLabels_(source, id, name, truncation)
    };
    if (!id) quality.projects.missingIdentifier += 1;
    if (!name) quality.projects.missingName += 1;
    if (!stage) quality.projects.unknownStage += 1;
    if (programSnapshotNeedsNextAction_(stage) && !nextAction) {
      quality.projects.workingStageWithoutNextAction += 1;
    }
    return project;
  });

  all.sort(programSnapshotProjectSort_);
  var missingNextActions = [];
  all.forEach(function (project) {
    var publicProject = programSnapshotPublicProject_(project);
    if (byStage[project.stage]) byStage[project.stage].push(publicProject);
    if (programSnapshotNeedsNextAction_(project.stage) && !project.nextAction) {
      missingNextActions.push(publicProject);
    }
  });
  return { all: all, byStage: byStage, missingNextActions: missingNextActions };
}

function programSnapshotUpdates_(dashboard, projects, settings, quality, truncation) {
  var candidates = [];
  var direct = Array.isArray(dashboard.updates) ? dashboard.updates : [];
  direct.forEach(function (update) {
    candidates.push({ update: update, project: null });
  });
  var rawProjects = Array.isArray(dashboard.projects) ? dashboard.projects : [];
  rawProjects.forEach(function (rawProject) {
    var recent = rawProject && Array.isArray(rawProject.recentUpdates) ? rawProject.recentUpdates : [];
    var matchedProject = programSnapshotMatchProject_({
      taskProject: rawProject.projectLabel || rawProject.projectId || rawProject.projectName
    }, projects);
    recent.forEach(function (update) {
      candidates.push({ update: update, project: matchedProject });
    });
  });

  var seen = {};
  var updates = [];
  candidates.forEach(function (candidate) {
    var source = programSnapshotObject_(candidate.update);
    var timestampValue = programSnapshotPreferredMachineValue_(source, 'timestampMachine', 'timestamp');
    var timestamp = programSnapshotDate_(timestampValue);
    var rawTimestampPresent = programSnapshotHasText_(source.timestamp);
    var project = candidate.project || programSnapshotMatchProject_(source, projects);
    var update = {
      timestamp: timestamp ? timestamp.iso : '',
      member: programSnapshotDisplayName_(source.memberDisplay || source.member, truncation),
      item: programSnapshotText_(source.taskProject || source.item, PROGRAM_SNAPSHOT_FIELD_LIMITS.label, truncation),
      update: programSnapshotText_(source.update, PROGRAM_SNAPSHOT_FIELD_LIMITS.longText, truncation),
      blocker: programSnapshotText_(source.blocker, PROGRAM_SNAPSHOT_FIELD_LIMITS.longText, truncation),
      nextStep: programSnapshotText_(source.nextStep, PROGRAM_SNAPSHOT_FIELD_LIMITS.longText, truncation),
      _timestampMillis: timestamp ? timestamp.millis : null,
      _project: project
    };
    var key = [
      update.timestamp || programSnapshotText_(source.timestamp, PROGRAM_SNAPSHOT_FIELD_LIMITS.shortText, truncation), update.member, update.item,
      update.update, update.blocker, update.nextStep
    ].join('\u001f');
    if (seen[key]) return;
    seen[key] = true;

    if (!timestamp) {
      if (rawTimestampPresent) quality.activity.invalidTimestamp += 1;
      else quality.activity.invalidTimestamp += 1;
      return;
    }
    if (timestamp.millis > settings.asOf.millis) {
      quality.activity.futureTimestamp += 1;
      return;
    }
    if (timestamp.millis < settings.windowStartMillis) return;
    updates.push(update);
  });
  updates.sort(programSnapshotUpdateSort_);
  return updates;
}

function programSnapshotTransitions_(updates, settings, quality) {
  var transitions = [];
  updates.forEach(function (update) {
    var inference = programSnapshotTransitionInference_(update.update);
    if (!inference) return;
    var project = update._project;
    if (!project || project.stage !== inference.toStage) {
      quality.activity.unverifiedTransitionText += 1;
      return;
    }
    transitions.push({
      timestamp: update.timestamp,
      member: update.member,
      projectId: project.id,
      projectName: project.name,
      fromStage: inference.fromStage,
      toStage: inference.toStage,
      event: inference.event,
      evidence: 'update_text_inference'
    });
  });
  transitions.sort(programSnapshotTransitionSort_);
  return transitions;
}

function programSnapshotCompletedWork_(tasks, projects, transitions, settings) {
  var result = [];
  tasks.forEach(function (task) {
    if (task.status !== 'Done' || task._lastUpdateMillis === null) return;
    if (task._lastUpdateMillis < settings.windowStartMillis || task._lastUpdateMillis > settings.asOf.millis) return;
    result.push({
      type: 'task',
      completedAt: programSnapshotIso_(task._lastUpdateMillis),
      id: task.id,
      title: task.title,
      completedWork: ''
    });
  });

  transitions.forEach(function (transition) {
    if (transition.toStage !== 'Completed') return;
    var project = programSnapshotFindProject_(projects, transition.projectId, transition.projectName);
    if (!project || project.stage !== 'Completed') return;
    result.push({
      type: 'project',
      completedAt: transition.timestamp,
      id: project.id,
      title: project.name,
      completedWork: project.completedWork
    });
  });
  result.sort(programSnapshotCompletedSort_);
  return result;
}

function programSnapshotPublicTask_(task) {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    owner: task.owner,
    relatedProject: task.relatedProject,
    relatedMetric: task.relatedMetric,
    interestTag: task.interestTag,
    estimatedTime: task.estimatedTime,
    dueDate: task.dueDate,
    lastUpdatedAt: task.lastUpdatedAt,
    blocker: task.blocker,
    isCurrentMember: task.isCurrentMember,
    isOverdue: task.isOverdue
  };
}

function programSnapshotPublicProject_(project) {
  return {
    id: project.id,
    name: project.name,
    stage: project.stage,
    lead: project.lead,
    problemOpportunity: project.problemOpportunity,
    linkedMetrics: project.linkedMetrics.slice(),
    startImpact: project.startImpact,
    startDifficulty: project.startDifficulty,
    startCost: project.startCost,
    localFeasibility: project.localFeasibility,
    recommendation: project.recommendation,
    schoolFeedback: project.schoolFeedback,
    nextAction: project.nextAction,
    validationEvidence: project.validationEvidence,
    successMeasure: project.successMeasure,
    knownConcerns: project.knownConcerns,
    decisionNotes: project.decisionNotes,
    completedWork: project.completedWork,
    observedResult: project.observedResult
  };
}

function programSnapshotPublicUpdate_(update) {
  return {
    timestamp: update.timestamp,
    member: update.member,
    item: update.item,
    update: update.update,
    blocker: update.blocker,
    nextStep: update.nextStep
  };
}

function programSnapshotBound_(items, limit, path, truncation) {
  var included = Math.min(items.length, limit);
  var omitted = items.length - included;
  truncation.collections[path] = {
    available: items.length,
    included: included,
    omitted: omitted
  };
  if (omitted > 0) truncation.truncated = true;
  return items.slice(0, included);
}

function programSnapshotApplySerializedBudget_(snapshot, limit) {
  var removalPaths = [
    'attention.blockedTasks',
    'attention.waitingOnSchool',
    'attention.ideasWaitingForValidation',
    'attention.missingNextActions',
    'tasks.currentMemberWork',
    'tasks.overdue',
    'tasks.completed',
    'projects.completed',
    'projects.paused',
    'projects.rejected',
    'activity.recentProjectTransitions',
    'activity.recentlyCompleted',
    'tasks.open',
    'tasks.doing',
    'tasks.blocked',
    'projects.ideas',
    'projects.validation',
    'projects.schoolReview',
    'projects.active',
    'activity.recentUpdates'
  ];
  var serialized = {
    limit: limit,
    initialCharacters: 0,
    finalCharacters: 0,
    itemsOmitted: 0,
    collections: {}
  };
  snapshot.truncation.serialized = serialized;
  serialized.initialCharacters = JSON.stringify(snapshot).length;

  function removeNextItem() {
    for (var index = 0; index < removalPaths.length; index += 1) {
      var path = removalPaths[index];
      var items = programSnapshotCollectionAtPath_(snapshot, path);
      if (!items.length) continue;
      var removedItem = items.pop();
      serialized.itemsOmitted += 1;
      serialized.collections[path] = (serialized.collections[path] || 0) + 1;
      snapshot.truncation.truncated = true;
      if (snapshot.truncation.collections[path]) {
        snapshot.truncation.collections[path].included -= 1;
        snapshot.truncation.collections[path].omitted += 1;
      }
      return JSON.stringify(removedItem).length + 1;
    }
    return 0;
  }

  var currentCharacters = JSON.stringify(snapshot).length;
  while (currentCharacters > limit) {
    var estimatedCharacters = currentCharacters;
    while (estimatedCharacters > limit) {
      var removedCharacters = removeNextItem();
      if (!removedCharacters) {
        throw new Error('Program snapshot metadata exceeds the serialized character budget.');
      }
      // Allow for the omission counters and a newly-added collection key. The
      // exact size is checked after the batch, so this estimate never decides
      // whether the hard limit was actually satisfied.
      estimatedCharacters -= Math.max(1, removedCharacters - 96);
    }
    currentCharacters = JSON.stringify(snapshot).length;
  }

  for (var pass = 0; pass < 8; pass += 1) {
    var actualCharacters = JSON.stringify(snapshot).length;
    serialized.finalCharacters = actualCharacters;
    var withFinalCount = JSON.stringify(snapshot).length;
    if (withFinalCount <= limit && withFinalCount === actualCharacters) return snapshot;
    if (withFinalCount > limit && !removeNextItem()) {
      throw new Error('Program snapshot metadata exceeds the serialized character budget.');
    }
  }

  serialized.finalCharacters = JSON.stringify(snapshot).length;
  if (JSON.stringify(snapshot).length > limit) {
    throw new Error('Program snapshot could not satisfy the serialized character budget.');
  }
  return snapshot;
}

function programSnapshotCollectionAtPath_(snapshot, path) {
  return path.split('.').reduce(function (value, part) {
    return value && value[part];
  }, snapshot) || [];
}

function programSnapshotTaskStatus_(value) {
  var key = programSnapshotKey_(value);
  if (key === 'open' || key === 'unclaimed' || key === 'todo' || key === 'notstarted') return 'Open';
  if (key === 'doing' || key === 'claimed' || key === 'assigned' || key === 'inprogress' || key === 'started' || key === 'active') return 'Doing';
  if (key === 'blocked' || key === 'waiting' || key === 'waitingonschool' || key === 'onhold') return 'Blocked';
  if (key === 'done' || key === 'complete' || key === 'completed' || key === 'closed') return 'Done';
  return '';
}

function programSnapshotProjectStage_(value) {
  var key = programSnapshotKey_(value);
  if (key === 'idea' || key === 'concept' || key === 'proposed') return 'Idea';
  if (key === 'validation' || key === 'validating' || key === 'evaluation') return 'Validation';
  if (key === 'schoolreview' || key === 'proposalready' || key === 'awaitingschoolreview' || key === 'pendingapproval') return 'School Review';
  if (key === 'active' || key === 'pilot' || key === 'implementation' || key === 'inprogress') return 'Active';
  if (key === 'completed' || key === 'complete' || key === 'done' || key === 'closed') return 'Completed';
  if (key === 'paused' || key === 'pause' || key === 'onhold') return 'Paused';
  if (key === 'rejected' || key === 'declined' || key === 'notpursuing' || key === 'cancelled' || key === 'canceled') return 'Rejected';
  return '';
}

function programSnapshotTransitionInference_(value) {
  var text = String(value || '').trim();
  if (/^created project idea$/i.test(text) || /\s+—\s+submitted with new project idea$/i.test(text)) {
    return { event: 'created_idea', fromStage: '', toStage: 'Idea' };
  }
  if (/^started validation$/i.test(text)) {
    return { event: 'started_validation', fromStage: 'Idea', toStage: 'Validation' };
  }
  if (/^validation completed\s+[—-]\s+ready for school review$/i.test(text)) {
    return { event: 'ready_for_school_review', fromStage: 'Validation', toStage: 'School Review' };
  }
  if (/^paused during validation:/i.test(text)) {
    return { event: 'paused_during_validation', fromStage: 'Validation', toStage: 'Paused' };
  }
  if (/^school review approved:/i.test(text)) {
    return { event: 'school_review_approved', fromStage: 'School Review', toStage: 'Active' };
  }
  if (/^school review requested revision:/i.test(text)) {
    return { event: 'school_review_revision', fromStage: 'School Review', toStage: 'Validation' };
  }
  if (/^school review declined the project:/i.test(text)) {
    return { event: 'school_review_declined', fromStage: 'School Review', toStage: 'Rejected' };
  }
  if (/^completed project:/i.test(text)) {
    return { event: 'completed_project', fromStage: 'Active', toStage: 'Completed' };
  }
  if (/^paused project:/i.test(text)) {
    return { event: 'paused_project', fromStage: '', toStage: 'Paused' };
  }
  return null;
}

function programSnapshotMatchProject_(update, projects) {
  var association = programSnapshotKey_(update.taskProject || update.item);
  if (!association) return null;
  var matches = projects.filter(function (project) {
    return project._labels.indexOf(association) >= 0;
  });
  return matches.length === 1 ? matches[0] : null;
}

function programSnapshotFindProject_(projects, projectId, projectName) {
  var id = programSnapshotKey_(projectId);
  var name = programSnapshotKey_(projectName);
  var matches = projects.filter(function (project) {
    return (id && programSnapshotKey_(project.id) === id) ||
      (name && programSnapshotKey_(project.name) === name) ||
      (name && project._labels.indexOf(name) >= 0);
  });
  return matches.length === 1 ? matches[0] : null;
}

function programSnapshotProjectLabels_(source, id, name, truncation) {
  var labels = [
    id,
    name,
    id && name ? id + ': ' + name : '',
    programSnapshotText_(source.projectLabel, PROGRAM_SNAPSHOT_FIELD_LIMITS.label, truncation),
    programSnapshotText_(source.projectKey, PROGRAM_SNAPSHOT_FIELD_LIMITS.label, truncation)
  ]
    .map(programSnapshotKey_)
    .filter(function (value) { return !!value && !/^row\d/.test(value); });
  var unique = [];
  labels.forEach(function (value) {
    if (unique.indexOf(value) < 0) unique.push(value);
  });
  return unique;
}

function programSnapshotNeedsNextAction_(stage) {
  return stage === 'Validation' || stage === 'School Review' || stage === 'Active';
}

function programSnapshotStringList_(value, limit, truncation) {
  var source = Array.isArray(value) ? value : String(value || '').split(/[|;,\n]+/);
  var result = [];
  source.forEach(function (item) {
    var text = programSnapshotText_(item, PROGRAM_SNAPSHOT_FIELD_LIMITS.shortText, truncation);
    if (text && result.indexOf(text) < 0) result.push(text);
  });
  result.sort(programSnapshotTextSort_);
  if (result.length > limit) {
    truncation.truncated = true;
    truncation.lists.listsTruncated += 1;
    truncation.lists.itemsOmitted += result.length - limit;
  }
  return result.slice(0, limit);
}

function programSnapshotDate_(value) {
  var tag = Object.prototype.toString.call(value);
  if (tag === '[object Date]') {
    var dateMillis = value.getTime();
    if (!isFinite(dateMillis)) return null;
    return {
      kind: 'timestamp',
      millis: dateMillis,
      dueMillis: dateMillis,
      iso: programSnapshotIso_(dateMillis),
      output: programSnapshotIso_(dateMillis)
    };
  }
  if (typeof value !== 'string') return null;
  var text = value.trim();
  var dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (dateOnly) {
    var dateParts = programSnapshotCalendarParts_(dateOnly);
    if (!dateParts) return null;
    var start = Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day);
    return {
      kind: 'date',
      dateOnly: text,
      millis: start,
      dueMillis: start + 24 * 60 * 60 * 1000 - 1,
      iso: programSnapshotIso_(start),
      output: text
    };
  }
  var timestamp = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(text);
  if (!timestamp || !programSnapshotCalendarParts_(timestamp)) return null;
  if (Number(timestamp[4]) > 23 || Number(timestamp[5]) > 59 || Number(timestamp[6]) > 59) return null;
  if (timestamp[8] !== 'Z') {
    var offset = /^([+-])(\d{2}):(\d{2})$/.exec(timestamp[8]);
    if (!offset || Number(offset[2]) > 23 || Number(offset[3]) > 59) return null;
  }
  var millis = Date.parse(text);
  if (!isFinite(millis)) return null;
  return {
    kind: 'timestamp',
    millis: millis,
    dueMillis: millis,
    iso: programSnapshotIso_(millis),
    output: programSnapshotIso_(millis)
  };
}

function programSnapshotCalendarParts_(match) {
  var year = Number(match[1]);
  var month = Number(match[2]);
  var day = Number(match[3]);
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1) return null;
  var monthLengths = [31, programSnapshotLeapYear_(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day > monthLengths[month - 1]) return null;
  return { year: year, month: month, day: day };
}

function programSnapshotDateOnly_(value) {
  if (typeof value !== 'string') return '';
  var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  return match && programSnapshotCalendarParts_(match) ? value.trim() : '';
}

function programSnapshotPreferredMachineValue_(source, machineField, displayField) {
  if (programSnapshotHasText_(source[machineField])) return source[machineField];
  return source[displayField];
}

function programSnapshotDueIsOverdue_(due, settings) {
  if (due.kind === 'date') return due.dateOnly < settings.today;
  return due.dueMillis < settings.asOf.millis;
}

function programSnapshotLeapYear_(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function programSnapshotIso_(millis) {
  return new Date(millis).toISOString();
}

function programSnapshotPublicId_(value, truncation) {
  var text = programSnapshotText_(value, PROGRAM_SNAPSHOT_FIELD_LIMITS.id, truncation);
  return /^row:\d+:/i.test(text) ? '' : text;
}

function programSnapshotDisplayName_(value, truncation) {
  var text = String(value === null || typeof value === 'undefined' ? '' : value).trim();
  if (!text || programSnapshotContainsEmail_(text)) return '';
  return programSnapshotText_(text, PROGRAM_SNAPSHOT_FIELD_LIMITS.member, truncation);
}

function programSnapshotText_(value, maximumCharacters, truncation) {
  if (value === null || typeof value === 'undefined') return '';
  var text = String(value).trim();
  if (!text) return '';
  if (text.indexOf('@') >= 0) {
    text = text.replace(
      /[A-Z0-9._%+-]{1,64}@[A-Z0-9.-]{1,253}\.[A-Z]{2,63}/gi,
      '[redacted]'
    );
  }
  var maximum = typeof maximumCharacters === 'number'
    ? maximumCharacters
    : PROGRAM_SNAPSHOT_FIELD_LIMITS.longText;
  if (text.length > maximum) {
    if (truncation) {
      truncation.truncated = true;
      truncation.text.fieldsTruncated += 1;
      truncation.text.charactersOmitted += text.length - maximum;
    }
    return text.slice(0, maximum);
  }
  return text;
}

function programSnapshotContainsEmail_(value) {
  var text = String(value || '');
  return text.indexOf('@') >= 0 &&
    /[A-Z0-9._%+-]{1,64}@[A-Z0-9.-]{1,253}\.[A-Z]{2,63}/i.test(text);
}

function programSnapshotHasText_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') return true;
  return value !== null && typeof value !== 'undefined' && String(value).trim() !== '';
}

function programSnapshotObject_(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function programSnapshotKey_(value) {
  return String(value === null || typeof value === 'undefined' ? '' : value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function programSnapshotTextSort_(left, right) {
  var a = String(left || '').toLowerCase();
  var b = String(right || '').toLowerCase();
  if (a < b) return -1;
  if (a > b) return 1;
  return String(left || '') < String(right || '') ? -1 : String(left || '') > String(right || '') ? 1 : 0;
}

function programSnapshotTaskSort_(left, right) {
  if (left._dueMillis !== null && right._dueMillis !== null && left._dueMillis !== right._dueMillis) {
    return left._dueMillis - right._dueMillis;
  }
  if (left._dueMillis !== null && right._dueMillis === null) return -1;
  if (left._dueMillis === null && right._dueMillis !== null) return 1;
  if (left._lastUpdateMillis !== null && right._lastUpdateMillis !== null && left._lastUpdateMillis !== right._lastUpdateMillis) {
    return right._lastUpdateMillis - left._lastUpdateMillis;
  }
  if (left._lastUpdateMillis !== null && right._lastUpdateMillis === null) return -1;
  if (left._lastUpdateMillis === null && right._lastUpdateMillis !== null) return 1;
  return programSnapshotTextSort_(programSnapshotTaskSortKey_(left), programSnapshotTaskSortKey_(right));
}

function programSnapshotProjectSort_(left, right) {
  var primary = programSnapshotTextSort_(left.name + '\u001f' + left.id, right.name + '\u001f' + right.id);
  if (primary) return primary;
  return programSnapshotTextSort_(programSnapshotProjectSortKey_(left), programSnapshotProjectSortKey_(right));
}

function programSnapshotUpdateSort_(left, right) {
  if (left._timestampMillis !== right._timestampMillis) return right._timestampMillis - left._timestampMillis;
  return programSnapshotTextSort_(programSnapshotUpdateSortKey_(left), programSnapshotUpdateSortKey_(right));
}

function programSnapshotTransitionSort_(left, right) {
  var timeDifference = Date.parse(right.timestamp) - Date.parse(left.timestamp);
  if (timeDifference) return timeDifference;
  return programSnapshotTextSort_(
    [left.projectId, left.projectName, left.event, left.fromStage, left.toStage, left.member].join('\u001f'),
    [right.projectId, right.projectName, right.event, right.fromStage, right.toStage, right.member].join('\u001f')
  );
}

function programSnapshotCompletedSort_(left, right) {
  var timeDifference = Date.parse(right.completedAt) - Date.parse(left.completedAt);
  if (timeDifference) return timeDifference;
  return programSnapshotTextSort_(
    [left.type, left.id, left.title, left.completedWork].join('\u001f'),
    [right.type, right.id, right.title, right.completedWork].join('\u001f')
  );
}

function programSnapshotTaskSortKey_(task) {
  return [
    task.id, task.title, task.status, task.owner, task.relatedProject,
    task.relatedMetric, task.interestTag, task.estimatedTime, task.dueDate,
    task.lastUpdatedAt, task.blocker, String(task.isCurrentMember), String(task.isOverdue)
  ].join('\u001f');
}

function programSnapshotProjectSortKey_(project) {
  return [
    project.id, project.name, project.stage, project.lead,
    project.problemOpportunity, project.linkedMetrics.join('\u001e'),
    project.startImpact, project.startDifficulty, project.startCost,
    project.localFeasibility, project.recommendation, project.schoolFeedback,
    project.nextAction, project.validationEvidence, project.successMeasure,
    project.knownConcerns, project.decisionNotes, project.completedWork,
    project.observedResult
  ].join('\u001f');
}

function programSnapshotUpdateSortKey_(update) {
  return [
    update.item, update.update, update.member, update.blocker, update.nextStep
  ].join('\u001f');
}
