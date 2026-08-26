function activeUserEmail_() {
  try {
    return normalizeEmail_(Session.getActiveUser().getEmail());
  } catch (error) {
    return '';
  }
}

function effectiveUserEmail_() {
  try {
    return normalizeEmail_(Session.getEffectiveUser().getEmail());
  } catch (error) {
    return '';
  }
}

function memberProfilesByEmail_(email, profiles) {
  var target = normalizeEmail_(email);
  if (!target) return [];
  return (profiles || []).filter(function (profile) {
    return normalizeEmail_(profile.email) === target;
  });
}

function resolveOperationalAccess_(spreadsheet) {
  var email = activeUserEmail_();
  if (!email) return deniedAccessContext_('identity_unavailable');
  var ownerCanAdmin = isDeploymentOwner_(email);

  var directory;
  try {
    directory = readMemberDirectory_(spreadsheet);
  } catch (error) {
    return deniedAccessContext_('members_not_ready', ownerCanAdmin);
  }
  if (directory.source !== 'members') {
    return deniedAccessContext_('members_not_ready', ownerCanAdmin);
  }

  var matches = memberProfilesByEmail_(email, directory.all);
  if (matches.length > 1) return deniedAccessContext_('duplicate_member', ownerCanAdmin);
  if (!matches.length) return deniedAccessContext_('unknown_member', ownerCanAdmin);
  if (!matches[0].active) return deniedAccessContext_('inactive_member', ownerCanAdmin);

  return {
    allowed: true,
    reason: '',
    email: email,
    member: matches[0],
    directory: directory,
    canAdmin: canAdminister_(spreadsheet, email, directory)
  };
}

function deniedAccessContext_(reason, canAdmin) {
  return {
    allowed: false,
    reason: reason || 'access_denied',
    email: '',
    member: null,
    directory: { all: [], active: [], source: 'unavailable' },
    canAdmin: canAdmin === true
  };
}

function requireActiveMember_(spreadsheet) {
  var access = resolveOperationalAccess_(spreadsheet);
  if (access.allowed) return access.member;
  if (access.reason === 'duplicate_member') {
    fail_('Your Google email appears more than once in Members. Ask the deployment owner to remove the duplicate before making changes.');
  }
  if (access.reason === 'inactive_member') {
    fail_('Your member profile is inactive. Ask a coordinator to mark it Active before making changes.');
  }
  fail_('Access denied. Sign in with an active approved member Google account.');
}

function isDeploymentOwner_(activeEmail) {
  var active = normalizeEmail_(activeEmail);
  var effective = effectiveUserEmail_();
  return !!active && !!effective && active === effective;
}

function canAdminister_(spreadsheet, activeEmail, directory) {
  var email = normalizeEmail_(activeEmail);
  if (!email) return false;
  if (isDeploymentOwner_(email)) return true;
  if (getConfiguredCoordinatorEmails_().indexOf(email) < 0) return false;

  var memberDirectory = directory;
  if (!memberDirectory) {
    try {
      memberDirectory = readMemberDirectory_(spreadsheet);
    } catch (error) {
      return false;
    }
  }
  if (memberDirectory.source !== 'members') return false;
  var matches = memberProfilesByEmail_(email, memberDirectory.all);
  return matches.length === 1 && matches[0].active;
}

function requireAdmin_(spreadsheet) {
  var email = activeUserEmail_();
  if (!email) {
    fail_('Administrator access requires a signed-in Google identity.');
  }
  if (isDeploymentOwner_(email)) {
    return { email: email, isOwner: true, member: null };
  }

  var directory;
  try {
    directory = readMemberDirectory_(spreadsheet);
  } catch (error) {
    fail_('Administrator access is unavailable until Members is ready. Ask the deployment owner to finish setup.');
  }
  var matches = memberProfilesByEmail_(email, directory.all);
  if (matches.length > 1) {
    fail_('Your Google email appears more than once in Members. Ask the deployment owner to remove the duplicate.');
  }
  if (getConfiguredCoordinatorEmails_().indexOf(email) < 0 ||
      matches.length !== 1 || !matches[0].active) {
    fail_('Administrator access is limited to the deployment owner and approved active coordinators.');
  }
  return { email: email, isOwner: false, member: matches[0] };
}

function deniedViewer_(reason, canAdmin) {
  return {
    displayName: '',
    authMode: reason === 'identity_unavailable' ? 'identity_unavailable' : 'google_denied',
    needsDisplayName: false,
    needsProfileSelection: false,
    isActive: false,
    canMutate: false,
    canAdmin: canAdmin === true,
    accessDenied: true,
    accessReason: reason || 'access_denied'
  };
}

function authorizedViewer_(access) {
  return {
    profileKey: access.member.displayName,
    identity: access.member.displayName,
    displayName: access.member.displayName,
    authMode: 'google',
    needsDisplayName: !!access.member.needsDisplayName,
    needsProfileSelection: false,
    isActive: true,
    canMutate: true,
    canAdmin: !!access.canAdmin,
    accessDenied: false,
    accessReason: ''
  };
}
