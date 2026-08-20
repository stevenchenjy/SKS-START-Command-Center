/**
 * Creates a display-only record of the facts already recorded for a project.
 *
 * The helper is deliberately pure: it does not read the Sheet, rank projects,
 * fill missing values, or make a decision. Text is bounded and email addresses
 * are removed so the result can be reused by later server and UI layers.
 *
 * @param {Object} project A mapped Command Center project record.
 * @return {Object} A bounded, JSON-safe factual decision record.
 */
function buildProjectDecisionRecord_(project) {
  var source = decisionReportingObject_(project);
  var limits = decisionReportingLimits_();
  var record = {
    schemaVersion: 'project-decision-record/v1',
    projectId: decisionReportingText_(
      decisionReportingFirstValue_(source, ['projectId', 'id']),
      limits.idCharacters
    ),
    projectName: decisionReportingText_(
      decisionReportingFirstValue_(source, ['projectName', 'name']),
      limits.labelCharacters
    ),
    stage: decisionReportingText_(
      decisionReportingFirstValue_(source, ['stage']),
      limits.shortCharacters
    ),
    startImpact: decisionReportingText_(
      decisionReportingFirstValue_(source, ['startImpact', 'START Impact']),
      limits.factCharacters
    ),
    startDifficulty: decisionReportingText_(
      decisionReportingFirstValue_(source, ['startDifficulty', 'START Difficulty']),
      limits.factCharacters
    ),
    startCost: decisionReportingText_(
      decisionReportingFirstValue_(source, ['startCost', 'START Cost']),
      limits.factCharacters
    ),
    localFeasibility: decisionReportingText_(
      decisionReportingFirstValue_(source, ['localFeasibility', 'Local Feasibility']),
      limits.factCharacters
    ),
    recordedRecommendation: decisionReportingText_(
      decisionReportingFirstValue_(source, ['recordedRecommendation', 'recommendation', 'Recommendation']),
      limits.factCharacters
    ),
    schoolFeedback: decisionReportingText_(
      decisionReportingFirstValue_(source, ['schoolFeedback', 'School Feedback']),
      limits.factCharacters
    ),
    validationEvidence: decisionReportingText_(
      decisionReportingFirstValue_(source, ['validationEvidence', 'Validation Evidence']),
      limits.factCharacters
    ),
    successMeasure: decisionReportingText_(
      decisionReportingFirstValue_(source, ['successMeasure', 'Success Measure']),
      limits.factCharacters
    ),
    knownConcerns: decisionReportingText_(
      decisionReportingFirstValue_(source, ['knownConcerns', 'Known Concerns']),
      limits.factCharacters
    ),
    nextAction: decisionReportingText_(
      decisionReportingFirstValue_(source, ['nextAction', 'Next Action']),
      limits.factCharacters
    ),
    linkedMetrics: decisionReportingStringList_(
      decisionReportingFirstValue_(source, [
        'linkedMetrics',
        'linkedMetricNames',
        'linkedStartMetrics',
        'Linked START Metrics'
      ]),
      limits.linkedMetrics,
      limits.labelCharacters
    ),
    missingInformation: [],
    humanDecisionRequired: true
  };

  decisionReportingDecisionFields_().forEach(function (definition) {
    var value = record[definition.field];
    var missing = definition.field === 'linkedMetrics' ? !value.length : !value;
    if (missing) {
      record.missingInformation.push({
        field: definition.field,
        label: definition.label
      });
    }
  });
  return record;
}

/**
 * Selects bounded project records for a factual side-by-side comparison.
 * Omitting projectIds selects all projects; passing an empty list selects none.
 * The output is sorted by recorded project identity, never by preference.
 *
 * @param {Array<Object>} projects Mapped project records.
 * @param {Array<string>|string=} projectIds Optional exact project IDs.
 * @return {Object} Bounded comparison-ready facts and selection diagnostics.
 */
function buildProjectDecisionComparison_(projects, projectIds) {
  var sourceProjects = Array.isArray(projects) ? projects : [];
  var limits = decisionReportingLimits_();
  var records = sourceProjects.map(function (project) {
    return buildProjectDecisionRecord_(project);
  });
  records.sort(decisionReportingProjectRecordSort_);

  var recordsById = {};
  var duplicateSourceProjectIds = 0;
  records.forEach(function (record) {
    var key = decisionReportingKey_(record.projectId);
    if (!key) return;
    if (Object.prototype.hasOwnProperty.call(recordsById, key)) {
      duplicateSourceProjectIds += 1;
      return;
    }
    recordsById[key] = record;
  });

  var hasSelection = typeof projectIds !== 'undefined' && projectIds !== null;
  var requested = decisionReportingRequestedIds_(
    hasSelection ? projectIds : [],
    limits.requestedProjectIds,
    limits.idCharacters
  );
  var candidates = [];
  var notFoundProjectIds = [];

  if (hasSelection) {
    requested.values.forEach(function (projectId) {
      var match = recordsById[decisionReportingKey_(projectId)];
      if (match) candidates.push(match);
      else notFoundProjectIds.push(projectId);
    });
  } else {
    candidates = records.slice();
  }
  candidates.sort(decisionReportingProjectRecordSort_);

  var includedProjects = candidates.slice(0, limits.comparisonProjects);
  var includedNotFound = notFoundProjectIds.slice(0, limits.notFoundProjectIds);
  return {
    schemaVersion: 'project-decision-comparison/v1',
    comparisonFields: decisionReportingDecisionFields_().map(function (definition) {
      return { field: definition.field, label: definition.label };
    }),
    requestedProjectIds: requested.values.slice(),
    notFoundProjectIds: includedNotFound,
    projects: includedProjects,
    selection: {
      sourceProjects: sourceProjects.length,
      uniqueRecordedProjectIds: Object.keys(recordsById).length,
      duplicateSourceProjectIds: duplicateSourceProjectIds,
      requestedProjectIds: hasSelection ? requested.total : 0,
      includedRequestedProjectIds: hasSelection ? requested.values.length : 0,
      omittedRequestedProjectIds: hasSelection ? requested.omitted : 0,
      matchedProjects: candidates.length,
      includedProjects: includedProjects.length,
      omittedMatchedProjects: Math.max(0, candidates.length - includedProjects.length),
      notFoundProjectIds: notFoundProjectIds.length,
      omittedNotFoundProjectIds: Math.max(0, notFoundProjectIds.length - includedNotFound.length)
    },
    humanDecisionRequired: true
  };
}

/**
 * Prepares factual, bounded report data from a Program Snapshot.
 *
 * This helper intentionally reuses only the supplied snapshot. It does not read
 * services, calculate project scores, verify reported results, or create a new
 * data store.
 *
 * @param {Object} snapshot A privacy-minimized Program Snapshot payload.
 * @return {Object} JSON-safe data for future reports.
 */
function buildStartReportingData_(snapshot) {
  var source = decisionReportingObject_(snapshot);
  var limits = decisionReportingLimits_();
  var sourceSnapshotTruncation = decisionReportingSourceSnapshotTruncation_(source);
  var truncation = {
    truncated: sourceSnapshotTruncation.truncated,
    collections: {},
    sourceSnapshot: sourceSnapshotTruncation
  };
  var schoolProjects = decisionReportingProjectsFromGroups_(source, [
    ['projects', 'schoolReview']
  ]);
  var activeProjects = decisionReportingProjectsFromGroups_(source, [
    ['projects', 'active']
  ]);
  var completedProjects = decisionReportingProjectsFromGroups_(source, [
    ['projects', 'completed']
  ]);
  var activeTasks = decisionReportingTasksFromGroups_(source, [
    ['tasks', 'doing'],
    ['tasks', 'currentMemberWork']
  ], function (task) {
    return decisionReportingKey_(task.status) === 'doing';
  });
  var blockedTasks = decisionReportingTasksFromGroups_(source, [
    ['attention', 'blockedTasks'],
    ['tasks', 'blocked']
  ], null);

  var schoolDecisionQueue = schoolProjects.map(function (project) {
    return buildProjectDecisionRecord_(project);
  });
  var completedProjectRecords = completedProjects.map(function (project) {
    return decisionReportingCompletedProject_(project);
  });
  var activeProjectRecords = activeProjects.map(function (project) {
    return decisionReportingActiveProject_(project);
  });
  var activeTaskRecords = activeTasks.map(function (task) {
    return decisionReportingActiveTask_(task);
  });
  var blockerRecords = blockedTasks.map(function (task) {
    return decisionReportingBlocker_(task);
  });
  var upcomingPriorities = decisionReportingUpcomingPriorities_(source);
  var observedResults = completedProjectRecords.filter(function (project) {
    return !!project.observedResult.value;
  }).map(function (project) {
    return {
      projectId: project.projectId,
      projectName: project.projectName,
      value: project.observedResult.value,
      reportingStatus: 'reported',
      verificationStatus: 'not_verified',
      status: 'reported/not_verified'
    };
  });

  return {
    schemaVersion: 'start-reporting-data/v1',
    sourceSnapshotSchemaVersion: decisionReportingText_(source.schemaVersion, limits.shortCharacters),
    asOf: decisionReportingText_(source.asOf, limits.shortCharacters),
    today: decisionReportingText_(source.today, limits.shortCharacters),
    semesterProgress: decisionReportingSemesterProgress_(source),
    schoolDecisionQueue: decisionReportingBound_(
      schoolDecisionQueue,
      limits.schoolDecisionQueue,
      'schoolDecisionQueue',
      truncation
    ),
    completedProjects: decisionReportingBound_(
      completedProjectRecords,
      limits.completedProjects,
      'completedProjects',
      truncation
    ),
    activeWork: {
      projects: decisionReportingBound_(
        activeProjectRecords,
        limits.activeProjects,
        'activeWork.projects',
        truncation
      ),
      tasks: decisionReportingBound_(
        activeTaskRecords,
        limits.activeTasks,
        'activeWork.tasks',
        truncation
      )
    },
    blockers: decisionReportingBound_(
      blockerRecords,
      limits.blockers,
      'blockers',
      truncation
    ),
    upcomingPriorities: decisionReportingBound_(
      upcomingPriorities,
      limits.upcomingPriorities,
      'upcomingPriorities',
      truncation
    ),
    observedResults: decisionReportingBound_(
      observedResults,
      limits.observedResults,
      'observedResults',
      truncation
    ),
    humanDecisionRequired: true,
    limits: {
      schoolDecisionQueue: limits.schoolDecisionQueue,
      completedProjects: limits.completedProjects,
      activeProjects: limits.activeProjects,
      activeTasks: limits.activeTasks,
      blockers: limits.blockers,
      upcomingPriorities: limits.upcomingPriorities,
      observedResults: limits.observedResults
    },
    truncation: truncation
  };
}

function decisionReportingLimits_() {
  return {
    idCharacters: 160,
    labelCharacters: 300,
    shortCharacters: 500,
    factCharacters: 1200,
    linkedMetrics: 12,
    comparisonProjects: 10,
    requestedProjectIds: 20,
    notFoundProjectIds: 10,
    schoolDecisionQueue: 10,
    completedProjects: 20,
    activeProjects: 20,
    activeTasks: 30,
    blockers: 20,
    upcomingPriorities: 24,
    observedResults: 20
  };
}

function decisionReportingSourceSnapshotTruncation_(snapshot) {
  var truncation = decisionReportingObject_(decisionReportingObject_(snapshot).truncation);
  var sourceCollections = decisionReportingObject_(truncation.collections);
  var paths = [
    'projects.schoolReview',
    'projects.active',
    'projects.completed',
    'tasks.doing',
    'tasks.currentMemberWork',
    'tasks.blocked',
    'tasks.overdue',
    'attention.blockedTasks'
  ];
  var collections = {};
  var collectionOmissions = 0;
  paths.forEach(function (path) {
    if (!Object.prototype.hasOwnProperty.call(sourceCollections, path)) return;
    var state = decisionReportingObject_(sourceCollections[path]);
    var available = decisionReportingCount_(state.available);
    var included = decisionReportingCount_(state.included);
    var omitted = decisionReportingCount_(state.omitted);
    collections[path] = {
      available: available,
      included: included,
      omitted: omitted
    };
    collectionOmissions += omitted;
  });
  var text = decisionReportingObject_(truncation.text);
  var lists = decisionReportingObject_(truncation.lists);
  var serialized = decisionReportingObject_(truncation.serialized);
  var textFieldsTruncated = decisionReportingCount_(text.fieldsTruncated);
  var textCharactersOmitted = decisionReportingCount_(text.charactersOmitted);
  var listItemsOmitted = decisionReportingCount_(lists.itemsOmitted);
  var serializedItemsOmitted = decisionReportingCount_(serialized.itemsOmitted);
  return {
    truncated: truncation.truncated === true || collectionOmissions > 0 ||
      textFieldsTruncated > 0 || textCharactersOmitted > 0 ||
      listItemsOmitted > 0 || serializedItemsOmitted > 0,
    collections: collections,
    textFieldsTruncated: textFieldsTruncated,
    textCharactersOmitted: textCharactersOmitted,
    listItemsOmitted: listItemsOmitted,
    serializedItemsOmitted: serializedItemsOmitted
  };
}

function decisionReportingDecisionFields_() {
  return [
    { field: 'projectId', label: 'Project ID' },
    { field: 'projectName', label: 'Project Name' },
    { field: 'stage', label: 'Stage' },
    { field: 'startImpact', label: 'START Impact' },
    { field: 'startDifficulty', label: 'START Difficulty' },
    { field: 'startCost', label: 'START Cost' },
    { field: 'localFeasibility', label: 'Local Feasibility' },
    { field: 'recordedRecommendation', label: 'Recorded Recommendation' },
    { field: 'schoolFeedback', label: 'School Feedback' },
    { field: 'validationEvidence', label: 'Validation Evidence' },
    { field: 'successMeasure', label: 'Success Measure' },
    { field: 'knownConcerns', label: 'Known Concerns' },
    { field: 'nextAction', label: 'Next Action' },
    { field: 'linkedMetrics', label: 'Linked Metrics' }
  ];
}

function decisionReportingSemesterProgress_(snapshot) {
  var summary = decisionReportingObject_(snapshot.summary);
  var taskSummary = decisionReportingObject_(summary.tasks);
  var projectSummary = decisionReportingObject_(summary.projects);
  var activitySummary = decisionReportingObject_(summary.activity);
  return {
    basis: 'current_program_snapshot',
    tasks: {
      total: decisionReportingCount_(taskSummary.total),
      open: decisionReportingCount_(taskSummary.open),
      doing: decisionReportingCount_(taskSummary.doing),
      blocked: decisionReportingCount_(taskSummary.blocked),
      completed: decisionReportingCount_(taskSummary.completed),
      currentMemberWork: decisionReportingCount_(taskSummary.currentMemberWork),
      overdue: decisionReportingCount_(taskSummary.overdue)
    },
    projects: {
      total: decisionReportingCount_(projectSummary.total),
      ideas: decisionReportingCount_(projectSummary.ideas),
      validation: decisionReportingCount_(projectSummary.validation),
      schoolReview: decisionReportingCount_(projectSummary.schoolReview),
      active: decisionReportingCount_(projectSummary.active),
      completed: decisionReportingCount_(projectSummary.completed),
      paused: decisionReportingCount_(projectSummary.paused),
      rejected: decisionReportingCount_(projectSummary.rejected)
    },
    activity: {
      recentUpdates: decisionReportingCount_(activitySummary.recentUpdates),
      recentProjectTransitions: decisionReportingCount_(activitySummary.recentProjectTransitions),
      recentlyCompleted: decisionReportingCount_(activitySummary.recentlyCompleted)
    },
    dataAvailable: {
      taskSummary: decisionReportingHasKeys_(taskSummary),
      projectSummary: decisionReportingHasKeys_(projectSummary),
      activitySummary: decisionReportingHasKeys_(activitySummary)
    }
  };
}

function decisionReportingCompletedProject_(project) {
  var record = buildProjectDecisionRecord_(project);
  var limits = decisionReportingLimits_();
  var observedResult = decisionReportingText_(
    decisionReportingFirstValue_(decisionReportingObject_(project), ['observedResult', 'Observed Result']),
    limits.factCharacters
  );
  return {
    projectId: record.projectId,
    projectName: record.projectName,
    stage: record.stage,
    completedWork: decisionReportingText_(
      decisionReportingFirstValue_(decisionReportingObject_(project), ['completedWork', 'Completed Work']),
      limits.factCharacters
    ),
    linkedMetrics: record.linkedMetrics.slice(),
    observedResult: {
      value: observedResult,
      reportingStatus: observedResult ? 'reported' : 'not_reported',
      verificationStatus: 'not_verified',
      status: observedResult ? 'reported/not_verified' : 'not_reported/not_verified'
    }
  };
}

function decisionReportingActiveProject_(project) {
  var record = buildProjectDecisionRecord_(project);
  return {
    projectId: record.projectId,
    projectName: record.projectName,
    stage: record.stage,
    nextAction: record.nextAction,
    knownConcerns: record.knownConcerns,
    linkedMetrics: record.linkedMetrics.slice()
  };
}

function decisionReportingActiveTask_(task) {
  var source = decisionReportingObject_(task);
  var limits = decisionReportingLimits_();
  return {
    taskId: decisionReportingText_(
      decisionReportingFirstValue_(source, ['id', 'taskId']),
      limits.idCharacters
    ),
    title: decisionReportingText_(
      decisionReportingFirstValue_(source, ['title', 'task']),
      limits.labelCharacters
    ),
    status: decisionReportingText_(source.status, limits.shortCharacters),
    owner: decisionReportingText_(source.owner, limits.labelCharacters),
    relatedProject: decisionReportingText_(source.relatedProject, limits.labelCharacters),
    dueDate: decisionReportingText_(source.dueDate, limits.shortCharacters),
    estimatedTime: decisionReportingText_(source.estimatedTime, limits.shortCharacters)
  };
}

function decisionReportingBlocker_(task) {
  var source = decisionReportingObject_(task);
  var limits = decisionReportingLimits_();
  var blocker = decisionReportingText_(source.blocker, limits.factCharacters);
  return {
    type: 'task',
    itemId: decisionReportingText_(
      decisionReportingFirstValue_(source, ['id', 'taskId']),
      limits.idCharacters
    ),
    itemName: decisionReportingText_(
      decisionReportingFirstValue_(source, ['title', 'task']),
      limits.labelCharacters
    ),
    status: decisionReportingText_(source.status, limits.shortCharacters),
    relatedProject: decisionReportingText_(source.relatedProject, limits.labelCharacters),
    blocker: blocker,
    dueDate: decisionReportingText_(source.dueDate, limits.shortCharacters),
    missingInformation: blocker ? [] : [{ field: 'blocker', label: 'Blocker' }]
  };
}

function decisionReportingUpcomingPriorities_(snapshot) {
  var projects = decisionReportingProjectsFromGroups_(snapshot, [
    ['projects', 'active'],
    ['projects', 'schoolReview'],
    ['projects', 'validation'],
    ['projects', 'ideas']
  ]);
  var tasks = decisionReportingTasksFromGroups_(snapshot, [
    ['tasks', 'currentMemberWork'],
    ['tasks', 'overdue']
  ], null);
  var limits = decisionReportingLimits_();
  var items = [];

  projects.forEach(function (project) {
    var record = buildProjectDecisionRecord_(project);
    if (!record.nextAction) return;
    items.push({
      type: 'project',
      itemId: record.projectId,
      itemName: record.projectName,
      stage: record.stage,
      recordedAction: record.nextAction,
      dueDate: '',
      basis: 'recorded_next_action'
    });
  });
  tasks.forEach(function (task) {
    var source = decisionReportingObject_(task);
    var dueDate = decisionReportingText_(source.dueDate, limits.shortCharacters);
    if (!dueDate) return;
    items.push({
      type: 'task',
      itemId: decisionReportingText_(
        decisionReportingFirstValue_(source, ['id', 'taskId']),
        limits.idCharacters
      ),
      itemName: decisionReportingText_(
        decisionReportingFirstValue_(source, ['title', 'task']),
        limits.labelCharacters
      ),
      stage: decisionReportingText_(source.status, limits.shortCharacters),
      recordedAction: '',
      dueDate: dueDate,
      basis: 'recorded_due_date'
    });
  });
  items.sort(decisionReportingPrioritySort_);
  return decisionReportingUniqueRecords_(items, function (item) {
    return [item.type, item.itemId, item.itemName, item.basis].join('\u001f');
  });
}

function decisionReportingProjectsFromGroups_(snapshot, paths) {
  var projects = [];
  paths.forEach(function (path) {
    decisionReportingArrayAt_(snapshot, path).forEach(function (project) {
      projects.push(decisionReportingObject_(project));
    });
  });
  projects.sort(function (left, right) {
    return decisionReportingProjectRecordSort_(
      buildProjectDecisionRecord_(left),
      buildProjectDecisionRecord_(right)
    );
  });
  return decisionReportingUniqueRecords_(projects, function (project) {
    var record = buildProjectDecisionRecord_(project);
    return [record.projectId, record.projectName, record.stage].join('\u001f');
  });
}

function decisionReportingTasksFromGroups_(snapshot, paths, predicate) {
  var tasks = [];
  paths.forEach(function (path) {
    decisionReportingArrayAt_(snapshot, path).forEach(function (task) {
      var value = decisionReportingObject_(task);
      if (!predicate || predicate(value)) tasks.push(value);
    });
  });
  tasks.sort(decisionReportingTaskSort_);
  return decisionReportingUniqueRecords_(tasks, function (task) {
    var limits = decisionReportingLimits_();
    return [
      decisionReportingText_(decisionReportingFirstValue_(task, ['id', 'taskId']), limits.idCharacters),
      decisionReportingText_(decisionReportingFirstValue_(task, ['title', 'task']), limits.labelCharacters),
      decisionReportingText_(task.status, limits.shortCharacters)
    ].join('\u001f');
  });
}

function decisionReportingArrayAt_(source, path) {
  var current = decisionReportingObject_(source);
  for (var index = 0; index < path.length; index += 1) {
    current = current[path[index]];
    if (index < path.length - 1) current = decisionReportingObject_(current);
  }
  return Array.isArray(current) ? current : [];
}

function decisionReportingBound_(items, maximum, path, truncation) {
  var included = Math.min(items.length, maximum);
  var omitted = Math.max(0, items.length - included);
  truncation.collections[path] = {
    available: items.length,
    included: included,
    omitted: omitted
  };
  if (omitted) truncation.truncated = true;
  return items.slice(0, included);
}

function decisionReportingRequestedIds_(projectIds, maximum, maximumCharacters) {
  var values = Array.isArray(projectIds) ? projectIds : [projectIds];
  var seen = {};
  var included = [];
  var total = 0;
  values.forEach(function (value) {
    var projectId = decisionReportingText_(value, maximumCharacters);
    var key = decisionReportingKey_(projectId);
    if (!key || seen[key]) return;
    seen[key] = true;
    total += 1;
    if (included.length < maximum) included.push(projectId);
  });
  included.sort(decisionReportingTextSort_);
  return {
    values: included,
    total: total,
    omitted: Math.max(0, total - included.length)
  };
}

function decisionReportingStringList_(value, maximum, maximumCharacters) {
  var values;
  if (Array.isArray(value)) {
    values = value;
  } else if (value === null || typeof value === 'undefined' || value === '') {
    values = [];
  } else {
    values = String(value).split(/[\n,;|]+/);
  }
  var seen = {};
  var result = [];
  values.forEach(function (item) {
    var raw = item;
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      raw = decisionReportingFirstValue_(item, ['metric', 'name', 'title']);
    }
    var text = decisionReportingText_(raw, maximumCharacters);
    var key = decisionReportingKey_(text);
    if (!key || seen[key]) return;
    seen[key] = true;
    result.push(text);
  });
  result.sort(decisionReportingTextSort_);
  return result.slice(0, maximum);
}

function decisionReportingFirstValue_(source, fields) {
  var object = decisionReportingObject_(source);
  for (var index = 0; index < fields.length; index += 1) {
    var field = fields[index];
    if (!Object.prototype.hasOwnProperty.call(object, field)) continue;
    var value = object[field];
    if (value === null || typeof value === 'undefined') continue;
    if (Array.isArray(value)) {
      if (value.length) return value;
      continue;
    }
    if (typeof value === 'object') continue;
    if (String(value).trim() !== '') return value;
  }
  return '';
}

function decisionReportingText_(value, maximumCharacters) {
  if (value === null || typeof value === 'undefined') return '';
  if (typeof value === 'object') return '';
  var text = String(value)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email removed]')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.slice(0, Math.max(0, maximumCharacters));
}

function decisionReportingCount_(value) {
  var number = Number(value);
  if (!isFinite(number) || number < 0) return 0;
  return Math.min(1000000, Math.floor(number));
}

function decisionReportingObject_(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function decisionReportingHasKeys_(value) {
  return Object.keys(decisionReportingObject_(value)).length > 0;
}

function decisionReportingKey_(value) {
  return String(value || '').trim().toLowerCase();
}

function decisionReportingUniqueRecords_(items, keyFunction) {
  var seen = {};
  var result = [];
  items.forEach(function (item) {
    var key = decisionReportingKey_(keyFunction(item));
    if (seen[key]) return;
    seen[key] = true;
    result.push(item);
  });
  return result;
}

function decisionReportingProjectRecordSort_(left, right) {
  var leftKey = [left.projectId, left.projectName, left.stage].join('\u001f');
  var rightKey = [right.projectId, right.projectName, right.stage].join('\u001f');
  return decisionReportingTextSort_(leftKey, rightKey);
}

function decisionReportingTaskSort_(left, right) {
  var limits = decisionReportingLimits_();
  var leftKey = [
    decisionReportingFirstValue_(left, ['id', 'taskId']),
    decisionReportingFirstValue_(left, ['title', 'task']),
    left.status
  ].map(function (value) {
    return decisionReportingText_(value, limits.labelCharacters);
  }).join('\u001f');
  var rightKey = [
    decisionReportingFirstValue_(right, ['id', 'taskId']),
    decisionReportingFirstValue_(right, ['title', 'task']),
    right.status
  ].map(function (value) {
    return decisionReportingText_(value, limits.labelCharacters);
  }).join('\u001f');
  return decisionReportingTextSort_(leftKey, rightKey);
}

function decisionReportingPrioritySort_(left, right) {
  var leftKey = [left.type, left.itemId, left.itemName, left.basis].join('\u001f');
  var rightKey = [right.type, right.itemId, right.itemName, right.basis].join('\u001f');
  return decisionReportingTextSort_(leftKey, rightKey);
}

function decisionReportingTextSort_(left, right) {
  var normalizedLeft = decisionReportingKey_(left);
  var normalizedRight = decisionReportingKey_(right);
  if (normalizedLeft < normalizedRight) return -1;
  if (normalizedLeft > normalizedRight) return 1;
  var exactLeft = String(left || '');
  var exactRight = String(right || '');
  if (exactLeft < exactRight) return -1;
  if (exactLeft > exactRight) return 1;
  return 0;
}
