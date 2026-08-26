function startSchemaDefinition_() {
  return [
    {
      sheetName: 'Tasks',
      fields: TASK_FIELDS,
      requiredFields: [
        'taskId', 'task', 'relatedProject', 'relatedMetric', 'interestTag',
        'estimatedTime', 'dueDate', 'status', 'claimedBy', 'lastUpdate',
        'blocker', 'supportingLink'
      ]
    },
    {
      sheetName: 'Projects',
      fields: PROJECT_FIELDS,
      requiredFields: [
        'projectId', 'projectName', 'problemOpportunity', 'linkedStartMetrics',
        'carbonTrack', 'stage', 'startImpact', 'startDifficulty', 'startCost',
        'localFeasibility', 'recommendation', 'schoolFeedback', 'nextAction',
        'projectLead', 'resultsLink', 'validationEvidence', 'successMeasure',
        'schoolContact', 'knownConcerns', 'decisionNotes', 'completedWork',
        'observedResult'
      ]
    },
    {
      sheetName: 'Metrics',
      fields: METRIC_FIELDS,
      requiredFields: ['metric']
    },
    {
      sheetName: 'Updates',
      fields: UPDATE_FIELDS,
      requiredFields: [
        'timestamp', 'member', 'taskProject', 'update', 'blocker', 'nextStep', 'link'
      ]
    },
    {
      sheetName: 'Settings',
      fields: SETTINGS_FIELDS,
      requiredFields: ['setting', 'value']
    },
    {
      sheetName: 'Members',
      fields: MEMBER_FIELDS,
      requiredFields: ['email', 'displayName', 'active']
    }
  ];
}

function inspectStartSchema_(spreadsheet) {
  var issues = [];
  var sheets = [];
  var statesByName = {};

  startSchemaDefinition_().forEach(function (definition) {
    var state = inspectSchemaSheet_(spreadsheet, definition, issues);
    sheets.push(state);
    statesByName[definition.sheetName] = state;
  });

  var projectOptions = inspectProjectStageOptions_(spreadsheet, statesByName.Settings, issues);
  var requiredSetups = schemaSetupRecommendations_(statesByName, projectOptions);

  issues.forEach(function (issue) {
    if (issue.sheet && statesByName[issue.sheet]) statesByName[issue.sheet].ready = false;
  });

  return {
    version: START_SCHEMA_VERSION,
    ready: issues.length === 0,
    issues: issues,
    requiredSetups: requiredSetups,
    sheets: sheets
  };
}

function inspectSchemaSheet_(spreadsheet, definition, issues) {
  var sheet = spreadsheet && typeof spreadsheet.getSheetByName === 'function'
    ? spreadsheet.getSheetByName(definition.sheetName)
    : null;
  var state = {
    name: definition.sheetName,
    present: !!sheet,
    ready: true,
    missingHeaders: [],
    ambiguousHeaders: []
  };

  if (!sheet) {
    state.ready = false;
    issues.push(schemaIssue_(
      'MISSING_SHEET',
      definition.sheetName,
      '',
      'Required sheet "' + definition.sheetName + '" was not found.'
    ));
    return state;
  }

  var headers = readSchemaHeaders_(sheet);
  if (!headers.length) {
    state.ready = false;
    issues.push(schemaIssue_(
      'MISSING_HEADER_ROW',
      definition.sheetName,
      '',
      'Sheet "' + definition.sheetName + '" has no readable header row.'
    ));
    return state;
  }

  definition.requiredFields.forEach(function (fieldName) {
    var supported = definition.fields[fieldName].map(normalizeHeader_);
    var matches = headers.filter(function (header) {
      return supported.indexOf(normalizeHeader_(header)) >= 0;
    });
    if (matches.length === 1) return;
    var canonical = definition.fields[fieldName][0];
    if (!matches.length) {
      state.missingHeaders.push(canonical);
      issues.push(schemaIssue_(
        'MISSING_HEADER',
        definition.sheetName,
        canonical,
        'Sheet "' + definition.sheetName + '" is missing the supported "' + canonical + '" header.'
      ));
    } else {
      state.ambiguousHeaders.push(canonical);
      issues.push(schemaIssue_(
        'AMBIGUOUS_HEADER',
        definition.sheetName,
        canonical,
        'Sheet "' + definition.sheetName + '" has more than one supported header for "' + canonical + '". Keep one supported column.'
      ));
    }
  });
  state.ready = state.missingHeaders.length === 0 && state.ambiguousHeaders.length === 0;
  return state;
}

function readSchemaHeaders_(sheet) {
  var lastRow = typeof sheet.getLastRow === 'function' ? sheet.getLastRow() : 0;
  var lastColumn = typeof sheet.getLastColumn === 'function' ? sheet.getLastColumn() : 0;
  if (lastRow < 1 || lastColumn < 1 || typeof sheet.getRange !== 'function') return [];
  var range = sheet.getRange(1, 1, 1, lastColumn);
  var values = typeof range.getDisplayValues === 'function'
    ? range.getDisplayValues()
    : range.getValues();
  return values && values[0] ? values[0].map(string_) : [];
}

function schemaHeaderTable_(headers) {
  var headerIndex = {};
  headers.forEach(function (header, index) {
    var normalized = normalizeHeader_(header);
    if (normalized && typeof headerIndex[normalized] === 'undefined') {
      headerIndex[normalized] = index;
    }
  });
  return { headers: headers, headerIndex: headerIndex };
}

function inspectProjectStageOptions_(spreadsheet, settingsState, issues) {
  var result = {
    inspectable: false,
    matchCount: 0,
    current: false
  };
  if (!settingsState || !settingsState.present || settingsState.missingHeaders.length) return result;

  var settingsSheet = spreadsheet.getSheetByName('Settings');
  var lastRow = settingsSheet.getLastRow();
  var lastColumn = settingsSheet.getLastColumn();
  if (lastRow < 1 || lastColumn < 1) return result;
  var range = settingsSheet.getRange(1, 1, lastRow, lastColumn);
  var values = typeof range.getDisplayValues === 'function'
    ? range.getDisplayValues()
    : range.getValues();
  var headers = (values[0] || []).map(string_);
  var columns = indexes_(schemaHeaderTable_(headers), SETTINGS_FIELDS);
  if (columns.setting < 0 || columns.value < 0) return result;

  var matches = values.slice(1).filter(function (row) {
    return normalizeHeader_(cell_(row, columns.setting)) === 'projectstageoptions';
  });
  result.inspectable = true;
  result.matchCount = matches.length;
  result.current = matches.length === 1 &&
    cell_(matches[0], columns.value).trim() === PROJECT_STAGE_OPTIONS;

  if (matches.length > 1) {
    issues.push(schemaIssue_(
      'DUPLICATE_PROJECT_STAGE_OPTIONS',
      'Settings',
      'Project Stage Options',
      'Settings contains more than one Project Stage Options row; keep one before running setupProjectWorkflow.'
    ));
  } else if (!result.current) {
    issues.push(schemaIssue_(
      'PROJECT_STAGE_OPTIONS_OUTDATED',
      'Settings',
      'Project Stage Options',
      'Project Stage Options is missing or does not match the current project workflow.'
    ));
  }
  return result;
}

function schemaSetupRecommendations_(statesByName, projectOptions) {
  var recommendations = [];
  var members = statesByName.Members;
  if (!members || !members.ready) {
    recommendations.push('setupMembersSheet');
  }

  var projects = statesByName.Projects;
  var settings = statesByName.Settings;
  var missingWorkflowHeader = projects && PROJECT_WORKFLOW_HEADERS.some(function (workflowHeader) {
    return projects.missingHeaders.indexOf(workflowHeader.canonical) >= 0;
  });
  var projectSetupSafe = projects && projects.present && !projects.ambiguousHeaders.length &&
    settings && settings.present && !settings.missingHeaders.length && !settings.ambiguousHeaders.length &&
    projectOptions.inspectable && projectOptions.matchCount <= 1;
  if (projectSetupSafe && (missingWorkflowHeader || !projectOptions.current)) {
    recommendations.push('setupProjectWorkflow');
  }
  return recommendations;
}

function schemaIssue_(code, sheetName, header, message) {
  return {
    code: code,
    sheet: sheetName,
    header: header,
    message: message
  };
}
