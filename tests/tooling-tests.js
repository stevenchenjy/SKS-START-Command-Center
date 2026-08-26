#!/usr/bin/env node

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  EXPECTED_SOURCE_ROOT,
  EXPECTED_WEB_APP,
  REQUIRED_CLASP_VERSION,
  applyRemoteOnlyPolicy,
  assertDeploymentUpdated,
  assertNoRemoteOnly,
  assertPermanentWebAppDeployment,
  assertReleaseBranchSynchronized,
  assertReleaseMetadataBumped,
  assertRuntimeSynchronized,
  assertWebAppManifest,
  commandFor,
  compareRuntimeDirectories,
  createVersionReliably,
  ensurePreviousDeploymentRestored,
  loadConfiguration,
  normalizeDeploymentState,
  parseJsonOutput,
  permanentWebAppUrl,
  positiveVersionNumber,
  publishVersionWithRecovery,
  runChecks,
  probePermanentWebApp,
  readWebReleaseMetadata,
  releaseDescription,
  resolveCreatedVersion,
  updatePermanentDeployment,
  validateConfiguration,
  verifyPermanentDeployment,
  verifyNodeVersion
} = require('../scripts/gas-tooling');
const {
  parseRuntimeReleaseMetadata,
  verifyWebReleaseMetadata
} = require('../scripts/verify');

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

function validConfig() {
  return validateConfiguration(validDeployment(), validClasp());
}

function deploymentResource(versionNumber = 27, overrides = {}) {
  const config = validConfig();
  return {
    deploymentId: config.deploymentId,
    deploymentConfig: {
      versionNumber,
      manifestFileName: 'appsscript',
      description: `Version ${versionNumber}`,
      ...(overrides.deploymentConfig || {})
    },
    entryPoints: overrides.entryPoints || [
      {
        entryPointType: 'WEB_APP',
        webApp: {
          url: permanentWebAppUrl(config),
          entryPointConfig: {
            access: EXPECTED_WEB_APP.access,
            executeAs: EXPECTED_WEB_APP.executeAs
          }
        }
      }
    ],
    updateTime: '2026-08-25T00:00:00Z',
    ...overrides,
    deploymentConfig: {
      versionNumber,
      manifestFileName: 'appsscript',
      description: `Version ${versionNumber}`,
      ...(overrides.deploymentConfig || {})
    }
  };
}

function deploymentState(versionNumber = 27, overrides = {}) {
  return { ...normalizeDeploymentState(deploymentResource(versionNumber)), ...overrides };
}

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sks-start-tooling-test-'));
}

test('loads the ignored local Script ID, Deployment ID, and source root', () => {
  const directory = temporaryDirectory();
  fs.copyFileSync(path.join(ROOT, '.clasp.json.example'), path.join(directory, '.clasp.json'));
  fs.copyFileSync(path.join(ROOT, '.gas-deploy.example.json'), path.join(directory, '.gas-deploy.json'));
  const config = loadConfiguration(directory);
  assert.equal(config.scriptId, SCRIPT_ID);
  assert.equal(config.deploymentId, DEPLOYMENT_ID);
  assert.equal(config.sourceRoot, 'apps-script');
  fs.rmSync(directory, { recursive: true, force: true });
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

test('normalizes full Apps Script API deployment state and confirms the permanent Web App', () => {
  const config = validConfig();
  const resource = deploymentResource('27', {
    entryPoints: [
      { entryPointType: 'EXECUTION_API', executionApi: {} },
      ...deploymentResource(27).entryPoints
    ]
  });
  const state = normalizeDeploymentState(resource);
  assert.equal(state.versionNumber, 27);
  assert.equal(state.manifestFileName, 'appsscript');
  assert.equal(state.entryPoints[1].access, 'ANYONE_ANONYMOUS');
  assert.equal(
    assertPermanentWebAppDeployment(state, config, 27).url,
    permanentWebAppUrl(config)
  );
});

test('rejects missing, misrouted, or policy-drifted Web App entry points', () => {
  const config = validConfig();
  assert.throws(
    () => assertPermanentWebAppDeployment(
      deploymentState(27, { entryPoints: [{ entryPointType: 'EXECUTION_API' }] }),
      config,
      27
    ),
    /no WEB_APP/i
  );
  const wrongUrl = deploymentState(27);
  wrongUrl.entryPoints[0].url = 'https://script.google.com/macros/s/different-deployment/exec';
  assert.throws(() => assertPermanentWebAppDeployment(wrongUrl, config, 27), /URL does not match/i);
  const wrongAccess = deploymentState(27);
  wrongAccess.entryPoints[0].access = 'DOMAIN';
  assert.throws(() => assertPermanentWebAppDeployment(wrongAccess, config, 27), /policy drifted/i);
  assert.throws(
    () => assertPermanentWebAppDeployment(deploymentState(26), config, 27),
    /version 26, expected 27/i
  );
});

test('polls authoritative deployment state through propagation delay', async () => {
  const config = validConfig();
  const observed = [deploymentState(26), deploymentState(26), deploymentState(27)];
  const delays = [];
  const state = await verifyPermanentDeployment(config, 27, {
    attempts: 3,
    getState: async () => observed.shift(),
    delay: async (milliseconds) => delays.push(milliseconds),
    delayMs: 0
  });
  assert.equal(state.versionNumber, 27);
  assert.equal(delays.length, 2);
});

test('fails when authoritative state never confirms the intended Web App', async () => {
  const config = validConfig();
  await assert.rejects(
    verifyPermanentDeployment(config, 27, {
      attempts: 2,
      getState: async () => deploymentState(27, { entryPoints: [] }),
      delay: async () => {}
    }),
    /verification failed.*no WEB_APP/i
  );
});

test('bounds a hanging authoritative deployment request', async () => {
  const config = validConfig();
  await assert.rejects(
    verifyPermanentDeployment(config, 27, {
      attempts: 1,
      requestTimeoutMs: 5,
      getState: async () => new Promise(() => {})
    }),
    /state request timed out after 5 ms/i
  );
});

test('accepts incomplete clasp update stdout only after authoritative state confirms success', async () => {
  const config = validConfig();
  const calls = [];
  const result = await updatePermanentDeployment(config, 27, 'Reviewed release', {
    execute: async (args) => {
      calls.push(args);
      return { status: 1, stdout: `{"deploymentId":"${DEPLOYMENT_ID}"}`, stderr: 'timed out locally' };
    },
    verify: async (_config, version) => deploymentState(version)
  });
  assert.equal(result.responseMatched, false);
  assert.equal(result.commandStatus, 1);
  assert.equal(result.state.versionNumber, 27);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], commandFor('update', config, {
    versionNumber: 27,
    description: 'Reviewed release'
  }));
  assert.ok(!calls[0].includes('create-deployment'));
  assert.equal(calls[0].filter((value) => value === DEPLOYMENT_ID).length, 1);
});

test('successful release primitives create one version and update only the existing permanent deployment', async () => {
  const config = validConfig();
  const calls = [];
  let listCall = 0;
  const created = await createVersionReliably(config, 'Release 28', {
    listVersions: async () => {
      listCall += 1;
      return listCall === 1
        ? [{ versionNumber: 27, description: 'Release 27' }]
        : [
          { versionNumber: 28, description: 'Release 28' },
          { versionNumber: 27, description: 'Release 27' }
        ];
    },
    execute: async (args) => {
      calls.push(args);
      return { status: 0, stdout: '{"versionNumber":28}', stderr: '' };
    },
    delay: async () => {}
  });
  await updatePermanentDeployment(config, created.versionNumber, 'Release 28', {
    execute: async (args) => {
      calls.push(args);
      return {
        status: 0,
        stdout: `{"deploymentId":"${DEPLOYMENT_ID}","versionNumber":28}`,
        stderr: ''
      };
    },
    verify: async () => deploymentState(28)
  });
  assert.equal(calls.length, 2);
  assert.ok(calls[0].includes('create-version'));
  assert.ok(calls[1].includes('update-deployment'));
  assert.ok(calls[1].includes(DEPLOYMENT_ID));
  assert.ok(!calls.flat().includes('create-deployment'));
});

test('successful publish orchestration verifies the new permanent version and served marker', async () => {
  const config = validConfig();
  const calls = [];
  const probes = [];
  const updated = await publishVersionWithRecovery(
    config,
    28,
    'Release 28',
    'Web v0.3.1 · build release28',
    27,
    'Web v0.3.0 · build release27',
    {
      execute: async (args) => {
        calls.push(args);
        return {
          status: 0,
          stdout: `{"deploymentId":"${DEPLOYMENT_ID}","versionNumber":28}`,
          stderr: ''
        };
      },
      verify: async (_config, expectedVersion) => deploymentState(expectedVersion),
      probeWebApp: async (url, marker) => probes.push([url, marker])
    }
  );
  assert.equal(updated.state.versionNumber, 28);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes(DEPLOYMENT_ID));
  assert.deepEqual(probes, [[
    permanentWebAppUrl(config),
    'Web v0.3.1 · build release28'
  ]]);
});

test('publish orchestration rolls back the same deployment when the served marker fails', async () => {
  const config = validConfig();
  const calls = [];
  let probeCall = 0;
  await assert.rejects(
    publishVersionWithRecovery(
      config,
      28,
      'Release 28',
      'Web v0.3.1 · build release28',
      27,
      'Web v0.3.0 · build release27',
      {
        execute: async (args) => {
          calls.push(args);
          const versionIndex = args.indexOf('--versionNumber');
          const versionNumber = Number(args[versionIndex + 1]);
          return {
            status: 0,
            stdout: `{"deploymentId":"${DEPLOYMENT_ID}","versionNumber":${versionNumber}}`,
            stderr: ''
          };
        },
        verify: async (_config, expectedVersion) => deploymentState(expectedVersion),
        probeWebApp: async () => {
          probeCall += 1;
          if (probeCall === 1) throw new Error('new marker not served');
        },
        stabilityCheck: false
      }
    ),
    /production was restored to version 27.*new marker not served/i
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[0][calls[0].indexOf('--versionNumber') + 1], '28');
  assert.equal(calls[1][calls[1].indexOf('--versionNumber') + 1], '27');
  calls.forEach((args) => assert.ok(args.includes(DEPLOYMENT_ID)));
});

test('treats numeric-string deployment versions as equivalent parser variants', () => {
  const config = validConfig();
  assert.equal(positiveVersionNumber('27'), 27);
  assert.doesNotThrow(() => assertDeploymentUpdated({
    deploymentId: DEPLOYMENT_ID,
    versionNumber: '27'
  }, config, 27));
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

function fakeGitRunner(responses) {
  return (_executable, args) => {
    const key = args.join(' ');
    const response = responses[key];
    if (!response) return { status: 1, stdout: '', stderr: `Unexpected git call: ${key}` };
    return {
      status: response.status === undefined ? 0 : response.status,
      stdout: response.stdout || '',
      stderr: response.stderr || ''
    };
  };
}

function synchronizedGitResponses(overrides = {}) {
  return {
    'symbolic-ref --quiet --short HEAD': { stdout: 'main\n' },
    'rev-parse --abbrev-ref --symbolic-full-name @{upstream}': { stdout: 'origin/main\n' },
    'fetch --quiet origin main': { stdout: '' },
    'rev-parse HEAD': { stdout: 'abc123\n' },
    'rev-parse @{upstream}': { stdout: 'abc123\n' },
    ...overrides
  };
}

test('production release accepts only synchronized main tracking origin/main', () => {
  const state = assertReleaseBranchSynchronized(
    ROOT,
    fakeGitRunner(synchronizedGitResponses())
  );
  assert.equal(state.branch, 'main');
  assert.equal(state.upstream, 'origin/main');
  assert.equal(state.revision, 'abc123');
});

test('production release rejects feature branches, detached HEAD, and missing or wrong upstreams', () => {
  assert.throws(() => assertReleaseBranchSynchronized(
    ROOT,
    fakeGitRunner(synchronizedGitResponses({
      'symbolic-ref --quiet --short HEAD': { stdout: 'preseason/platform-completion\n' }
    })),
    { fetch: false }
  ), /must run from main/i);
  assert.throws(() => assertReleaseBranchSynchronized(
    ROOT,
    fakeGitRunner(synchronizedGitResponses({
      'symbolic-ref --quiet --short HEAD': { status: 1 }
    })),
    { fetch: false }
  ), /detached HEAD/i);
  assert.throws(() => assertReleaseBranchSynchronized(
    ROOT,
    fakeGitRunner(synchronizedGitResponses({
      'rev-parse --abbrev-ref --symbolic-full-name @{upstream}': { status: 1 }
    })),
    { fetch: false }
  ), /configured upstream/i);
  assert.throws(() => assertReleaseBranchSynchronized(
    ROOT,
    fakeGitRunner(synchronizedGitResponses({
      'rev-parse --abbrev-ref --symbolic-full-name @{upstream}': { stdout: 'fork/main\n' }
    })),
    { fetch: false }
  ), /track origin\/main/i);
});

test('production release rejects ahead, behind, and diverged main state', () => {
  ['ahead', 'behind', 'diverged'].forEach((label, index) => {
    assert.throws(() => assertReleaseBranchSynchronized(
      ROOT,
      fakeGitRunner(synchronizedGitResponses({
        'rev-parse HEAD': { stdout: `local-${label}-${index}\n` },
        'rev-parse @{upstream}': { stdout: `remote-${label}-${index}\n` }
      })),
      { fetch: false }
    ), /same reviewed commit/i);
  });
});

test('production release stops when origin main cannot be refreshed', () => {
  assert.throws(() => assertReleaseBranchSynchronized(
    ROOT,
    fakeGitRunner(synchronizedGitResponses({
      'fetch --quiet origin main': { status: 1, stderr: 'network unavailable' }
    }))
  ), /could not refresh origin\/main.*network unavailable/i);
});

test('release descriptions always include visible version, build, and git revision', () => {
  const revision = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
    cwd: ROOT,
    encoding: 'utf8'
  }).stdout.trim();
  const description = releaseDescription('Reviewed preseason release', {
    version: '0.4.0',
    build: '20260826a'
  }, ROOT);
  assert.match(description, /^Reviewed preseason release · Web v0\.4\.0 · build 20260826a · git /);
  assert.ok(description.endsWith(revision));
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

test('keeps remote HEAD synchronization distinct from deployed-version synchronization', () => {
  const head = { identical: ['Code.gs'], different: [], localOnly: [], remoteOnly: [] };
  const deployed = { identical: [], different: ['Code.gs'], localOnly: [], remoteOnly: [] };
  assert.doesNotThrow(() => assertRuntimeSynchronized(head, 'Remote HEAD'));
  assert.throws(
    () => assertRuntimeSynchronized(deployed, 'Permanent deployment'),
    /Permanent deployment.*not synchronized.*Code\.gs/i
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

test('authoritatively identifies version creation when clasp stdout is not usable JSON', async () => {
  const config = validConfig();
  let listCall = 0;
  const created = await createVersionReliably(config, 'Reviewed release', {
    listVersions: async () => {
      listCall += 1;
      return listCall === 1
        ? [{ versionNumber: 1, description: 'Old' }]
        : [
          { versionNumber: 2, description: 'Reviewed release' },
          { versionNumber: 1, description: 'Old' }
        ];
    },
    execute: async () => ({ status: 0, stdout: 'Created version 2', stderr: '' }),
    delay: async () => {}
  });
  assert.equal(created.versionNumber, 2);
  assert.equal(created.responseMatched, false);
});

test('rejects ambiguous version creation state', () => {
  assert.throws(
    () => resolveCreatedVersion(
      [{ versionNumber: 1 }],
      [
        { versionNumber: 3, description: 'Reviewed release' },
        { versionNumber: 2, description: 'Reviewed release' },
        { versionNumber: 1 }
      ],
      'Reviewed release',
      null
    ),
    /one newly created.*found 2/i
  );
});

test('recovery updates only the configured deployment and verifies restoration', async () => {
  const config = validConfig();
  const commands = [];
  const probes = [];
  const restored = await ensurePreviousDeploymentRestored(config, 1, 'Web v0.1.0 · build legacy', {
    verify: async (_config, expectedVersion) => deploymentState(expectedVersion),
    execute: async (args) => {
      commands.push(args);
      return { status: 0, stdout: '{}', stderr: '' };
    },
    probeWebApp: async (url, marker) => probes.push([url, marker]),
    stabilityCheck: false
  });
  assert.equal(restored.state.versionNumber, 1);
  assert.equal(commands.length, 1);
  assert.ok(commands[0].includes('update-deployment'));
  assert.ok(commands[0].includes(DEPLOYMENT_ID));
  assert.ok(!commands[0].includes('create-deployment'));
  assert.deepEqual(probes, [[permanentWebAppUrl(config), 'Web v0.1.0 · build legacy']]);
});

test('always reasserts rollback after an attempted update even if a read still shows the old version', async () => {
  const config = validConfig();
  let updateCalls = 0;
  const restored = await ensurePreviousDeploymentRestored(config, 1, '', {
    verify: async () => deploymentState(1),
    execute: async () => {
      updateCalls += 1;
      return { status: 0, stdout: '{}', stderr: '' };
    },
    probeWebApp: async () => {},
    stabilityCheck: false
  });
  assert.equal(restored.state.versionNumber, 1);
  assert.equal(updateCalls, 1);
});

test('does not certify rollback from stale old state when rollback commands are unacknowledged', async () => {
  const config = validConfig();
  let updateCalls = 0;
  await assert.rejects(
    ensurePreviousDeploymentRestored(config, 1, '', {
      rollbackCommandAttempts: 2,
      delay: async () => {},
      execute: async () => {
        updateCalls += 1;
        return { status: 1, stdout: '', stderr: 'local timeout' };
      },
      verify: async () => deploymentState(1),
      probe: false,
      stabilityCheck: false
    }),
    /Rollback command was not acknowledged after 2 attempt/i
  );
  assert.equal(updateCalls, 2);
});

test('certified rollback performs a delayed authoritative stability re-check', async () => {
  const config = validConfig();
  let verificationCalls = 0;
  let probeCalls = 0;
  const delays = [];
  const restored = await ensurePreviousDeploymentRestored(config, 1, '', {
    delay: async (milliseconds) => delays.push(milliseconds),
    execute: async () => ({ status: 0, stdout: '{}', stderr: '' }),
    verify: async () => {
      verificationCalls += 1;
      return deploymentState(1);
    },
    probeWebApp: async () => {
      probeCalls += 1;
    }
  });
  assert.equal(restored.state.versionNumber, 1);
  assert.equal(verificationCalls, 2);
  assert.equal(probeCalls, 2);
  assert.deepEqual(delays, [2000]);
});

test('rollback certification fails if the delayed stability re-check regresses', async () => {
  const config = validConfig();
  let verificationCalls = 0;
  await assert.rejects(
    ensurePreviousDeploymentRestored(config, 1, '', {
      delay: async () => {},
      execute: async () => ({ status: 0, stdout: '{}', stderr: '' }),
      verify: async () => {
        verificationCalls += 1;
        if (verificationCalls === 2) throw new Error('late deployment flip');
        return deploymentState(1);
      },
      probeWebApp: async () => {}
    }),
    /late deployment flip/i
  );
  assert.equal(verificationCalls, 2);
});

test('HTTP verification requires the START UI and exact visible release marker', async () => {
  const marker = 'Web v0.3.1 · build 20260825a';
  const result = await probePermanentWebApp('https://script.google.com/macros/s/example/exec', marker, {
    attempts: 1,
    fetchImpl: async (url) => ({
      ok: true,
      status: 200,
      url,
      text: async () => `<title>START Command Center</title><footer>${marker}</footer>`
    })
  });
  assert.equal(result.status, 200);
  await assert.rejects(
    probePermanentWebApp('https://script.google.com/macros/s/example/exec', marker, {
      attempts: 1,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        url: '',
        text: async () => '<title>START Command Center</title>'
      })
    }),
    /does not contain/i
  );
});

test('visible release metadata is source-frozen and must change with runtime drift', () => {
  const directory = temporaryDirectory();
  fs.writeFileSync(
    path.join(directory, 'Index.html'),
    '<footer id="release-indicator" data-web-version="0.3.1" data-web-build="20260825a">' +
      'Web v0.3.1 · build 20260825a</footer>',
    'utf8'
  );
  const metadata = readWebReleaseMetadata(directory);
  assert.deepEqual(metadata, {
    version: '0.3.1',
    build: '20260825a',
    marker: 'Web v0.3.1 · build 20260825a'
  });
  assert.throws(
    () => assertReleaseMetadataBumped(metadata, metadata, {
      different: ['Code.gs'],
      localOnly: [],
      remoteOnly: []
    }),
    /build token.*did not/i
  );
  assert.doesNotThrow(() => assertReleaseMetadataBumped(metadata, metadata, {
    different: [],
    localOnly: [],
    remoteOnly: []
  }));
  fs.rmSync(directory, { recursive: true, force: true });
});

test('runtime, footer, package, and lockfile release metadata stay synchronized', () => {
  const runtime = parseRuntimeReleaseMetadata(
    fs.readFileSync(path.join(ROOT, 'apps-script', 'Config.gs'), 'utf8')
  );
  const visible = verifyWebReleaseMetadata();
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const packageLock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  assert.deepEqual(runtime, { version: visible.version, build: visible.build });
  assert.equal(packageJson.version, visible.version);
  assert.equal(packageLock.version, visible.version);
  assert.equal(packageLock.packages[''].version, visible.version);
  assert.throws(() => parseRuntimeReleaseMetadata("var START_WEB_VERSION = '0.4.0';"), /must define/i);
});

test('visible release footer exposes no deployment, configuration, identity, or path data', () => {
  const html = fs.readFileSync(path.join(ROOT, 'apps-script', 'Index.html'), 'utf8');
  const footer = html.match(/<footer\b[^>]*\bid="release-indicator"[\s\S]*?<\/footer>/i);
  assert.ok(footer, 'release footer exists');
  [
    SCRIPT_ID,
    DEPLOYMENT_ID,
    'OPENAI_API_KEY',
    'START_SPREADSHEET_ID',
    '@sks.org',
    '/Users/'
  ].forEach((privateValue) => assert.ok(!footer[0].includes(privateValue), `${privateValue} is not exposed`));
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
    ['--json', '--project', '.clasp.json.example', 'show-file-status'],
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
  assert.equal(packageJson.devDependencies.googleapis, '148.0.0');
  assert.equal(packageJson.engines.node, '>=20');
  assert.ok(verifyNodeVersion(process.versions.node) >= 20);
  assert.throws(() => verifyNodeVersion('19.9.0'), /requires Node\.js 20 or newer/i);
});

test('release verification runs every workflow, reporting, integrity, client, and tooling suite', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  [
    'tests/run-tests.js',
    'tests/platform-config-schema-tests.js',
    'tests/program-snapshot-tests.js',
    'tests/decision-reporting-tests.js',
    'tests/integrity-tests.js',
    'tests/client-ui-tests.js',
    'tests/tooling-tests.js'
  ].forEach((suite) => assert.match(packageJson.scripts.test, new RegExp(suite.replace('.', '\\.'))));
  assert.equal(packageJson.scripts.verify, 'npm test && npm run check');
});

test('release tooling never pulls into the repository or creates a deployment', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'gas-tooling.js'), 'utf8');
  assert.doesNotMatch(source, /['"]pull['"]/);
  assert.doesNotMatch(source, /['"]create-deployment['"]/);
  assert.doesNotMatch(source, /CLASP_USER/);
  assert.match(source, /['"]update-deployment['"]/);
  const releaseBody = source.match(/async function release\([\s\S]*?\n}\n\nasync function recover/);
  const recoveryBody = source.match(/async function recover\([\s\S]*?\n}\n\nfunction usage/);
  assert.ok(releaseBody);
  assert.ok(recoveryBody);
  assert.match(releaseBody[0], /assertReleaseBranchSynchronized/);
  assert.doesNotMatch(recoveryBody[0], /assertReleaseBranchSynchronized/);
});

test('CI installs and verifies without credentials or deployment commands', () => {
  const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'verify.yml'), 'utf8');
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /branches:\s*\n\s*- main/);
  assert.match(workflow, /permissions:\s*\n\s*contents: read/);
  assert.match(workflow, /node-version: 20/);
  assert.match(workflow, /run: npm ci/);
  assert.match(workflow, /run: npm run verify/);
  assert.doesNotMatch(workflow, /secrets\.|clasp|gas:(?:push|dev|release|recover)|deploy/i);
});

test('declares only current Spreadsheet and email scopes on the platform manifest', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps-script', 'appsscript.json'), 'utf8'));
  assert.deepEqual(manifest.webapp, {
    executeAs: EXPECTED_WEB_APP.executeAs,
    access: EXPECTED_WEB_APP.access
  });
  assert.doesNotThrow(() => assertWebAppManifest(manifest));
  assert.throws(() => assertWebAppManifest({}), /must preserve webapp/i);
  assert.deepEqual(manifest.oauthScopes, [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/userinfo.email'
  ]);
  assert.ok(!manifest.oauthScopes.some((scope) => /drive|external_request/.test(scope)));
  assert.equal(manifest.executionApi, undefined);
});

(async () => {
  let passed = 0;
  for (const { name, work } of tests) {
    try {
      await work();
      passed += 1;
      process.stdout.write(`✓ ${name}\n`);
    } catch (error) {
      process.stderr.write(`✗ ${name}\n${error.stack || error.message}\n`);
    }
  }

  process.stdout.write(`\n${passed}/${tests.length} tooling tests passed.\n`);
  if (passed !== tests.length) process.exitCode = 1;
})().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
