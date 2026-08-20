/**
 * Pure, deterministic context selection for the dormant START assistant.
 *
 * This module receives an already-mapped dashboard payload. It never opens the
 * workbook, reads configuration, calls a model, or mutates application data.
 */

function validateAssistantRequest_(request) {
  if (!assistantContextIsObject_(request)) {
    throw new Error('Assistant request must be an object.');
  }

  var allowedKeys = { question: true, scope: true, projectId: true };
  Object.keys(request).forEach(function (key) {
    if (!allowedKeys[key]) throw new Error('Assistant request contains an unsupported field.');
  });

  if (typeof request.question !== 'string') {
    throw new Error('Assistant question must be text.');
  }
  var question = request.question.trim();
  if (!question || question.length > 800) {
    throw new Error('Assistant question must be between 1 and 800 characters.');
  }
  // The service serializes the validated request as well as the selected
  // context, so minimize contact information at the validation boundary.
  question = assistantContextText_(question, 800, null);

  var scope = typeof request.scope === 'undefined' || request.scope === null || request.scope === ''
    ? 'auto'
    : request.scope;
  if (typeof scope !== 'string') throw new Error('Assistant scope must be text.');
  scope = scope.trim().toLowerCase();
  var allowedScopes = {
    auto: true,
    project: true,
    work: true,
    waiting: true,
    program: true,
    proposal: true
  };
  if (!allowedScopes[scope]) {
    throw new Error('Assistant scope must be auto, project, work, waiting, program, or proposal.');
  }

  var projectId = '';
  if (typeof request.projectId !== 'undefined' && request.projectId !== null) {
    if (typeof request.projectId !== 'string') throw new Error('Assistant project ID must be text.');
    projectId = request.projectId.trim();
    if (projectId.length > 160) throw new Error('Assistant project ID must be at most 160 characters.');
    if (/[\r\n]/.test(request.projectId)) {
      throw new Error('Assistant project ID must be a single-line exact Project ID.');
    }
    if (/^row:/i.test(projectId)) {
      throw new Error('Assistant project ID cannot use an internal fallback row key.');
    }
  }
  if ((scope === 'project' || scope === 'proposal') && !projectId) {
    throw new Error('Assistant project and proposal scopes require an exact Project ID.');
  }
  if (projectId && scope !== 'auto' && scope !== 'project' && scope !== 'proposal') {
    throw new Error('Assistant project ID is only valid for auto, project, or proposal scope.');
  }

  return { question: question, scope: scope, projectId: projectId };
}

/**
 * Resolves `auto` without model classification or fuzzy matching.
 *
 * @return {{scope: string, projectId: string}}
 */
function resolveAssistantScope_(request, dashboard) {
  var validated = validateAssistantRequest_(request);
  if (validated.scope !== 'auto') {
    return { scope: validated.scope, projectId: validated.projectId };
  }

  var proposalQuestion = assistantContextMatches_(
    validated.question,
    /\b(proposal|draft|pitch|write[ -]?up|school[ -]?review packet)\b/i
  );
  if (validated.projectId) {
    return { scope: proposalQuestion ? 'proposal' : 'project', projectId: validated.projectId };
  }

  var mentionedProject = assistantContextMentionedProject_(validated.question, dashboard);
  if (mentionedProject) {
    return {
      scope: proposalQuestion ? 'proposal' : 'project',
      projectId: String(mentionedProject.projectId).trim()
    };
  }
  if (assistantContextMatches_(
    validated.question,
    /\b(wait(?:ing)?|approval|school feedback|school review|blocked|blocker|held up)\b/i
  )) {
    return { scope: 'waiting', projectId: '' };
  }
  if (assistantContextMatches_(
    validated.question,
    /\b(what (?:can|should) i work|open tasks?|available tasks?|my work|my tasks?|to[ -]?do|next task|help out)\b/i
  )) {
    return { scope: 'work', projectId: '' };
  }
  if (assistantContextMatches_(
    validated.question,
    /\b(program|summary|overview|overall|progress|command center|committee status)\b/i
  )) {
    return { scope: 'program', projectId: '' };
  }
  return { scope: 'program', projectId: '' };
}

/**
 * Builds the exact bounded model context. `options.knowledge` may contain the
 * already-selected public knowledge items from KnowledgeProviders.gs.
 */
function buildAssistantContext_(dashboard, request, options) {
  var source = assistantContextIsObject_(dashboard) ? dashboard : {};
  var input = validateAssistantRequest_(request);
  var resolved = resolveAssistantScope_(input, source);
  var settings = assistantContextIsObject_(options) ? options : {};
  var truncation = {
    truncated: false,
    textFieldsTruncated: 0,
    charactersOmitted: 0,
    omitted: { knowledge: 0, updates: 0, metrics: 0, projects: 0, tasks: 0 },
    limit: 24000,
    initialCharacters: 0,
    finalCharacters: 0
  };
  var context = {
    schemaVersion: 'assistant-context/v1',
    scope: resolved.scope,
    question: assistantContextText_(input.question, 800, truncation),
    projectId: assistantContextId_(resolved.projectId, truncation),
    commandCenter: {},
    knowledge: assistantContextKnowledge_(settings.knowledge, truncation),
    sourceCatalog: [],
    truncation: truncation
  };

  if (resolved.scope === 'project' || resolved.scope === 'proposal') {
    assistantContextBuildProjectScope_(context, source, resolved, truncation);
  } else if (resolved.scope === 'work') {
    assistantContextBuildWorkScope_(context, source, truncation);
  } else if (resolved.scope === 'waiting') {
    assistantContextBuildWaitingScope_(context, source, truncation);
  } else {
    assistantContextBuildProgramScope_(context, source, settings, truncation);
  }

  context.sourceCatalog = buildAssistantSourceCatalog_(context);
  assistantContextApplyBudget_(context);
  return context;
}

function buildAssistantSourceCatalog_(context) {
  var found = {};

  function visit(value, key) {
    if (!value || typeof value !== 'object') return;
    if (key === 'sourceCatalog' || key === 'truncation') return;
    if (Array.isArray(value)) {
      value.forEach(function (item) { visit(item, ''); });
      return;
    }
    if (typeof value.sourceId === 'string' && /^(?:task|project|metric|update|knowledge):/.test(value.sourceId)) {
      var type = value.sourceId.split(':')[0];
      var navigable = type === 'task' || type === 'project' || type === 'metric';
      var itemId = '';
      if (type === 'task' || type === 'project') itemId = assistantContextId_(value.id, null);
      if (type === 'metric') itemId = assistantContextText_(value.metric, 300, null);
      var label = assistantContextText_(
        value.title || value.name || value.metric || value.item || value.update || value.label,
        300,
        null
      ) || itemId || value.sourceId;
      if (!found[value.sourceId]) {
        found[value.sourceId] = {
          sourceId: value.sourceId,
          type: type,
          itemId: navigable ? itemId : '',
          label: label,
          navigable: navigable
        };
      }
    }
    Object.keys(value).forEach(function (childKey) {
      if (childKey !== 'sourceCatalog' && childKey !== 'truncation') visit(value[childKey], childKey);
    });
  }

  visit(context, '');
  return Object.keys(found).sort().map(function (sourceId) { return found[sourceId]; });
}

function assistantContextBuildProjectScope_(context, dashboard, resolved, truncation) {
  var project = assistantContextFindProjectById_(dashboard.projects, resolved.projectId);
  if (!project) throw new Error('That project ID was not found in the Command Center.');
  context.projectId = assistantContextId_(project.projectId, truncation);

  if (resolved.scope === 'proposal') {
    context.commandCenter = {
      selectedProject: assistantContextProposalProject_(project, truncation),
      recentUpdates: assistantContextProjectUpdates_(dashboard, project, truncation).slice(0, 8)
    };
    return;
  }

  context.commandCenter = {
    selectedProject: assistantContextFullProject_(project, truncation),
    relatedTasks: assistantContextProjectTasks_(dashboard, project, truncation).slice(0, 12),
    recentUpdates: assistantContextProjectUpdates_(dashboard, project, truncation).slice(0, 8),
    linkedMetrics: assistantContextProjectMetrics_(dashboard, project, truncation).slice(0, 8)
  };
}

function assistantContextBuildWorkScope_(context, dashboard, truncation) {
  var tasks = Array.isArray(dashboard.tasks) ? dashboard.tasks : [];
  var projects = Array.isArray(dashboard.projects) ? dashboard.projects : [];
  var openTasks = tasks.filter(function (task) {
    var source = assistantContextObject_(task);
    return assistantContextTaskStatus_(source.status) === 'Open' &&
      !assistantContextHasText_(source.claimedBy) &&
      !assistantContextHasText_(source.claimedByDisplay || source.ownerDisplay || source.owner);
  }).map(function (task) {
    return assistantContextTask_(task, truncation);
  }).filter(assistantContextHasStableSource_);
  openTasks.sort(assistantContextTaskSort_);

  var current = tasks.filter(function (task) {
    var source = assistantContextObject_(task);
    var status = assistantContextTaskStatus_(source.status);
    return source.isMine === true && (status === 'Doing' || status === 'Blocked');
  }).map(function (task) {
    return assistantContextTask_(task, truncation);
  }).filter(assistantContextHasStableSource_);
  current.sort(assistantContextCurrentTaskSort_);

  var activeProjects = projects.filter(function (project) {
    return assistantContextProjectStage_(assistantContextObject_(project).stage) === 'Active';
  }).map(function (project) {
    return assistantContextProjectSummary_(project, truncation);
  }).filter(assistantContextHasStableSource_);
  activeProjects.sort(assistantContextProjectSort_);

  context.commandCenter = {
    openTasks: assistantContextDedupe_(openTasks, 'sourceId').slice(0, 15),
    currentMemberWork: assistantContextDedupe_(current, 'sourceId').slice(0, 10),
    activeProjects: assistantContextDedupe_(activeProjects, 'sourceId').slice(0, 10)
  };
}

function assistantContextBuildWaitingScope_(context, dashboard, truncation) {
  var tasks = Array.isArray(dashboard.tasks) ? dashboard.tasks : [];
  var projects = Array.isArray(dashboard.projects) ? dashboard.projects : [];
  var schoolReview = projects.filter(function (project) {
    return assistantContextProjectStage_(assistantContextObject_(project).stage) === 'School Review';
  }).map(function (project) {
    return assistantContextWaitingProject_(project, truncation);
  }).filter(assistantContextHasStableSource_);
  schoolReview.sort(assistantContextProjectSort_);

  var blocked = tasks.filter(function (task) {
    return assistantContextTaskStatus_(assistantContextObject_(task).status) === 'Blocked';
  }).map(function (task) {
    return assistantContextTask_(task, truncation);
  }).filter(assistantContextHasStableSource_);
  blocked.sort(assistantContextTaskSort_);

  var linkedMetricNames = {};
  schoolReview.forEach(function (project) {
    (project.linkedMetrics || []).forEach(function (name) {
      linkedMetricNames[assistantContextNormalize_(name)] = true;
    });
  });
  blocked.forEach(function (task) {
    if (task.relatedMetric) linkedMetricNames[assistantContextNormalize_(task.relatedMetric)] = true;
  });
  var metrics = (Array.isArray(dashboard.metrics) ? dashboard.metrics : []).filter(function (metric) {
    var source = assistantContextObject_(metric);
    return assistantContextHasText_(source.waitingOn) || linkedMetricNames[assistantContextNormalize_(source.metric)];
  }).map(function (metric) {
    return assistantContextMetric_(metric, truncation);
  }).filter(assistantContextHasStableSource_);
  metrics.sort(assistantContextMetricSort_);

  context.commandCenter = {
    schoolReviewProjects: assistantContextDedupe_(schoolReview, 'sourceId').slice(0, 10),
    blockedTasks: assistantContextDedupe_(blocked, 'sourceId').slice(0, 12),
    metrics: assistantContextDedupe_(metrics, 'sourceId').slice(0, 8)
  };
}

function assistantContextBuildProgramScope_(context, dashboard, options, truncation) {
  var snapshot = options.programSnapshot;
  if (!snapshot) {
    if (typeof buildProgramSnapshot_ !== 'function') {
      throw new Error('Program snapshot builder is unavailable.');
    }
    snapshot = buildProgramSnapshot_(dashboard, {
      asOf: dashboard.generatedAt,
      today: dashboard.today,
      limits: {
        tasksPerStatus: 12,
        currentMemberWork: 10,
        overdue: 10,
        projectsPerStage: 10,
        attentionPerGroup: 10,
        recentUpdates: 12,
        recentTransitions: 8,
        recentlyCompleted: 8,
        maxSerializedCharacters: 24000
      }
    });
  }

  var activeProjects = (Array.isArray(dashboard.projects) ? dashboard.projects : []).filter(function (project) {
    return assistantContextProjectStage_(assistantContextObject_(project).stage) === 'Active';
  }).map(function (project) {
    return assistantContextProjectSummary_(project, truncation);
  }).filter(assistantContextHasStableSource_);
  activeProjects.sort(assistantContextProjectSort_);

  var updates = assistantContextUpdates_(dashboard.updates, truncation);
  context.commandCenter = {
    programSnapshot: assistantContextProgramSnapshot_(snapshot, truncation),
    activeProjects: assistantContextDedupe_(activeProjects, 'sourceId').slice(0, 10),
    recentUpdates: updates.slice(0, 12)
  };
}

function assistantContextProgramSnapshot_(snapshot, truncation) {
  var source = assistantContextObject_(snapshot);
  var summary = assistantContextObject_(source.summary);
  var attention = assistantContextObject_(source.attention);
  return {
    schemaVersion: assistantContextText_(source.schemaVersion, 80, truncation),
    asOf: assistantContextText_(source.asOf, 80, truncation),
    today: assistantContextText_(source.today, 20, truncation),
    summary: {
      tasks: assistantContextNumericRecord_(summary.tasks),
      projects: assistantContextNumericRecord_(summary.projects),
      attention: assistantContextNumericRecord_(summary.attention),
      activity: assistantContextNumericRecord_(summary.activity)
    },
    attention: {
      blockedTasks: assistantContextSnapshotTasks_(attention.blockedTasks, truncation).slice(0, 10),
      waitingOnSchool: assistantContextSnapshotProjects_(attention.waitingOnSchool, truncation).slice(0, 10),
      ideasWaitingForValidation: assistantContextSnapshotProjects_(attention.ideasWaitingForValidation, truncation).slice(0, 10),
      missingNextActions: assistantContextSnapshotProjects_(attention.missingNextActions, truncation).slice(0, 10)
    }
  };
}

function assistantContextNumericRecord_(record) {
  var source = assistantContextObject_(record);
  var result = {};
  Object.keys(source).sort().forEach(function (key) {
    if (typeof source[key] === 'number' && isFinite(source[key])) result[key] = source[key];
  });
  return result;
}

function assistantContextSnapshotTasks_(items, truncation) {
  return (Array.isArray(items) ? items : []).map(function (item) {
    return assistantContextTask_({
      taskId: item.id,
      task: item.title,
      status: item.status,
      claimedByDisplay: item.owner,
      relatedProject: item.relatedProject,
      relatedMetric: item.relatedMetric,
      interestTag: item.interestTag,
      estimatedTime: item.estimatedTime,
      dueDateMachine: item.dueDate,
      lastUpdateMachine: item.lastUpdatedAt,
      blocker: item.blocker,
      isMine: item.isCurrentMember
    }, truncation);
  }).filter(assistantContextHasStableSource_);
}

function assistantContextSnapshotProjects_(items, truncation) {
  return (Array.isArray(items) ? items : []).map(function (item) {
    return assistantContextWaitingProject_({
      projectId: item.id,
      projectName: item.name,
      stage: item.stage,
      projectLead: item.lead,
      linkedMetricNames: item.linkedMetrics,
      schoolFeedback: item.schoolFeedback,
      schoolContact: item.schoolContact,
      nextAction: item.nextAction,
      localFeasibility: item.localFeasibility,
      knownConcerns: item.knownConcerns
    }, truncation);
  }).filter(assistantContextHasStableSource_);
}

function assistantContextFindProjectById_(projects, projectId) {
  var matches = (Array.isArray(projects) ? projects : []).filter(function (project) {
    return String(assistantContextObject_(project).projectId || '').trim() === projectId;
  });
  if (matches.length > 1) throw new Error('More than one project uses that Project ID.');
  return matches.length === 1 ? matches[0] : null;
}

function assistantContextMentionedProject_(question, dashboard) {
  var projects = (Array.isArray(assistantContextObject_(dashboard).projects)
    ? dashboard.projects
    : []).filter(function (project) {
      return assistantContextHasText_(assistantContextObject_(project).projectId);
    });
  var nameCounts = {};
  projects.forEach(function (project) {
    var name = assistantContextNormalize_(assistantContextObject_(project).projectName);
    if (name) nameCounts[name] = (nameCounts[name] || 0) + 1;
  });

  var matches = [];
  projects.forEach(function (project) {
    var source = assistantContextObject_(project);
    var id = String(source.projectId).trim();
    var name = assistantContextNormalize_(source.projectName);
    if (assistantContextContainsExact_(question, id) ||
        (name && nameCounts[name] === 1 && assistantContextContainsExact_(question, source.projectName))) {
      matches.push(project);
    }
  });
  matches = assistantContextDedupe_(matches, 'projectId');
  return matches.length === 1 ? matches[0] : null;
}

function assistantContextContainsExact_(text, target) {
  var haystack = String(text || '').toLowerCase();
  var needle = String(target || '').trim().toLowerCase();
  if (!needle) return false;
  var index = haystack.indexOf(needle);
  while (index !== -1) {
    var before = index === 0 ? '' : haystack.charAt(index - 1);
    var afterIndex = index + needle.length;
    var after = afterIndex >= haystack.length ? '' : haystack.charAt(afterIndex);
    if ((!before || !/[a-z0-9]/i.test(before)) && (!after || !/[a-z0-9]/i.test(after))) return true;
    index = haystack.indexOf(needle, index + 1);
  }
  return false;
}

function assistantContextProjectTasks_(dashboard, project, truncation) {
  var candidates = (Array.isArray(dashboard.tasks) ? dashboard.tasks : []).concat(
    Array.isArray(project.relatedTasks) ? project.relatedTasks : []
  );
  var projects = Array.isArray(dashboard.projects) ? dashboard.projects : [];
  var result = candidates.filter(function (task) {
    return assistantContextRecordMatchesProject_(
      assistantContextObject_(task).relatedProject,
      project,
      projects
    );
  }).map(function (task) {
    return assistantContextTask_(task, truncation);
  }).filter(assistantContextHasStableSource_);
  result = assistantContextDedupe_(result, 'sourceId');
  result.sort(assistantContextTaskSort_);
  return result;
}

function assistantContextProjectUpdates_(dashboard, project, truncation) {
  var candidates = (Array.isArray(dashboard.updates) ? dashboard.updates : []).concat(
    Array.isArray(project.recentUpdates) ? project.recentUpdates : []
  );
  var projects = Array.isArray(dashboard.projects) ? dashboard.projects : [];
  var result = candidates.filter(function (update) {
    var source = assistantContextObject_(update);
    if (String(source.projectId || '').trim() === String(project.projectId || '').trim()) return true;
    return assistantContextRecordMatchesProject_(source.taskProject || source.item, project, projects);
  }).map(function (update) {
    return assistantContextUpdate_(update, truncation);
  });
  result = assistantContextDedupe_(result, 'dedupeKey');
  result.sort(assistantContextUpdateSort_);
  return result.map(function (item, index) {
    item.sourceId = 'update:' + (index + 1);
    delete item.dedupeKey;
    return item;
  });
}

function assistantContextProjectMetrics_(dashboard, project, truncation) {
  var wanted = {};
  assistantContextStringList_(project.linkedMetricNames || project.linkedStartMetrics, 8, 300, truncation)
    .forEach(function (name) { wanted[assistantContextNormalize_(name)] = true; });
  var result = (Array.isArray(dashboard.metrics) ? dashboard.metrics : []).filter(function (metric) {
    return wanted[assistantContextNormalize_(assistantContextObject_(metric).metric)];
  }).map(function (metric) {
    return assistantContextMetric_(metric, truncation);
  }).filter(assistantContextHasStableSource_);
  result = assistantContextDedupe_(result, 'sourceId');
  result.sort(assistantContextMetricSort_);
  return result;
}

function assistantContextRecordMatchesProject_(association, project, projects) {
  var value = String(association || '').trim();
  if (!value) return false;
  var id = String(project.projectId || '').trim();
  var label = String(project.projectLabel || '').trim();
  var name = String(project.projectName || '').trim();
  if (id && value === id) return true;
  if (label && value === label) return true;
  if (id && name && value === id + ': ' + name) return true;
  if (name && value === name) {
    var normalizedName = assistantContextNormalize_(name);
    var count = (Array.isArray(projects) ? projects : []).filter(function (candidate) {
      return assistantContextNormalize_(assistantContextObject_(candidate).projectName) === normalizedName;
    }).length;
    return count === 1;
  }
  return false;
}

function assistantContextFullProject_(project, truncation) {
  var source = assistantContextObject_(project);
  var id = assistantContextId_(source.projectId, truncation);
  return {
    sourceId: id ? 'project:' + id : '',
    id: id,
    name: assistantContextText_(source.projectName, 300, truncation),
    stage: assistantContextProjectStage_(source.stage) || assistantContextText_(source.stage, 80, truncation),
    problemOpportunity: assistantContextText_(source.problemOpportunity, 1200, truncation),
    linkedMetrics: assistantContextStringList_(source.linkedMetricNames || source.linkedStartMetrics, 8, 300, truncation),
    startImpact: assistantContextText_(source.startImpact, 1200, truncation),
    startDifficulty: assistantContextText_(source.startDifficulty, 1200, truncation),
    startCost: assistantContextText_(source.startCost, 1200, truncation),
    localFeasibility: assistantContextText_(source.localFeasibility, 1200, truncation),
    recommendation: assistantContextText_(source.recommendation, 1200, truncation),
    schoolFeedback: assistantContextText_(source.schoolFeedback, 1200, truncation),
    schoolContact: assistantContextText_(source.schoolContact, 1200, truncation),
    nextAction: assistantContextText_(source.nextAction, 1200, truncation),
    lead: assistantContextDisplayName_(source.projectLeadDisplay || source.projectLead, truncation),
    validationEvidence: assistantContextText_(source.validationEvidence, 1200, truncation),
    successMeasure: assistantContextText_(source.successMeasure, 1200, truncation),
    knownConcerns: assistantContextText_(source.knownConcerns, 1200, truncation),
    decisionNotes: assistantContextText_(source.decisionNotes, 1200, truncation),
    completedWork: assistantContextText_(source.completedWork, 1200, truncation),
    observedResult: assistantContextText_(source.observedResult, 1200, truncation)
  };
}

function assistantContextProposalProject_(project, truncation) {
  var full = assistantContextFullProject_(project, truncation);
  return {
    sourceId: full.sourceId,
    id: full.id,
    name: full.name,
    stage: full.stage,
    problemOpportunity: full.problemOpportunity,
    validationEvidence: full.validationEvidence,
    successMeasure: full.successMeasure,
    knownConcerns: full.knownConcerns,
    schoolContact: full.schoolContact,
    schoolFeedback: full.schoolFeedback,
    linkedMetrics: full.linkedMetrics,
    nextAction: full.nextAction
  };
}

function assistantContextProjectSummary_(project, truncation) {
  var source = assistantContextObject_(project);
  var id = assistantContextId_(source.projectId, truncation);
  return {
    sourceId: id ? 'project:' + id : '',
    id: id,
    name: assistantContextText_(source.projectName, 300, truncation),
    stage: assistantContextProjectStage_(source.stage) || assistantContextText_(source.stage, 80, truncation),
    lead: assistantContextDisplayName_(source.projectLeadDisplay || source.projectLead, truncation),
    nextAction: assistantContextText_(source.nextAction, 1200, truncation),
    linkedMetrics: assistantContextStringList_(source.linkedMetricNames || source.linkedStartMetrics, 8, 300, truncation)
  };
}

function assistantContextWaitingProject_(project, truncation) {
  var summary = assistantContextProjectSummary_(project, truncation);
  var source = assistantContextObject_(project);
  summary.schoolFeedback = assistantContextText_(source.schoolFeedback, 1200, truncation);
  summary.schoolContact = assistantContextText_(source.schoolContact, 1200, truncation);
  summary.localFeasibility = assistantContextText_(source.localFeasibility, 1200, truncation);
  summary.knownConcerns = assistantContextText_(source.knownConcerns, 1200, truncation);
  return summary;
}

function assistantContextTask_(task, truncation) {
  var source = assistantContextObject_(task);
  var id = assistantContextId_(source.taskId, truncation);
  return {
    sourceId: id ? 'task:' + id : '',
    id: id,
    title: assistantContextText_(source.task || source.title, 300, truncation),
    status: assistantContextTaskStatus_(source.status) || assistantContextText_(source.status, 80, truncation),
    owner: assistantContextDisplayName_(source.claimedByDisplay || source.ownerDisplay || source.owner, truncation),
    relatedProject: assistantContextText_(source.relatedProject, 300, truncation),
    relatedMetric: assistantContextText_(source.relatedMetric, 300, truncation),
    interestTag: assistantContextText_(source.interestTag, 300, truncation),
    estimatedTime: assistantContextText_(source.estimatedTime, 300, truncation),
    dueDate: assistantContextText_(source.dueDateMachine || source.dueDate, 80, truncation),
    lastUpdatedAt: assistantContextText_(source.lastUpdateMachine || source.lastUpdatedAt || source.lastUpdate, 80, truncation),
    blocker: assistantContextText_(source.blocker, 1200, truncation),
    isCurrentMember: source.isMine === true || source.isCurrentMember === true
  };
}

function assistantContextMetric_(metric, truncation) {
  var source = assistantContextObject_(metric);
  var name = assistantContextText_(source.metric, 300, truncation);
  return {
    sourceId: name ? 'metric:' + assistantContextSlug_(name) : '',
    metric: name,
    category: assistantContextText_(source.category, 300, truncation),
    currentTier: assistantContextText_(source.currentTier, 300, truncation),
    status: assistantContextText_(source.status, 300, truncation),
    staffContact: assistantContextText_(source.staffContact, 300, truncation),
    waitingOn: assistantContextText_(source.waitingOn, 1200, truncation),
    lastAction: assistantContextText_(source.lastAction, 1200, truncation),
    lastUpdated: assistantContextText_(source.lastUpdated, 80, truncation)
  };
}

function assistantContextUpdates_(updates, truncation) {
  var result = (Array.isArray(updates) ? updates : []).map(function (update) {
    return assistantContextUpdate_(update, truncation);
  });
  result = assistantContextDedupe_(result, 'dedupeKey');
  result.sort(assistantContextUpdateSort_);
  return result.map(function (item, index) {
    item.sourceId = 'update:' + (index + 1);
    delete item.dedupeKey;
    return item;
  });
}

function assistantContextUpdate_(update, truncation) {
  var source = assistantContextObject_(update);
  var result = {
    timestamp: assistantContextText_(source.timestampMachine || source.timestamp, 80, truncation),
    member: assistantContextDisplayName_(source.memberDisplay || source.member, truncation),
    item: assistantContextText_(source.taskProject || source.item, 300, truncation),
    update: assistantContextText_(source.update, 1200, truncation),
    blocker: assistantContextText_(source.blocker, 1200, truncation),
    nextStep: assistantContextText_(source.nextStep, 1200, truncation)
  };
  result.dedupeKey = [
    result.timestamp, result.member, result.item, result.update, result.blocker, result.nextStep
  ].join('\u001f');
  return result;
}

function assistantContextKnowledge_(items, truncation) {
  return (Array.isArray(items) ? items : []).slice(0, 5).map(function (item, index) {
    var source = assistantContextObject_(item);
    return {
      sourceId: 'knowledge:' + (index + 1),
      type: 'knowledge',
      title: assistantContextExternalText_(source.title, 300, truncation),
      mimeType: assistantContextText_(source.mimeType, 120, truncation),
      excerpt: assistantContextExternalText_(source.excerpt, 3000, truncation)
    };
  }).filter(function (item) { return !!item.title && !!item.excerpt; });
}

function assistantContextApplyBudget_(context) {
  var truncation = context.truncation;
  context.sourceCatalog = buildAssistantSourceCatalog_(context);
  truncation.initialCharacters = JSON.stringify(context).length;

  var groups = [
    { name: 'knowledge', paths: [['knowledge']] },
    { name: 'updates', paths: [
      ['commandCenter', 'recentUpdates']
    ] },
    { name: 'metrics', paths: [
      ['commandCenter', 'linkedMetrics'],
      ['commandCenter', 'metrics']
    ] },
    { name: 'projects', paths: [
      ['commandCenter', 'activeProjects'],
      ['commandCenter', 'schoolReviewProjects'],
      ['commandCenter', 'programSnapshot', 'attention', 'waitingOnSchool'],
      ['commandCenter', 'programSnapshot', 'attention', 'ideasWaitingForValidation'],
      ['commandCenter', 'programSnapshot', 'attention', 'missingNextActions']
    ] },
    { name: 'tasks', paths: [
      ['commandCenter', 'relatedTasks'],
      ['commandCenter', 'openTasks'],
      ['commandCenter', 'currentMemberWork'],
      ['commandCenter', 'blockedTasks'],
      ['commandCenter', 'programSnapshot', 'attention', 'blockedTasks']
    ] }
  ];

  groups.forEach(function (group) {
    group.paths.forEach(function (path) {
      var list = assistantContextPath_(context, path);
      while (Array.isArray(list) && list.length && JSON.stringify(context).length > truncation.limit) {
        list.pop();
        truncation.omitted[group.name] += 1;
        truncation.truncated = true;
        context.sourceCatalog = buildAssistantSourceCatalog_(context);
      }
    });
  });

  if (JSON.stringify(context).length > truncation.limit && context.commandCenter.selectedProject) {
    [900, 600, 300, 160].forEach(function (limit) {
      if (JSON.stringify(context).length <= truncation.limit) return;
      assistantContextShrinkStrings_(context.commandCenter.selectedProject, limit, truncation);
      context.sourceCatalog = buildAssistantSourceCatalog_(context);
    });
  }
  if (JSON.stringify(context).length > truncation.limit) {
    assistantContextShrinkStrings_(context.commandCenter, 160, truncation);
    context.sourceCatalog = buildAssistantSourceCatalog_(context);
  }
  var measured = -1;
  while (measured !== JSON.stringify(context).length) {
    measured = JSON.stringify(context).length;
    truncation.finalCharacters = measured;
  }
  if (truncation.finalCharacters > truncation.limit) {
    throw new Error('Assistant context could not be bounded safely.');
  }
}

function assistantContextShrinkStrings_(value, limit, truncation) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach(function (item) { assistantContextShrinkStrings_(item, limit, truncation); });
    return;
  }
  Object.keys(value).forEach(function (key) {
    if (typeof value[key] === 'string' && value[key].length > limit && key !== 'sourceId' && key !== 'id') {
      value[key] = assistantContextText_(value[key], limit, truncation);
    } else if (value[key] && typeof value[key] === 'object') {
      assistantContextShrinkStrings_(value[key], limit, truncation);
    }
  });
}

function assistantContextPath_(object, path) {
  var value = object;
  for (var index = 0; index < path.length; index += 1) {
    if (!value || typeof value !== 'object') return null;
    value = value[path[index]];
  }
  return value;
}

function assistantContextStringList_(value, limit, fieldLimit, truncation) {
  var source = Array.isArray(value) ? value : String(value || '').split(/[;,|\n]/);
  var seen = {};
  var result = [];
  source.forEach(function (item) {
    var text = assistantContextText_(item, fieldLimit, truncation);
    var normalized = assistantContextNormalize_(text);
    if (!text || seen[normalized] || result.length >= limit) return;
    seen[normalized] = true;
    result.push(text);
  });
  return result;
}

function assistantContextDedupe_(items, key) {
  var seen = {};
  return (Array.isArray(items) ? items : []).filter(function (item) {
    var value = assistantContextObject_(item)[key];
    var exact = String(value || '');
    if (!exact || seen[exact]) return false;
    seen[exact] = true;
    return true;
  });
}

function assistantContextTaskSort_(left, right) {
  var leftDue = String(left.dueDate || '9999-99-99');
  var rightDue = String(right.dueDate || '9999-99-99');
  if (leftDue !== rightDue) return leftDue < rightDue ? -1 : 1;
  return assistantContextCompare_(left.id, right.id) || assistantContextCompare_(left.title, right.title);
}

function assistantContextCurrentTaskSort_(left, right) {
  var leftRank = left.status === 'Blocked' ? 0 : 1;
  var rightRank = right.status === 'Blocked' ? 0 : 1;
  return leftRank - rightRank || assistantContextTaskSort_(left, right);
}

function assistantContextProjectSort_(left, right) {
  return assistantContextCompare_(left.id, right.id) || assistantContextCompare_(left.name, right.name);
}

function assistantContextMetricSort_(left, right) {
  return assistantContextCompare_(left.metric, right.metric);
}

function assistantContextUpdateSort_(left, right) {
  var time = assistantContextCompare_(right.timestamp, left.timestamp);
  return time || assistantContextCompare_(left.item, right.item) ||
    assistantContextCompare_(left.update, right.update) ||
    assistantContextCompare_(left.member, right.member) ||
    assistantContextCompare_(left.blocker, right.blocker) ||
    assistantContextCompare_(left.nextStep, right.nextStep);
}

function assistantContextCompare_(left, right) {
  var a = assistantContextNormalize_(left);
  var b = assistantContextNormalize_(right);
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function assistantContextTaskStatus_(status) {
  var normalized = assistantContextNormalize_(status);
  if (normalized === 'open' || normalized === 'unclaimed' || normalized === 'available') return 'Open';
  if (normalized === 'doing' || normalized === 'claimed' || normalized === 'in progress' || normalized === 'in-progress') return 'Doing';
  if (normalized === 'blocked' || normalized === 'waiting' || normalized === 'stuck') return 'Blocked';
  if (normalized === 'done' || normalized === 'complete' || normalized === 'completed') return 'Done';
  return '';
}

function assistantContextProjectStage_(stage) {
  var normalized = assistantContextNormalize_(stage);
  var map = {
    idea: 'Idea', concept: 'Idea',
    validation: 'Validation', validating: 'Validation',
    'school review': 'School Review', 'proposal ready': 'School Review', 'school-review': 'School Review',
    active: 'Active', pilot: 'Active',
    completed: 'Completed', complete: 'Completed', done: 'Completed',
    paused: 'Paused', 'on hold': 'Paused',
    rejected: 'Rejected', declined: 'Rejected'
  };
  return map[normalized] || '';
}

function assistantContextSlug_(value) {
  var slug = assistantContextNormalize_(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return slug || 'item';
}

function assistantContextDisplayName_(value, truncation) {
  var text = assistantContextText_(value, 160, truncation);
  return text
    .replace(/\s*[<(]?\[email removed\][>)]?/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function assistantContextId_(value, truncation) {
  var text = assistantContextText_(value, 160, truncation);
  return text.indexOf('[email removed]') === -1 ? text : '';
}

function assistantContextText_(value, limit, truncation) {
  if (value === null || typeof value === 'undefined') return '';
  if (typeof value === 'object') return '';
  var text = String(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email removed]')
    .trim();
  if (text.length <= limit) return text;
  if (truncation) {
    truncation.textFieldsTruncated += 1;
    truncation.charactersOmitted += text.length - limit;
    truncation.truncated = true;
  }
  return limit <= 1 ? text.slice(0, limit) : text.slice(0, limit - 1).trimEnd() + '…';
}

function assistantContextExternalText_(value, limit, truncation) {
  var text = assistantContextText_(value, limit, truncation);
  return text.replace(/\b(?:https?:\/\/|www\.)\S+/gi, '[link removed]').trim();
}

function assistantContextNormalize_(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function assistantContextHasText_(value) {
  return String(value || '').trim() !== '';
}

function assistantContextHasStableSource_(item) {
  return (!!item && !!item.sourceId && !!item.id) ||
    (!!item && /^metric:/.test(String(item.sourceId || '')) && !!item.metric);
}

function assistantContextMatches_(value, pattern) {
  return pattern.test(String(value || ''));
}

function assistantContextObject_(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function assistantContextIsObject_(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
