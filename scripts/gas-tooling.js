#!/usr/bin/env node

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const REPOSITORY_ROOT = path.resolve(__dirname, '..');
const CLASP_CONFIG_FILE = '.clasp.json';
const DEPLOY_CONFIG_FILE = '.gas-deploy.json';
const CLASP_EXAMPLE_FILE = '.clasp.json.example';
const DEPLOY_EXAMPLE_FILE = '.gas-deploy.example.json';
const EXPECTED_SOURCE_ROOT = 'apps-script';
const REQUIRED_CLASP_VERSION = '3.3.0';
const MINIMUM_NODE_MAJOR = 20;
const EXPECTED_WEB_APP = Object.freeze({
  access: 'ANYONE_ANONYMOUS',
  executeAs: 'USER_DEPLOYING'
});
const DEPLOYMENT_POLL_ATTEMPTS = 8;
const DEPLOYMENT_POLL_DELAY_MS = 1500;
const APPS_SCRIPT_API_TIMEOUT_MS = 15000;
const CLASP_MUTATION_TIMEOUT_MS = 45000;
const ROLLBACK_COMMAND_ATTEMPTS = 3;
const ROLLBACK_STABILITY_DELAY_MS = 2000;
const WEB_APP_TITLE = 'START Command Center';
const RELEASE_INDICATOR_ID = 'release-indicator';

function fail(message) {
  const error = new Error(message);
  error.isExpected = true;
  throw error;
}

function readJsonFile(filePath, label) {
  if (!fs.existsSync(filePath)) {
    fail(`${label} is missing at ${path.relative(REPOSITORY_ROOT, filePath)}. Run npm run gas:configure.`);
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    fail(`${label} is malformed JSON: ${error.message}`);
  }
}

function validIdentifier(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{20,}$/.test(value);
}

function validateConfiguration(deployment, clasp) {
  if (!deployment || Array.isArray(deployment) || typeof deployment !== 'object') {
    fail('Deployment configuration must be a JSON object.');
  }
  if (!clasp || Array.isArray(clasp) || typeof clasp !== 'object') {
    fail('clasp configuration must be a JSON object.');
  }
  if (!validIdentifier(deployment.scriptId)) fail('Deployment configuration has an invalid Script ID.');
  if (!validIdentifier(deployment.deploymentId)) fail('Deployment configuration has an invalid Deployment ID.');
  if (deployment.sourceRoot !== EXPECTED_SOURCE_ROOT) {
    fail(`Deployment sourceRoot must be exactly "${EXPECTED_SOURCE_ROOT}".`);
  }
  if (clasp.scriptId !== deployment.scriptId) {
    fail('Script IDs differ between .clasp.json and .gas-deploy.json.');
  }
  const normalizedRoot = String(clasp.rootDir || '').replace(/[\\/]+$/, '').replace(/\\/g, '/');
  if (normalizedRoot !== EXPECTED_SOURCE_ROOT) {
    fail(`.clasp.json rootDir must be exactly "${EXPECTED_SOURCE_ROOT}".`);
  }
  return {
    scriptId: deployment.scriptId,
    deploymentId: deployment.deploymentId,
    sourceRoot: EXPECTED_SOURCE_ROOT,
    claspProjectFile: CLASP_CONFIG_FILE
  };
}

function loadConfiguration(repositoryRoot = REPOSITORY_ROOT) {
  const deployment = readJsonFile(path.join(repositoryRoot, DEPLOY_CONFIG_FILE), 'Deployment configuration');
  const clasp = readJsonFile(path.join(repositoryRoot, CLASP_CONFIG_FILE), 'clasp configuration');
  return validateConfiguration(deployment, clasp);
}

function claspBinary(repositoryRoot = REPOSITORY_ROOT) {
  const executable = process.platform === 'win32' ? 'clasp.cmd' : 'clasp';
  const filePath = path.join(repositoryRoot, 'node_modules', '.bin', executable);
  if (!fs.existsSync(filePath)) fail('Pinned clasp is not installed. Run npm install.');
  return filePath;
}

function commandFor(action, config, options = {}) {
  const project = ['--project', config.claspProjectFile];
  switch (action) {
    case 'status':
      return [...project, 'show-file-status'];
    case 'push':
      return [...project, 'push', '--force'];
    case 'open':
      return [...project, 'open-script'];
    case 'deployments':
      return ['--json', ...project, 'list-deployments', config.scriptId];
    case 'versions':
      return ['--json', ...project, 'list-versions', config.scriptId];
    case 'version':
      if (!options.description) fail('A release description is required to create a version.');
      return ['--json', ...project, 'create-version', options.description];
    case 'update':
      if (!Number.isInteger(options.versionNumber) || options.versionNumber < 1) {
        fail('A positive Apps Script version number is required to update the deployment.');
      }
      return [
        '--json',
        ...project,
        'update-deployment',
        config.deploymentId,
        '--versionNumber',
        String(options.versionNumber),
        '--description',
        options.description || ''
      ];
    default:
      fail(`Unknown clasp action: ${action}`);
  }
}

function printableCommand(executable, args) {
  const quote = (value) => (/^[A-Za-z0-9_./:@=-]+$/.test(value) ? value : JSON.stringify(value));
  return [executable, ...args].map(quote).join(' ');
}

function runCommandResult(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: options.cwd || REPOSITORY_ROOT,
    encoding: 'utf8',
    stdio: options.capture === false ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...(options.env || {}) },
    timeout: options.timeout
  });
  if (result.error && !options.allowError) fail(`Could not run ${executable}: ${result.error.message}`);
  return {
    status: Number.isInteger(result.status) ? result.status : 1,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || ''),
    error: result.error ? result.error.message : ''
  };
}

function runCommand(executable, args, options = {}) {
  const capture = !!options.capture;
  const result = runCommandResult(executable, args, { ...options, capture });
  if (result.status !== 0) {
    const detail = capture ? String(result.stderr || result.stdout || '').trim() : '';
    fail(`${path.basename(executable)} exited with status ${result.status}${detail ? `: ${detail}` : '.'}`);
  }
  return capture ? result.stdout : '';
}

function runClasp(args, options = {}) {
  return runCommand(claspBinary(options.repositoryRoot), args, options);
}

function runClaspResult(args, options = {}) {
  return runCommandResult(claspBinary(options.repositoryRoot), args, {
    ...options,
    allowError: true,
    capture: true,
    timeout: options.timeout || CLASP_MUTATION_TIMEOUT_MS
  });
}

function verifyNodeVersion(version = process.versions.node) {
  var major = Number(String(version || '').split('.')[0]);
  if (!Number.isInteger(major) || major < MINIMUM_NODE_MAJOR) {
    fail(`clasp requires Node.js ${MINIMUM_NODE_MAJOR} or newer; this runtime is ${version || 'unknown'}.`);
  }
  return major;
}

function parseJsonOutput(output, label) {
  try {
    return JSON.parse(output);
  } catch (error) {
    fail(`${label} did not return valid JSON: ${error.message}`);
  }
}

function tryParseJsonOutput(output) {
  try {
    return JSON.parse(String(output || ''));
  } catch (_error) {
    return null;
  }
}

function positiveVersionNumber(value) {
  if (typeof value === 'string' && /^\d+$/.test(value)) value = Number(value);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function runChecks(runner = runCommand) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  runner(npm, ['test'], { cwd: REPOSITORY_ROOT });
  runner(process.execPath, [path.join('scripts', 'verify.js')], { cwd: REPOSITORY_ROOT });
}

function assertCleanWorktree(repositoryRoot = REPOSITORY_ROOT) {
  const git = spawnSync('git', ['status', '--porcelain'], {
    cwd: repositoryRoot,
    encoding: 'utf8'
  });
  if (git.status !== 0) fail('Unable to inspect git worktree state.');
  if (git.stdout.trim()) {
    fail('Production release requires a clean git worktree. Commit or stash the reviewed changes first.');
  }
}

function currentRevision(repositoryRoot = REPOSITORY_ROOT) {
  const git = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
    cwd: repositoryRoot,
    encoding: 'utf8'
  });
  if (git.status !== 0) fail('Unable to determine the current git revision.');
  return git.stdout.trim();
}

function relativeRuntimeFiles(directory) {
  const files = [];
  function walk(current) {
    fs.readdirSync(current, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))
      .forEach((entry) => {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) walk(fullPath);
        else if (entry.isFile()) files.push(path.relative(directory, fullPath).replace(/\\/g, '/'));
      });
  }
  if (fs.existsSync(directory)) walk(directory);
  return files;
}

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = stableJson(value[key]);
      return result;
    }, {});
  }
  return value;
}

function normalizedFileContent(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  if (path.basename(filePath) === 'appsscript.json') {
    try {
      return JSON.stringify(stableJson(JSON.parse(content)));
    } catch (_error) {
      return content.replace(/\r\n/g, '\n').replace(/\s+$/, '');
    }
  }
  return content.replace(/\r\n/g, '\n').replace(/\s+$/, '');
}

function readRuntimeManifest(runtimeRoot, label = 'Apps Script source') {
  const manifestPath = path.join(runtimeRoot, 'appsscript.json');
  if (!fs.existsSync(manifestPath)) fail(`${label} is missing appsscript.json.`);
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    fail(`${label} has an invalid appsscript.json: ${error.message}`);
  }
  return manifest;
}

function assertWebAppManifest(manifest, label = 'Apps Script manifest') {
  const webApp = manifest && manifest.webapp;
  if (!webApp || webApp.access !== EXPECTED_WEB_APP.access ||
      webApp.executeAs !== EXPECTED_WEB_APP.executeAs) {
    fail(
      `${label} must preserve webapp access ${EXPECTED_WEB_APP.access} ` +
      `and executeAs ${EXPECTED_WEB_APP.executeAs}.`
    );
  }
  return webApp;
}

function attributeFromTag(tag, name) {
  const match = String(tag || '').match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i'));
  return match ? match[1] : '';
}

function readWebReleaseMetadata(runtimeRoot, options = {}) {
  const label = options.label || 'Apps Script source';
  const htmlPath = path.join(runtimeRoot, 'Index.html');
  if (!fs.existsSync(htmlPath)) {
    if (options.required === false) return null;
    fail(`${label} is missing Index.html.`);
  }
  const html = fs.readFileSync(htmlPath, 'utf8');
  const tag = html.match(new RegExp(`<[^>]+\\bid=["']${RELEASE_INDICATOR_ID}["'][^>]*>`, 'i'));
  if (!tag) {
    if (options.required === false) return null;
    fail(`${label} is missing the ${RELEASE_INDICATOR_ID} footer.`);
  }
  const version = attributeFromTag(tag[0], 'data-web-version');
  const build = attributeFromTag(tag[0], 'data-web-build');
  if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`${label} has an invalid visible Web version.`);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/.test(build)) fail(`${label} has an invalid visible build token.`);
  const marker = `Web v${version} · build ${build}`;
  if (!html.includes(marker)) fail(`${label} release-indicator text does not match its attributes.`);
  return { version, build, marker };
}

function assertReleaseMetadataBumped(localMetadata, deployedMetadata, deployedComparison) {
  if (!localMetadata || !deployedMetadata || !deployedComparison) return;
  const runtimeChanged = deployedComparison.different.length ||
    deployedComparison.localOnly.length || deployedComparison.remoteOnly.length;
  if (runtimeChanged && localMetadata.build === deployedMetadata.build) {
    fail(
      `Runtime source changed but visible build token ${localMetadata.build} did not. ` +
      'Update data-web-build before release.'
    );
  }
}

function logicalRuntimePath(filePath) {
  return /\.(?:gs|js)$/i.test(filePath) ? filePath.replace(/\.(?:gs|js)$/i, '.gs') : filePath;
}

function runtimeFileIndex(directory) {
  const index = new Map();
  relativeRuntimeFiles(directory).forEach((filePath) => {
    const logicalPath = logicalRuntimePath(filePath);
    if (index.has(logicalPath)) {
      fail(`Runtime directory contains conflicting server files for ${logicalPath}.`);
    }
    index.set(logicalPath, filePath);
  });
  return index;
}

function compareRuntimeDirectories(localDirectory, remoteDirectory) {
  const localIndex = runtimeFileIndex(localDirectory);
  const remoteIndex = runtimeFileIndex(remoteDirectory);
  const localFiles = Array.from(localIndex.keys()).sort();
  const remoteFiles = Array.from(remoteIndex.keys()).sort();
  const localSet = new Set(localFiles);
  const remoteSet = new Set(remoteFiles);
  const localOnly = localFiles.filter((file) => !remoteSet.has(file));
  const remoteOnly = remoteFiles.filter((file) => !localSet.has(file));
  const different = localFiles.filter((file) => remoteSet.has(file) && (
    normalizedFileContent(path.join(localDirectory, localIndex.get(file))) !==
    normalizedFileContent(path.join(remoteDirectory, remoteIndex.get(file)))
  ));
  const identical = localFiles.filter((file) => remoteSet.has(file) && !different.includes(file));
  return { localOnly, remoteOnly, different, identical };
}

function assertRuntimeSynchronized(comparison, label) {
  const drift = [
    ...comparison.different,
    ...comparison.localOnly,
    ...comparison.remoteOnly
  ];
  if (drift.length) {
    fail(`${label} is not synchronized with local source: ${Array.from(new Set(drift)).sort().join(', ')}.`);
  }
  return comparison;
}

function assertNoRemoteOnly(comparisons) {
  const remoteOnly = Array.from(new Set(comparisons.flatMap((comparison) => (
    comparison ? comparison.remoteOnly : []
  )))).sort();
  if (remoteOnly.length) {
    fail(
      `Apps Script contains remote-only runtime files: ${remoteOnly.join(', ')}. ` +
      'Inspect the comparison clone and deliberately preserve or remove those files before pushing.'
    );
  }
  return remoteOnly;
}

function applyRemoteOnlyPolicy(headComparison, deployedComparison, failOnRemoteOnly) {
  const remoteOnly = Array.from(new Set([
    ...headComparison.remoteOnly,
    ...(deployedComparison ? deployedComparison.remoteOnly : [])
  ])).sort();
  if (failOnRemoteOnly) assertNoRemoteOnly([headComparison]);
  return remoteOnly;
}

function assertDeploymentUpdated(updated, config, versionNumber) {
  if (!updated || updated.deploymentId !== config.deploymentId ||
      positiveVersionNumber(updated.versionNumber) !== positiveVersionNumber(versionNumber)) {
    fail('Deployment update response did not confirm the configured Deployment ID and new version.');
  }
}

function printComparison(label, comparison, tempDirectory) {
  process.stdout.write(`${label} comparison clone: ${tempDirectory}\n`);
  process.stdout.write(`Identical files: ${comparison.identical.length}\n`);
  process.stdout.write(`Different files: ${comparison.different.length}\n`);
  process.stdout.write(`Local-only files: ${comparison.localOnly.length}\n`);
  process.stdout.write(`Remote-only files: ${comparison.remoteOnly.length}\n`);
  [['Different', comparison.different], ['Local only', comparison.localOnly], ['Remote only', comparison.remoteOnly]]
    .forEach(([label, files]) => {
      if (files.length) process.stdout.write(`${label}: ${files.join(', ')}\n`);
    });
}

function listDeployments(config) {
  const deployments = parseJsonOutput(
    runClasp(commandFor('deployments', config), { capture: true }),
    'clasp list-deployments'
  );
  if (!Array.isArray(deployments)) fail('clasp list-deployments returned an unexpected shape.');
  return deployments;
}

function listVersions(config) {
  const versions = parseJsonOutput(
    runClasp(commandFor('versions', config), { capture: true }),
    'clasp list-versions'
  );
  if (!Array.isArray(versions)) fail('clasp list-versions returned an unexpected shape.');
  return versions.map((version) => ({
    ...version,
    versionNumber: positiveVersionNumber(version.versionNumber)
  })).filter((version) => version.versionNumber);
}

function permanentWebAppUrl(config) {
  return `https://script.google.com/macros/s/${config.deploymentId}/exec`;
}

function normalizeDeploymentState(deployment) {
  const config = deployment && deployment.deploymentConfig || {};
  return {
    deploymentId: deployment && deployment.deploymentId,
    versionNumber: positiveVersionNumber(config.versionNumber),
    description: config.description || '',
    manifestFileName: config.manifestFileName || '',
    updateTime: deployment && deployment.updateTime || '',
    entryPoints: Array.isArray(deployment && deployment.entryPoints)
      ? deployment.entryPoints.map((entryPoint) => {
        const webApp = entryPoint && entryPoint.webApp || {};
        const entryPointConfig = webApp.entryPointConfig || {};
        return {
          entryPointType: entryPoint && entryPoint.entryPointType,
          url: webApp.url || '',
          access: entryPointConfig.access || '',
          executeAs: entryPointConfig.executeAs || ''
        };
      })
      : []
  };
}

let appsScriptApiPromise = null;

async function appsScriptApi() {
  if (!appsScriptApiPromise) {
    appsScriptApiPromise = (async () => {
      const authModulePath = path.join(
        REPOSITORY_ROOT,
        'node_modules',
        '@google',
        'clasp',
        'build',
        'src',
        'auth',
        'auth.js'
      );
      if (!fs.existsSync(authModulePath)) fail('Pinned clasp authentication module is missing. Run npm install.');
      const { initAuth } = await import(pathToFileURL(authModulePath).href);
      const { google } = await import('googleapis');
      let authFilePath = process.env.clasp_config_auth || undefined;
      if (authFilePath && fs.existsSync(authFilePath) && fs.statSync(authFilePath).isDirectory()) {
        authFilePath = path.join(authFilePath, '.clasprc.json');
      }
      // Every clasp subprocess uses its default user; authoritative reads must use the same credential.
      const auth = await initAuth({
        authFilePath,
        userKey: 'default',
        useApplicationDefaultCredentials: false
      });
      if (!auth.credentials) fail('No clasp credentials found. Run npm run gas:login.');
      return google.script({ version: 'v1', auth: auth.credentials });
    })();
  }
  return appsScriptApiPromise;
}

async function getDeploymentState(config) {
  const api = await appsScriptApi();
  const response = await api.projects.deployments.get({
    scriptId: config.scriptId,
    deploymentId: config.deploymentId
  }, { timeout: APPS_SCRIPT_API_TIMEOUT_MS });
  return normalizeDeploymentState(response.data);
}

function assertPermanentWebAppDeployment(state, config, expectedVersion) {
  if (!state || state.deploymentId !== config.deploymentId) {
    fail('Apps Script API did not return the configured permanent Deployment ID.');
  }
  const expected = positiveVersionNumber(expectedVersion);
  if (expected && state.versionNumber !== expected) {
    fail(`Permanent deployment points to version ${state.versionNumber || 'HEAD'}, expected ${expected}.`);
  }
  if (state.manifestFileName !== 'appsscript') {
    fail('Permanent deployment does not use the appsscript manifest.');
  }
  const webApp = state.entryPoints.find((entryPoint) => entryPoint.entryPointType === 'WEB_APP');
  if (!webApp) fail('Configured permanent deployment has no WEB_APP entry point.');
  const expectedUrl = permanentWebAppUrl(config);
  if (webApp.url !== expectedUrl) {
    fail(`Permanent WEB_APP URL does not match the configured deployment (${webApp.url || 'missing URL'}).`);
  }
  if (webApp.access !== EXPECTED_WEB_APP.access || webApp.executeAs !== EXPECTED_WEB_APP.executeAs) {
    fail(
      `Permanent WEB_APP policy drifted: expected access ${EXPECTED_WEB_APP.access} ` +
      `and executeAs ${EXPECTED_WEB_APP.executeAs}.`
    );
  }
  return webApp;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function withTimeout(work, milliseconds, label) {
  let timeoutId;
  try {
    return await Promise.race([
      Promise.resolve().then(work),
      new Promise((_resolve, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`${label} timed out after ${milliseconds} ms.`)),
          milliseconds
        );
      })
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function verifyPermanentDeployment(config, expectedVersion, options = {}) {
  const getState = options.getState || getDeploymentState;
  const attempts = options.attempts || DEPLOYMENT_POLL_ATTEMPTS;
  const delay = options.delay || wait;
  let lastError = null;
  let lastState = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      lastState = await withTimeout(
        () => getState(config),
        options.requestTimeoutMs ?? APPS_SCRIPT_API_TIMEOUT_MS,
        'Apps Script deployment state request'
      );
      assertPermanentWebAppDeployment(lastState, config, expectedVersion);
      return lastState;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await delay(options.delayMs ?? DEPLOYMENT_POLL_DELAY_MS);
    }
  }
  const observed = lastState && (lastState.versionNumber || 'HEAD');
  fail(
    `Permanent deployment verification failed after ${attempts} attempt(s)` +
    `${observed ? `; last observed version ${observed}` : ''}: ${lastError ? lastError.message : 'unknown state'}`
  );
}

async function probePermanentWebApp(url, expectedMarker, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const attempts = options.attempts || DEPLOYMENT_POLL_ATTEMPTS;
  const delay = options.delay || wait;
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        redirect: 'follow',
        signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout
          ? AbortSignal.timeout(30000)
          : undefined
      });
      const body = await response.text();
      if (!response.ok) fail(`Permanent Web App returned HTTP ${response.status}.`);
      if (!body.includes(WEB_APP_TITLE)) fail('Permanent Web App response is not the START Command Center.');
      if (expectedMarker && !body.includes(expectedMarker)) {
        fail(`Permanent Web App response does not contain ${expectedMarker}.`);
      }
      return { status: response.status, url: response.url || url };
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await delay(options.delayMs ?? DEPLOYMENT_POLL_DELAY_MS);
    }
  }
  fail(`Permanent Web App HTTP verification failed after ${attempts} attempt(s): ${lastError.message}`);
}

function cloneRemote(config, label, versionNumber) {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), `sks-start-${label}-`));
  const cloneArgs = ['clone-script', config.scriptId];
  if (Number.isInteger(versionNumber) && versionNumber > 0) cloneArgs.push(String(versionNumber));
  cloneArgs.push('--rootDir', EXPECTED_SOURCE_ROOT);
  runClasp(cloneArgs, { cwd: tempDirectory, repositoryRoot: REPOSITORY_ROOT });
  return {
    tempDirectory,
    runtimeRoot: path.join(tempDirectory, EXPECTED_SOURCE_ROOT)
  };
}

function compareClonedRuntime(config, label, versionNumber) {
  const clone = cloneRemote(config, label, versionNumber);
  const comparison = compareRuntimeDirectories(
    path.join(REPOSITORY_ROOT, config.sourceRoot),
    clone.runtimeRoot
  );
  return { clone, comparison };
}

function verifyRemoteHeadSynchronized(config) {
  const head = compareClonedRuntime(config, 'post-push-head');
  printComparison('Post-push remote project HEAD', head.comparison, head.clone.tempDirectory);
  assertRuntimeSynchronized(head.comparison, 'Post-push remote project HEAD');
  return head;
}

function compareRemote(config, options = {}) {
  const deployments = listDeployments(config);
  const existing = deployments.find((deployment) => deployment.deploymentId === config.deploymentId);
  if (!existing) {
    fail(`Configured permanent Deployment ID ${config.deploymentId} does not exist in the linked Apps Script project.`);
  }
  const headClone = cloneRemote(config, 'apps-script-head');
  const localRoot = path.join(REPOSITORY_ROOT, config.sourceRoot);
  const headComparison = compareRuntimeDirectories(localRoot, headClone.runtimeRoot);
  printComparison('Remote project HEAD', headComparison, headClone.tempDirectory);

  let deployedClone = null;
  let deployedComparison = null;
  if (Number.isInteger(existing.versionNumber) && existing.versionNumber > 0) {
    deployedClone = cloneRemote(config, 'apps-script-deployed', existing.versionNumber);
    deployedComparison = compareRuntimeDirectories(localRoot, deployedClone.runtimeRoot);
    printComparison(
      `Permanent deployment version ${existing.versionNumber}`,
      deployedComparison,
      deployedClone.tempDirectory
    );
  } else {
    process.stdout.write('Permanent deployment points at HEAD; no separate version clone was needed.\n');
  }

  const remoteOnly = applyRemoteOnlyPolicy(
    headComparison,
    deployedComparison,
    options.failOnRemoteOnly
  );
  return {
    deployments,
    existing,
    head: { clone: headClone, comparison: headComparison },
    deployed: deployedClone ? { clone: deployedClone, comparison: deployedComparison } : null,
    remoteOnly
  };
}

function assertWebHandler(runtimeRoot, label = 'Apps Script source') {
  const source = relativeRuntimeFiles(runtimeRoot)
    .filter((filePath) => /\.(?:gs|js)$/i.test(filePath))
    .map((filePath) => fs.readFileSync(path.join(runtimeRoot, filePath), 'utf8'))
    .join('\n');
  if (!/function\s+doGet\s*\(/.test(source) && !/function\s+doPost\s*\(/.test(source)) {
    fail(`${label} has no public doGet or doPost Web App handler.`);
  }
}

function validateRuntimeWebApp(runtimeRoot, label, options = {}) {
  const manifest = readRuntimeManifest(runtimeRoot, label);
  assertWebAppManifest(manifest, `${label} manifest`);
  assertWebHandler(runtimeRoot, label);
  const metadata = readWebReleaseMetadata(runtimeRoot, {
    label,
    required: options.requireMetadata !== false
  });
  return { manifest, metadata };
}

function resolveCreatedVersion(before, after, description, responseHint) {
  const previous = new Set(before.map((version) => positiveVersionNumber(version.versionNumber)).filter(Boolean));
  const created = after.filter((version) => {
    const number = positiveVersionNumber(version.versionNumber);
    return number && !previous.has(number);
  });
  if (created.length !== 1) {
    fail(`Could not authoritatively identify one newly created Apps Script version (found ${created.length}).`);
  }
  const versionNumber = positiveVersionNumber(created[0].versionNumber);
  if (created[0].description !== description) {
    fail(`New Apps Script version ${versionNumber} has an unexpected description.`);
  }
  const hintedVersion = responseHint && positiveVersionNumber(responseHint.versionNumber);
  return {
    versionNumber,
    responseMatched: hintedVersion === versionNumber
  };
}

async function confirmCreatedVersion(config, before, description, responseHint, options = {}) {
  const lister = options.listVersions || listVersions;
  const attempts = options.attempts || DEPLOYMENT_POLL_ATTEMPTS;
  const delay = options.delay || wait;
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return resolveCreatedVersion(before, await lister(config), description, responseHint);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await delay(options.delayMs ?? DEPLOYMENT_POLL_DELAY_MS);
    }
  }
  fail(`Apps Script version creation could not be confirmed: ${lastError.message}`);
}

async function createVersionReliably(config, description, options = {}) {
  const lister = options.listVersions || listVersions;
  const execute = options.execute || ((args) => runClaspResult(args));
  const before = await lister(config);
  const result = await execute(commandFor('version', config, { description }));
  const responseHint = tryParseJsonOutput(result.stdout);
  const confirmed = await confirmCreatedVersion(config, before, description, responseHint, {
    listVersions: lister,
    attempts: options.attempts,
    delay: options.delay,
    delayMs: options.delayMs
  });
  return { ...confirmed, commandStatus: result.status, responseHint };
}

async function updatePermanentDeployment(config, versionNumber, description, options = {}) {
  const execute = options.execute || ((args) => runClaspResult(args));
  const verifier = options.verify || verifyPermanentDeployment;
  const args = commandFor('update', config, { description, versionNumber });
  const result = await execute(args);
  const responseHint = tryParseJsonOutput(result.stdout);
  const responseMatched = !!responseHint &&
    responseHint.deploymentId === config.deploymentId &&
    positiveVersionNumber(responseHint.versionNumber) === versionNumber;
  const state = await verifier(config, versionNumber, {
    getState: options.getState,
    attempts: options.attempts,
    delay: options.delay,
    delayMs: options.delayMs,
    requestTimeoutMs: options.requestTimeoutMs
  });
  return {
    args,
    commandStatus: result.status,
    responseHint,
    responseMatched,
    state
  };
}

async function restorePermanentDeployment(config, versionNumber, description, expectedMarker, options = {}) {
  const attempts = options.rollbackCommandAttempts || ROLLBACK_COMMAND_ATTEMPTS;
  const delay = options.delay || wait;
  let updated = null;
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      updated = await updatePermanentDeployment(config, versionNumber, description, options);
      if (updated.commandStatus === 0) break;
      lastError = new Error(`rollback command exited ${updated.commandStatus}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) await delay(options.rollbackRetryDelayMs ?? DEPLOYMENT_POLL_DELAY_MS);
  }
  if (!updated || updated.commandStatus !== 0) {
    fail(
      `Rollback command was not acknowledged after ${attempts} attempt(s): ` +
      `${lastError ? lastError.message : 'unknown failure'}`
    );
  }
  let webApp = assertPermanentWebAppDeployment(updated.state, config, versionNumber);
  if (options.probe !== false) {
    await (options.probeWebApp || probePermanentWebApp)(webApp.url, expectedMarker, options.probeOptions || {});
  }
  if (options.stabilityCheck !== false) {
    await delay(options.stabilityDelayMs ?? ROLLBACK_STABILITY_DELAY_MS);
    updated.state = await (options.verify || verifyPermanentDeployment)(config, versionNumber, {
      getState: options.getState,
      attempts: options.stabilityAttempts || 2,
      delay: options.delay,
      delayMs: options.delayMs,
      requestTimeoutMs: options.requestTimeoutMs
    });
    webApp = assertPermanentWebAppDeployment(updated.state, config, versionNumber);
    if (options.probe !== false) {
      await (options.probeWebApp || probePermanentWebApp)(webApp.url, expectedMarker, options.probeOptions || {});
    }
  }
  return updated;
}

async function ensurePreviousDeploymentRestored(config, versionNumber, expectedMarker, options = {}) {
  return restorePermanentDeployment(
    config,
    versionNumber,
    `Automatic rollback to version ${versionNumber}`,
    expectedMarker,
    options
  );
}

async function publishVersionWithRecovery(
  config,
  versionNumber,
  description,
  expectedMarker,
  previousVersion,
  previousMarker,
  options = {}
) {
  try {
    const updated = await updatePermanentDeployment(
      config,
      versionNumber,
      description,
      options
    );
    const releasedWebApp = assertPermanentWebAppDeployment(updated.state, config, versionNumber);
    if (options.probe !== false) {
      await (options.probeWebApp || probePermanentWebApp)(
        releasedWebApp.url,
        expectedMarker,
        options.probeOptions || {}
      );
    }
    return updated;
  } catch (releaseError) {
    try {
      await ensurePreviousDeploymentRestored(
        config,
        previousVersion,
        previousMarker,
        options
      );
    } catch (recoveryError) {
      fail(
        `Release verification failed (${releaseError.message}) and automatic rollback failed ` +
        `(${recoveryError.message}). Inspect the configured deployment immediately.`
      );
    }
    fail(
      `Release verification failed, and production was restored to version ${previousVersion}: ` +
      releaseError.message
    );
  }
}

function verifyClaspVersion() {
  verifyNodeVersion();
  const output = runClasp(['--version'], { capture: true }).trim();
  if (output !== REQUIRED_CLASP_VERSION) {
    fail(`Expected pinned clasp ${REQUIRED_CLASP_VERSION}, but found ${output || 'no version'}. Run npm install.`);
  }
}

function configure() {
  [
    [CLASP_EXAMPLE_FILE, CLASP_CONFIG_FILE],
    [DEPLOY_EXAMPLE_FILE, DEPLOY_CONFIG_FILE]
  ].forEach(([exampleName, destinationName]) => {
    const example = path.join(REPOSITORY_ROOT, exampleName);
    const destination = path.join(REPOSITORY_ROOT, destinationName);
    if (!fs.existsSync(example)) fail(`Tracked configuration template is missing: ${exampleName}`);
    if (!fs.existsSync(destination)) {
      fs.copyFileSync(example, destination, fs.constants.COPYFILE_EXCL);
      process.stdout.write(`Created ignored local configuration: ${destinationName}\n`);
    } else {
      process.stdout.write(`Kept existing local configuration: ${destinationName}\n`);
    }
  });
  const config = loadConfiguration();
  process.stdout.write(`Configured Script ID ${config.scriptId} with source root ${config.sourceRoot}.\n`);
  process.stdout.write(`Configured existing Deployment ID ${config.deploymentId}.\n`);
}

function login() {
  verifyClaspVersion();
  runClasp(['login']);
}

async function status(options = {}) {
  const config = loadConfiguration();
  verifyClaspVersion();
  process.stdout.write('Local upload candidates (this alone is not a remote synchronization check):\n');
  runClasp(commandFor('status', config));
  if (options.dryRun) {
    process.stdout.write('Dry run: skipped authenticated remote clone.\n');
    return;
  }
  const remote = compareRemote(config);
  const versionNumber = positiveVersionNumber(remote.existing.versionNumber);
  if (!versionNumber) fail('Configured permanent deployment must point to an immutable version, not HEAD.');
  const state = await verifyPermanentDeployment(config, versionNumber);
  const webApp = assertPermanentWebAppDeployment(state, config, versionNumber);
  process.stdout.write(`Permanent deployment: version ${versionNumber}, WEB_APP confirmed.\n`);
  process.stdout.write(`Permanent URL: ${webApp.url}\n`);
}

function push(options = {}) {
  const config = loadConfiguration();
  verifyClaspVersion();
  runChecks();
  const pushArgs = commandFor('push', config);
  if (options.dryRun) {
    process.stdout.write(`Dry run: ${printableCommand('clasp', pushArgs)}\n`);
    return;
  }
  process.stdout.write(`Verified target Script ID: ${config.scriptId}\n`);
  compareRemote(config, { failOnRemoteOnly: true });
  runClasp(pushArgs);
  verifyRemoteHeadSynchronized(config);
}

function openScript(options = {}) {
  const config = loadConfiguration();
  verifyClaspVersion();
  const args = commandFor('open', config);
  if (options.dryRun) {
    process.stdout.write(`Dry run: ${printableCommand('clasp', args)}\n`);
    return;
  }
  runClasp(args);
}

function dev(options = {}) {
  push(options);
  process.stdout.write(
    'Development source is synchronized. In the Apps Script editor, use Deploy → Test deployments → Web app.\n' +
    'The /dev URL runs the latest saved code and is available only to script editors; the permanent /exec URL is unchanged.\n'
  );
}

function releaseDescription(argument) {
  const revision = currentRevision();
  const supplied = String(argument || '').trim();
  return supplied || `START Command Center ${revision}`;
}

async function release(options = {}) {
  const config = loadConfiguration();
  verifyClaspVersion();
  runChecks();
  if (!options.dryRun) assertCleanWorktree();
  const description = releaseDescription(options.description);

  if (options.dryRun) {
    const plan = [
      commandFor('deployments', config),
      commandFor('push', config),
      commandFor('versions', config),
      commandFor('version', config, { description }),
      commandFor('update', config, { description, versionNumber: 1 })
        .map((part) => part === '1' ? '<new-version>' : part)
    ];
    plan.forEach((args) => process.stdout.write(`Dry run: ${printableCommand('clasp', args)}\n`));
    process.stdout.write('Dry run: authoritative deployments.get WEB_APP verification before and after update.\n');
    process.stdout.write('Dry run: post-push HEAD and immutable-version source comparisons.\n');
    process.stdout.write(`Target existing deployment only: ${config.deploymentId}\n`);
    return;
  }

  const localRoot = path.join(REPOSITORY_ROOT, config.sourceRoot);
  const localRelease = validateRuntimeWebApp(localRoot, 'Local Apps Script source');
  const remote = compareRemote(config, { failOnRemoteOnly: true });
  const existing = remote.existing;
  const previousVersion = positiveVersionNumber(existing.versionNumber);
  if (!previousVersion || !remote.deployed) {
    fail('Configured permanent deployment must point to an immutable version before release.');
  }
  const previousRelease = validateRuntimeWebApp(
    remote.deployed.clone.runtimeRoot,
    `Permanent deployment version ${previousVersion}`,
    { requireMetadata: false }
  );
  assertReleaseMetadataBumped(
    localRelease.metadata,
    previousRelease.metadata,
    remote.deployed.comparison
  );
  const currentState = await verifyPermanentDeployment(config, previousVersion);
  const currentWebApp = assertPermanentWebAppDeployment(currentState, config, previousVersion);
  await probePermanentWebApp(
    currentWebApp.url,
    previousRelease.metadata ? previousRelease.metadata.marker : ''
  );

  runClasp(commandFor('push', config));
  const pushedHead = verifyRemoteHeadSynchronized(config);
  validateRuntimeWebApp(pushedHead.clone.runtimeRoot, 'Post-push remote project HEAD');

  const created = await createVersionReliably(config, description);
  if (!created.responseMatched) {
    process.stderr.write(
      'Note: clasp create-version stdout was incomplete or variant; authoritative version state confirmed success.\n'
    );
  }
  if (created.commandStatus !== 0) {
    process.stderr.write(
      `Note: clasp create-version exited ${created.commandStatus}, but authoritative version state confirmed success.\n`
    );
  }
  const immutable = compareClonedRuntime(config, `release-version-${created.versionNumber}`, created.versionNumber);
  printComparison(
    `New immutable version ${created.versionNumber}`,
    immutable.comparison,
    immutable.clone.tempDirectory
  );
  assertRuntimeSynchronized(immutable.comparison, `New immutable version ${created.versionNumber}`);
  const immutableRelease = validateRuntimeWebApp(
    immutable.clone.runtimeRoot,
    `New immutable version ${created.versionNumber}`
  );
  if (immutableRelease.metadata.marker !== localRelease.metadata.marker) {
    fail('New immutable version release indicator does not match local source.');
  }

  const updated = await publishVersionWithRecovery(
    config,
    created.versionNumber,
    description,
    localRelease.metadata.marker,
    previousVersion,
    previousRelease.metadata ? previousRelease.metadata.marker : ''
  );
  if (!updated.responseMatched) {
    process.stderr.write(
      'Note: clasp update-deployment stdout was incomplete or variant; authoritative deployment state confirmed success.\n'
    );
  }
  if (updated.commandStatus !== 0) {
    process.stderr.write(
      `Note: clasp update-deployment exited ${updated.commandStatus}, but authoritative deployment state confirmed success.\n`
    );
  }

  process.stdout.write(`Released Apps Script version ${created.versionNumber}.\n`);
  process.stdout.write(`Visible release: ${localRelease.metadata.marker}.\n`);
  process.stdout.write(`Preserved permanent deployment: ${config.deploymentId}\n`);
  process.stdout.write(`Permanent URL: ${permanentWebAppUrl(config)}\n`);
  process.stdout.write(`Previous version: ${previousVersion}\n`);
  process.stdout.write(`Recovery command: npm run gas:recover -- ${previousVersion}\n`);
}

async function recover(options = {}) {
  const config = loadConfiguration();
  verifyClaspVersion();
  const versionNumber = positiveVersionNumber(options.versionNumber);
  if (!versionNumber) fail('Recovery requires a positive immutable Apps Script version number.');
  const description = String(options.description || '').trim() || `Manual recovery to version ${versionNumber}`;
  if (options.dryRun) {
    const args = commandFor('update', config, { versionNumber, description });
    process.stdout.write(`Dry run: validate immutable version ${versionNumber} Web App source.\n`);
    process.stdout.write(`Dry run: ${printableCommand('clasp', args)}\n`);
    process.stdout.write('Dry run: authoritative deployments.get and HTTP verification.\n');
    return;
  }
  const target = cloneRemote(config, `recovery-version-${versionNumber}`, versionNumber);
  const targetRelease = validateRuntimeWebApp(
    target.runtimeRoot,
    `Recovery version ${versionNumber}`,
    { requireMetadata: false }
  );
  await restorePermanentDeployment(
    config,
    versionNumber,
    description,
    targetRelease.metadata ? targetRelease.metadata.marker : ''
  );
  process.stdout.write(`Restored the existing permanent deployment to version ${versionNumber}.\n`);
  process.stdout.write(`Permanent URL: ${permanentWebAppUrl(config)}\n`);
}

function usage() {
  return [
    'Usage: node scripts/gas-tooling.js <configure|login|status|compare|push|open|dev|release|recover> [options]',
    '  release [--dry-run] [description]',
    '  recover [--dry-run] <version> [description]',
    '',
    'Remote operations require `npm run gas:login` and the Apps Script API enabled at:',
    'https://script.google.com/home/usersettings'
  ].join('\n');
}

async function main(argv = process.argv.slice(2)) {
  const action = argv[0];
  const dryRun = argv.includes('--dry-run');
  const description = argv.slice(1).filter((part) => part !== '--dry-run').join(' ');
  switch (action) {
    case 'configure': configure(); break;
    case 'login': login(); break;
    case 'status': await status({ dryRun }); break;
    case 'compare': {
      const config = loadConfiguration();
      verifyClaspVersion();
      if (dryRun) process.stdout.write('Dry run: clasp clone-script <configured-script-id> --rootDir apps-script\n');
      else {
        const remote = compareRemote(config);
        const versionNumber = positiveVersionNumber(remote.existing.versionNumber);
        if (!versionNumber) fail('Configured permanent deployment must point to an immutable version, not HEAD.');
        const state = await verifyPermanentDeployment(config, versionNumber);
        assertPermanentWebAppDeployment(state, config, versionNumber);
        process.stdout.write(`Permanent deployment version ${versionNumber}: WEB_APP state confirmed.\n`);
      }
      break;
    }
    case 'push': push({ dryRun }); break;
    case 'open': openScript({ dryRun }); break;
    case 'dev': dev({ dryRun }); break;
    case 'release': await release({ dryRun, description }); break;
    case 'recover': {
      const recoveryArgs = argv.slice(1).filter((part) => part !== '--dry-run');
      await recover({
        dryRun,
        versionNumber: recoveryArgs[0],
        description: recoveryArgs.slice(1).join(' ')
      });
      break;
    }
    default:
      process.stderr.write(`${usage()}\n`);
      process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`Apps Script tooling stopped: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  CLASP_CONFIG_FILE,
  DEPLOY_CONFIG_FILE,
  EXPECTED_SOURCE_ROOT,
  EXPECTED_WEB_APP,
  REQUIRED_CLASP_VERSION,
  applyRemoteOnlyPolicy,
  assertDeploymentUpdated,
  assertNoRemoteOnly,
  assertPermanentWebAppDeployment,
  assertReleaseMetadataBumped,
  assertRuntimeSynchronized,
  assertWebAppManifest,
  commandFor,
  compareRuntimeDirectories,
  confirmCreatedVersion,
  createVersionReliably,
  ensurePreviousDeploymentRestored,
  loadConfiguration,
  normalizeDeploymentState,
  parseJsonOutput,
  permanentWebAppUrl,
  positiveVersionNumber,
  printableCommand,
  probePermanentWebApp,
  publishVersionWithRecovery,
  readJsonFile,
  readWebReleaseMetadata,
  resolveCreatedVersion,
  runChecks,
  runCommandResult,
  restorePermanentDeployment,
  updatePermanentDeployment,
  validateConfiguration,
  validateRuntimeWebApp,
  verifyPermanentDeployment,
  verifyNodeVersion
};
