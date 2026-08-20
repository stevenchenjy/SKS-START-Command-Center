function buildAssistantResponseJsonSchema_() {
  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'answer',
      'knownFacts',
      'missingInformation',
      'suggestedNextActions',
      'relevantItemIds'
    ],
    properties: {
      answer: { type: 'string' },
      knownFacts: {
        type: 'array',
        maxItems: 8,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['fact', 'sourceIds'],
          properties: {
            fact: { type: 'string' },
            sourceIds: {
              type: 'array',
              minItems: 1,
              maxItems: 4,
              items: { type: 'string' }
            }
          }
        }
      },
      missingInformation: {
        type: 'array',
        maxItems: 6,
        items: { type: 'string' }
      },
      suggestedNextActions: {
        type: 'array',
        maxItems: 6,
        items: { type: 'string' }
      },
      relevantItemIds: {
        type: 'array',
        maxItems: 12,
        items: { type: 'string' }
      }
    }
  };
}

function validateAssistantModelResponse_(value, sourceCatalog, privateValues) {
  assistantRequirePlainObject_(value, 'response');
  assistantRequireExactKeys_(value, [
    'answer',
    'knownFacts',
    'missingInformation',
    'suggestedNextActions',
    'relevantItemIds'
  ], 'response');

  var sources = assistantSourceMap_(sourceCatalog);
  var privateStrings = assistantPrivateStrings_(privateValues);
  var answer = assistantResponseText_(value.answer, 'answer', 6000, true, privateStrings);
  var facts = assistantResponseArray_(value.knownFacts, 'knownFacts', 8);
  var missing = assistantResponseArray_(value.missingInformation, 'missingInformation', 6);
  var actions = assistantResponseArray_(value.suggestedNextActions, 'suggestedNextActions', 6);
  var relevantIds = assistantResponseArray_(value.relevantItemIds, 'relevantItemIds', 12);

  var knownFacts = facts.map(function (fact, index) {
    var label = 'knownFacts[' + index + ']';
    assistantRequirePlainObject_(fact, label);
    assistantRequireExactKeys_(fact, ['fact', 'sourceIds'], label);
    var sourceIds = assistantResponseArray_(fact.sourceIds, label + '.sourceIds', 4);
    if (!sourceIds.length) assistantSchemaError_(label + '.sourceIds must not be empty');
    var seen = {};
    var validatedSourceIds = sourceIds.map(function (sourceId, sourceIndex) {
      var cleanId = assistantResponseText_(sourceId, label + '.sourceIds[' + sourceIndex + ']', 240, true, privateStrings);
      if (!sources[cleanId]) assistantSchemaError_(label + ' cites an unavailable source');
      if (seen[cleanId]) assistantSchemaError_(label + '.sourceIds contains a duplicate');
      seen[cleanId] = true;
      return cleanId;
    });
    return {
      fact: assistantResponseText_(fact.fact, label + '.fact', 600, true, privateStrings),
      sourceIds: validatedSourceIds
    };
  });

  var validatedMissing = missing.map(function (item, index) {
    return assistantResponseText_(item, 'missingInformation[' + index + ']', 400, true, privateStrings);
  });
  var validatedActions = actions.map(function (item, index) {
    return assistantResponseText_(item, 'suggestedNextActions[' + index + ']', 400, true, privateStrings);
  });
  assistantRequireUniqueTexts_(knownFacts.map(function (fact) { return fact.fact; }), 'knownFacts');
  assistantRequireUniqueTexts_(validatedMissing, 'missingInformation');
  assistantRequireUniqueTexts_(validatedActions, 'suggestedNextActions');
  var relevantSeen = {};
  var validatedRelevantIds = relevantIds.map(function (sourceId, index) {
    var cleanId = assistantResponseText_(sourceId, 'relevantItemIds[' + index + ']', 240, true, privateStrings);
    if (!sources[cleanId] || sources[cleanId].navigable !== true) {
      assistantSchemaError_('relevantItemIds contains an unavailable item');
    }
    if (relevantSeen[cleanId]) assistantSchemaError_('relevantItemIds contains a duplicate');
    relevantSeen[cleanId] = true;
    return cleanId;
  });

  return {
    answer: answer,
    knownFacts: knownFacts,
    missingInformation: validatedMissing,
    suggestedNextActions: validatedActions,
    relevantItemIds: validatedRelevantIds
  };
}

function assistantRequireUniqueTexts_(values, label) {
  var seen = {};
  values.forEach(function (value) {
    var normalized = value.toLowerCase().replace(/\s+/g, ' ').trim();
    if (seen[normalized]) assistantSchemaError_(label + ' contains a duplicate');
    seen[normalized] = true;
  });
}

function hydrateAssistantResponse_(validated, sourceCatalog, dashboard, scope, privateValues) {
  var sourceMap = assistantSourceMap_(sourceCatalog);
  var privateStrings = assistantPrivateStrings_(privateValues);
  var response = {
    schemaVersion: assistantDefaults_().responseVersion,
    scope: assistantPublicScope_(scope),
    answer: validated.answer,
    knownFacts: validated.knownFacts.map(function (fact) {
      return {
        fact: fact.fact,
        sources: fact.sourceIds.map(function (sourceId) {
          return assistantPublicSource_(sourceMap[sourceId], dashboard, privateStrings);
        })
      };
    }),
    missingInformation: validated.missingInformation.slice(),
    suggestedNextActions: validated.suggestedNextActions.slice(),
    relevantItems: validated.relevantItemIds.map(function (sourceId) {
      return assistantPublicItem_(sourceMap[sourceId], dashboard, privateStrings);
    })
  };
  assistantAssertSafePublicResponse_(response, privateStrings);
  return response;
}

function assistantPublicScope_(scope) {
  var allowed = {
    project: true,
    work: true,
    waiting: true,
    program: true,
    proposal: true
  };
  if (typeof scope !== 'string' || !allowed[scope]) {
    assistantSchemaError_('resolved scope is invalid');
  }
  return scope;
}

function assistantPublicSource_(source, dashboard, privateStrings) {
  var item = assistantPublicItem_(source, dashboard, privateStrings);
  return {
    type: item.type,
    id: item.id,
    title: item.title
  };
}

function assistantPublicItem_(source, dashboard, privateStrings) {
  var itemId = source.itemId || source.sourceId;
  var result = {
    type: assistantSafeCatalogText_(source.type, 60, privateStrings),
    id: assistantSafeCatalogText_(itemId, 240, privateStrings),
    title: assistantSafeCatalogText_(source.label, 300, privateStrings)
  };
  var state = assistantCatalogItemState_(source, dashboard);
  if (state.status) result.status = assistantSafeCatalogText_(state.status, 80, privateStrings);
  if (state.stage) result.stage = assistantSafeCatalogText_(state.stage, 80, privateStrings);
  return result;
}

function assistantCatalogItemState_(source, dashboard) {
  var itemId = String(source.itemId || '');
  var tasks = dashboard && Array.isArray(dashboard.tasks) ? dashboard.tasks : [];
  var projects = dashboard && Array.isArray(dashboard.projects) ? dashboard.projects : [];
  var metrics = dashboard && Array.isArray(dashboard.metrics) ? dashboard.metrics : [];
  var index;
  if (source.type === 'task') {
    for (index = 0; index < tasks.length; index += 1) {
      if (String(tasks[index].taskId || tasks[index].taskKey || '') === itemId) {
        return { status: String(tasks[index].status || ''), stage: '' };
      }
    }
  }
  if (source.type === 'project') {
    for (index = 0; index < projects.length; index += 1) {
      if (String(projects[index].projectId || '') === itemId) {
        return { status: '', stage: String(projects[index].stage || '') };
      }
    }
  }
  if (source.type === 'metric') {
    for (index = 0; index < metrics.length; index += 1) {
      if (String(metrics[index].metric || '') === itemId) {
        return { status: String(metrics[index].status || ''), stage: '' };
      }
    }
  }
  return { status: '', stage: '' };
}

function assistantSourceMap_(sourceCatalog) {
  if (!Array.isArray(sourceCatalog)) assistantSchemaError_('source catalog is invalid');
  var map = Object.create(null);
  sourceCatalog.forEach(function (source) {
    assistantRequirePlainObject_(source, 'source catalog entry');
    var sourceId = typeof source.sourceId === 'string' ? source.sourceId.trim() : '';
    if (!sourceId || sourceId.length > 240 || map[sourceId]) {
      assistantSchemaError_('source catalog contains an invalid source ID');
    }
    map[sourceId] = source;
  });
  return map;
}

function assistantResponseArray_(value, label, maximum) {
  if (!Array.isArray(value) || value.length > maximum) {
    assistantSchemaError_(label + ' is invalid');
  }
  return value;
}

function assistantResponseText_(value, label, maximum, required, privateStrings) {
  if (typeof value !== 'string') assistantSchemaError_(label + ' must be text');
  var text = value.trim();
  if (required && !text) assistantSchemaError_(label + ' is required');
  if (text.length > maximum) assistantSchemaError_(label + ' is too long');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) {
    assistantSchemaError_(label + ' contains unsupported control characters');
  }
  if (assistantContainsEmail_(text)) assistantSchemaError_(label + ' contains private contact information');
  if (assistantContainsPrivateString_(text, privateStrings)) assistantSchemaError_(label + ' contains private configuration');
  return text;
}

function assistantSafeCatalogText_(value, maximum, privateStrings) {
  var text = typeof value === 'string' ? value.trim() : String(value || '').trim();
  text = text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email removed]');
  privateStrings.forEach(function (privateValue) {
    if (!privateValue) return;
    text = text.split(privateValue).join('[private value removed]');
  });
  text = text.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (text.length > maximum) text = text.slice(0, maximum).trim();
  if (!text) assistantSchemaError_('source catalog contains an unusable public value');
  return text;
}

function assistantRequirePlainObject_(value, label) {
  if (!value || Object.prototype.toString.call(value) !== '[object Object]') {
    assistantSchemaError_(label + ' must be an object');
  }
}

function assistantRequireExactKeys_(value, expectedKeys, label) {
  var keys = Object.keys(value).sort();
  var expected = expectedKeys.slice().sort();
  if (keys.length !== expected.length || keys.some(function (key, index) { return key !== expected[index]; })) {
    assistantSchemaError_(label + ' has unexpected fields');
  }
}

function assistantContainsEmail_(value) {
  return /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value);
}

function assistantPrivateStrings_(values) {
  return (Array.isArray(values) ? values : []).filter(function (value) {
    return typeof value === 'string' && value.length >= 8;
  });
}

function assistantContainsPrivateString_(text, privateStrings) {
  return privateStrings.some(function (privateValue) {
    return text.indexOf(privateValue) >= 0;
  });
}

function assistantAssertSafePublicResponse_(response, privateStrings) {
  var serialized = JSON.stringify(response);
  if (assistantContainsEmail_(serialized) || assistantContainsPrivateString_(serialized, privateStrings)) {
    assistantSchemaError_('public response contains private information');
  }
}

function assistantSchemaError_(detail) {
  throw new Error('Invalid Ask START response: ' + detail + '.');
}
