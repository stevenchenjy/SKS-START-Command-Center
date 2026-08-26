function mutateTask_(taskKey, profileKey, action, input) {
  return withMutationLock_(function () {
    var spreadsheet = getSpreadsheet_();
    var member = resolveMutationMember_(spreadsheet, profileKey);
    var tasksTable = readTable_(spreadsheet, 'Tasks');
    var updatesTable = readTable_(spreadsheet, 'Updates');
    var taskRow = findTaskRow_(tasksTable, taskKey);
    var needsBlocker = action === 'block' || action === 'resume' || action === 'done' ||
      action === 'release' || action === 'legacy_update';
    var taskColumns = taskColumnsForWrite_(tasksTable, needsBlocker);
    var currentStatus = normalizeReadStatus_(cell_(taskRow.values, taskColumns.status));
    var currentOwner = cell_(taskRow.values, taskColumns.claimedBy).trim();
    var currentBlocker = cell_(taskRow.values, taskColumns.blocker).trim();
    var nextStatus = currentStatus;
    var nextOwner = memberStorageKey_(member);
    var nextBlocker = currentBlocker;
    var updateText = '';
    var historyBlocker = '';

    assertUpdateColumns_(updatesTable);

    if (action === 'claim') {
      if (currentStatus !== 'Open') {
        fail_('This task is no longer open; its current status is "' + currentStatus + '". Refresh the dashboard and try again.');
      }
      if (currentOwner) {
        fail_('This task is already assigned to ' + ownerDisplayName_(currentOwner, readMemberDirectory_(spreadsheet).all) + '. Refresh the dashboard to see the latest owner.');
      }
      nextStatus = 'Doing';
      nextBlocker = '';
      updateText = 'Claimed task';
    } else {
      assertTaskOwner_(currentOwner, member, spreadsheet);

      if (action === 'add_update') {
        assertWorkingStatus_(currentStatus, ['Doing', 'Blocked'], 'add an update to');
        updateText = validateText_(input, 'Update', 1000, true);
      } else if (action === 'block') {
        assertWorkingStatus_(currentStatus, ['Doing'], 'mark');
        nextStatus = 'Blocked';
        nextBlocker = validateText_(input, 'Blocker', 500, true);
        updateText = 'Marked blocked';
        historyBlocker = nextBlocker;
      } else if (action === 'resume') {
        assertWorkingStatus_(currentStatus, ['Blocked'], 'resume');
        nextStatus = 'Doing';
        nextBlocker = '';
        updateText = 'Resumed work';
        historyBlocker = currentBlocker;
      } else if (action === 'done') {
        assertWorkingStatus_(currentStatus, ['Doing', 'Blocked'], 'complete');
        nextStatus = 'Done';
        nextBlocker = '';
        updateText = 'Marked done';
        historyBlocker = currentBlocker;
      } else if (action === 'release') {
        assertWorkingStatus_(currentStatus, ['Doing', 'Blocked'], 'release');
        nextStatus = 'Open';
        nextOwner = '';
        nextBlocker = '';
        updateText = currentStatus === 'Blocked' ? 'Released blocked task' : 'Released task';
        historyBlocker = currentBlocker;
      } else if (action === 'legacy_update') {
        var legacy = input || {};
        nextStatus = validateStatus_(legacy.status);
        assertLegacyTaskTransition_(currentStatus, nextStatus);
        updateText = validateText_(legacy.updateText, 'Update', 1000, false) || 'Status changed to ' + nextStatus;
        if (nextStatus === 'Blocked') {
          nextBlocker = validateText_(legacy.blocker, 'Blocker', 500, true);
          historyBlocker = nextBlocker;
        } else if (nextStatus === 'Open') {
          nextOwner = '';
          nextBlocker = '';
          historyBlocker = currentBlocker;
        } else if (nextStatus === 'Doing' && currentStatus === 'Blocked') {
          nextBlocker = '';
          historyBlocker = currentBlocker;
        } else if (nextStatus === 'Done') {
          nextBlocker = '';
          historyBlocker = currentBlocker;
        }
      } else {
        fail_('Unsupported task action.');
      }
    }

    var now = new Date();
    var changes = [
      { column: taskColumns.status, value: nextStatus },
      { column: taskColumns.claimedBy, value: literalSheetText_(nextOwner) },
      { column: taskColumns.lastUpdate, value: now }
    ];
    if (taskColumns.blocker >= 0 && (needsBlocker || action === 'claim')) {
      changes.push({ column: taskColumns.blocker, value: literalSheetText_(nextBlocker) });
    }
    setCells_(tasksTable.sheet, taskRow.rowNumber, changes);

    appendUpdate_(updatesTable, {
      timestamp: now,
      member: member.displayName,
      taskProject: taskLabel_(taskRow.values, taskColumns, taskKey),
      update: updateText,
      blocker: historyBlocker,
      nextStep: '',
      link: cell_(taskRow.values, taskColumns.supportingLink)
    });

    flush_();
    return buildDashboardData_(spreadsheet, member.profileKey);
  });
}

function assertTaskOwner_(storedOwner, member, spreadsheet) {
  if (!storedOwner) {
    fail_('This task is not owned. Claim it before changing it.');
  }
  var directory = readMemberDirectory_(spreadsheet);
  if (!memberMatchesIdentity_(storedOwner, member, directory.all)) {
    fail_('Only ' + ownerDisplayName_(storedOwner, directory.all) + ', the member who owns this task, can change it.');
  }
}

function assertWorkingStatus_(status, allowed, verb) {
  if (allowed.indexOf(status) < 0) {
    fail_('You cannot ' + verb + ' a task while it is ' + status + '. Refresh the dashboard and try again.');
  }
}

function assertLegacyTaskTransition_(currentStatus, nextStatus) {
  var allowed = {
    Doing: ['Open', 'Doing', 'Blocked', 'Done'],
    Blocked: ['Open', 'Doing', 'Blocked', 'Done']
  };
  if (!allowed[currentStatus] || allowed[currentStatus].indexOf(nextStatus) < 0) {
    fail_('You cannot change a task from ' + currentStatus + ' to ' + nextStatus + '. Refresh the dashboard and use the action shown for its current state.');
  }
}

function taskCreationColumns_(table) {
  var columns = indexes_(table, TASK_FIELDS);
  [
    ['taskId', 'Task ID'], ['task', 'Task'], ['relatedProject', 'Related Project'],
    ['relatedMetric', 'Related Metric'], ['interestTag', 'Interest Tag'],
    ['estimatedTime', 'Estimated Time'], ['dueDate', 'Due Date'], ['status', 'Status'],
    ['claimedBy', 'Claimed By'], ['lastUpdate', 'Last Update'], ['blocker', 'Blocker'],
    ['supportingLink', 'Supporting Link']
  ].forEach(function (field) {
    requireColumn_(columns[field[0]], field[1], 'Tasks');
  });
  return columns;
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
