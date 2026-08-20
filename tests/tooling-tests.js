#!/usr/bin/env node

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  EXPECTED_SOURCE_ROOT,
  REQUIRED_CLASP_VERSION,
  applyRemoteOnlyPolicy,
  assertDeploymentUpdated,
  assertNoRemoteOnly,
  commandFor,
  compareRuntimeDirectories,
  loadConfiguration,
  parseJsonOutput,
  runChecks,
  validateConfiguration,
  verifyNodeVersion
} = require('../scripts/gas-tooling');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT_ID = '12Ex89VwthU9KQo0txTbhvdl-4hIpZe5SjpbEnekFGz5gbYaNRdm2S0Dg';
const DEPLOYMENT_ID = 'AKfycbwuBPUusFBHHILfJ8ySalyHmI5Fk5tVff4z5cEUUZo0sgPviBwc2szUMqi4tVixyayZ';
const tests = [];

function test(name, work) {
  tests.push({ name, work });
}

function validDeployment(overrides = {}) {
  return {
    scriptId: SCRIPT_ID,
    deploymentId: DEPLOYMENT_ID,
    sourceRoot: EXPECTED_SOURCE_ROOT,
    ...overrides
  };
}

function validClasp(overrides = {}) {
  return { scriptId: SCRIPT_ID, rootDir: EXPECTED_SOURCE_ROOT, ...overrides };
}

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sks-start-tooling-test-'));
}

test('loads the ignored local Script ID, Deployment ID, and source root', () => {
  const config = loadConfiguration(ROOT);
  assert.equal(config.scriptId, SCRIPT_ID);
  assert.equal(config.deploymentId, DEPLOYMENT_ID);
  assert.equal(config.sourceRoot, 'apps-script');
});

test('rejects a malformed deployment configuration', () => {
  const directory = temporaryDirectory();
  fs.writeFileSync(path.join(directory, '.gas-deploy.json'), '{broken', 'utf8');
  fs.writeFileSync(path.join(directory, '.clasp.json'), JSON.stringify(validClasp()), 'utf8');
  assert.throws(() => loadConfiguration(directory), /malformed JSON/i);
  fs.rmSync(directory, { recursive: true, force: true });
});

test('rejects a malformed clasp project configuration', () => {
  const directory = temporaryDirectory();
  fs.writeFileSync(path.join(directory, '.gas-deploy.json'), JSON.stringify(validDeployment()), 'utf8');
  fs.writeFileSync(path.join(directory, '.clasp.json'), '{broken', 'utf8');
  assert.throws(() => loadConfiguration(directory), /malformed JSON/i);
  fs.rmSync(directory, { recursive: true, force: true });
});

test('rejects missing local deployment configuration', () => {
  const directory = temporaryDirectory();
  fs.writeFileSync(path.join(directory, '.clasp.json'), JSON.stringify(validClasp()), 'utf8');
  assert.throws(() => loadConfiguration(directory), /missing.*gas:configure/i);
  fs.rmSync(directory, { recursive: true, force: true });
});

test('rejects a source root outside apps-script', () => {
  assert.throws(
    () => validateConfiguration(validDeployment({ sourceRoot: '.' }), validClasp({ rootDir: '.' })),
    /sourceRoot must be exactly "apps-script"/
  );
});

test('rejects mismatched Script IDs', () => {
  assert.throws(
    () => validateConfiguration(validDeployment(), validClasp({ scriptId: `${SCRIPT_ID}x` })),
    /Script IDs differ/
  );
});

test('constructs a forced push only for the configured Apps Script project', () => {
  const args = commandFor('push', validateConfiguration(validDeployment(), validClasp()));
  assert.deepEqual(args, ['--project', '.clasp.json', 'push', '--force']);
  assert.ok(!args.includes('deploy'));
});

test('constructs an update for the existing permanent deployment and explicit version', () => {
  const config = validateConfiguration(validDeployment(), validClasp());
  const args = commandFor('update', config, { versionNumber: 27, description: 'Reviewed release' });
  assert.ok(args.includes('update-deployment'));
  assert.ok(args.includes(DEPLOYMENT_ID));
  assert.ok(args.includes('27'));
  assert.ok(!args.includes('create-deployment'));
  assert.ok(!args.includes('deploy'));
});

test('requires a positive explicit version for production deployment updates', () => {
  const config = validateConfiguration(validDeployment(), validClasp());
  assert.throws(() => commandFor('update', config, { versionNumber: 0 }), /positive.*version/i);
});

test('rejects a deployment response for a different ID or version', () => {
  const config = validateConfiguration(validDeployment(), validClasp());
  assert.throws(
    () => assertDeploymentUpdated({ deploymentId: 'different_deployment_identifier', versionNumber: 27 }, config, 27),
    /did not confirm/i
  );
  assert.throws(
    () => assertDeploymentUpdated({ deploymentId: DEPLOYMENT_ID, versionNumber: 26 }, config, 27),
    /did not confirm/i
  );
  assert.doesNotThrow(() => (
    assertDeploymentUpdated({ deploymentId: DEPLOYMENT_ID, versionNumber: 27 }, config, 27)
  ));
});

test('stops the required-check sequence at the first failed test command', () => {
  const calls = [];
  const runner = (executable, args) => {
    calls.push([executable, args]);
    throw new Error('simulated test failure');
  };
  assert.throws(() => runChecks(runner), /simulated test failure/);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][1], ['test']);
});

test('compares runtime trees without overwriting either side', () => {
  const directory = temporaryDirectory();
  const local = path.join(directory, 'local');
  const remote = path.join(directory, 'remote');
  fs.mkdirSync(local);
  fs.mkdirSync(remote);
  fs.writeFileSync(path.join(local, 'Code.gs'), 'function local() {}\n', 'utf8');
  fs.writeFileSync(path.join(local, 'Index.html'), '<p>same</p>\n', 'utf8');
  fs.writeFileSync(path.join(remote, 'Code.gs'), 'function remote() {}\n', 'utf8');
  fs.writeFileSync(path.join(remote, 'Index.html'), '<p>same</p>\n', 'utf8');
  fs.writeFileSync(path.join(remote, 'RemoteOnly.gs'), 'function old() {}\n', 'utf8');
  const comparison = compareRuntimeDirectories(local, remote);
  assert.deepEqual(comparison.different, ['Code.gs']);
  assert.deepEqual(comparison.identical, ['Index.html']);
  assert.deepEqual(comparison.remoteOnly, ['RemoteOnly.gs']);
  assert.equal(fs.readFileSync(path.join(local, 'Code.gs'), 'utf8'), 'function local() {}\n');
  fs.rmSync(directory, { recursive: true, force: true });
});

test('treats clasp-cloned .js and local .gs server files as the same logical runtime file', () => {
  const directory = temporaryDirectory();
  const local = path.join(directory, 'local');
  const remote = path.join(directory, 'remote');
  fs.mkdirSync(local);
  fs.mkdirSync(remote);
  fs.writeFileSync(path.join(local, 'Code.gs'), 'function same() {}\n', 'utf8');
  fs.writeFileSync(path.join(remote, 'Code.js'), 'function same() {}\n', 'utf8');

  const comparison = compareRuntimeDirectories(local, remote);
  assert.deepEqual(comparison.identical, ['Code.gs']);
  assert.deepEqual(comparison.different, []);
  assert.deepEqual(comparison.localOnly, []);
  assert.deepEqual(comparison.remoteOnly, []);
  assert.doesNotThrow(() => assertNoRemoteOnly([comparison]));
  fs.rmSync(directory, { recursive: true, force: true });
});

test('stops a push for remote HEAD-only files but not files only in the deployed version', () => {
  assert.throws(
    () => applyRemoteOnlyPolicy(
      { remoteOnly: ['HeadOnly.gs'] },
      { remoteOnly: [] },
      true
    ),
    /HeadOnly\.gs/
  );
  assert.deepEqual(
    applyRemoteOnlyPolicy(
      { remoteOnly: [] },
      { remoteOnly: ['PreviouslyDeployed.gs'] },
      true
    ),
    ['PreviouslyDeployed.gs']
  );
});

test('compares equivalent Apps Script manifests semantically', () => {
  const directory = temporaryDirectory();
  const local = path.join(directory, 'local');
  const remote = path.join(directory, 'remote');
  fs.mkdirSync(local);
  fs.mkdirSync(remote);
  fs.writeFileSync(path.join(local, 'appsscript.json'), '{"runtimeVersion":"V8","dependencies":{}}\n', 'utf8');
  fs.writeFileSync(
    path.join(remote, 'appsscript.json'),
    '{\n  "dependencies": {},\n  "runtimeVersion": "V8"\n}\n',
    'utf8'
  );
  const comparison = compareRuntimeDirectories(local, remote);
  assert.deepEqual(comparison.identical, ['appsscript.json']);
  assert.deepEqual(comparison.different, []);
  fs.rmSync(directory, { recursive: true, force: true });
});

test('parses an explicit positive version response without accepting malformed JSON', () => {
  assert.deepEqual(parseJsonOutput('{"versionNumber":31}', 'version'), { versionNumber: 31 });
  assert.throws(() => parseJsonOutput('Created version 31', 'version'), /valid JSON/i);
});

test('keeps OAuth and local target files ignored by Git', () => {
  ['.clasprc.json', 'nested/.clasprc.json', '.clasp.json', '.gas-deploy.json', 'client_secret_school.json']
    .forEach((file) => {
      const result = spawnSync('git', ['check-ignore', '--quiet', file], { cwd: ROOT });
      assert.equal(result.status, 0, `${file} is ignored`);
    });
});

test('tracks only Apps Script runtime types below the configured source root', () => {
  const result = spawnSync(
    path.join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'clasp.cmd' : 'clasp'),
    ['--json', '--project', '.clasp.json', 'show-file-status'],
    { cwd: ROOT, encoding: 'utf8' }
  );
  assert.equal(result.status, 0, result.stderr);
  const status = parseJsonOutput(result.stdout, 'clasp status');
  assert.deepEqual(status.untrackedFiles, []);
  assert.ok(status.filesToPush.includes('apps-script/appsscript.json'));
  status.filesToPush.forEach((file) => {
    assert.match(file, /^apps-script\/(?:.*\.gs|.*\.html|appsscript\.json)$/);
  });
});

test('pins the current official clasp release and compatible Node engine', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(packageJson.devDependencies['@google/clasp'], REQUIRED_CLASP_VERSION);
  assert.equal(packageJson.engines.node, '>=20');
  assert.ok(verifyNodeVersion(process.versions.node) >= 20);
  assert.throws(() => verifyNodeVersion('19.9.0'), /requires Node\.js 20 or newer/i);
});

test('release tooling never pulls into the repository or creates a deployment', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'gas-tooling.js'), 'utf8');
  assert.doesNotMatch(source, /['"]pull['"]/);
  assert.doesNotMatch(source, /['"]create-deployment['"]/);
  assert.match(source, /['"]update-deployment['"]/);
});

test('declares only current Spreadsheet and email scopes on the platform manifest', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps-script', 'appsscript.json'), 'utf8'));
  assert.deepEqual(manifest.oauthScopes, [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/userinfo.email'
  ]);
  assert.ok(!manifest.oauthScopes.some((scope) => /drive|external_request/.test(scope)));
});

let passed = 0;
tests.forEach(({ name, work }) => {
  try {
    work();
    passed += 1;
    process.stdout.write(`✓ ${name}\n`);
  } catch (error) {
    process.stderr.write(`✗ ${name}\n${error.stack || error.message}\n`);
  }
});

process.stdout.write(`\n${passed}/${tests.length} tooling tests passed.\n`);
if (passed !== tests.length) process.exitCode = 1;
