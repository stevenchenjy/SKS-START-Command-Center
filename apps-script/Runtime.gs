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
    var spreadsheet = SpreadsheetApp.openById(getConfiguredSpreadsheetId_());
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
