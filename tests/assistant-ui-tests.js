#!/usr/bin/env node

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const INDEX_PATH = path.resolve(__dirname, '..', 'apps-script', 'Index.html');
const html = fs.readFileSync(INDEX_PATH, 'utf8');
const inlineMatch = html.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(inlineMatch, 'Index.html contains an inline application script');
const inlineSource = inlineMatch[1];

const tests = [];

function test(name, work) {
  tests.push({ name, work });
}

class FakeClassList {
  constructor(initial = '') {
    this.values = new Set(String(initial).split(/\s+/).filter(Boolean));
  }

  add(name) { this.values.add(name); }
  remove(name) { this.values.delete(name); }
  contains(name) { return this.values.has(name); }
  toggle(name, force) {
    const next = force === undefined ? !this.values.has(name) : !!force;
    if (next) this.values.add(name);
    else this.values.delete(name);
    return next;
  }
}

class FakeElement {
  constructor(attributes = {}, options = {}) {
    this.attributes = { ...attributes };
    this.hidden = !!options.hidden;
    this.disabled = false;
    this.innerHTML = '';
    this.textContent = '';
    this.value = '';
    this.classList = new FakeClassList(options.className || '');
    this.inNavigation = !!options.inNavigation;
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name)
      ? this.attributes[name]
      : null;
  }

  setAttribute(name, value) { this.attributes[name] = String(value); }
  removeAttribute(name) { delete this.attributes[name]; }
  closest(selector) { return selector === 'nav' && this.inNavigation ? this : null; }
  matches() { return false; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  focus() {}
  scrollIntoView() {}
  setSelectionRange() {}
}

function dashboardPayload(aiHelper) {
  return {
    capabilities: { aiHelper },
    viewer: {
      authMode: 'google-email',
      email: 'student@example.edu',
      profileKey: 'student@example.edu',
      displayName: 'Student Member',
      isActive: true
    },
    members: [
      { profileKey: 'student@example.edu', displayName: 'Student Member', isActive: true }
    ],
    tasks: [
      { id: 'T-001', key: 'T-001', title: 'Audit waste', status: 'Open', isOpen: true }
    ],
    projects: [
      { id: 'P-001', projectKey: 'P-001', name: 'Waste Reduction', stage: 'Active' }
    ],
    metrics: [{ id: 'M-001', name: 'Waste metric' }],
    updates: [],
    summary: {},
    projectWorkflow: {},
    generatedAt: '2026-08-20T12:00:00.000Z'
  };
}

function instrumentSource(source) {
  const marker = "      if (!window.location.hash || assistantHashIsActive()) window.history.replaceState(null, '', '#home');";
  assert.ok(source.includes(marker), 'test hook marker remains available');
  return source.replace(marker, [
    '      window.__assistantTestHooks = {',
    '        state: state,',
    '        ingest: ingest,',
    '        render: render,',
    '        renderAssistant: renderAssistant,',
    '        navigate: navigate,',
    '        normalizeAssistantResponse: normalizeAssistantResponse,',
    '        submitAssistantQuestion: submitAssistantQuestion,',
    '        clearAssistantConversation: clearAssistantConversation,',
    '        serverCall: serverCall',
    '      };',
    marker
  ].join('\n'));
}

async function createHarness({ hash = '#home', aiHelper = true } = {}) {
  const ids = new Map();
  const events = { document: {}, window: {} };
  const storageCalls = [];
  const views = ['home', 'tasks', 'projects', 'assistant'].map((name) => {
    const element = new FakeElement({ 'data-view': name }, {
      hidden: name !== 'home',
      className: 'view'
    });
    ids.set(`view-${name}`, element);
    return element;
  });
  const navigationButtons = [];
  ['desktop', 'mobile'].forEach(() => {
    ['home', 'tasks', 'projects', 'assistant'].forEach((name) => {
      navigationButtons.push(new FakeElement({ 'data-view-target': name }, {
        hidden: name === 'assistant',
        className: 'nav-button',
        inNavigation: true
      }));
    });
  });
  const mobileNavigation = new FakeElement({}, { className: 'mobile-nav' });

  function elementById(id) {
    if (!ids.has(id)) ids.set(id, new FakeElement({ id }));
    return ids.get(id);
  }

  const document = {
    getElementById: elementById,
    querySelectorAll(selector) {
      if (selector === '[data-view-target]') return navigationButtons;
      if (selector === '.view') return views;
      if (selector === '.mobile-nav') return [mobileNavigation];
      return [];
    },
    querySelector() { return null; },
    addEventListener(type, handler) { events.document[type] = handler; }
  };

  const location = { hash };
  const controller = {
    calls: [],
    pendingAssistant: null,
    dashboard: dashboardPayload(aiHelper)
  };
  const runner = {
    successHandler: null,
    failureHandler: null,
    withSuccessHandler(handler) {
      this.successHandler = handler;
      return this;
    },
    withFailureHandler(handler) {
      this.failureHandler = handler;
      return this;
    },
    getDashboardData(profileKey) {
      controller.calls.push({ method: 'getDashboardData', args: [profileKey] });
      const success = this.successHandler;
      Promise.resolve().then(() => success(controller.dashboard));
    },
    askStartAssistant(profileKey, request) {
      controller.calls.push({ method: 'askStartAssistant', args: [profileKey, request] });
      controller.pendingAssistant = {
        resolve: this.successHandler,
        reject: this.failureHandler
      };
    }
  };
  const google = { script: { run: runner } };
  const window = {
    location,
    google,
    localStorage: {
      getItem(key) { storageCalls.push({ action: 'get', key }); return ''; },
      setItem(key, value) { storageCalls.push({ action: 'set', key, value }); },
      removeItem(key) { storageCalls.push({ action: 'remove', key }); }
    },
    history: {
      replaceState(_state, _title, nextHash) { location.hash = nextHash; }
    },
    addEventListener(type, handler) { events.window[type] = handler; },
    requestAnimationFrame(handler) { handler(); },
    setTimeout() { return 1; },
    clearTimeout() {},
    scrollTo() {}
  };

  const sandbox = {
    console,
    window,
    document,
    google,
    URL,
    Intl,
    Date,
    Error,
    Object,
    Array,
    Number,
    String,
    RegExp,
    Math,
    JSON,
    Promise,
    FormData: class {},
    setTimeout: window.setTimeout,
    clearTimeout: window.clearTimeout
  };
  vm.createContext(sandbox);
  vm.runInContext(instrumentSource(inlineSource), sandbox, { filename: INDEX_PATH });
  await new Promise((resolve) => setImmediate(resolve));
  return {
    window,
    document,
    controller,
    navigationButtons,
    mobileNavigation,
    views,
    ids,
    storageCalls,
    hooks: window.__assistantTestHooks
  };
}

function validAssistantResponse(overrides = {}) {
  return {
    schemaVersion: 'start-assistant-response/v1',
    scope: 'work',
    answer: 'Start with the open waste audit.',
    knownFacts: [
      {
        fact: 'The waste audit is open.',
        sources: [{ type: 'task', id: 'T-001', title: 'Audit waste' }]
      }
    ],
    missingInformation: ['Who can join the audit?'],
    suggestedNextActions: ['Claim the task if it fits your time.'],
    relevantItems: [{ type: 'task', id: 'T-001', title: 'Audit waste', status: 'Open' }],
    ...overrides
  };
}

test('keeps both navigation entries and the assistant view statically hidden', () => {
  const hiddenNav = html.match(/<button[^>]*data-view-target="assistant"[^>]*data-ai-only[^>]*hidden[^>]*>/g) || [];
  assert.equal(hiddenNav.length, 2, 'desktop and mobile Ask START buttons start hidden');
  assert.match(html, /<section[^>]*data-view="assistant"[^>]*data-ai-only[^>]*hidden/);
  assert.match(html, /\[data-ai-only\]\[hidden\]\s*\{\s*display:\s*none\s*!important/);
  assert.match(html, /\.mobile-nav\.ai-enabled\s*\{\s*grid-template-columns:\s*repeat\(4,/);
});

test('uses only an exact dashboard capability boolean as the visibility signal', () => {
  assert.match(inlineSource, /state\.aiHelperEnabled\s*=\s*state\.capabilities\.aiHelper\s*===\s*true/);
  assert.doesNotMatch(inlineSource, /bool\([^\n]*aiHelper/);
  assert.doesNotMatch(inlineSource, /FEATURE_AI_HELPER/);
});

test('redirects a direct disabled assistant hash to Home with no visible controls', async () => {
  const harness = await createHarness({ hash: '#assistant', aiHelper: false });
  assert.equal(harness.window.location.hash, '#home');
  assert.equal(harness.hooks.state.view, 'home');
  harness.navigationButtons.filter((button) => button.getAttribute('data-view-target') === 'assistant')
    .forEach((button) => assert.equal(button.hidden, true));
  assert.equal(harness.views.find((view) => view.getAttribute('data-view') === 'assistant').hidden, true);
  assert.equal(harness.ids.get('assistant-content').innerHTML, '');
});

test('shows the gated view only for true and clears it immediately on capability loss', async () => {
  const harness = await createHarness({ aiHelper: true });
  harness.hooks.navigate('assistant');
  assert.equal(harness.hooks.state.view, 'assistant');
  assert.equal(harness.views.find((view) => view.getAttribute('data-view') === 'assistant').hidden, false);
  harness.navigationButtons.filter((button) => button.getAttribute('data-view-target') === 'assistant')
    .forEach((button) => assert.equal(button.hidden, false));
  assert.equal(harness.mobileNavigation.classList.contains('ai-enabled'), true);

  harness.hooks.state.assistantDraft = 'private draft';
  harness.hooks.state.assistantStatus = 'populated';
  harness.hooks.state.assistantResponse = harness.hooks.normalizeAssistantResponse(validAssistantResponse());
  harness.hooks.ingest(dashboardPayload('true'));
  harness.hooks.render();
  assert.equal(harness.hooks.state.aiHelperEnabled, false, 'the string true stays disabled');
  assert.equal(harness.hooks.state.assistantDraft, '');
  assert.equal(harness.hooks.state.assistantResponse, null);
  assert.equal(harness.hooks.state.view, 'home');
  assert.equal(harness.window.location.hash, '#home');
});

test('renders all returned values as escaped plain text without links or Markdown parsing', async () => {
  const harness = await createHarness({ aiHelper: true });
  harness.hooks.state.assistantStatus = 'populated';
  harness.hooks.state.assistantResponse = harness.hooks.normalizeAssistantResponse(validAssistantResponse({
    answer: '<img src=x onerror=alert(1)> **bold** [open](javascript:alert(1))',
    knownFacts: [{
      fact: '<script>alert(2)</script>',
      sources: [{ type: 'knowledge', id: 'knowledge:1', title: '<b>unsafe title</b>' }]
    }],
    missingInformation: ['<svg onload=alert(3)>'],
    suggestedNextActions: ['[click me](https://example.test)'],
    relevantItems: [{ type: 'unknown', id: '" onmouseover="alert(4)', title: '<em>unknown</em>' }]
  }));
  harness.hooks.renderAssistant();
  const output = harness.ids.get('assistant-content').innerHTML;
  assert.match(output, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(output, /\*\*bold\*\*/);
  assert.match(output, /\[open\]\(javascript:alert\(1\)\)/);
  assert.match(output, /&lt;script&gt;alert\(2\)&lt;\/script&gt;/);
  assert.match(output, /&lt;b&gt;unsafe title&lt;\/b&gt;/);
  assert.doesNotMatch(output, /<img|<script|<svg|<em>|<b>/i);
  assert.doesNotMatch(output, /<a\b|href=/i);
  assert.doesNotMatch(inlineSource, /marked\s*\(|markdown-it|showdown|dangerouslySetInnerHTML/i);
});

test('keeps assistant drafts in memory and limits the question field to 800 characters', () => {
  assert.match(html, /id="assistant-question"[^>]*maxlength="800"/);
  const storageLines = inlineSource.split('\n').filter((line) => line.includes('localStorage'));
  assert.ok(storageLines.length > 0, 'member selection still uses local storage');
  storageLines.forEach((line) => assert.doesNotMatch(line, /assistant|question|response/i));
  assert.doesNotMatch(inlineSource, /STORAGE_KEY[^\n]*(assistant|question|response)/i);
});

test('dispatches the exact public request and ignores a stale completion after reset', async () => {
  const harness = await createHarness({ aiHelper: true });
  harness.hooks.state.assistantDraft = 'What can I work on?';
  harness.hooks.state.assistantScope = 'work';
  harness.hooks.state.assistantProjectId = 'P-001';
  const pending = harness.hooks.submitAssistantQuestion();
  const call = harness.controller.calls.find((item) => item.method === 'askStartAssistant');
  assert.ok(call, 'the UI calls askStartAssistant');
  assert.equal(call.args[0], 'student@example.edu');
  assert.deepEqual(JSON.parse(JSON.stringify(call.args[1])), {
    question: 'What can I work on?',
    scope: 'work',
    projectId: ''
  });
  assert.match(inlineSource, /runner\.askStartAssistant\(args\[0\], args\[1\]\)/);

  harness.hooks.clearAssistantConversation();
  harness.controller.pendingAssistant.resolve(validAssistantResponse());
  await pending;
  assert.equal(harness.hooks.state.assistantStatus, 'initial');
  assert.equal(harness.hooks.state.assistantResponse, null);
  assert.equal(harness.hooks.state.assistantDraft, '');
});

test('preserves the draft on failure and rejects an oversized question before dispatch', async () => {
  const harness = await createHarness({ aiHelper: true });
  harness.hooks.state.assistantDraft = 'What is blocked?';
  harness.hooks.state.assistantScope = 'waiting';
  const pending = harness.hooks.submitAssistantQuestion();
  harness.controller.pendingAssistant.reject(new Error('Provider unavailable'));
  await pending;
  assert.equal(harness.hooks.state.assistantStatus, 'error');
  assert.equal(harness.hooks.state.assistantDraft, 'What is blocked?');
  assert.equal(harness.hooks.state.assistantError, 'Provider unavailable');

  const callCount = harness.controller.calls.length;
  harness.hooks.state.assistantDraft = 'x'.repeat(801);
  await harness.hooks.submitAssistantQuestion();
  assert.equal(harness.controller.calls.length, callCount);
  assert.equal(harness.hooks.state.assistantStatus, 'error');
  assert.match(harness.hooks.state.assistantError, /800 characters/);
});

test('requires exact known Project IDs for project and proposal requests', async () => {
  const harness = await createHarness({ aiHelper: true });
  harness.hooks.state.assistantDraft = 'Draft a proposal.';
  harness.hooks.state.assistantScope = 'proposal';
  harness.hooks.state.assistantProjectId = 'p-001';
  await harness.hooks.submitAssistantQuestion();
  assert.equal(harness.controller.calls.filter((call) => call.method === 'askStartAssistant').length, 0);
  assert.match(harness.hooks.state.assistantError, /Choose a project/);

  harness.hooks.state.assistantProjectId = 'P-001';
  const pending = harness.hooks.submitAssistantQuestion();
  const call = harness.controller.calls.find((item) => item.method === 'askStartAssistant');
  assert.deepEqual(JSON.parse(JSON.stringify(call.args[1])), {
    question: 'Draft a proposal.',
    scope: 'proposal',
    projectId: 'P-001'
  });
  harness.controller.pendingAssistant.resolve(validAssistantResponse({ scope: 'proposal' }));
  await pending;
});

(async () => {
  let failures = 0;
  for (const { name, work } of tests) {
    try {
      await work();
      console.log(`✓ ${name}`);
    } catch (error) {
      failures += 1;
      console.error(`✗ ${name}`);
      console.error(error && error.stack ? error.stack : error);
    }
  }
  if (failures) process.exitCode = 1;
  else console.log(`\n${tests.length}/${tests.length} assistant UI tests passed.`);
})();
