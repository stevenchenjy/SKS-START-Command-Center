function generateUniqueId_(prefix, table, idColumn) {
  requireColumn_(idColumn, prefix === 'PRJ' ? 'Project ID' : 'Task ID', prefix === 'PRJ' ? 'Projects' : 'Tasks');
  var now = new Date();
  var datePart = now.getUTCFullYear() + padNumber_(now.getUTCMonth() + 1, 2) + padNumber_(now.getUTCDate(), 2);
  var base = prefix + '-' + datePart + '-';
  var used = {};
  var maximum = 0;
  table.rows.forEach(function (row) {
    var id = cell_(row.values, idColumn).trim();
    if (!id) return;
    used[normalizeIdentity_(id)] = true;
    var match = new RegExp('^' + prefix + '-' + datePart + '-(\\d+)$', 'i').exec(id);
    if (match) maximum = Math.max(maximum, parseInt(match[1], 10));
  });
  var sequence = maximum + 1;
  var candidate = base + padNumber_(sequence, 3);
  while (used[normalizeIdentity_(candidate)]) {
    sequence += 1;
    candidate = base + padNumber_(sequence, 3);
  }
  return candidate;
}

function padNumber_(value, width) {
  var text = String(value);
  while (text.length < width) text = '0' + text;
  return text;
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
  if (key === 'doing' || key === 'claimed' || key === 'assigned' || key === 'inprogress' || key === 'started' || key === 'active') return 'Doing';
  if (key === 'blocked' || key === 'waiting' || key === 'waitingonschool' || key === 'onhold') return 'Blocked';
  if (key === 'done' || key === 'complete' || key === 'completed' || key === 'closed') return 'Done';
  return string_(value).trim();
}

function validateStatus_(value) {
  var key = normalizeHeader_(value);
  var allowed = {
    open: 'Open',
    doing: 'Doing',
    claimed: 'Doing',
    inprogress: 'Doing',
    blocked: 'Blocked',
    waiting: 'Blocked',
    done: 'Done'
  };
  if (!allowed[key]) {
    fail_('Unsupported task status. Use one of: ' + START_STATUSES.join(', ') + '.');
  }
  return allowed[key];
}

function normalizeReadProjectStage_(value) {
  var key = normalizeHeader_(value);
  if (!key || key === 'idea' || key === 'concept' || key === 'proposed') return 'Idea';
  if (key === 'validation' || key === 'validating' || key === 'evaluation') return 'Validation';
  if (key === 'schoolreview' || key === 'proposalready' || key === 'awaitingschoolreview' || key === 'pendingapproval') return 'School Review';
  if (key === 'active' || key === 'pilot' || key === 'implementation' || key === 'inprogress') return 'Active';
  if (key === 'completed' || key === 'complete' || key === 'done' || key === 'closed') return 'Completed';
  if (key === 'paused' || key === 'pause' || key === 'onhold') return 'Paused';
  if (key === 'rejected' || key === 'declined' || key === 'notpursuing' || key === 'cancelled' || key === 'canceled') return 'Rejected';
  return string_(value).trim();
}

function projectWorkflowState_(projectsTable, settingsTable) {
  var missingHeaders = PROJECT_WORKFLOW_HEADERS.filter(function (header) {
    return columnIndex_(projectsTable, PROJECT_FIELDS[header.field]) < 0;
  }).map(function (header) {
    return header.canonical;
  });
  var stageOptions = '';
  if (settingsTable.headers.length) {
    var columns = indexes_(settingsTable, SETTINGS_FIELDS);
    if (columns.setting >= 0 && columns.value >= 0) {
      settingsTable.rows.some(function (row) {
        if (normalizeHeader_(cell_(row.values, columns.setting)) !== 'projectstageoptions') return false;
        stageOptions = cell_(row.values, columns.value).trim();
        return true;
      });
    }
  }
  var stageOptionsCurrent = stageOptions === PROJECT_STAGE_OPTIONS;
  return {
    missingHeaders: missingHeaders,
    stageOptions: stageOptions,
    requiredStageOptions: PROJECT_STAGE_OPTIONS,
    stageOptionsCurrent: stageOptionsCurrent,
    setupNeeded: missingHeaders.length > 0 || !stageOptionsCurrent
  };
}

function normalizedOptionList_(value) {
  return string_(value).split('|').map(function (item) {
    return normalizeHeader_(item);
  }).filter(function (item) {
    return !!item;
  }).join('|');
}

function isActiveProjectStage_(stage) {
  return normalizeReadProjectStage_(stage) === 'Active';
}

function isProjectWaitingOnSchool_(stage, localFeasibility, recommendation) {
  return normalizeReadProjectStage_(stage) === 'School Review' ||
    /needs conversation|blocked/i.test(string_(localFeasibility)) ||
    /needs school decision/i.test(string_(recommendation));
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
