#!/usr/bin/env node

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const SOURCE_PATH = path.join(ROOT, 'apps-script', 'KnowledgeProviders.gs');
const SOURCE = fs.readFileSync(SOURCE_PATH, 'utf8');
const tests = [];

function test(name, work) {
  tests.push({ name, work });
}

function loadContext(extra = {}) {
  const context = vm.createContext({ ...extra });
  new vm.Script(SOURCE, { filename: SOURCE_PATH }).runInContext(context);
  return context;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function candidate(overrides = {}) {
  return {
    folderId: 'folder-start-private',
    fileId: 'file-private-1',
    title: 'Water audit guidance',
    mimeType: 'application/vnd.google-apps.document',
    text: 'Water audit teams should record a factual baseline before proposing next steps.',
    webViewLink: 'https://private.example/file',
    ...overrides
  };
}

const request = { question: 'How should we prepare the water audit?', scope: 'project', projectId: 'P-1' };
const folderConfig = {
  sksStartFolderId: 'folder-start-private',
  gsaResourceFolderId: 'folder-gsa-private'
};

test('strictly disabled knowledge reads neither folder configuration nor loader', () => {
  const context = loadContext();
  let configReads = 0;
  let loaderCalls = 0;
  const disabled = plain(context.collectAssistantKnowledge_(request, {
    enabled: false,
    getFolderConfig() {
      configReads += 1;
      return folderConfig;
    },
    loader() {
      loaderCalls += 1;
      return [candidate()];
    }
  }));
  assert.equal(disabled.status, 'disabled');
  assert.deepEqual(disabled.items, []);
  assert.equal(configReads, 0);
  assert.equal(loaderCalls, 0);
  assert.equal(context.collectAssistantKnowledge_(request, { enabled: 'true' }).status, 'disabled');
});

test('enabled knowledge requires at least one exact configured folder before loading', () => {
  const context = loadContext();
  let loaderCalls = 0;
  const result = plain(context.collectAssistantKnowledge_(request, {
    enabled: true,
    folderConfig: {},
    loader() {
      loaderCalls += 1;
      return [candidate()];
    }
  }));
  assert.equal(result.status, 'not_configured');
  assert.equal(loaderCalls, 0);
});

test('filters to exact folder allowlist and never returns private identifiers or URLs', () => {
  const context = loadContext();
  const result = plain(context.collectAssistantKnowledge_(request, {
    enabled: true,
    folderConfig,
    candidates: [
      candidate({
        text: 'Water details at https://private.example/doc for teacher@sks.org. ' +
          'Folder folder-start-private and file file-private-1 must stay private.'
      }),
      candidate({ folderId: 'folder-not-allowed', fileId: 'outside-file', title: 'Water outside' })
    ]
  }));
  assert.equal(result.status, 'ready');
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].sourceId, 'knowledge:1');
  const serialized = JSON.stringify(result);
  [
    'folder-start-private', 'folder-gsa-private', 'file-private-1', 'outside-file',
    'https://private.example/doc', 'teacher@sks.org', 'webViewLink', 'folderId', 'fileId'
  ].forEach((privateValue) => assert.ok(!serialized.includes(privateValue), privateValue));
  assert.equal(result.truncation.outsideAllowlistCount, 1);
});

test('supports only the explicit document, spreadsheet, and plain-text MIME allowlist', () => {
  const context = loadContext();
  const candidates = [
    candidate({ fileId: 'doc', mimeType: 'application/vnd.google-apps.document' }),
    candidate({ fileId: 'sheet', title: 'Water audit sheet', mimeType: 'application/vnd.google-apps.spreadsheet' }),
    candidate({ fileId: 'text', title: 'Water audit notes', mimeType: 'text/plain' }),
    candidate({ fileId: 'pdf', title: 'Water audit PDF', mimeType: 'application/pdf' }),
    candidate({ fileId: 'image', title: 'Water audit image', mimeType: 'image/png' })
  ];
  const result = plain(context.collectAssistantKnowledge_(request, {
    enabled: true,
    folderConfig,
    candidates
  }));
  assert.equal(result.items.length, 3);
  assert.equal(result.truncation.unsupportedMimeCount, 2);
  assert.ok(result.items.every((item) => item.type === 'knowledge'));
});

test('excludes irrelevant files and ranks title matches deterministically', () => {
  const context = loadContext();
  const candidates = [
    candidate({ fileId: 'z', title: 'General notes', text: 'A water audit is mentioned here.' }),
    candidate({ fileId: 'a', title: 'Water audit checklist', text: 'Checklist.' }),
    candidate({ fileId: 'x', title: 'Unrelated lunch menu', text: 'Soup and sandwiches.' })
  ];
  const first = plain(context.collectAssistantKnowledge_(request, {
    enabled: true, folderConfig, candidates
  }));
  const second = plain(context.collectAssistantKnowledge_(request, {
    enabled: true, folderConfig, candidates: candidates.slice().reverse()
  }));
  assert.equal(first.items[0].title, 'Water audit checklist');
  assert.ok(!first.items.some((item) => item.title === 'Unrelated lunch menu'));
  assert.deepEqual(first.items, second.items);
  assert.equal(first.truncation.irrelevantCount, 1);
});

test('bounds retrieval to five files, 3000 characters each, and 6000 characters total', () => {
  const context = loadContext();
  const candidates = Array.from({ length: 9 }, (_, index) => candidate({
    fileId: `file-${index}`,
    title: `Water audit ${String(index).padStart(2, '0')}`,
    text: `Water audit ${'x'.repeat(3990)}`
  }));
  const result = plain(context.collectAssistantKnowledge_(request, {
    enabled: true, folderConfig, candidates
  }));
  assert.ok(result.items.length <= 5);
  assert.ok(result.items.every((item) => item.excerpt.length <= 3000));
  assert.ok(result.items.reduce((sum, item) => sum + item.excerpt.length, 0) <= 6000);
  assert.equal(result.truncation.excerptCharacters, 6000);
  assert.equal(result.truncation.truncated, true);
  assert.ok(result.truncation.omittedCount > 0);
});

test('uses a loader only after enablement and passes a sorted defensive allowlist copy', () => {
  const context = loadContext();
  let receivedFolders;
  let receivedRequest;
  const result = plain(context.collectAssistantKnowledge_(request, {
    enabled: true,
    folderConfig: {
      sksStartFolderId: 'z-folder',
      gsaResourceFolderId: 'a-folder'
    },
    loader(folderIds, actualRequest) {
      receivedFolders = folderIds;
      receivedRequest = actualRequest;
      folderIds.push('attempted-mutation');
      return [candidate({ folderId: 'a-folder', fileId: 'loader-file' })];
    }
  }));
  assert.deepEqual(plain(receivedFolders.slice(0, 2)), ['a-folder', 'z-folder']);
  assert.equal(receivedRequest, request);
  assert.equal(result.items.length, 1);
  assert.ok(!JSON.stringify(result).includes('attempted-mutation'));
});

test('selection is pure and request-local source IDs reset for each request', () => {
  const context = loadContext();
  const candidates = [
    candidate({ fileId: 'one', title: 'Water audit one' }),
    candidate({ fileId: 'two', title: 'Water audit two' })
  ];
  const before = JSON.stringify(candidates);
  const first = plain(context.selectAssistantKnowledgeCandidates_(request, candidates, ['folder-start-private']));
  const second = plain(context.selectAssistantKnowledgeCandidates_(request, candidates.slice(1), ['folder-start-private']));
  assert.equal(JSON.stringify(candidates), before);
  assert.deepEqual(first.items.map((item) => item.sourceId), ['knowledge:1', 'knowledge:2']);
  assert.deepEqual(second.items.map((item) => item.sourceId), ['knowledge:1']);
});

test('production adapter remains an explicit inert stub with no service or write capability', () => {
  const context = loadContext();
  const result = plain(context.collectAssistantKnowledge_(request, {
    enabled: true,
    folderConfig
  }));
  assert.equal(result.status, 'adapter_not_installed');
  assert.deepEqual(result.items, []);
  [
    'Drive' + 'App',
    'Url' + 'FetchApp',
    '.setContent(',
    '.setValue(',
    '.createFile(',
    '.addFile(',
    '.removeFile('
  ].forEach((forbidden) => assert.ok(!SOURCE.includes(forbidden), forbidden));
});

let passed = 0;
for (const current of tests) {
  try {
    current.work();
    passed += 1;
    console.log(`✓ ${current.name}`);
  } catch (error) {
    console.error(`✗ ${current.name}`);
    throw error;
  }
}
console.log(`\n${passed}/${tests.length} knowledge provider tests passed.`);
