function getAdminData_() {
  var spreadsheet = getSpreadsheet_();
  var admin = requireAdmin_(spreadsheet);
  return buildAdminData_(spreadsheet, admin);
}

function buildAdminData_(spreadsheet, admin) {
  var directory;
  try {
    directory = readMemberDirectory_(spreadsheet);
  } catch (error) {
    directory = { all: [], active: [], source: 'unavailable' };
  }
  var memberProfiles = directory.source === 'members' ? directory.all : [];
  var emailCounts = {};
  memberProfiles.forEach(function (profile) {
    var email = normalizeEmail_(profile.email);
    if (email) emailCounts[email] = (emailCounts[email] || 0) + 1;
  });
  var generatedNow = new Date();
  var today = dashboardMachineDateOnly_(generatedNow);
  var schema = inspectStartSchema_(spreadsheet);
  var features = getFeatureFlags_();

  return {
    authorization: {
      canAdmin: true,
      isDeploymentOwner: !!admin.isOwner,
      displayName: admin.member ? admin.member.displayName : 'Deployment owner'
    },
    members: memberProfiles.map(function (profile) {
      var email = normalizeEmail_(profile.email);
      return {
        email: email,
        displayName: profile.displayName,
        active: !!profile.active,
        duplicateEmail: !!email && emailCounts[email] > 1
      };
    }),
    schema: schema,
    integrity: buildDataIntegrityReport_(spreadsheet, today, {
      issueLimit: 200,
      staleBlockedDays: 14
    }),
    runtime: {
      webVersion: START_WEB_VERSION,
      webBuild: START_WEB_BUILD,
      generatedAt: generatedNow.toISOString(),
      sourceOfTruth: 'Google Sheets',
      executionMode: 'deployment_owner',
      operationalAccess: 'exact_active_member_session_identity'
    },
    configuration: {
      schemaReady: !!schema.ready,
      membersReady: directory.source === 'members',
      coordinatorAllowlistConfigured: getConfiguredCoordinatorEmails_().length > 0
    },
    taskRecovery: buildStrandedTaskRecoveryData_(spreadsheet, directory),
    features: features
  };
}

function saveMemberProfile_(input) {
  return withMutationLock_(function () {
    var spreadsheet = getSpreadsheet_();
    var admin = requireAdmin_(spreadsheet);
    var member = objectInput_(input, 'Member');
    var email = validateMemberEmail_(member.email);
    var displayName = singleLineText_(member.displayName, 'Display name', 120, true);
    var requestedActive = hasOwn_(member, 'active')
      ? strictBoolean_(member.active, 'Active')
      : null;
    ensureMembersSheet_(spreadsheet);
    var table = readTable_(spreadsheet, 'Members');
    var columns = memberAdminColumns_(table);
    var matches = memberRowsByEmail_(table, columns, email);
    if (matches.length > 1) {
      fail_('That email appears more than once in Members. Remove the duplicate before updating it.');
    }

    if (memberIdentityNamespaceConflict_(table, columns, email, displayName)) {
      fail_('Member emails and display names must be unique and cannot match one another.');
    }

    if (matches.length === 1) {
      var changes = [
        { column: columns.displayName, value: literalSheetText_(displayName) }
      ];
      if (hasOwn_(member, 'active')) {
        changes.push({ column: columns.active, value: requestedActive });
      }
      setCells_(table.sheet, matches[0].rowNumber, changes);
    } else {
      var row = table.headers.map(function () { return ''; });
      row[columns.email] = literalSheetText_(email);
      row[columns.displayName] = literalSheetText_(displayName);
      row[columns.active] = hasOwn_(member, 'active')
        ? requestedActive
        : false;
      table.sheet.getRange(table.sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
    }

    flush_();
    return buildAdminData_(spreadsheet, admin);
  });
}

function setMemberActive_(emailValue, activeValue) {
  return withMutationLock_(function () {
    var spreadsheet = getSpreadsheet_();
    var admin = requireAdmin_(spreadsheet);
    var email = validateMemberEmail_(emailValue);
    var active = strictBoolean_(activeValue, 'Active');
    var table = readTable_(spreadsheet, 'Members');
    var columns = memberAdminColumns_(table);
    var matches = memberRowsByEmail_(table, columns, email);
    if (!matches.length) fail_('That member email was not found.');
    if (matches.length > 1) {
      fail_('That email appears more than once in Members. Remove the duplicate before changing its status.');
    }
    if (active) {
      var displayName = cell_(matches[0].values, columns.displayName).trim();
      if (memberIdentityNamespaceConflict_(table, columns, email, displayName)) {
        fail_('Resolve member email/display-name collisions before activating this member.');
      }
    }
    table.sheet.getRange(matches[0].rowNumber, columns.active + 1).setValue(active);
    flush_();
    return buildAdminData_(spreadsheet, admin);
  });
}

function releaseStrandedTask_(taskIdValue, reasonValue) {
  return withMutationLock_(function () {
    var spreadsheet = getSpreadsheet_();
    var admin = requireAdmin_(spreadsheet);
    var taskId = singleLineText_(taskIdValue, 'Task ID', 250, true);
    var reason = singleLineText_(reasonValue, 'Recovery reason', 300, true);
    var directory = readMemberDirectory_(spreadsheet);
    if (directory.source !== 'members') {
      fail_('Task recovery is unavailable until the Members sheet is ready.');
    }

    var tasksTable = readTable_(spreadsheet, 'Tasks');
    var updatesTable = readTable_(spreadsheet, 'Updates');
    var taskMatch = findExactTaskIdForRecovery_(tasksTable, taskId);
    var taskRow = taskMatch.row;
    var taskColumns = taskMatch.columns;
    var currentStatus = normalizeReadStatus_(cell_(taskRow.values, taskColumns.status));
    if (currentStatus !== 'Doing' && currentStatus !== 'Blocked') {
      fail_('Only Doing or Blocked tasks can be released through stranded-task recovery. This task is ' + currentStatus + '.');
    }

    var currentOwner = cell_(taskRow.values, taskColumns.claimedBy).trim();
    var activeOwnerMatches = activeMemberProfilesMatchingTaskOwner_(currentOwner, directory.all);
    if (activeOwnerMatches.length === 1) {
      fail_('This task still resolves to one active member. Ask that member to release it through the task workflow.');
    }

    assertUpdateColumns_(updatesTable);
    var currentBlocker = cell_(taskRow.values, taskColumns.blocker).trim();
    var now = new Date();
    setCells_(tasksTable.sheet, taskRow.rowNumber, [
      { column: taskColumns.status, value: 'Open' },
      { column: taskColumns.claimedBy, value: '' },
      { column: taskColumns.lastUpdate, value: now },
      { column: taskColumns.blocker, value: '' }
    ]);

    appendUpdate_(updatesTable, {
      timestamp: now,
      member: admin.member ? admin.member.displayName : 'Deployment owner',
      taskProject: taskLabel_(taskRow.values, taskColumns, taskId),
      update: 'Coordinator released a stranded ' + currentStatus.toLowerCase() + ' task. Reason: ' + reason,
      blocker: currentBlocker,
      nextStep: 'Available to claim',
      link: cell_(taskRow.values, taskColumns.supportingLink)
    });

    flush_();
    return buildAdminData_(spreadsheet, admin);
  });
}

function findExactTaskIdForRecovery_(table, taskId) {
  if (!table.headers.length) {
    fail_('The Tasks sheet is empty and has no header row.');
  }
  var columns = taskColumnsForWrite_(table, true);
  requireColumn_(columns.taskId, 'Task ID', 'Tasks');
  var matches = table.rows.filter(function (row) {
    return cell_(row.values, columns.taskId).trim() === taskId;
  });
  if (!matches.length) {
    fail_('Task ID "' + taskId + '" was not found. Enter the exact Task ID shown in Operations.');
  }
  if (matches.length > 1) {
    fail_('Task ID "' + taskId + '" appears more than once. Make Task IDs unique before recovering it.');
  }
  return { row: matches[0], columns: columns };
}

function activeMemberProfilesMatchingTaskOwner_(identity, profiles) {
  var target = normalizeIdentity_(identity);
  if (!target) return [];
  return (profiles || []).filter(function (profile) {
    return profile.active && (
      normalizeIdentity_(profile.profileKey) === target ||
      normalizeIdentity_(profile.email) === target
    );
  });
}

function buildStrandedTaskRecoveryData_(spreadsheet, directory) {
  var limit = 50;
  var result = {
    schemaVersion: 'start-stranded-task-recovery/v1',
    available: false,
    tasks: [],
    total: 0,
    omitted: 0,
    unavailableCount: 0,
    limit: limit
  };
  if (!directory || directory.source !== 'members') return result;

  try {
    var table = readTable_(spreadsheet, 'Tasks');
    if (!table.headers.length) return result;
    var columns = indexes_(table, TASK_FIELDS);
    if (columns.taskId < 0 || columns.task < 0 || columns.status < 0 ||
        columns.claimedBy < 0 || columns.blocker < 0) return result;

    var candidates = [];
    var taskIdCounts = {};
    table.rows.forEach(function (row) {
      var status = normalizeReadStatus_(cell_(row.values, columns.status));
      if (status !== 'Doing' && status !== 'Blocked') return;
      var owner = cell_(row.values, columns.claimedBy).trim();
      var ownerMatches = activeMemberProfilesMatchingTaskOwner_(owner, directory.all);
      if (ownerMatches.length === 1) return;
      var taskId = cell_(row.values, columns.taskId).trim();
      if (taskId) taskIdCounts[taskId] = (taskIdCounts[taskId] || 0) + 1;
      candidates.push({
        taskId: taskId,
        task: cell_(row.values, columns.task).trim(),
        status: status,
        ownerDisplayName: owner ? ownerDisplayName_(owner, directory.all) : '',
        ownerResolution: !owner
          ? 'No owner recorded'
          : ownerMatches.length > 1
            ? 'Owner matches more than one active member'
            : 'Owner is inactive, legacy name-based, or is not an active Members email'
      });
    });

    var actionable = candidates.filter(function (task) {
      return !!task.taskId && taskIdCounts[task.taskId] === 1;
    }).sort(function (left, right) {
      var idComparison = left.taskId.localeCompare(right.taskId);
      return idComparison || left.task.localeCompare(right.task);
    });
    result.available = true;
    result.total = actionable.length;
    result.omitted = Math.max(0, actionable.length - limit);
    result.unavailableCount = candidates.length - actionable.length;
    result.tasks = actionable.slice(0, limit);
    return result;
  } catch (error) {
    return result;
  }
}

function memberAdminColumns_(table) {
  var columns = indexes_(table, MEMBER_FIELDS);
  requireColumn_(columns.email, 'Email', 'Members');
  requireColumn_(columns.displayName, 'Display Name', 'Members');
  requireColumn_(columns.active, 'Active', 'Members');
  return columns;
}

function memberRowsByEmail_(table, columns, email) {
  var target = normalizeEmail_(email);
  return table.rows.filter(function (row) {
    return normalizeEmail_(cell_(row.values, columns.email)) === target;
  });
}

function validateMemberEmail_(value) {
  var email = singleLineText_(value, 'Email', 254, true).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    fail_('Enter a complete Google account email address.');
  }
  return email;
}

function strictBoolean_(value, label) {
  if (value === true || value === false) return value;
  var normalized = normalizeHeader_(value);
  if (normalized === 'true' || normalized === 'yes' || normalized === '1' || normalized === 'active') return true;
  if (normalized === 'false' || normalized === 'no' || normalized === '0' || normalized === 'inactive') return false;
  fail_((label || 'Value') + ' must be true or false.');
}
