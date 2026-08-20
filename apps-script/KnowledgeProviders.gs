/**
 * Curated, read-only knowledge source foundation for the dormant assistant.
 *
 * The production extraction adapter is deliberately not installed in this
 * branch. Selection is complete and testable against injected candidates; a
 * later scope-reviewed adapter can provide those candidates without changing
 * the assistant service contract.
 */

function collectAssistantKnowledge_(request, options) {
  var settings = assistantKnowledgeObject_(options);
  var enabled = Object.prototype.hasOwnProperty.call(settings, 'enabled')
    ? settings.enabled === true
    : assistantKnowledgeFeatureEnabled_();
  if (!enabled) return assistantKnowledgeEmptyResult_('disabled');

  var folderConfig;
  if (Object.prototype.hasOwnProperty.call(settings, 'folderConfig')) {
    folderConfig = settings.folderConfig;
  } else if (typeof settings.getFolderConfig === 'function') {
    folderConfig = settings.getFolderConfig();
  } else if (typeof getDriveKnowledgeFolderConfig_ === 'function') {
    folderConfig = getDriveKnowledgeFolderConfig_();
  } else {
    folderConfig = {};
  }
  var allowlist = assistantKnowledgeFolderAllowlist_(folderConfig);
  if (!allowlist.length) return assistantKnowledgeEmptyResult_('not_configured');

  var candidates;
  var adapterInstalled = false;
  if (Object.prototype.hasOwnProperty.call(settings, 'candidates')) {
    candidates = settings.candidates;
    adapterInstalled = true;
  } else if (typeof settings.loader === 'function') {
    candidates = settings.loader(allowlist.slice(), request);
    adapterInstalled = true;
  } else {
    candidates = loadCuratedDriveKnowledgeCandidates_(allowlist.slice(), request);
  }
  if (assistantKnowledgeIsObject_(candidates) && Array.isArray(candidates.candidates)) {
    candidates = candidates.candidates;
  }
  if (!Array.isArray(candidates)) candidates = [];

  var selected = selectAssistantKnowledgeCandidates_(request, candidates, allowlist);
  selected.status = adapterInstalled ? 'ready' : 'adapter_not_installed';
  return selected;
}

/**
 * Intentional production stub. It performs no external or application access.
 */
function loadCuratedDriveKnowledgeCandidates_(allowlistedFolderIds, request) {
  return [];
}

/**
 * Pure bounded selector for extracted fixture/adapter candidates.
 */
function selectAssistantKnowledgeCandidates_(request, candidates, allowlistedFolderIds) {
  var limits = assistantKnowledgeLimits_();
  var allowlist = {};
  (Array.isArray(allowlistedFolderIds) ? allowlistedFolderIds : []).forEach(function (folderId) {
    var value = String(folderId || '').trim();
    if (value) allowlist[value] = true;
  });
  var secrets = Object.keys(allowlist);
  var supported = assistantKnowledgeMimeTypes_();
  var query = assistantKnowledgeQuery_(request);
  var unsupportedMimeCount = 0;
  var outsideAllowlistCount = 0;
  var irrelevantCount = 0;
  var seen = {};

  var ranked = (Array.isArray(candidates) ? candidates : []).map(function (candidate, index) {
    var source = assistantKnowledgeObject_(candidate);
    var folderId = String(source.folderId || '').trim();
    if (!allowlist[folderId]) {
      outsideAllowlistCount += 1;
      return null;
    }
    if (!supported[source.mimeType]) {
      unsupportedMimeCount += 1;
      return null;
    }
    var privateFileId = String(source.fileId || '').trim();
    var privateValues = secrets.concat(privateFileId ? [privateFileId] : []);
    var title = assistantKnowledgeText_(source.title || source.name, limits.titleCharacters, privateValues, true);
    var rawText = source.text || source.excerpt || source.content;
    var text = assistantKnowledgeText_(rawText, limits.excerptCharacters, privateValues, true);
    if (!title || !text) return null;
    var dedupeKey = privateFileId || [folderId, source.mimeType, title, text].join('\u001f');
    if (seen[dedupeKey]) return null;
    seen[dedupeKey] = true;
    var score = assistantKnowledgeScore_(query, title, text);
    if (score <= 0) {
      irrelevantCount += 1;
      return null;
    }
    return {
      title: title,
      mimeType: source.mimeType,
      excerpt: text,
      score: score,
      tie: [
        title.toLowerCase(),
        source.mimeType,
        text.toLowerCase(),
        privateFileId,
        String(index)
      ].join('\u001f')
    };
  }).filter(function (item) { return !!item; });

  ranked.sort(function (left, right) {
    if (left.score !== right.score) return right.score - left.score;
    if (left.tie === right.tie) return 0;
    return left.tie < right.tie ? -1 : 1;
  });

  var remaining = limits.totalExcerptCharacters;
  var items = [];
  for (var index = 0; index < ranked.length && items.length < limits.files && remaining > 0; index += 1) {
    var candidate = ranked[index];
    var excerpt = candidate.excerpt.slice(0, Math.min(limits.excerptCharacters, remaining));
    if (!excerpt) continue;
    remaining -= excerpt.length;
    items.push({
      sourceId: 'knowledge:' + (items.length + 1),
      type: 'knowledge',
      title: candidate.title,
      mimeType: candidate.mimeType,
      excerpt: excerpt
    });
  }

  var omitted = Math.max(0, ranked.length - items.length);
  return {
    status: 'ready',
    items: items,
    truncation: {
      truncated: omitted > 0 || remaining === 0 && ranked.length > items.length,
      candidateCount: Array.isArray(candidates) ? candidates.length : 0,
      eligibleCount: ranked.length,
      includedCount: items.length,
      omittedCount: omitted,
      outsideAllowlistCount: outsideAllowlistCount,
      unsupportedMimeCount: unsupportedMimeCount,
      irrelevantCount: irrelevantCount,
      excerptCharacters: limits.totalExcerptCharacters - remaining,
      limits: limits
    }
  };
}

function assistantKnowledgeFeatureEnabled_() {
  if (typeof isFeatureEnabled_ !== 'function' ||
      typeof START_FEATURE_PROPERTY_KEYS === 'undefined' ||
      !START_FEATURE_PROPERTY_KEYS) return false;
  return isFeatureEnabled_(START_FEATURE_PROPERTY_KEYS.driveKnowledge) === true;
}

function assistantKnowledgeFolderAllowlist_(folderConfig) {
  var source = assistantKnowledgeObject_(folderConfig);
  var seen = {};
  var result = [];
  [source.sksStartFolderId, source.gsaResourceFolderId].forEach(function (folderId) {
    if (typeof folderId !== 'string') return;
    var value = folderId.trim();
    if (!value || seen[value]) return;
    seen[value] = true;
    result.push(value);
  });
  return result.sort();
}

function assistantKnowledgeMimeTypes_() {
  return {
    'application/vnd.google-apps.document': true,
    'application/vnd.google-apps.spreadsheet': true,
    'text/plain': true
  };
}

function assistantKnowledgeLimits_() {
  return {
    files: 5,
    titleCharacters: 300,
    excerptCharacters: 3000,
    totalExcerptCharacters: 6000
  };
}

function assistantKnowledgeEmptyResult_(status) {
  var limits = assistantKnowledgeLimits_();
  return {
    status: status,
    items: [],
    truncation: {
      truncated: false,
      candidateCount: 0,
      eligibleCount: 0,
      includedCount: 0,
      omittedCount: 0,
      outsideAllowlistCount: 0,
      unsupportedMimeCount: 0,
      irrelevantCount: 0,
      excerptCharacters: 0,
      limits: limits
    }
  };
}

function assistantKnowledgeQuery_(request) {
  var source = assistantKnowledgeObject_(request);
  var text = [source.question, source.projectId].join(' ').toLowerCase();
  var stop = {
    about: true, after: true, also: true, been: true, before: true, could: true,
    from: true, have: true, into: true, should: true, start: true, that: true,
    their: true, there: true, these: true, they: true, this: true, what: true,
    when: true, where: true, which: true, with: true, would: true, your: true,
    how: true, the: true
  };
  var seen = {};
  var tokens = (text.match(/[a-z0-9][a-z0-9_-]{2,}/g) || []).filter(function (token) {
    if (stop[token] || seen[token]) return false;
    seen[token] = true;
    return true;
  }).sort();
  return {
    phrase: String(source.question || '').trim().toLowerCase(),
    tokens: tokens
  };
}

function assistantKnowledgeScore_(query, title, text) {
  var titleText = title.toLowerCase();
  var bodyText = text.toLowerCase();
  var score = 0;
  if (query.phrase.length >= 4 && titleText.indexOf(query.phrase) !== -1) score += 50;
  query.tokens.forEach(function (token) {
    if (titleText.indexOf(token) !== -1) score += 8;
    if (bodyText.indexOf(token) !== -1) score += 2;
  });
  return score;
}

function assistantKnowledgeText_(value, limit, privateValues, removeUrls) {
  if (value === null || typeof value === 'undefined' || typeof value === 'object') return '';
  var text = String(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email removed]');
  if (removeUrls) text = text.replace(/\b(?:https?:\/\/|www\.)\S+/gi, '[link removed]');
  (Array.isArray(privateValues) ? privateValues : []).forEach(function (privateValue) {
    var secret = String(privateValue || '');
    if (!secret) return;
    if (secret.length >= 6) {
      text = text.split(secret).join('[private identifier removed]');
      return;
    }
    // Short fixture identifiers still count as private, but replace only the
    // exact token so an ID such as "a" does not corrupt every word containing a.
    var escaped = secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var pattern = new RegExp('(^|[^A-Za-z0-9_-])' + escaped + '(?=$|[^A-Za-z0-9_-])', 'g');
    text = text.replace(pattern, function (match, prefix) {
      return prefix + '[private identifier removed]';
    });
  });
  text = text.trim();
  if (text.length <= limit) return text;
  return limit <= 1 ? text.slice(0, limit) : text.slice(0, limit - 1).trimEnd() + '…';
}

function assistantKnowledgeObject_(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function assistantKnowledgeIsObject_(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
