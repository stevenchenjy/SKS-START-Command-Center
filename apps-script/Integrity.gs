/**
 * Builds a bounded, deterministic, read-only integrity report from either
 * in-memory table objects or a Spreadsheet-like object. The function never
 * repairs data and deliberately requires an injected school-local date.
 *
 * Supported in-memory table shapes include:
 *   { Tasks: { headers: [...], rows: [[...], ...] }, ... }
 *   { tasks: [{ taskId: 'TASK-1', ... }], ... }
 *   { Tasks: { headers: [...], rows: [{ rowNumber: 2, values: [...] }] } }
 *
 * @param {Object} source Spreadsheet-like object or keyed in-memory tables.
 * @param {string} today Strict school-local YYYY-MM-DD date.
 * @param {Object=} options Optional issueLimit (0-200) and staleBlockedDays.
 * @return {Object} Privacy-minimized integrity report.
 */
function buildDataIntegrityReport_(source, today, options) {
  var settings = integritySettings_(today, options);
  var tables = integrityTables_(source);
  var collector = integrityCollector_(settings.issueLimit);

  Object.keys(tables).forEach(function (sheetName) {
    integrityInspectHeaders_(tables[sheetName], collector);
  });

  var members = integrityInspectMembers_(tables.Members, collector);
  var metrics = integrityInspectMetrics_(tables.Metrics, collector);
  var projects = integrityInspectProjects_(tables.Projects, members, metrics, collector);
  var tasks = integrityInspectTasks_(
    tables.Tasks,
    members,
    metrics,
    projects,
    settings,
    collector
  );
  integrityInspectSettings_(tables.Settings, collector);
  integrityInspectUpdates_(tables.Updates, tasks, projects, settings, collector);

  return integrityFinalizeReport_(collector, settings);
}

function buildStartIntegrityReport_(source, today, options) {
  return buildDataIntegrityReport_(source, today, options);
}

function integritySettings_(today, options) {
  var cleanToday = integrityString_(today).trim();
  var todayMillis = integrityCalendarDayMillis_(cleanToday);
  if (todayMillis === null) {
    throw new Error('Integrity report today must be a real YYYY-MM-DD calendar date.');
  }
  var input = options && typeof options === 'object' ? options : {};
  var issueLimit = typeof input.issueLimit === 'undefined' ? 200 : Number(input.issueLimit);
  if (!isFinite(issueLimit) || Math.floor(issueLimit) !== issueLimit || issueLimit < 0 || issueLimit > 200) {
    throw new Error('Integrity report issueLimit must be an integer from 0 to 200.');
  }
  var staleBlockedDays = typeof input.staleBlockedDays === 'undefined'
    ? 14
    : Number(input.staleBlockedDays);
  if (!isFinite(staleBlockedDays) || Math.floor(staleBlockedDays) !== staleBlockedDays ||
      staleBlockedDays < 1 || staleBlockedDays > 365) {
    throw new Error('Integrity report staleBlockedDays must be an integer from 1 to 365.');
  }
  return {
    today: cleanToday,
    todayMillis: todayMillis,
    issueLimit: issueLimit,
    staleBlockedDays: staleBlockedDays
  };
}

function integrityTables_(source) {
  var fields = integrityFieldDefinitions_();
  var result = {};
  Object.keys(fields).forEach(function (sheetName) {
    result[sheetName] = integrityTable_(source, sheetName, fields[sheetName]);
  });
  return result;
}

function integrityFieldDefinitions_() {
  return {
    Tasks: integrityConfiguredFields_('TASK_FIELDS', {
      taskId: ['Task ID', 'TaskID', 'ID'],
      task: ['Task', 'Task Name', 'Title', 'Action Item'],
      relatedProject: ['Related Project', 'Project', 'Project Name'],
      relatedMetric: ['Related Metric', 'Linked Metric', 'START Metric', 'Metric'],
      dueDate: ['Due Date', 'Deadline', 'Due'],
      status: ['Status', 'Task Status'],
      claimedBy: ['Claimed By', 'ClaimedBy', 'Owner', 'Assignee', 'Assigned To'],
      lastUpdate: ['Last Update', 'Last Updated', 'Updated'],
      blocker: ['Blocker', 'Blockers', 'Current Blocker'],
      supportingLink: ['Supporting Link', 'Link', 'URL', 'Resource Link']
    }),
    Projects: integrityConfiguredFields_('PROJECT_FIELDS', {
      projectId: ['Project ID', 'ProjectID', 'ID'],
      projectName: ['Project Name', 'Project', 'Name', 'Title'],
      linkedStartMetrics: ['Linked START Metrics', 'Linked Metrics', 'START Metrics', 'Metrics'],
      stage: ['Stage', 'Project Stage', 'Status'],
      localFeasibility: ['Local Feasibility', 'Feasibility'],
      recommendation: ['Recommendation', 'Recommended Action'],
      schoolFeedback: ['School Feedback', 'Staff Feedback', 'Feedback'],
      nextAction: ['Next Action', 'Next Step'],
      projectLead: ['Project Lead', 'Lead', 'Owner'],
      validationEvidence: ['Validation Evidence', 'Evidence', 'Opportunity Evidence'],
      successMeasure: ['Success Measure', 'Success Measures', 'Measure of Success'],
      schoolContact: ['School Contact', 'School Contacts', 'Consulted', 'Department Consulted'],
      knownConcerns: ['Known Concerns', 'Concerns', 'Validation Concerns'],
      decisionNotes: ['Decision Notes', 'Decision Note', 'Pause / Decision Reason'],
      completedWork: ['Completed Work', 'Work Completed', 'What Was Completed'],
      observedResult: ['Observed Result', 'Observed Results', 'Result Observed'],
      resultsLink: ['Results Link', 'Result Link', 'Link', 'URL']
    }),
    Metrics: integrityConfiguredFields_('METRIC_FIELDS', {
      metric: ['Metric', 'Metric Name', 'START Metric']
    }),
    Updates: integrityConfiguredFields_('UPDATE_FIELDS', {
      timestamp: ['Timestamp', 'Time', 'Date'],
      member: ['Member', 'Updated By', 'Author'],
      taskProject: ['Task / Project', 'Task or Project', 'Task Project', 'Item'],
      update: ['Update', 'Progress Update', 'Note'],
      link: ['Link', 'URL', 'Supporting Link']
    }),
    Settings: integrityConfiguredFields_('SETTINGS_FIELDS', {
      setting: ['Setting', 'Key', 'Name'],
      value: ['Value', 'Setting Value']
    }),
    Members: integrityConfiguredFields_('MEMBER_FIELDS', {
      email: ['Email', 'Email Address', 'Google Email'],
      displayName: ['Display Name', 'Name', 'Member Name'],
      active: ['Active', 'Enabled', 'Current']
    })
  };
}

function integrityConfiguredFields_(globalName, fallback) {
  var configured = null;
  if (globalName === 'TASK_FIELDS' && typeof TASK_FIELDS !== 'undefined') configured = TASK_FIELDS;
  if (globalName === 'PROJECT_FIELDS' && typeof PROJECT_FIELDS !== 'undefined') configured = PROJECT_FIELDS;
  if (globalName === 'METRIC_FIELDS' && typeof METRIC_FIELDS !== 'undefined') configured = METRIC_FIELDS;
  if (globalName === 'UPDATE_FIELDS' && typeof UPDATE_FIELDS !== 'undefined') configured = UPDATE_FIELDS;
  if (globalName === 'SETTINGS_FIELDS' && typeof SETTINGS_FIELDS !== 'undefined') configured = SETTINGS_FIELDS;
  if (globalName === 'MEMBER_FIELDS' && typeof MEMBER_FIELDS !== 'undefined') configured = MEMBER_FIELDS;
  var result = {};
  Object.keys(fallback).forEach(function (field) {
    var aliases = configured && Array.isArray(configured[field]) ? configured[field] : fallback[field];
    result[field] = aliases.slice();
  });
  return result;
}

function integrityTable_(source, sheetName, fields) {
  var raw;
  if (source && typeof source.getSheetByName === 'function') {
    raw = integrityReadSpreadsheetTable_(source, sheetName);
  } else {
    var container = source && source.tables && typeof source.tables === 'object'
      ? source.tables
      : source;
    raw = container && (container[sheetName] || container[sheetName.toLowerCase()]);
  }
  var table = integrityNormalizeTable_(raw, sheetName);
  table.fields = fields;
  table.fieldIndexes = {};
  table.fieldMatches = {};
  Object.keys(fields).forEach(function (field) {
    var matches = integrityHeaderMatches_(table.headers, fields[field]);
    table.fieldMatches[field] = matches;
    table.fieldIndexes[field] = matches.length ? matches[0] : -1;
  });
  return table;
}

function integrityReadSpreadsheetTable_(spreadsheet, sheetName) {
  var sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) return { headers: [], rows: [] };
  var lastRow = typeof sheet.getLastRow === 'function' ? sheet.getLastRow() : 0;
  var lastColumn = typeof sheet.getLastColumn === 'function' ? sheet.getLastColumn() : 0;
  if (lastRow < 1 || lastColumn < 1 || typeof sheet.getRange !== 'function') {
    return { headers: [], rows: [] };
  }
  var range = sheet.getRange(1, 1, lastRow, lastColumn);
  var rawValues = typeof range.getValues === 'function' ? range.getValues() : [];
  var displayValues = typeof range.getDisplayValues === 'function'
    ? range.getDisplayValues()
    : rawValues;
  var headerSource = displayValues[0] || rawValues[0] || [];
  var rows = [];
  for (var rowIndex = 1; rowIndex < Math.max(rawValues.length, displayValues.length); rowIndex += 1) {
    rows.push({
      rowNumber: rowIndex + 1,
      values: displayValues[rowIndex] || rawValues[rowIndex] || [],
      rawValues: rawValues[rowIndex] || displayValues[rowIndex] || []
    });
  }
  return { headers: headerSource, rows: rows };
}

function integrityNormalizeTable_(raw, sheetName) {
  var headers = [];
  var rawRows = [];
  if (Array.isArray(raw)) {
    if (raw.length && Array.isArray(raw[0])) {
      headers = raw[0];
      rawRows = raw.slice(1);
    } else {
      rawRows = raw;
    }
  } else if (raw && typeof raw === 'object') {
    headers = Array.isArray(raw.headers) ? raw.headers : [];
    rawRows = Array.isArray(raw.rows) ? raw.rows : [];
  }
  var rows = rawRows.map(function (row, index) {
    if (row && typeof row === 'object' && Array.isArray(row.values)) {
      return {
        rowNumber: integrityPositiveRow_(row.rowNumber, index + 2),
        values: row.values,
        rawValues: Array.isArray(row.rawValues) ? row.rawValues : row.values,
        object: null
      };
    }
    if (Array.isArray(row)) {
      return {
        rowNumber: index + 2,
        values: row,
        rawValues: row,
        object: null
      };
    }
    return {
      rowNumber: integrityPositiveRow_(row && row.rowNumber, index + 2),
      values: null,
      rawValues: null,
      object: row && typeof row === 'object' ? row : {}
    };
  });
  return {
    name: sheetName,
    headers: headers.map(integrityString_),
    rows: rows
  };
}

function integrityPositiveRow_(value, fallback) {
  var number = Number(value);
  return isFinite(number) && Math.floor(number) === number && number > 0 ? number : fallback;
}

function integrityHeaderMatches_(headers, aliases) {
  var aliasKeys = aliases.map(integrityNormalize_);
  var matches = [];
  headers.forEach(function (header, index) {
    if (aliasKeys.indexOf(integrityNormalize_(header)) >= 0) matches.push(index);
  });
  return matches;
}

function integrityInspectHeaders_(table, collector) {
  var groups = {};
  table.headers.forEach(function (header, index) {
    var key = integrityNormalize_(header);
    if (!key) return;
    var safeKey = '$' + key;
    if (!groups[safeKey]) groups[safeKey] = [];
    groups[safeKey].push(index);
  });
  Object.keys(groups).sort().forEach(function (key) {
    if (groups[key].length < 2) return;
    integrityAddIssue_(collector, {
      code: 'DUPLICATE_HEADER',
      severity: 'error',
      category: 'schema',
      sheet: table.name,
      row: 1,
      field: 'Header row',
      itemLabel: table.name + ' header row',
      message: 'The same normalized header appears more than once; reads would use only the first column.'
    });
  });
  Object.keys(table.fields).sort().forEach(function (field) {
    if (table.fieldMatches[field].length < 2) return;
    integrityAddIssue_(collector, {
      code: 'AMBIGUOUS_HEADER_ALIAS',
      severity: 'error',
      category: 'schema',
      sheet: table.name,
      row: 1,
      field: table.fields[field][0],
      itemLabel: table.name + ' header row',
      message: 'More than one supported header resolves to this logical field; keep one supported column.'
    });
  });
}

function integrityInspectMembers_(table, collector) {
  var members = integrityPopulatedRows_(table).map(function (row) {
    var email = integrityString_(integrityValue_(table, row, 'email')).trim();
    var displayName = integrityString_(integrityValue_(table, row, 'displayName')).trim();
    var activeState = integrityMemberActiveState_(integrityValue_(table, row, 'active'));
    var label = 'Member row ' + row.rowNumber;
    if (email && !integrityValidEmail_(email)) {
      integrityAddIssue_(collector, integrityMemberIssue_(
        'MALFORMED_MEMBER_EMAIL', 'error', row.rowNumber, 'Email', label,
        'Member email is not a valid single email address.'
      ));
    }
    if (activeState.active && !email) {
      integrityAddIssue_(collector, integrityMemberIssue_(
        'ACTIVE_MEMBER_MISSING_EMAIL', 'error', row.rowNumber, 'Email', label,
        'An active member is missing the stable email identity required for authenticated access.'
      ));
    }
    if (email && !displayName) {
      integrityAddIssue_(collector, integrityMemberIssue_(
        'MEMBER_MISSING_DISPLAY_NAME', 'warning', row.rowNumber, 'Display Name', label,
        'Member has an email identity but no student-facing display name.'
      ));
    }
    if (!activeState.valid) {
      integrityAddIssue_(collector, integrityMemberIssue_(
        'UNRECOGNIZED_MEMBER_ACTIVE', 'error', row.rowNumber, 'Active', label,
        'Member Active value is neither a supported active nor inactive value.'
      ));
    }
    return {
      rowNumber: row.rowNumber,
      email: integrityNormalizeEmail_(email),
      displayName: displayName,
      displayKey: integrityNormalizeIdentity_(displayName),
      active: activeState.active && activeState.valid
    };
  });

  integrityReportDuplicateRecords_(members, function (member) { return member.email; }, function (member) {
    return integrityMemberIssue_(
      'DUPLICATE_MEMBER_EMAIL', 'error', member.rowNumber, 'Email',
      'Member row ' + member.rowNumber,
      'This member email appears more than once; authenticated identity is ambiguous.'
    );
  }, collector);
  integrityReportDuplicateRecords_(members, function (member) { return member.displayKey; }, function (member) {
    return integrityMemberIssue_(
      'AMBIGUOUS_MEMBER_DISPLAY_NAME', 'warning', member.rowNumber, 'Display Name',
      'Member row ' + member.rowNumber,
      'This display name appears more than once; legacy owner references by name are ambiguous.'
    );
  }, collector);
  members.forEach(function (member) {
    if (!member.displayKey) return;
    var collidesWithEmail = members.some(function (candidate) {
      return !!candidate.email && integrityNormalizeIdentity_(candidate.email) === member.displayKey;
    });
    if (!collidesWithEmail) return;
    integrityAddIssue_(collector, integrityMemberIssue_(
      'MEMBER_IDENTITY_NAMESPACE_COLLISION', 'error', member.rowNumber, 'Display Name',
      'Member row ' + member.rowNumber,
      'Display Name matches a member email; stable identities and student-facing names must not overlap.'
    ));
  });
  return members;
}

function integrityMemberIssue_(code, severity, row, field, label, message) {
  return {
    code: code,
    severity: severity,
    category: 'identity',
    sheet: 'Members',
    row: row,
    field: field,
    itemLabel: label,
    message: message
  };
}

function integrityMemberActiveState_(value) {
  var key = integrityNormalize_(value);
  var active = ['true', 'yes', 'y', '1', 'active', 'enabled'];
  var inactive = ['', 'false', 'no', 'n', '0', 'inactive', 'disabled'];
  if (active.indexOf(key) >= 0) return { valid: true, active: true };
  if (inactive.indexOf(key) >= 0) return { valid: true, active: false };
  return { valid: false, active: false };
}

function integrityValidEmail_(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(integrityString_(value).trim());
}

function integrityInspectMetrics_(table, collector) {
  var metrics = integrityPopulatedRows_(table).map(function (row) {
    var name = integrityString_(integrityValue_(table, row, 'metric')).trim();
    return { rowNumber: row.rowNumber, name: name, key: integrityNormalizeIdentity_(name) };
  }).filter(function (metric) { return !!metric.name; });
  integrityReportDuplicateRecords_(metrics, function (metric) { return metric.key; }, function (metric) {
    return {
      code: 'DUPLICATE_METRIC_NAME',
      severity: 'error',
      category: 'association',
      sheet: 'Metrics',
      row: metric.rowNumber,
      field: 'Metric',
      itemLabel: 'Metric row ' + metric.rowNumber,
      message: 'This metric name appears more than once; linked metric references are ambiguous.'
    };
  }, collector);
  return metrics;
}

function integrityInspectSettings_(table, collector) {
  var settings = integrityPopulatedRows_(table).map(function (row) {
    return {
      rowNumber: row.rowNumber,
      key: integrityNormalize_(integrityValue_(table, row, 'setting'))
    };
  }).filter(function (setting) { return !!setting.key; });
  integrityReportDuplicateRecords_(settings, function (setting) { return setting.key; }, function (setting) {
    return {
      code: 'DUPLICATE_SETTING',
      severity: 'error',
      category: 'schema',
      sheet: 'Settings',
      row: setting.rowNumber,
      field: 'Setting',
      itemLabel: 'Setting row ' + setting.rowNumber,
      message: 'This normalized Settings key appears more than once; keep one authoritative row.'
    };
  }, collector);
}

function integrityInspectProjects_(table, members, metrics, collector) {
  var projects = integrityPopulatedRows_(table).map(function (row) {
    var id = integrityString_(integrityValue_(table, row, 'projectId')).trim();
    var name = integrityString_(integrityValue_(table, row, 'projectName')).trim();
    var stageState = integrityProjectStage_(integrityValue_(table, row, 'stage'));
    var label = integrityItemLabel_('Project', id, name, row.rowNumber);
    if (!id) {
      integrityAddIssue_(collector, {
        code: 'MISSING_PROJECT_ID', severity: 'error', category: 'project', sheet: 'Projects',
        row: row.rowNumber, field: 'Project ID', itemLabel: label,
        message: 'Populated project row is missing its stable Project ID.'
      });
    }
    if (!name) {
      integrityAddIssue_(collector, {
        code: 'MISSING_PROJECT_NAME', severity: 'error', category: 'project', sheet: 'Projects',
        row: row.rowNumber, field: 'Project Name', itemLabel: label,
        message: 'Populated project row is missing its student-facing Project Name.'
      });
    }
    if (!stageState.valid) {
      integrityAddIssue_(collector, {
        code: 'INVALID_PROJECT_STAGE', severity: 'error', category: 'project', sheet: 'Projects',
        row: row.rowNumber, field: 'Stage', itemLabel: label,
        message: 'Project stage is blank or not a supported lifecycle value.'
      });
    }
    var project = {
      row: row,
      rowNumber: row.rowNumber,
      id: id,
      idKey: integrityNormalizeIdentity_(id),
      name: name,
      nameKey: integrityNormalizeIdentity_(name),
      label: id && name ? id + ': ' + name : id || name,
      stage: stageState.stage,
      itemLabel: label
    };
    integrityInspectProjectOwner_(table, project, members, collector);
    integrityInspectProjectMetrics_(table, project, metrics, collector);
    integrityInspectProjectState_(table, project, collector);
    return project;
  });

  integrityReportDuplicateRecords_(projects, function (project) { return project.idKey; }, function (project) {
    return {
      code: 'DUPLICATE_PROJECT_ID', severity: 'error', category: 'project', sheet: 'Projects',
      row: project.rowNumber, field: 'Project ID', itemLabel: project.itemLabel,
      message: 'This Project ID appears on more than one populated row.'
    };
  }, collector);
  return projects;
}

function integrityInspectProjectOwner_(table, project, members, collector) {
  var owner = integrityString_(integrityValue_(table, project.row, 'projectLead')).trim();
  if (!owner || project.stage === 'Completed' || project.stage === 'Rejected') return;
  var state = integrityMemberReference_(owner, members);
  if (state.count === 0) {
    integrityAddIssue_(collector, {
      code: 'UNKNOWN_PROJECT_LEAD', severity: 'warning', category: 'identity', sheet: 'Projects',
      row: project.rowNumber, field: 'Project Lead', itemLabel: project.itemLabel,
      message: 'Project Lead does not match a current Members email or unique display name.'
    });
  } else if (state.count > 1) {
    integrityAddIssue_(collector, {
      code: 'AMBIGUOUS_PROJECT_LEAD', severity: 'error', category: 'identity', sheet: 'Projects',
      row: project.rowNumber, field: 'Project Lead', itemLabel: project.itemLabel,
      message: 'Project Lead matches more than one member profile.'
    });
  } else if (!state.matches[0].active) {
    integrityAddIssue_(collector, {
      code: 'INACTIVE_PROJECT_LEAD', severity: 'warning', category: 'identity', sheet: 'Projects',
      row: project.rowNumber, field: 'Project Lead', itemLabel: project.itemLabel,
      message: 'A nonterminal project is led by an inactive member.'
    });
  }
}

function integrityInspectProjectMetrics_(table, project, metrics, collector) {
  integrityStringList_(integrityValue_(table, project.row, 'linkedStartMetrics')).forEach(function (name) {
    var count = integrityMetricMatchCount_(name, metrics);
    if (count === 0) {
      integrityAddIssue_(collector, {
        code: 'MISSING_PROJECT_METRIC', severity: 'warning', category: 'association', sheet: 'Projects',
        row: project.rowNumber, field: 'Linked START Metrics', itemLabel: project.itemLabel,
        message: 'A linked project metric does not match a current Metrics row.'
      });
    } else if (count > 1) {
      integrityAddIssue_(collector, {
        code: 'AMBIGUOUS_PROJECT_METRIC', severity: 'error', category: 'association', sheet: 'Projects',
        row: project.rowNumber, field: 'Linked START Metrics', itemLabel: project.itemLabel,
        message: 'A linked project metric matches more than one Metrics row.'
      });
    }
  });
}

function integrityInspectProjectState_(table, project, collector) {
  var row = project.row;
  var nextAction = integrityString_(integrityValue_(table, row, 'nextAction')).trim();
  var resultsLink = integrityString_(integrityValue_(table, row, 'resultsLink')).trim();
  if (resultsLink && !integrityValidHttpLink_(resultsLink)) {
    integrityAddIssue_(collector, {
      code: 'INVALID_PROJECT_RESULTS_LINK', severity: 'warning', category: 'project', sheet: 'Projects',
      row: project.rowNumber, field: 'Results Link', itemLabel: project.itemLabel,
      message: 'Non-empty Results Link is not a valid HTTP or HTTPS web link.'
    });
  }
  if (['Validation', 'School Review', 'Active'].indexOf(project.stage) >= 0 && !nextAction) {
    integrityAddIssue_(collector, {
      code: 'WORKING_PROJECT_MISSING_NEXT_ACTION', severity: 'warning', category: 'project', sheet: 'Projects',
      row: project.rowNumber, field: 'Next Action', itemLabel: project.itemLabel,
      message: 'A working project is missing its recorded next action.'
    });
  }
  if (project.stage === 'School Review') {
    [
      ['validationEvidence', 'Validation Evidence'],
      ['successMeasure', 'Success Measure'],
      ['schoolContact', 'School Contact'],
      ['knownConcerns', 'Known Concerns']
    ].forEach(function (field) {
      if (integrityString_(integrityValue_(table, row, field[0])).trim()) return;
      integrityAddIssue_(collector, {
        code: 'SCHOOL_REVIEW_MISSING_REQUIRED_FACT', severity: 'warning', category: 'project', sheet: 'Projects',
        row: project.rowNumber, field: field[1], itemLabel: project.itemLabel,
        message: 'School Review project is missing a fact required by the current validation workflow.'
      });
    });
  }
  var decisionNotes = integrityString_(integrityValue_(table, row, 'decisionNotes')).trim();
  var schoolFeedback = integrityString_(integrityValue_(table, row, 'schoolFeedback')).trim();
  if (project.stage === 'Paused' && !decisionNotes) {
    integrityAddIssue_(collector, {
      code: 'PAUSED_PROJECT_MISSING_REASON', severity: 'warning', category: 'project', sheet: 'Projects',
      row: project.rowNumber, field: 'Decision Notes', itemLabel: project.itemLabel,
      message: 'Paused project has no recorded pause reason.'
    });
  }
  if (project.stage === 'Rejected' && !decisionNotes && !schoolFeedback) {
    integrityAddIssue_(collector, {
      code: 'REJECTED_PROJECT_MISSING_REASON', severity: 'warning', category: 'project', sheet: 'Projects',
      row: project.rowNumber, field: 'Decision Notes', itemLabel: project.itemLabel,
      message: 'Rejected project has no recorded decision reason or school feedback.'
    });
  }
  if (project.stage === 'Completed') {
    if (!integrityString_(integrityValue_(table, row, 'completedWork')).trim()) {
      integrityAddIssue_(collector, {
        code: 'COMPLETED_PROJECT_MISSING_WORK', severity: 'warning', category: 'project', sheet: 'Projects',
        row: project.rowNumber, field: 'Completed Work', itemLabel: project.itemLabel,
        message: 'Completed project is missing its recorded completed work.'
      });
    }
    if (!integrityString_(integrityValue_(table, row, 'observedResult')).trim()) {
      integrityAddIssue_(collector, {
        code: 'COMPLETED_PROJECT_MISSING_RESULT', severity: 'warning', category: 'project', sheet: 'Projects',
        row: project.rowNumber, field: 'Observed Result', itemLabel: project.itemLabel,
        message: 'Completed project is missing its reported observed result.'
      });
    }
    if (nextAction) {
      integrityAddIssue_(collector, {
        code: 'COMPLETED_PROJECT_HAS_NEXT_ACTION', severity: 'warning', category: 'project', sheet: 'Projects',
        row: project.rowNumber, field: 'Next Action', itemLabel: project.itemLabel,
        message: 'Completed project still has an active next action.'
      });
    }
  }
}

function integrityInspectTasks_(table, members, metrics, projects, settings, collector) {
  var tasks = integrityPopulatedRows_(table).map(function (row) {
    var id = integrityString_(integrityValue_(table, row, 'taskId')).trim();
    var title = integrityString_(integrityValue_(table, row, 'task')).trim();
    var statusState = integrityTaskStatus_(integrityValue_(table, row, 'status'));
    var owner = integrityString_(integrityValue_(table, row, 'claimedBy')).trim();
    var blocker = integrityString_(integrityValue_(table, row, 'blocker')).trim();
    var itemLabel = integrityItemLabel_('Task', id, title, row.rowNumber);
    var task = {
      row: row,
      rowNumber: row.rowNumber,
      id: id,
      idKey: integrityNormalizeIdentity_(id),
      title: title,
      nameKey: integrityNormalizeIdentity_(title),
      label: id && title ? id + ': ' + title : id || title,
      status: statusState.status,
      itemLabel: itemLabel
    };
    if (!id) {
      integrityAddIssue_(collector, {
        code: 'MISSING_TASK_ID', severity: 'error', category: 'task', sheet: 'Tasks',
        row: row.rowNumber, field: 'Task ID', itemLabel: itemLabel,
        message: 'Populated task row is missing its stable Task ID.'
      });
    }
    if (!title) {
      integrityAddIssue_(collector, {
        code: 'MISSING_TASK_TITLE', severity: 'error', category: 'task', sheet: 'Tasks',
        row: row.rowNumber, field: 'Task', itemLabel: itemLabel,
        message: 'Populated task row is missing its student-facing task title.'
      });
    }
    if (!statusState.valid) {
      integrityAddIssue_(collector, {
        code: 'INVALID_TASK_STATUS', severity: 'error', category: 'task', sheet: 'Tasks',
        row: row.rowNumber, field: 'Status', itemLabel: itemLabel,
        message: 'Task status is blank or not a supported workflow value.'
      });
    }
    integrityInspectTaskState_(task, owner, blocker, members, collector);
    integrityInspectTaskAssociations_(table, task, projects, metrics, collector);
    integrityInspectTaskDates_(table, task, settings, collector);
    integrityInspectTaskLink_(table, task, collector);
    return task;
  });

  integrityReportDuplicateRecords_(tasks, function (task) { return task.idKey; }, function (task) {
    return {
      code: 'DUPLICATE_TASK_ID', severity: 'error', category: 'task', sheet: 'Tasks',
      row: task.rowNumber, field: 'Task ID', itemLabel: task.itemLabel,
      message: 'This Task ID appears on more than one populated row.'
    };
  }, collector);
  return tasks;
}

function integrityInspectTaskLink_(table, task, collector) {
  var link = integrityString_(integrityValue_(table, task.row, 'supportingLink')).trim();
  if (!link || integrityValidHttpLink_(link)) return;
  integrityAddIssue_(collector, {
    code: 'INVALID_TASK_SUPPORTING_LINK', severity: 'warning', category: 'task', sheet: 'Tasks',
    row: task.rowNumber, field: 'Supporting Link', itemLabel: task.itemLabel,
    message: 'Non-empty Supporting Link is not a valid HTTP or HTTPS web link.'
  });
}

function integrityInspectTaskState_(task, owner, blocker, members, collector) {
  if (task.status === 'Open' && owner) {
    integrityAddIssue_(collector, {
      code: 'OPEN_TASK_HAS_OWNER', severity: 'error', category: 'task', sheet: 'Tasks',
      row: task.rowNumber, field: 'Claimed By', itemLabel: task.itemLabel,
      message: 'Open task still has an owner; release should clear ownership.'
    });
  }
  if ((task.status === 'Doing' || task.status === 'Blocked') && !owner) {
    integrityAddIssue_(collector, {
      code: 'WORKING_TASK_MISSING_OWNER', severity: 'error', category: 'task', sheet: 'Tasks',
      row: task.rowNumber, field: 'Claimed By', itemLabel: task.itemLabel,
      message: 'Doing or Blocked task is missing its owner.'
    });
  }
  if (task.status === 'Blocked' && !blocker) {
    integrityAddIssue_(collector, {
      code: 'BLOCKED_TASK_MISSING_BLOCKER', severity: 'error', category: 'task', sheet: 'Tasks',
      row: task.rowNumber, field: 'Blocker', itemLabel: task.itemLabel,
      message: 'Blocked task has no recorded blocker.'
    });
  }
  if (task.status && task.status !== 'Blocked' && blocker) {
    integrityAddIssue_(collector, {
      code: 'NONBLOCKED_TASK_HAS_BLOCKER', severity: 'warning', category: 'task', sheet: 'Tasks',
      row: task.rowNumber, field: 'Blocker', itemLabel: task.itemLabel,
      message: 'Task is not Blocked but still contains an active blocker.'
    });
  }
  if (!owner || task.status === 'Done') return;
  var memberState = integrityStableMemberReference_(owner, members);
  var legacyState = integrityMemberReference_(owner, members);
  if (memberState.count === 0 && legacyState.count === 1) {
    integrityAddIssue_(collector, {
      code: 'LEGACY_TASK_OWNER_IDENTITY', severity: 'warning', category: 'identity', sheet: 'Tasks',
      row: task.rowNumber, field: 'Claimed By', itemLabel: task.itemLabel,
      message: 'Task owner is stored as a mutable display name; use admin recovery so it can be reclaimed with a stable email identity.'
    });
  } else if (memberState.count === 0 && legacyState.count > 1) {
    integrityAddIssue_(collector, {
      code: 'AMBIGUOUS_TASK_OWNER', severity: 'error', category: 'identity', sheet: 'Tasks',
      row: task.rowNumber, field: 'Claimed By', itemLabel: task.itemLabel,
      message: 'Current task owner matches more than one member profile.'
    });
  } else if (memberState.count === 0) {
    integrityAddIssue_(collector, {
      code: 'UNKNOWN_TASK_OWNER', severity: 'warning', category: 'identity', sheet: 'Tasks',
      row: task.rowNumber, field: 'Claimed By', itemLabel: task.itemLabel,
      message: 'Current task owner does not match a Members email.'
    });
  } else if (memberState.count > 1) {
    integrityAddIssue_(collector, {
      code: 'AMBIGUOUS_TASK_OWNER', severity: 'error', category: 'identity', sheet: 'Tasks',
      row: task.rowNumber, field: 'Claimed By', itemLabel: task.itemLabel,
      message: 'Current task owner matches more than one member profile.'
    });
  } else if (!memberState.matches[0].active) {
    integrityAddIssue_(collector, {
      code: 'INACTIVE_TASK_OWNER', severity: 'warning', category: 'identity', sheet: 'Tasks',
      row: task.rowNumber, field: 'Claimed By', itemLabel: task.itemLabel,
      message: 'Current task is owned by an inactive member.'
    });
  }
}

function integrityInspectTaskAssociations_(table, task, projects, metrics, collector) {
  var projectReference = integrityString_(integrityValue_(table, task.row, 'relatedProject')).trim();
  if (projectReference) {
    var matches = integrityReferenceMatches_(projectReference, projects);
    if (!matches.length) {
      integrityAddIssue_(collector, {
        code: 'MISSING_TASK_PROJECT', severity: 'warning', category: 'association', sheet: 'Tasks',
        row: task.rowNumber, field: 'Related Project', itemLabel: task.itemLabel,
        message: 'Related Project does not match a current exact ID, canonical label, or unique project name.'
      });
    } else if (matches.length > 1) {
      integrityAddIssue_(collector, {
        code: 'AMBIGUOUS_TASK_PROJECT', severity: 'error', category: 'association', sheet: 'Tasks',
        row: task.rowNumber, field: 'Related Project', itemLabel: task.itemLabel,
        message: 'Related Project matches more than one current project.'
      });
    }
  }
  var metricReference = integrityString_(integrityValue_(table, task.row, 'relatedMetric')).trim();
  if (metricReference) {
    var metricCount = integrityMetricMatchCount_(metricReference, metrics);
    if (metricCount === 0) {
      integrityAddIssue_(collector, {
        code: 'MISSING_TASK_METRIC', severity: 'warning', category: 'association', sheet: 'Tasks',
        row: task.rowNumber, field: 'Related Metric', itemLabel: task.itemLabel,
        message: 'Related Metric does not match a current Metrics row.'
      });
    } else if (metricCount > 1) {
      integrityAddIssue_(collector, {
        code: 'AMBIGUOUS_TASK_METRIC', severity: 'error', category: 'association', sheet: 'Tasks',
        row: task.rowNumber, field: 'Related Metric', itemLabel: task.itemLabel,
        message: 'Related Metric matches more than one current Metrics row.'
      });
    }
  }
}

function integrityInspectTaskDates_(table, task, settings, collector) {
  var due = integrityDateState_(integrityValue_(table, task.row, 'dueDate', true));
  if (due.present && !due.valid) {
    integrityAddIssue_(collector, {
      code: 'INVALID_TASK_DUE_DATE', severity: 'warning', category: 'task', sheet: 'Tasks',
      row: task.rowNumber, field: 'Due Date', itemLabel: task.itemLabel,
      message: 'Due Date is not a real date or strict timestamp.'
    });
  }
  var lastUpdate = integrityDateState_(integrityValue_(table, task.row, 'lastUpdate', true));
  if (lastUpdate.present && !lastUpdate.valid) {
    integrityAddIssue_(collector, {
      code: 'INVALID_TASK_LAST_UPDATE', severity: 'warning', category: 'task', sheet: 'Tasks',
      row: task.rowNumber, field: 'Last Update', itemLabel: task.itemLabel,
      message: 'Last Update is not a real date or strict timestamp.'
    });
  }
  if (lastUpdate.valid && lastUpdate.millis >= settings.todayMillis + 86400000) {
    integrityAddIssue_(collector, {
      code: 'FUTURE_TASK_LAST_UPDATE', severity: 'warning', category: 'task', sheet: 'Tasks',
      row: task.rowNumber, field: 'Last Update', itemLabel: task.itemLabel,
      message: 'Last Update is later than the injected school-local audit date.'
    });
  }
  if (task.status !== 'Blocked') return;
  if (!lastUpdate.present) {
    integrityAddIssue_(collector, {
      code: 'BLOCKED_TASK_MISSING_LAST_UPDATE', severity: 'warning', category: 'task', sheet: 'Tasks',
      row: task.rowNumber, field: 'Last Update', itemLabel: task.itemLabel,
      message: 'Blocked task has no date from which to assess staleness.'
    });
    return;
  }
  if (!lastUpdate.valid || lastUpdate.millis > settings.todayMillis) return;
  var ageDays = Math.floor((settings.todayMillis - lastUpdate.millis) / 86400000);
  if (ageDays >= settings.staleBlockedDays) {
    integrityAddIssue_(collector, {
      code: 'STALE_BLOCKED_TASK', severity: 'warning', category: 'task', sheet: 'Tasks',
      row: task.rowNumber, field: 'Last Update', itemLabel: task.itemLabel,
      message: 'Blocked task has not been updated for at least ' + settings.staleBlockedDays + ' days.'
    });
  }
}

function integrityInspectUpdates_(table, tasks, projects, settings, collector) {
  integrityPopulatedRows_(table).forEach(function (row) {
    var itemLabel = 'Update row ' + row.rowNumber;
    var member = integrityString_(integrityValue_(table, row, 'member')).trim();
    var updateText = integrityString_(integrityValue_(table, row, 'update')).trim();
    var link = integrityString_(integrityValue_(table, row, 'link')).trim();
    if (!member) {
      integrityAddIssue_(collector, {
        code: 'MISSING_UPDATE_MEMBER', severity: 'warning', category: 'history', sheet: 'Updates',
        row: row.rowNumber, field: 'Member', itemLabel: itemLabel,
        message: 'Historical update is missing its student-facing member name.'
      });
    }
    if (!updateText) {
      integrityAddIssue_(collector, {
        code: 'MISSING_UPDATE_TEXT', severity: 'warning', category: 'history', sheet: 'Updates',
        row: row.rowNumber, field: 'Update', itemLabel: itemLabel,
        message: 'Historical update is missing its recorded update text.'
      });
    }
    if (link && !integrityValidHttpLink_(link)) {
      integrityAddIssue_(collector, {
        code: 'INVALID_UPDATE_LINK', severity: 'warning', category: 'history', sheet: 'Updates',
        row: row.rowNumber, field: 'Link', itemLabel: itemLabel,
        message: 'Non-empty Update Link is not a valid HTTP or HTTPS web link.'
      });
    }
    var timestamp = integrityDateState_(integrityValue_(table, row, 'timestamp', true));
    if (!timestamp.present) {
      integrityAddIssue_(collector, {
        code: 'MISSING_UPDATE_TIMESTAMP', severity: 'warning', category: 'history', sheet: 'Updates',
        row: row.rowNumber, field: 'Timestamp', itemLabel: itemLabel,
        message: 'Historical update is missing its timestamp.'
      });
    } else if (!timestamp.valid) {
      integrityAddIssue_(collector, {
        code: 'INVALID_UPDATE_TIMESTAMP', severity: 'warning', category: 'history', sheet: 'Updates',
        row: row.rowNumber, field: 'Timestamp', itemLabel: itemLabel,
        message: 'Historical update timestamp is not a real date or strict timestamp.'
      });
    } else if (timestamp.millis >= settings.todayMillis + 86400000) {
      integrityAddIssue_(collector, {
        code: 'FUTURE_UPDATE_TIMESTAMP', severity: 'warning', category: 'history', sheet: 'Updates',
        row: row.rowNumber, field: 'Timestamp', itemLabel: itemLabel,
        message: 'Historical update timestamp is later than the injected school-local audit date.'
      });
    }

    var reference = integrityString_(integrityValue_(table, row, 'taskProject')).trim();
    var taskMatches = integrityReferenceMatches_(reference, tasks);
    var projectMatches = integrityReferenceMatches_(reference, projects);
    var matchCount = taskMatches.length + projectMatches.length;
    if (!reference || matchCount === 0) {
      integrityAddIssue_(collector, {
        code: 'UNASSOCIATED_UPDATE_REFERENCE', severity: 'warning', category: 'history', sheet: 'Updates',
        row: row.rowNumber, field: 'Task / Project', itemLabel: itemLabel,
        message: 'Update does not match a current exact ID, canonical label, or unique legacy name; it may be historical.'
      });
    } else if (matchCount > 1) {
      integrityAddIssue_(collector, {
        code: 'AMBIGUOUS_UPDATE_REFERENCE', severity: 'warning', category: 'history', sheet: 'Updates',
        row: row.rowNumber, field: 'Task / Project', itemLabel: itemLabel,
        message: 'Update reference matches more than one current task or project; no association was inferred.'
      });
    }
  });
}

/**
 * Mirrors the browser's safe-link intent without resolving or fetching a URL.
 * A conventional bare public hostname is accepted because the client upgrades
 * it to HTTPS; otherwise an explicit HTTP(S) scheme is required.
 */
function integrityValidHttpLink_(value) {
  var candidate = integrityString_(value).trim();
  if (!candidate || /[\s\\<>"'\u0000-\u001f\u007f]/.test(candidate)) return false;
  if (!/^https?:\/\//i.test(candidate)) {
    if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?::\d{1,5})?(?:[/?#].*)?$/i.test(candidate)) {
      return false;
    }
    candidate = 'https://' + candidate;
  }

  var match = /^https?:\/\/([^/?#]+)(?:[/?#].*)?$/i.exec(candidate);
  if (!match || !match[1] || match[1].indexOf('@') >= 0) return false;
  var authority = match[1];
  var host = authority;
  var port = '';
  if (authority.charAt(0) === '[') {
    var closingBracket = authority.indexOf(']');
    if (closingBracket < 0) return false;
    host = authority.slice(1, closingBracket);
    var suffix = authority.slice(closingBracket + 1);
    if (suffix && !/^:\d{1,5}$/.test(suffix)) return false;
    port = suffix ? suffix.slice(1) : '';
    if (!host || host.indexOf(':') < 0 || !/^[0-9a-f:.]+$/i.test(host)) return false;
  } else {
    if ((authority.match(/:/g) || []).length > 1) return false;
    var colonIndex = authority.lastIndexOf(':');
    if (colonIndex >= 0) {
      host = authority.slice(0, colonIndex);
      port = authority.slice(colonIndex + 1);
      if (!/^\d{1,5}$/.test(port)) return false;
    }
    if (!integrityValidHttpHost_(host)) return false;
  }
  return !port || Number(port) <= 65535;
}

function integrityValidHttpHost_(host) {
  var cleanHost = integrityString_(host).toLowerCase();
  if (!cleanHost || cleanHost.length > 253) return false;
  if (cleanHost.charAt(cleanHost.length - 1) === '.') cleanHost = cleanHost.slice(0, -1);
  if (!cleanHost) return false;
  if (/^[0-9.]+$/.test(cleanHost)) {
    var octets = cleanHost.split('.');
    return octets.length === 4 && octets.every(function (octet) {
      return /^\d{1,3}$/.test(octet) && Number(octet) <= 255;
    });
  }
  return cleanHost.split('.').every(function (label) {
    return label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label);
  });
}

function integrityTaskStatus_(value) {
  var key = integrityNormalize_(value);
  var map = {
    open: 'Open', unclaimed: 'Open', todo: 'Open', notstarted: 'Open',
    doing: 'Doing', claimed: 'Doing', assigned: 'Doing', inprogress: 'Doing', started: 'Doing', active: 'Doing',
    blocked: 'Blocked', waiting: 'Blocked', waitingonschool: 'Blocked', onhold: 'Blocked',
    done: 'Done', complete: 'Done', completed: 'Done', closed: 'Done'
  };
  return { valid: !!map[key], status: map[key] || '' };
}

function integrityProjectStage_(value) {
  var key = integrityNormalize_(value);
  var map = {
    idea: 'Idea', concept: 'Idea', proposed: 'Idea',
    validation: 'Validation', validating: 'Validation', evaluation: 'Validation',
    schoolreview: 'School Review', proposalready: 'School Review', awaitingschoolreview: 'School Review', pendingapproval: 'School Review',
    active: 'Active', pilot: 'Active', implementation: 'Active', inprogress: 'Active',
    completed: 'Completed', complete: 'Completed', done: 'Completed', closed: 'Completed',
    paused: 'Paused', pause: 'Paused', onhold: 'Paused',
    rejected: 'Rejected', declined: 'Rejected', notpursuing: 'Rejected', cancelled: 'Rejected', canceled: 'Rejected'
  };
  return { valid: !!map[key], stage: map[key] || '' };
}

function integrityMemberReference_(value, members) {
  var emailKey = integrityNormalizeEmail_(value);
  var emailMatches = members.filter(function (member) {
    return !!emailKey && member.email === emailKey;
  });
  var matches = emailMatches.length ? emailMatches : members.filter(function (member) {
    return !!integrityNormalizeIdentity_(value) && member.displayKey === integrityNormalizeIdentity_(value);
  });
  return { count: matches.length, matches: matches };
}

function integrityStableMemberReference_(value, members) {
  var emailKey = integrityNormalizeEmail_(value);
  var matches = members.filter(function (member) {
    return !!emailKey && member.email === emailKey;
  });
  return { count: matches.length, matches: matches };
}

function integrityReferenceMatches_(value, records) {
  var reference = integrityNormalizeIdentity_(value);
  if (!reference) return [];
  var matches = records.filter(function (record) {
    return (record.idKey && reference === record.idKey) ||
      (record.label && reference === integrityNormalizeIdentity_(record.label));
  });
  if (!matches.length) {
    var colon = reference.indexOf(':');
    var prefix = colon > 0 ? reference.slice(0, colon).trim() : '';
    if (prefix) {
      matches = records.filter(function (record) { return record.idKey && record.idKey === prefix; });
    }
  }
  if (!matches.length) {
    matches = records.filter(function (record) { return record.nameKey && record.nameKey === reference; });
  }
  var seen = {};
  return matches.filter(function (record) {
    var key = '$' + record.rowNumber;
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  }).sort(function (left, right) { return left.rowNumber - right.rowNumber; });
}

function integrityMetricMatchCount_(value, metrics) {
  var key = integrityNormalizeIdentity_(value);
  if (!key) return 0;
  return metrics.filter(function (metric) { return metric.key === key; }).length;
}

function integrityStringList_(value) {
  var raw = Array.isArray(value) ? value : integrityString_(value).split(/[|;,\n]+/);
  var seen = {};
  var result = [];
  raw.forEach(function (item) {
    var clean = integrityString_(item).trim();
    var key = integrityNormalizeIdentity_(clean);
    if (!key || seen['$' + key]) return;
    seen['$' + key] = true;
    result.push(clean);
  });
  result.sort(function (left, right) {
    return integrityNormalizeIdentity_(left).localeCompare(integrityNormalizeIdentity_(right));
  });
  return result;
}

function integrityDateState_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') {
    var dateMillis = value.getTime();
    return { present: true, valid: !isNaN(dateMillis), millis: isNaN(dateMillis) ? null : dateMillis };
  }
  var text = integrityString_(value).trim();
  if (!text) return { present: false, valid: false, millis: null };
  var dayMillis = integrityCalendarDayMillis_(text);
  if (dayMillis !== null) return { present: true, valid: true, millis: dayMillis };
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(text)) {
    return { present: true, valid: false, millis: null };
  }
  var millis = new Date(text).getTime();
  return { present: true, valid: !isNaN(millis), millis: isNaN(millis) ? null : millis };
}

function integrityCalendarDayMillis_(value) {
  var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(integrityString_(value));
  if (!match) return null;
  var year = Number(match[1]);
  var month = Number(match[2]);
  var day = Number(match[3]);
  var millis = Date.UTC(year, month - 1, day);
  var date = new Date(millis);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return millis;
}

function integrityValue_(table, row, field, preferRaw) {
  var index = table.fieldIndexes[field];
  if (index >= 0 && row.values) {
    var values = preferRaw && row.rawValues ? row.rawValues : row.values;
    return index < values.length ? values[index] : '';
  }
  var object = row.object;
  if (!object) return '';
  var aliases = [field].concat(table.fields[field] || []);
  for (var indexKey = 0; indexKey < aliases.length; indexKey += 1) {
    if (Object.prototype.hasOwnProperty.call(object, aliases[indexKey])) return object[aliases[indexKey]];
  }
  var properties = Object.keys(object);
  var aliasKeys = aliases.map(integrityNormalize_);
  for (var propertyIndex = 0; propertyIndex < properties.length; propertyIndex += 1) {
    if (aliasKeys.indexOf(integrityNormalize_(properties[propertyIndex])) >= 0) {
      return object[properties[propertyIndex]];
    }
  }
  return '';
}

function integrityPopulatedRows_(table) {
  return table.rows.filter(function (row) {
    if (row.values) {
      return row.values.some(function (value) { return integrityHasValue_(value); });
    }
    return Object.keys(row.object || {}).some(function (key) {
      return key !== 'rowNumber' && integrityHasValue_(row.object[key]);
    });
  });
}

function integrityHasValue_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') return true;
  if (Array.isArray(value)) return value.some(integrityHasValue_);
  return value !== null && typeof value !== 'undefined' && integrityString_(value).trim() !== '';
}

function integrityReportDuplicateRecords_(records, keyFunction, issueFunction, collector) {
  var groups = {};
  records.forEach(function (record) {
    var key = integrityString_(keyFunction(record));
    if (!key) return;
    var safeKey = '$' + key;
    if (!groups[safeKey]) groups[safeKey] = [];
    groups[safeKey].push(record);
  });
  Object.keys(groups).sort().forEach(function (key) {
    if (groups[key].length < 2) return;
    groups[key].slice().sort(function (left, right) {
      return left.rowNumber - right.rowNumber;
    }).forEach(function (record) {
      integrityAddIssue_(collector, issueFunction(record));
    });
  });
}

function integrityCollector_(limit) {
  return {
    limit: limit,
    total: 0,
    issues: [],
    byCode: {},
    bySeverity: {},
    byCategory: {},
    bySheet: {}
  };
}

function integrityAddIssue_(collector, issue) {
  var clean = {
    code: integrityPrivacyText_(issue.code, 80),
    severity: integrityPrivacyText_(issue.severity, 20),
    category: integrityPrivacyText_(issue.category, 40),
    sheet: integrityPrivacyText_(issue.sheet, 40),
    row: integrityPositiveRow_(issue.row, 1),
    field: integrityPrivacyText_(issue.field, 80),
    itemLabel: integrityPrivacyText_(issue.itemLabel, 140),
    message: integrityPrivacyText_(issue.message, 300)
  };
  collector.total += 1;
  integrityIncrement_(collector.byCode, clean.code);
  integrityIncrement_(collector.bySeverity, clean.severity);
  integrityIncrement_(collector.byCategory, clean.category);
  integrityIncrement_(collector.bySheet, clean.sheet);
  if (!collector.limit) return;
  collector.issues.push(clean);
  collector.issues.sort(integrityIssueSort_);
  if (collector.issues.length > collector.limit) collector.issues.pop();
}

function integrityIncrement_(counts, key) {
  var safeKey = integrityString_(key) || 'unknown';
  counts[safeKey] = (counts[safeKey] || 0) + 1;
}

function integrityIssueSort_(left, right) {
  var severity = { error: 0, warning: 1, info: 2 };
  var leftSeverity = typeof severity[left.severity] === 'number' ? severity[left.severity] : 9;
  var rightSeverity = typeof severity[right.severity] === 'number' ? severity[right.severity] : 9;
  if (leftSeverity !== rightSeverity) return leftSeverity - rightSeverity;
  var fields = ['sheet', 'row', 'field', 'code', 'itemLabel', 'message'];
  for (var index = 0; index < fields.length; index += 1) {
    var field = fields[index];
    if (field === 'row' && left.row !== right.row) return left.row - right.row;
    var leftValue = integrityString_(left[field]);
    var rightValue = integrityString_(right[field]);
    if (leftValue !== rightValue) return leftValue < rightValue ? -1 : 1;
  }
  return 0;
}

function integrityFinalizeReport_(collector, settings) {
  var omitted = Math.max(0, collector.total - collector.issues.length);
  return {
    schemaVersion: 'start-integrity-report/v1',
    asOfDate: settings.today,
    summary: {
      totalIssues: collector.total,
      detailIssues: collector.issues.length,
      omittedIssues: omitted,
      bySeverity: integritySortedCounts_(collector.bySeverity),
      byCategory: integritySortedCounts_(collector.byCategory),
      bySheet: integritySortedCounts_(collector.bySheet)
    },
    countsByCode: integritySortedCounts_(collector.byCode),
    issues: collector.issues.slice(),
    limits: {
      issueDetails: settings.issueLimit,
      staleBlockedDays: settings.staleBlockedDays
    },
    omissions: {
      issueDetails: omitted
    },
    truncated: omitted > 0
  };
}

function integritySortedCounts_(counts) {
  var result = {};
  Object.keys(counts).sort().forEach(function (key) { result[key] = counts[key]; });
  return result;
}

function integrityItemLabel_(type, id, name, rowNumber) {
  var safeId = integrityPrivacyText_(id, 80);
  var safeName = integrityPrivacyText_(name, 100);
  if (safeId && safeName) return type + ' ' + safeId + ': ' + safeName;
  if (safeId || safeName) return type + ' ' + (safeId || safeName);
  return type + ' row ' + rowNumber;
}

function integrityPrivacyText_(value, maximum) {
  var text = integrityString_(value)
    .replace(/[^\s@]+@[^\s@]+/g, '[member]')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > maximum ? text.slice(0, maximum) : text;
}

function integrityNormalize_(value) {
  return integrityString_(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function integrityNormalizeIdentity_(value) {
  return integrityString_(value).trim().toLowerCase().replace(/\s+/g, ' ');
}

function integrityNormalizeEmail_(value) {
  return integrityString_(value).trim().toLowerCase();
}

function integrityString_(value) {
  return value === null || typeof value === 'undefined' ? '' : String(value);
}
