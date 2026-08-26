function appendMissingProjectWorkflowHeaders_(projectsTable) {
  if (!projectsTable.headers.length) {
    fail_('The Projects sheet is empty and has no header row. Restore its existing headers before setup.');
  }
  var missing = PROJECT_WORKFLOW_HEADERS.filter(function (header) {
    return columnIndex_(projectsTable, PROJECT_FIELDS[header.field]) < 0;
  }).map(function (header) {
    return header.canonical;
  });
  if (!missing.length) return [];

  var firstNewColumn = projectsTable.headers.length + 1;
  ensureSheetCapacity_(projectsTable.sheet, firstNewColumn + missing.length - 1);
  projectsTable.sheet.getRange(1, firstNewColumn, 1, missing.length).setValues([missing]);
  return missing;
}

function ensureSheetCapacity_(sheet, requiredColumns) {
  if (typeof sheet.getMaxColumns !== 'function' || typeof sheet.insertColumnsAfter !== 'function') return;
  var currentColumns = sheet.getMaxColumns();
  if (currentColumns < requiredColumns) {
    sheet.insertColumnsAfter(currentColumns, requiredColumns - currentColumns);
  }
}

function setProjectStageOptions_(settingsTable) {
  if (!settingsTable.headers.length) {
    fail_('The Settings sheet is empty and has no header row.');
  }
  var columns = indexes_(settingsTable, SETTINGS_FIELDS);
  requireColumn_(columns.setting, 'Setting', 'Settings');
  requireColumn_(columns.value, 'Value', 'Settings');
  var matches = settingsTable.rows.filter(function (row) {
    return normalizeHeader_(cell_(row.values, columns.setting)) === 'projectstageoptions';
  });
  if (matches.length > 1) {
    fail_('Project Stage Options appears more than once in Settings. Keep one row before running setup.');
  }
  if (matches.length === 1) {
    var current = cell_(matches[0].values, columns.value).trim();
    if (current === PROJECT_STAGE_OPTIONS) return false;
    settingsTable.sheet.getRange(matches[0].rowNumber, columns.value + 1).setValue(PROJECT_STAGE_OPTIONS);
    return true;
  }

  var row = settingsTable.headers.map(function () { return ''; });
  row[columns.setting] = 'Project Stage Options';
  row[columns.value] = PROJECT_STAGE_OPTIONS;
  if (columns.notes >= 0) row[columns.notes] = 'Canonical project workflow stages';
  settingsTable.sheet.getRange(settingsTable.sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
  return true;
}

function ensureMembersSheet_(spreadsheet) {
  var requiredHeaders = [
    { canonical: 'Email', aliases: MEMBER_FIELDS.email },
    { canonical: 'Display Name', aliases: MEMBER_FIELDS.displayName },
    { canonical: 'Active', aliases: MEMBER_FIELDS.active }
  ];
  var sheet = spreadsheet.getSheetByName('Members');
  var created = false;
  if (!sheet) {
    sheet = spreadsheet.insertSheet('Members');
    created = true;
  }

  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();
  var existingHeaders = [];
  if (lastRow >= 1 && lastColumn >= 1) {
    var headerRange = sheet.getRange(1, 1, 1, lastColumn);
    existingHeaders = (typeof headerRange.getDisplayValues === 'function'
      ? headerRange.getDisplayValues()
      : headerRange.getValues())[0].map(string_);
  }
  var normalized = existingHeaders.map(normalizeHeader_);
  var missing = requiredHeaders.filter(function (header) {
    return !header.aliases.some(function (alias) {
      return normalized.indexOf(normalizeHeader_(alias)) >= 0;
    });
  }).map(function (header) {
    return header.canonical;
  });

  if (missing.length) {
    sheet.getRange(1, existingHeaders.length + 1, 1, missing.length).setValues([missing]);
  }
  if (typeof sheet.setFrozenRows === 'function') sheet.setFrozenRows(1);

  return {
    sheetName: 'Members',
    created: created,
    addedHeaders: missing,
    message: missing.length ? 'Members headers are ready.' : 'Members sheet was already ready.'
  };
}
