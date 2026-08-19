/**
 * SKS START Command Center - Google Apps Script server.
 *
 * The web app opens the existing workbook by ID because container-bound
 * "active spreadsheet" methods are not reliable from a deployed web app.
 */

var START_SPREADSHEET_ID = '1XFTIrKIcckrwavS-tJ5E_fReKVR3BlLtsbLUXRhto6I';
var START_STATUSES = ['Open', 'Claimed', 'In Progress', 'Waiting', 'Done'];

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
  resultsLink: ['Results Link', 'Result Link', 'Link', 'URL']
};

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

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('START Command Center')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function getDashboardData(memberName) {
  return buildDashboardData_(getSpreadsheet_(), memberName);
}

function claimTask(taskKey, memberName) {
  return withMutationLock_(function () {
    var spreadsheet = getSpreadsheet_();
    var member = resolveMutationMember_(spreadsheet, memberName);
    var tasksTable = readTable_(spreadsheet, 'Tasks');
    var updatesTable = readTable_(spreadsheet, 'Updates');
    var taskRow = findTaskRow_(tasksTable, taskKey);
    var taskColumns = taskColumnsForWrite_(tasksTable, false);
    var currentStatus = normalizeReadStatus_(cell_(taskRow.values, taskColumns.status));
    var currentOwner = cell_(taskRow.values, taskColumns.claimedBy).trim();

    assertUpdateColumns_(updatesTable);

    if (currentStatus !== 'Open') {
      fail_('This task is no longer open; its current status is "' + currentStatus + '". Refresh the dashboard and try again.');
    }
    if (currentOwner) {
      fail_('This task is already assigned to ' + currentOwner + '. Refresh the dashboard to see the latest owner.');
    }

    var now = new Date();
    setCells_(tasksTable.sheet, taskRow.rowNumber, [
      { column: taskColumns.status, value: 'Claimed' },
      { column: taskColumns.claimedBy, value: literalSheetText_(member) },
      { column: taskColumns.lastUpdate, value: now }
    ]);

    appendUpdate_(updatesTable, {
      timestamp: now,
      member: member,
      taskProject: taskLabel_(taskRow.values, taskColumns, taskKey),
      update: 'Claimed task',
      blocker: '',
      nextStep: '',
      link: cell_(taskRow.values, taskColumns.supportingLink)
    });

    flush_();
    return buildDashboardData_(spreadsheet, member);
  });
}

function updateTask(taskKey, memberName, status, updateText, blocker) {
  return withMutationLock_(function () {
    var spreadsheet = getSpreadsheet_();
    var member = resolveMutationMember_(spreadsheet, memberName);
    var nextStatus = validateStatus_(status);
    var progress = validateText_(updateText, 'Update', 1000, false);
    var blockerText = validateText_(blocker, 'Blocker', 500, false);
    var tasksTable = readTable_(spreadsheet, 'Tasks');
    var updatesTable = readTable_(spreadsheet, 'Updates');
    var taskRow = findTaskRow_(tasksTable, taskKey);
    var taskColumns = taskColumnsForWrite_(tasksTable, true);
    var currentOwner = cell_(taskRow.values, taskColumns.claimedBy).trim();
    var currentBlocker = cell_(taskRow.values, taskColumns.blocker).trim();

    assertUpdateColumns_(updatesTable);

    if (!currentOwner) {
      fail_('This task has not been claimed. Claim it before posting an update.');
    }
    if (!sameIdentity_(currentOwner, member)) {
      fail_('Only ' + currentOwner + ', the member who claimed this task, can update it.');
    }

    var now = new Date();
    var effectiveBlocker = nextStatus === 'Done' || nextStatus === 'Open'
      ? ''
      : blockerText || currentBlocker;
    setCells_(tasksTable.sheet, taskRow.rowNumber, [
      { column: taskColumns.status, value: nextStatus },
      { column: taskColumns.claimedBy, value: nextStatus === 'Open' ? '' : literalSheetText_(member) },
      { column: taskColumns.lastUpdate, value: now },
      { column: taskColumns.blocker, value: literalSheetText_(effectiveBlocker) }
    ]);

    appendUpdate_(updatesTable, {
      timestamp: now,
      member: member,
      taskProject: taskLabel_(taskRow.values, taskColumns, taskKey),
      update: progress || 'Status changed to ' + nextStatus,
      blocker: effectiveBlocker,
      nextStep: '',
      link: cell_(taskRow.values, taskColumns.supportingLink)
    });

    flush_();
    return buildDashboardData_(spreadsheet, member);
  });
}

function buildDashboardData_(spreadsheet, requestedMember) {
  var settingsTable = readTable_(spreadsheet, 'Settings');
  var members = readMembers_(settingsTable);
  var viewer = resolveViewer_(requestedMember, members);

  var tasks = mapTasks_(readTable_(spreadsheet, 'Tasks'), viewer.identity);
  var projects = mapProjects_(readTable_(spreadsheet, 'Projects'));
  var updates = mapUpdates_(readTable_(spreadsheet, 'Updates'));
  var recentUpdates = updates.slice(0, 20);

  return {
    viewer: viewer,
    members: members,
    tasks: tasks,
    projects: projects,
    updates: recentUpdates,
    summary: summarize_(tasks, projects, recentUpdates),
    generatedAt: new Date().toISOString()
  };
}

function mapTasks_(table, viewerIdentity) {
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
      lastUpdate: cell_(row.values, columns.lastUpdate),
      blocker: cell_(row.values, columns.blocker),
      supportingLink: cell_(row.values, columns.supportingLink),
      isOpen: status === 'Open' && !claimedBy,
      isMine: !!viewerIdentity && sameIdentity_(claimedBy, viewerIdentity)
    };
  });
}

function mapProjects_(table) {
  if (!table.headers.length) return [];

  var columns = indexes_(table, PROJECT_FIELDS);
  requireColumn_(columns.projectName, 'Project Name', 'Projects');
  requireColumn_(columns.stage, 'Stage', 'Projects');

  return table.rows.filter(function (row) {
    return hasContent_(row.values);
  }).map(function (row) {
    var stage = cell_(row.values, columns.stage);
    var localFeasibility = cell_(row.values, columns.localFeasibility);
    var recommendation = cell_(row.values, columns.recommendation);
    var isActive = isActiveProjectStage_(stage);
    return {
      projectId: cell_(row.values, columns.projectId),
      projectName: cell_(row.values, columns.projectName),
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
      projectLead: cell_(row.values, columns.projectLead),
      resultsLink: cell_(row.values, columns.resultsLink),
      isActive: isActive,
      isWaitingOnSchool: isActive && isProjectWaitingOnSchool_(stage, localFeasibility, recommendation)
    };
  });
}

function mapUpdates_(table) {
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
    return {
      timestamp: cell_(row.values, columns.timestamp),
      member: cell_(row.values, columns.member),
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

  tasks.forEach(function (task) {
    if (task.status === 'Open' && !task.claimedBy) openTasks += 1;
    if (task.claimedBy && task.status !== 'Done') claimedTasks += 1;
    if (task.isMine && task.status !== 'Done') myTasks += 1;
  });

  var activeProjects = projects.filter(function (project) {
    return project.isActive;
  }).length;
  var waitingItems = buildWaitingItems_(tasks, projects);

  return {
    openTasks: openTasks,
    claimedTasks: claimedTasks,
    myTasks: myTasks,
    activeProjects: activeProjects,
    waitingOnSchool: waitingItems.length,
    waitingItems: waitingItems,
    recentUpdates: updates.length
  };
}

function buildWaitingItems_(tasks, projects) {
  var taskItems = tasks.filter(function (task) {
    return task.status === 'Waiting';
  }).map(function (task) {
    return {
      key: 'task:' + task.taskKey,
      title: task.task,
      detail: task.blocker || 'Task is marked Waiting',
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

function readMembers_(table) {
  if (!table.headers.length) return [];

  var columns = indexes_(table, SETTINGS_FIELDS);
  requireColumn_(columns.setting, 'Setting', 'Settings');
  requireColumn_(columns.value, 'Value', 'Settings');
  var members = [];

  table.rows.forEach(function (row) {
    var setting = cell_(row.values, columns.setting).trim();
    var value = cell_(row.values, columns.value).trim();
    var key = normalizeHeader_(setting);
    var isMemberList = key === 'member' || key === 'members' ||
      key === 'committeemember' || key === 'committeemembers';
    var isRole = /(lead|chair|advisor|coordinator|secretary|treasurer|liaison|sponsor|representative|steward)$/.test(key);

    if (value && (isMemberList || isRole)) {
      value.split(/[|,;\n]+/).forEach(function (name) {
        addUnique_(members, name);
      });
    }
  });

  return members;
}

function resolveViewer_(requestedMember, members) {
  var email = activeUserEmail_();
  var selected = '';

  if (!email) {
    selected = validateText_(requestedMember, 'Member name', 120, false);
    if (/[\r\n]/.test(selected)) fail_('Member name must be a single line.');
    selected = findConfiguredMember_(selected, members);
  }

  return {
    email: email,
    identity: email || selected,
    authMode: email ? 'google' : 'settings_selector'
  };
}

function resolveMutationMember_(spreadsheet, requestedMember) {
  var email = activeUserEmail_();
  if (email) return email;

  var member = validateText_(requestedMember, 'Member name', 120, true);
  if (/[\r\n]/.test(member)) fail_('Member name must be a single line.');
  var configured = findConfiguredMember_(member, readMembers_(readTable_(spreadsheet, 'Settings')));
  if (!configured) {
    fail_('Choose a committee member listed in Settings before changing tasks.');
  }
  return configured;
}

function activeUserEmail_() {
  try {
    var email = Session.getActiveUser().getEmail();
    return string_(email).trim();
  } catch (error) {
    return '';
  }
}

function findConfiguredMember_(member, members) {
  var normalized = normalizeIdentity_(member);
  if (!normalized) return '';
  for (var index = 0; index < members.length; index += 1) {
    if (normalizeIdentity_(members[index]) === normalized) return members[index];
  }
  return '';
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
  if (key === 'claimed' || key === 'assigned') return 'Claimed';
  if (key === 'inprogress' || key === 'started' || key === 'active') return 'In Progress';
  if (key === 'waiting' || key === 'waitingonschool' || key === 'blocked' || key === 'onhold') return 'Waiting';
  if (key === 'done' || key === 'complete' || key === 'completed' || key === 'closed') return 'Done';
  return string_(value).trim();
}

function validateStatus_(value) {
  var key = normalizeHeader_(value);
  var allowed = {
    open: 'Open',
    claimed: 'Claimed',
    inprogress: 'In Progress',
    waiting: 'Waiting',
    done: 'Done'
  };
  if (!allowed[key]) {
    fail_('Unsupported task status. Use one of: ' + START_STATUSES.join(', ') + '.');
  }
  return allowed[key];
}

function isActiveProjectStage_(stage) {
  return !/\b(done|complete|completed|closed|cancelled|canceled|archived|paused|rejected)\b|not pursuing/i.test(string_(stage));
}

function isProjectWaitingOnSchool_(stage, localFeasibility, recommendation) {
  return /school review|waiting|awaiting|pending/i.test(string_(stage)) ||
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
