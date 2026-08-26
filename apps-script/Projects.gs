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

function resumeProject_(projectKey, profileKey, targetStage, nextAction) {
  return withMutationLock_(function () {
    var context = loadProjectMutation_(projectKey, profileKey,
      ['stage', 'decisionNotes', 'nextAction']);
    assertProjectStage_(context.stage, ['Paused'], 'resume');
    var resumedStage = validateChoice_(targetStage, 'Resume stage', {
      idea: 'Idea',
      validation: 'Validation',
      schoolreview: 'School Review',
      active: 'Active'
    });
    var next = validateText_(nextAction, 'Next action', 600, true);

    setCells_(context.projectsTable.sheet, context.projectRow.rowNumber, [
      { column: context.columns.decisionNotes, value: '' },
      { column: context.columns.nextAction, value: literalSheetText_(next) },
      { column: context.columns.stage, value: resumedStage }
    ]);
    appendProjectUpdate_(context, new Date(), 'Resumed project in ' + resumedStage, next, '');
    flush_();
    return projectMutationResult_(context.spreadsheet, context.member.profileKey,
      'resume_project', context.projectKey, '');
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

function relatedProjectMatches_(storedReference, project, allowNameOnlyMatch) {
  var rawReference = string_(storedReference).trim();
  var reference = normalizeIdentity_(rawReference);
  if (!reference) return false;
  var id = normalizeIdentity_(project.projectId);
  var name = normalizeIdentity_(project.projectName);
  var label = normalizeIdentity_(project.projectLabel || projectLabelFromParts_(project.projectId, project.projectName));
  if (id && reference === id) return true;
  if (id && name && reference === label) return true;
  if (id && rawReference.toLowerCase().indexOf(string_(project.projectId).trim().toLowerCase() + ':') === 0) return true;
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
