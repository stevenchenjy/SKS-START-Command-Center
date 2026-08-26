function readMemberDirectory_(spreadsheet) {
  var membersSheet = spreadsheet.getSheetByName('Members');
  if (!membersSheet) {
    var legacy = readLegacyMemberProfiles_(readTable_(spreadsheet, 'Settings'));
    return { all: legacy, active: legacy, source: 'settings' };
  }

  var table = readTable_(spreadsheet, 'Members');
  if (!table.headers.length) {
    fail_('The Members sheet is empty. Run setupMembersSheet() once to add the Email, Display Name, and Active headers.');
  }
  var columns = indexes_(table, MEMBER_FIELDS);
  requireColumn_(columns.email, 'Email', 'Members');
  requireColumn_(columns.displayName, 'Display Name', 'Members');
  requireColumn_(columns.active, 'Active', 'Members');
  var profiles = [];

  table.rows.forEach(function (row) {
    var email = normalizeEmail_(cell_(row.values, columns.email));
    var configuredName = cell_(row.values, columns.displayName).trim();
    if (!email && !configuredName) return;
    var displayName = configuredName || temporaryDisplayName_(email);
    var profile = {
      email: email,
      profileKey: email || configuredName,
      displayName: displayName,
      active: memberIsActive_(cell_(row.values, columns.active)),
      needsDisplayName: !configuredName,
      source: 'members',
      rowNumber: row.rowNumber
    };
    profiles.push(profile);
  });

  return {
    all: profiles,
    active: profiles.filter(function (profile) { return profile.active; }),
    source: 'members'
  };
}

function readLegacyMemberProfiles_(table) {
  if (!table.headers.length) return [];

  var columns = indexes_(table, SETTINGS_FIELDS);
  requireColumn_(columns.setting, 'Setting', 'Settings');
  requireColumn_(columns.value, 'Value', 'Settings');
  var names = [];

  table.rows.forEach(function (row) {
    var setting = cell_(row.values, columns.setting).trim();
    var value = cell_(row.values, columns.value).trim();
    var key = normalizeHeader_(setting);
    var isMemberList = key === 'member' || key === 'members' ||
      key === 'committeemember' || key === 'committeemembers';
    var isRole = /(lead|chair|advisor|coordinator|secretary|treasurer|liaison|sponsor|representative|steward)$/.test(key);

    if (value && (isMemberList || isRole)) {
      value.split(/[|,;\n]+/).forEach(function (name) {
        addUnique_(names, name);
      });
    }
  });

  return names.map(function (name) {
    return {
      email: '',
      profileKey: name,
      displayName: name,
      active: true,
      needsDisplayName: false,
      source: 'settings'
    };
  });
}

function resolveMutationMember_(spreadsheet, requestedProfileKey) {
  return requireActiveMember_(spreadsheet);
}

function publicMember_(profile) {
  return {
    profileKey: profile.displayName,
    displayName: profile.displayName,
    needsDisplayName: !!profile.needsDisplayName
  };
}

function temporaryDisplayName_(email) {
  var localPart = string_(email).split('@')[0]
    .replace(/[._+\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!localPart) return 'START member';
  return localPart.split(' ').map(function (word) {
    return word ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : '';
  }).join(' ');
}

function normalizeEmail_(value) {
  return string_(value).trim().toLowerCase();
}

function memberIsActive_(value) {
  var key = normalizeHeader_(value);
  return key === 'true' || key === 'yes' || key === 'y' || key === '1' ||
    key === 'active' || key === 'enabled';
}

function findMemberProfile_(identity, profiles) {
  var target = normalizeIdentity_(identity);
  if (!target) return null;
  for (var index = 0; index < profiles.length; index += 1) {
    var profile = profiles[index];
    if (normalizeIdentity_(profile.profileKey) === target ||
        normalizeIdentity_(profile.email) === target) {
      return profile;
    }
  }
  for (var displayIndex = 0; displayIndex < profiles.length; displayIndex += 1) {
    if (normalizeIdentity_(profiles[displayIndex].displayName) === target) {
      return profiles[displayIndex];
    }
  }
  return null;
}

function findUniqueActiveMemberProfile_(identity, profiles) {
  var target = normalizeIdentity_(identity);
  if (!target) return null;
  var matches = (profiles || []).filter(function (profile) {
    return profile.active && (
      normalizeIdentity_(profile.profileKey) === target ||
      normalizeIdentity_(profile.email) === target ||
      normalizeIdentity_(profile.displayName) === target
    );
  });
  if (matches.length > 1) {
    fail_('That member selection is ambiguous. Ask a coordinator to make member emails and display names unique.');
  }
  return matches.length === 1 ? matches[0] : null;
}

function memberStorageKey_(member) {
  return member.email || member.profileKey || member.displayName;
}

function memberMatchesIdentity_(storedIdentity, member) {
  var stored = normalizeIdentity_(storedIdentity);
  if (!stored || !member) return false;
  return stored === normalizeIdentity_(member.profileKey) ||
    stored === normalizeIdentity_(member.email);
}

function memberIdentityNamespaceConflict_(table, columns, emailValue, displayNameValue) {
  var email = normalizeEmail_(emailValue);
  var displayName = normalizeIdentity_(displayNameValue);
  if (!email || !displayName) return true;
  if (normalizeIdentity_(email) === displayName) return true;

  return table.rows.some(function (row) {
    var rowEmail = normalizeEmail_(cell_(row.values, columns.email));
    var rowDisplayName = normalizeIdentity_(cell_(row.values, columns.displayName));
    var sameMember = !!rowEmail && rowEmail === email;
    if (rowEmail && normalizeIdentity_(rowEmail) === displayName) return true;
    if (!sameMember && rowDisplayName && rowDisplayName === displayName) return true;
    return !sameMember && rowDisplayName && rowDisplayName === normalizeIdentity_(email);
  });
}

function ownerDisplayName_(storedIdentity, profiles) {
  var stored = string_(storedIdentity).trim();
  if (!stored) return '';
  var profile = findMemberProfile_(stored, profiles || []);
  if (profile) return profile.displayName;
  if (/^[^@\s]+@[^@\s]+$/.test(stored)) return temporaryDisplayName_(stored);
  return stored;
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
