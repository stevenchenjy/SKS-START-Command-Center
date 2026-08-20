#!/usr/bin/env node

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const SERVER = path.join(ROOT, 'apps-script');
const SOURCES = [
  'Config.gs',
  'ProgramSnapshot.gs',
  'AssistantConfig.gs',
  'AssistantPrompt.gs',
  'AssistantSchema.gs',
  'AssistantProvider.gs',
  'AssistantContext.gs',
  'KnowledgeProviders.gs',
  'AssistantService.gs'
];
const tests = [];
const properties = {};
const counters = {};
let dashboardFixture;

function test(name, work) {
  tests.push({ name, work });
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function resetCounters() {
  Object.keys(counters).forEach((key) => delete counters[key]);
  Object.assign(counters, {
    validate: 0,
    dashboard: 0,
    knowledge: 0,
    context: 0,
    catalog: 0,
    provider: 0,
    writes: 0
  });
}

function resetProperties(overrides = {}) {
  Object.keys(properties).forEach((key) => delete properties[key]);
  Object.assign(properties, overrides);
}

function dashboard(overrides = {}) {
  return {
    viewer: {
      profileKey: 'avery@example.test',
      displayName: 'Avery Student',
      email: 'avery@example.test',
      isActive: true
    },
    tasks: [{
      taskId: 'TASK-001',
      taskKey: 'TASK-001',
      task: 'Check refill station signs',
      status: 'Doing',
      claimedBy: 'avery@example.test',
      claimedByDisplay: 'Avery Student'
    }],
    projects: [{
      projectId: 'PRJ-001',
      projectKey: 'PRJ-001',
      projectName: 'Refill stations',
      stage: 'Active'
    }],
    metrics: [{ metric: 'Water', status: 'Current' }],
    updates: [],
    ...overrides
  };
}

function exactRequestValidator(request) {
  counters.validate += 1;
  if (!request || Object.prototype.toString.call(request) !== '[object Object]') {
    throw new Error('Ask START request details are required.');
  }
  const allowed = ['projectId', 'question', 'scope'];
  if (Object.keys(request).some((key) => !allowed.includes(key))) {
    throw new Error('Ask START request contains an unsupported field.');
  }
  if (typeof request.question !== 'string') throw new Error('Question is required.');
  const question = request.question.trim();
  if (!question || question.length > 800) throw new Error('Question must be 800 characters or fewer.');
  const scope = request.scope === undefined || request.scope === null || request.scope === ''
    ? 'auto'
    : request.scope;
  const allowedScopes = ['auto', 'project', 'work', 'waiting', 'program', 'proposal'];
  if (typeof scope !== 'string' || !allowedScopes.includes(scope)) throw new Error('Scope is not supported.');
  const rawProjectId = request.projectId === undefined || request.projectId === null
    ? ''
    : request.projectId;
  if (typeof rawProjectId !== 'string' || rawProjectId.length > 160) {
    throw new Error('Project ID is invalid.');
  }
  const projectId = rawProjectId.trim();
  if ((scope === 'project' || scope === 'proposal') && !projectId) {
    throw new Error('Project ID is required for that scope.');
  }
  if (projectId && !['auto', 'project', 'proposal'].includes(scope)) {
    throw new Error('Project ID is not valid for that scope.');
  }
  return { question, scope, projectId };
}

function defaultContextBuilder(currentDashboard, request, options) {
  counters.context += 1;
  const scope = request.scope === 'auto' ? (request.projectId ? 'project' : 'program') : request.scope;
  const catalog = [
    {
      sourceId: 'task:TASK-001', type: 'task', itemId: 'TASK-001',
      label: 'Check refill station signs', navigable: true
    },
    {
      sourceId: 'project:PRJ-001', type: 'project', itemId: 'PRJ-001',
      label: 'Refill stations', navigable: true
    }
  ];
  (options?.knowledge || []).forEach((item) => {
    catalog.push({
      sourceId: item.sourceId,
      type: 'knowledge',
      itemId: '',
      label: item.title,
      navigable: false
    });
  });
  return {
    schemaVersion: 'assistant-context/v1',
    scope,
    question: request.question,
    projectId: request.projectId,
    commandCenter: {
      viewer: { displayName: currentDashboard.viewer.displayName },
      tasks: currentDashboard.tasks.map((item) => ({
        sourceId: 'task:' + item.taskId,
        taskId: item.taskId,
        task: item.task,
        status: item.status,
        owner: item.claimedByDisplay
      })),
      projects: currentDashboard.projects.map((item) => ({
        sourceId: 'project:' + item.projectId,
        projectId: item.projectId,
        projectName: item.projectName,
        stage: item.stage
      }))
    },
    knowledge: options?.knowledge || [],
    sourceCatalog: catalog,
    truncation: { truncated: false, reasons: [] }
  };
}

const sandbox = {
  Date,
  Error,
  Object,
  Array,
  Number,
  String,
  RegExp,
  Math,
  JSON,
  isNaN,
  PropertiesService: {
    getScriptProperties() {
      return {
        getProperty(name) {
          return Object.prototype.hasOwnProperty.call(properties, name) ? properties[name] : null;
        }
      };
    }
  },
  UrlFetchApp: {
    fetch() {
      throw new Error('Automated tests must never call the network.');
    }
  },
  fail_(message) {
    throw new Error('START Command Center: ' + message);
  },
  validateAssistantRequest_: exactRequestValidator,
  getDashboardData() {
    counters.dashboard += 1;
    return dashboardFixture;
  },
  collectAssistantKnowledge_() {
    counters.knowledge += 1;
    return { status: 'disabled', items: [], truncation: { truncated: false } };
  },
  buildAssistantContext_: defaultContextBuilder,
  buildAssistantSourceCatalog_(context) {
    counters.catalog += 1;
    return context.sourceCatalog;
  }
};

vm.createContext(sandbox);
SOURCES.forEach((fileName) => {
  const filePath = path.join(SERVER, fileName);
  vm.runInContext(fs.readFileSync(filePath, 'utf8'), sandbox, { filename: filePath });
});

function request(overrides = {}) {
  return { question: 'What should I work on?', scope: 'work', projectId: '', ...overrides };
}

function modelResponse(overrides = {}) {
  return {
    answer: 'Finish the sign check and record what changed.',
    knownFacts: [{ fact: 'The sign check is Doing.', sourceIds: ['task:TASK-001'] }],
    missingInformation: [],
    suggestedNextActions: ['Check the remaining signs.'],
    relevantItemIds: ['task:TASK-001'],
    ...overrides
  };
}

function completedHttpResponse(output, overrides = {}) {
  const body = {
    status: 'completed',
    output: [{
      type: 'message',
      content: [{ type: 'output_text', text: JSON.stringify(output) }]
    }],
    ...overrides
  };
  return {
    getResponseCode: () => 200,
    getContentText: () => JSON.stringify(body)
  };
}

function enableAi(overrides = {}) {
  resetProperties({
    FEATURE_AI_HELPER: 'true',
    OPENAI_API_KEY: 'sk-test-secret-123',
    ...overrides
  });
}

function callService(overrides = {}) {
  return sandbox.askStartAssistantWithDependencies_(
    overrides.profileKey || 'avery@example.test',
    overrides.request || request(),
    {
      validateRequest: overrides.validateRequest || exactRequestValidator,
      getDashboardData: overrides.getDashboardData || function () {
        counters.dashboard += 1;
        return dashboardFixture;
      },
      collectKnowledge: overrides.collectKnowledge || function () {
        counters.knowledge += 1;
        return { status: 'disabled', items: [], truncation: { truncated: false } };
      },
      buildContext: overrides.buildContext || defaultContextBuilder,
      buildSourceCatalog: overrides.buildSourceCatalog || function (context) {
        counters.catalog += 1;
        return context.sourceCatalog;
      },
      callProvider: overrides.callProvider || function () {
        counters.provider += 1;
        return modelResponse();
      }
    }
  );
}

test('uses the strict structured-output schema and exact bounded fields', () => {
  const schema = plain(sandbox.buildAssistantResponseJsonSchema_());
  assert.equal(schema.type, 'object');
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, [
    'answer', 'knownFacts', 'missingInformation', 'suggestedNextActions', 'relevantItemIds'
  ]);
  assert.deepEqual(Object.keys(schema.properties), schema.required);
  assert.equal(schema.properties.knownFacts.maxItems, 8);
  assert.equal(schema.properties.knownFacts.items.additionalProperties, false);
  assert.deepEqual(schema.properties.knownFacts.items.required, ['fact', 'sourceIds']);
  assert.equal(schema.properties.knownFacts.items.properties.sourceIds.maxItems, 4);
  assert.equal(schema.properties.missingInformation.maxItems, 6);
  assert.equal(schema.properties.suggestedNextActions.maxItems, 6);
  assert.equal(schema.properties.relevantItemIds.maxItems, 12);
});

test('builds the current Responses API payload with store false and no tools', () => {
  let fetchCount = 0;
  let capturedUrl;
  let capturedOptions;
  const output = modelResponse();
  const result = sandbox.callAssistantProvider_(
    { instructions: 'Fixed instructions', inputText: '{"safe":"context"}' },
    { apiKey: 'sk-test-secret-123', model: 'gpt-5.6-luna' },
    (url, options) => {
      fetchCount += 1;
      capturedUrl = url;
      capturedOptions = options;
      return completedHttpResponse(output);
    }
  );

  assert.equal(fetchCount, 1);
  assert.equal(capturedUrl, 'https://api.openai.com/v1/responses');
  assert.equal(capturedOptions.method, 'post');
  assert.equal(capturedOptions.contentType, 'application/json');
  assert.equal(capturedOptions.headers.Authorization, 'Bearer sk-test-secret-123');
  assert.equal(capturedOptions.muteHttpExceptions, true);
  const payload = JSON.parse(capturedOptions.payload);
  assert.deepEqual(Object.keys(payload).sort(), [
    'input', 'instructions', 'max_output_tokens', 'model', 'store', 'text'
  ]);
  assert.equal(payload.model, 'gpt-5.6-luna');
  assert.equal(payload.store, false);
  assert.equal(payload.max_output_tokens, 1200);
  assert.deepEqual(payload.input, [{
    role: 'user',
    content: [{ type: 'input_text', text: '{"safe":"context"}' }]
  }]);
  assert.equal(payload.text.format.type, 'json_schema');
  assert.equal(payload.text.format.name, 'start_assistant_response_v1');
  assert.equal(payload.text.format.strict, true);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'tools'), false);
  assert.equal(capturedOptions.payload.includes('sk-test-secret-123'), false);
  assert.deepEqual(plain(result), output);
});

test('uses the documented default model and permits a safe property override', () => {
  assert.deepEqual(plain(sandbox.getAssistantProviderConfig_({ apiKey: 'key-value', model: '' })), {
    apiKey: 'key-value', model: 'gpt-5.6-luna'
  });
  assert.deepEqual(plain(sandbox.getAssistantProviderConfig_({
    apiKey: 'key-value', model: 'gpt-5.6-terra'
  })), { apiKey: 'key-value', model: 'gpt-5.6-terra' });
  assert.throws(
    () => sandbox.getAssistantProviderConfig_({ apiKey: 'key-value', model: 'bad model\nname' }),
    /invalid model configuration/i
  );
});

test('sanitizes API failures without exposing response bodies or credentials', () => {
  const secretBody = 'provider says sk-test-secret-123 is invalid';
  let thrown;
  try {
    sandbox.callAssistantProvider_(
      { instructions: 'instructions', inputText: '{}' },
      { apiKey: 'sk-test-secret-123', model: 'gpt-5.6-luna' },
      () => ({ getResponseCode: () => 401, getContentText: () => secretBody })
    );
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown);
  assert.match(thrown.message, /could not complete/i);
  assert.doesNotMatch(thrown.message, /sk-test-secret|provider says/i);
});

test('sanitizes timeout, malformed JSON, incomplete, and refusal responses', () => {
  const config = { apiKey: 'sk-test-secret-123', model: 'gpt-5.6-luna' };
  const providerRequest = { instructions: 'instructions', inputText: '{}' };
  assert.throws(
    () => sandbox.callAssistantProvider_(providerRequest, config, () => { throw new Error('socket timeout secret'); }),
    /could not complete/i
  );
  assert.throws(
    () => sandbox.callAssistantProvider_(providerRequest, config, () => ({
      getResponseCode: () => 200, getContentText: () => '{bad json'
    })),
    /could not complete/i
  );
  assert.throws(
    () => sandbox.callAssistantProvider_(providerRequest, config, () => ({
      getResponseCode: () => 200,
      getContentText: () => JSON.stringify({ status: 'incomplete', output: [] })
    })),
    /could not complete/i
  );
  assert.throws(
    () => sandbox.callAssistantProvider_(providerRequest, config, () => ({
      getResponseCode: () => 200,
      getContentText: () => JSON.stringify({
        status: 'completed',
        output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'No' }] }]
      })
    })),
    /could not complete/i
  );
});

test('refuses while disabled before reading config-dependent data or the workbook', () => {
  resetCounters();
  resetProperties({ OPENAI_API_KEY: 'sk-test-secret-123' });
  assert.throws(() => callService(), /not enabled/i);
  assert.deepEqual(counters, {
    validate: 0, dashboard: 0, knowledge: 0, context: 0, catalog: 0, provider: 0, writes: 0
  });
});

test('refuses a missing API key before request validation or dashboard read', () => {
  resetCounters();
  resetProperties({ FEATURE_AI_HELPER: 'true' });
  assert.throws(() => callService(), /not configured/i);
  assert.equal(counters.validate, 0);
  assert.equal(counters.dashboard, 0);
  assert.equal(counters.provider, 0);
});

test('rejects oversized, unknown-scope, missing-project, and extra-field requests before reading data', () => {
  enableAi();
  const invalidRequests = [
    request({ question: 'x'.repeat(801) }),
    request({ scope: 'everything' }),
    request({ scope: 'project', projectId: '' }),
    { ...request(), extra: true }
  ];
  invalidRequests.forEach((invalid) => {
    resetCounters();
    assert.throws(() => callService({ request: invalid }));
    assert.equal(counters.dashboard, 0);
    assert.equal(counters.provider, 0);
  });
});

test('requires an active selected viewer before context or provider work', () => {
  resetCounters();
  enableAi();
  dashboardFixture = dashboard({ viewer: { profileKey: '', displayName: '', isActive: false } });
  assert.throws(() => callService(), /active member profile/i);
  assert.equal(counters.dashboard, 1);
  assert.equal(counters.knowledge, 0);
  assert.equal(counters.context, 0);
  assert.equal(counters.provider, 0);
});

test('rejects unknown or fallback-row project IDs before knowledge or provider work', () => {
  resetCounters();
  enableAi();
  dashboardFixture = dashboard({
    projects: [{ projectId: '', projectKey: 'project-row-7', projectName: 'Missing ID', stage: 'Idea' }]
  });
  assert.throws(
    () => callService({ request: request({ scope: 'project', projectId: 'project-row-7' }) }),
    /project ID was not found/i
  );
  assert.equal(counters.dashboard, 1);
  assert.equal(counters.knowledge, 0);
  assert.equal(counters.provider, 0);
});

test('fails closed when Drive knowledge is enabled but not configured or not installed', () => {
  dashboardFixture = dashboard();
  ['not_configured', 'adapter_not_installed', 'disabled'].forEach((status) => {
    resetCounters();
    enableAi({ FEATURE_DRIVE_KNOWLEDGE: 'true' });
    assert.throws(() => callService({
      collectKnowledge() {
        counters.knowledge += 1;
        return { status, items: [], truncation: { truncated: false } };
      }
    }), /knowledge is enabled but is not configured/i);
    assert.equal(counters.knowledge, 1);
    assert.equal(counters.context, 0);
    assert.equal(counters.provider, 0);
  });
});

test('sanitizes a Drive knowledge loader failure and never calls the provider', () => {
  resetCounters();
  enableAi({ FEATURE_DRIVE_KNOWLEDGE: 'true' });
  dashboardFixture = dashboard();
  let thrown;
  try {
    callService({
      collectKnowledge() {
        counters.knowledge += 1;
        throw new Error('private-folder-id and loader credential');
      }
    });
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown);
  assert.match(thrown.message, /could not be prepared safely/i);
  assert.doesNotMatch(thrown.message, /private-folder|credential/i);
  assert.equal(counters.context, 0);
  assert.equal(counters.provider, 0);
});

test('cannot include knowledge items when the Drive feature flag is off', () => {
  resetCounters();
  enableAi();
  dashboardFixture = dashboard();
  let contextOptions;
  callService({
    collectKnowledge() {
      counters.knowledge += 1;
      return {
        status: 'ready',
        items: [{
          sourceId: 'knowledge:1',
          type: 'knowledge',
          title: 'Must stay out',
          mimeType: 'text/plain',
          excerpt: 'Not enabled'
        }],
        truncation: { truncated: false }
      };
    },
    buildContext(currentDashboard, validRequest, options) {
      contextOptions = options;
      return defaultContextBuilder(currentDashboard, validRequest, options);
    }
  });
  assert.deepEqual(plain(contextOptions.knowledge), []);
});

test('allows a ready bounded knowledge result and keeps folder IDs private', () => {
  resetCounters();
  enableAi({
    FEATURE_DRIVE_KNOWLEDGE: 'true',
    SKS_START_FOLDER_ID: 'private-folder-12345'
  });
  dashboardFixture = dashboard();
  let capturedInput = '';
  const result = plain(callService({
    collectKnowledge() {
      counters.knowledge += 1;
      return {
        status: 'ready',
        items: [{
          sourceId: 'knowledge:1',
          type: 'knowledge',
          title: 'Refill guide',
          mimeType: 'text/plain',
          excerpt: 'Use the existing refill-station checklist.'
        }],
        truncation: { truncated: false }
      };
    },
    callProvider(providerRequest) {
      counters.provider += 1;
      capturedInput = providerRequest.inputText;
      return modelResponse({
        knownFacts: [{
          fact: 'A refill-station checklist is available.',
          sourceIds: ['knowledge:1']
        }],
        relevantItemIds: []
      });
    }
  }));
  assert.equal(counters.provider, 1);
  assert.deepEqual(result.knownFacts[0].sources, [{
    type: 'knowledge', id: 'knowledge:1', title: 'Refill guide'
  }]);
  assert.doesNotMatch(capturedInput, /private-folder-12345/);
});

test('performs one dashboard read and one provider call and hydrates only catalog items', () => {
  resetCounters();
  enableAi();
  dashboardFixture = dashboard();
  const result = plain(callService());

  assert.equal(counters.dashboard, 1);
  assert.equal(counters.knowledge, 1);
  assert.equal(counters.context, 1);
  assert.equal(counters.catalog, 1);
  assert.equal(counters.provider, 1);
  assert.deepEqual(result, {
    schemaVersion: 'start-assistant-response/v1',
    scope: 'work',
    answer: 'Finish the sign check and record what changed.',
    knownFacts: [{
      fact: 'The sign check is Doing.',
      sources: [{ type: 'task', id: 'TASK-001', title: 'Check refill station signs' }]
    }],
    missingInformation: [],
    suggestedNextActions: ['Check the remaining signs.'],
    relevantItems: [{
      type: 'task', id: 'TASK-001', title: 'Check refill station signs', status: 'Doing'
    }]
  });
  assert.equal(JSON.stringify(result).includes('avery@example.test'), false);
});

test('integrates the production request, context, knowledge, and catalog contracts', () => {
  resetCounters();
  enableAi();
  dashboardFixture = dashboard({
    tasks: [{
      taskId: 'TASK-001',
      taskKey: 'TASK-001',
      task: 'Check refill station signs',
      status: 'Doing',
      claimedBy: 'avery@example.test',
      claimedByDisplay: 'Avery Student',
      isMine: true
    }]
  });
  let capturedInput = '';
  const result = plain(sandbox.askStartAssistantWithDependencies_(
    'avery@example.test',
    request(),
    {
      getDashboardData() {
        counters.dashboard += 1;
        return dashboardFixture;
      },
      callProvider(providerRequest) {
        counters.provider += 1;
        capturedInput = providerRequest.inputText;
        return modelResponse();
      }
    }
  ));
  assert.equal(counters.dashboard, 1);
  assert.equal(counters.provider, 1);
  assert.equal(result.scope, 'work');
  assert.deepEqual(result.relevantItems, [{
    type: 'task', id: 'TASK-001', title: 'Check refill station signs', status: 'Doing'
  }]);
  assert.doesNotMatch(capturedInput, /avery@example\.test|sk-test-secret-123/i);
  assert.match(capturedInput, /assistant-context\/v1/);
  assert.match(capturedInput, /task:TASK-001/);
});

test('accepts omitted optional scope and project ID and resolves auto deterministically', () => {
  resetCounters();
  enableAi();
  dashboardFixture = dashboard({
    tasks: [{
      taskId: 'TASK-001',
      task: 'Check refill station signs',
      status: 'Open',
      claimedBy: '',
      claimedByDisplay: ''
    }]
  });
  const result = plain(sandbox.askStartAssistantWithDependencies_(
    'avery@example.test',
    { question: 'What can I work on?' },
    {
      getDashboardData: () => dashboardFixture,
      callProvider: () => modelResponse({
        answer: 'The sign check is open.',
        knownFacts: [{ fact: 'The sign check is Open.', sourceIds: ['task:TASK-001'] }]
      })
    }
  ));
  assert.equal(result.scope, 'work');
  assert.equal(result.relevantItems[0].id, 'TASK-001');
});

test('hydrates project stage but never exposes model-supplied titles or links', () => {
  resetCounters();
  enableAi();
  dashboardFixture = dashboard();
  const result = plain(callService({
    callProvider() {
      counters.provider += 1;
      return modelResponse({
        knownFacts: [{ fact: 'The project is Active.', sourceIds: ['project:PRJ-001'] }],
        relevantItemIds: ['project:PRJ-001']
      });
    }
  }));
  assert.deepEqual(result.knownFacts[0].sources, [
    { type: 'project', id: 'PRJ-001', title: 'Refill stations' }
  ]);
  assert.deepEqual(result.relevantItems, [
    { type: 'project', id: 'PRJ-001', title: 'Refill stations', stage: 'Active' }
  ]);
  assert.equal(Object.prototype.hasOwnProperty.call(result.relevantItems[0], 'url'), false);
});

test('rejects malformed, extra, oversized, duplicate, and unavailable model fields', () => {
  resetCounters();
  enableAi();
  dashboardFixture = dashboard();
  const invalidOutputs = [
    { answer: 'Missing fields' },
    { ...modelResponse(), extra: 'not allowed' },
    modelResponse({ answer: 'x'.repeat(6001) }),
    modelResponse({
      knownFacts: [{ fact: 'Duplicate sources', sourceIds: ['task:TASK-001', 'task:TASK-001'] }]
    }),
    modelResponse({
      knownFacts: [{ fact: 'Unknown source', sourceIds: ['task:NOT-AVAILABLE'] }]
    }),
    modelResponse({
      knownFacts: [
        { fact: 'The task is Doing.', sourceIds: ['task:TASK-001'] },
        { fact: '  the task is   doing. ', sourceIds: ['task:TASK-001'] }
      ]
    }),
    modelResponse({ missingInformation: ['The due date', '  the DUE date  '] }),
    modelResponse({ suggestedNextActions: ['Check the signs', ' check  the signs '] }),
    modelResponse({ relevantItemIds: ['knowledge:1'] })
  ];

  invalidOutputs.forEach((output) => {
    resetCounters();
    assert.throws(
      () => callService({
        buildContext(currentDashboard, validRequest) {
          const context = defaultContextBuilder(currentDashboard, validRequest, {
            knowledge: [{ sourceId: 'knowledge:1', title: 'Guide excerpt' }]
          });
          return context;
        },
        callProvider() {
          counters.provider += 1;
          return output;
        }
      }),
      /could not complete/i
    );
    assert.equal(counters.provider, 1);
  });
});

test('rejects secrets and email addresses from model output without returning them', () => {
  enableAi();
  dashboardFixture = dashboard();
  [
    modelResponse({ answer: 'The credential is sk-test-secret-123.' }),
    modelResponse({ answer: 'Contact private.student@example.test.' })
  ].forEach((output) => {
    let thrown;
    try {
      callService({ callProvider: () => output });
    } catch (error) {
      thrown = error;
    }
    assert.ok(thrown);
    assert.match(thrown.message, /could not complete/i);
    assert.doesNotMatch(thrown.message, /sk-test-secret|private\.student/i);
  });
});

test('never sends viewer email, stored owner email, or API key in model input', () => {
  resetCounters();
  enableAi();
  dashboardFixture = dashboard();
  let capturedRequest;
  callService({
    callProvider(providerRequest) {
      counters.provider += 1;
      capturedRequest = providerRequest;
      return modelResponse();
    }
  });
  assert.ok(capturedRequest);
  assert.doesNotMatch(capturedRequest.inputText, /avery@example\.test/i);
  assert.doesNotMatch(capturedRequest.inputText, /sk-test-secret-123/i);
  assert.match(capturedRequest.instructions, /untrusted quoted data/i);
  assert.match(capturedRequest.instructions, /never claim that Storm King is carbon neutral/i);
  assert.match(capturedRequest.instructions, /never claim to have changed/i);
});

test('refuses unsafe context before making a provider call', () => {
  resetCounters();
  enableAi();
  dashboardFixture = dashboard();
  assert.throws(() => callService({
    buildContext(currentDashboard, validRequest, options) {
      const context = defaultContextBuilder(currentDashboard, validRequest, options);
      context.commandCenter.privateContact = 'hidden.person@example.test';
      return context;
    }
  }), /safely prepare/i);
  assert.equal(counters.provider, 0);
});

test('model output remains read-only data and AI modules contain no mutation or logging APIs', () => {
  resetCounters();
  enableAi();
  dashboardFixture = dashboard();
  const before = JSON.stringify(dashboardFixture);
  const result = callService({
    callProvider() {
      counters.provider += 1;
      return modelResponse({ suggestedNextActions: ['Mark the task Done after the work is actually complete.'] });
    }
  });
  assert.equal(JSON.stringify(dashboardFixture), before);
  assert.equal(counters.writes, 0);
  assert.match(result.suggestedNextActions[0], /Mark the task Done/);

  const aiSource = SOURCES.filter((name) => name !== 'Config.gs' && name !== 'ProgramSnapshot.gs')
    .map((name) => fs.readFileSync(path.join(SERVER, name), 'utf8'))
    .join('\n');
  assert.doesNotMatch(aiSource, /\bLockService\b|\.setValue\s*\(|\.setValues\s*\(|\.appendRow\s*\(|\bflush_\s*\(/);
  assert.doesNotMatch(aiSource, /\bLogger\b|console\.(?:log|error|warn)/);
});

test('adds one Ask START browser endpoint and only the external-request future scope', () => {
  const code = fs.readFileSync(path.join(SERVER, 'Code.gs'), 'utf8');
  assert.equal((code.match(/function askStartAssistant\s*\(/g) || []).length, 1);
  const newModules = SOURCES.filter((name) => name.startsWith('Assistant'))
    .map((name) => fs.readFileSync(path.join(SERVER, name), 'utf8'))
    .join('\n');
  const functionNames = [...newModules.matchAll(/^function\s+([A-Za-z0-9_$]+)\s*\(/gm)]
    .map((match) => match[1]);
  assert.equal(functionNames.every((name) => name.endsWith('_')), true);
  assert.doesNotMatch(newModules, /^(?:var|let|const)\s+[A-Za-z_$][\w$]*\s*=/m);

  const manifest = JSON.parse(fs.readFileSync(path.join(SERVER, 'appsscript.json'), 'utf8'));
  assert.equal(
    manifest.oauthScopes.filter((scope) => scope === 'https://www.googleapis.com/auth/script.external_request').length,
    1
  );
  assert.equal(manifest.oauthScopes.some((scope) => /\/auth\/drive(?:\.|$)/.test(scope)), false);
});

test('loads every assistant module in reverse order without top-level execution dependencies', () => {
  const reverseSandbox = {
    Object, Array, Number, String, RegExp, Math, JSON, Date, Error, isNaN
  };
  vm.createContext(reverseSandbox);
  SOURCES.filter((name) => name !== 'Config.gs').reverse().forEach((fileName) => {
    const filePath = path.join(SERVER, fileName);
    vm.runInContext(fs.readFileSync(filePath, 'utf8'), reverseSandbox, { filename: filePath });
  });
  assert.equal(typeof reverseSandbox.askStartAssistantWithDependencies_, 'function');
  assert.equal(typeof reverseSandbox.callAssistantProvider_, 'function');
  assert.equal(typeof reverseSandbox.assistantDefaults_, 'function');
});

let failures = 0;
for (const { name, work } of tests) {
  try {
    resetCounters();
    dashboardFixture = dashboard();
    work();
    console.log(`\u2713 ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`\u2717 ${name}`);
    console.error(error.stack || error);
  }
}

if (failures) {
  console.error(`\n${failures}/${tests.length} assistant service/provider tests failed.`);
  process.exit(1);
}

console.log(`\n${tests.length}/${tests.length} assistant service/provider tests passed.`);
