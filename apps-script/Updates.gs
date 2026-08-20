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
