#!/usr/bin/env node

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPOSITORY_ROOT = path.resolve(__dirname, '..');
const CLASP_CONFIG_FILE = '.clasp.json';
const DEPLOY_CONFIG_FILE = '.gas-deploy.json';
const CLASP_EXAMPLE_FILE = '.clasp.json.example';
const DEPLOY_EXAMPLE_FILE = '.gas-deploy.example.json';
const EXPECTED_SOURCE_ROOT = 'apps-script';
const REQUIRED_CLASP_VERSION = '3.3.0';
const MINIMUM_NODE_MAJOR = 20;

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

function runCommand(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: options.cwd || REPOSITORY_ROOT,
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    env: process.env
  });
  if (result.error) fail(`Could not run ${executable}: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = options.capture ? String(result.stderr || result.stdout || '').trim() : '';
    fail(`${path.basename(executable)} exited with status ${result.status}${detail ? `: ${detail}` : '.'}`);
  }
  return options.capture ? String(result.stdout || '') : '';
}

function runClasp(args, options = {}) {
  return runCommand(claspBinary(options.repositoryRoot), args, options);
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

function compareRuntimeDirectories(localDirectory, remoteDirectory) {
  const localFiles = relativeRuntimeFiles(localDirectory);
  const remoteFiles = relativeRuntimeFiles(remoteDirectory);
  const localSet = new Set(localFiles);
  const remoteSet = new Set(remoteFiles);
  const localOnly = localFiles.filter((file) => !remoteSet.has(file));
  const remoteOnly = remoteFiles.filter((file) => !localSet.has(file));
  const different = localFiles.filter((file) => remoteSet.has(file) && (
    normalizedFileContent(path.join(localDirectory, file)) !==
    normalizedFileContent(path.join(remoteDirectory, file))
  ));
  const identical = localFiles.filter((file) => remoteSet.has(file) && !different.includes(file));
  return { localOnly, remoteOnly, different, identical };
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

function assertDeploymentUpdated(updated, config, versionNumber) {
  if (!updated || updated.deploymentId !== config.deploymentId || updated.versionNumber !== versionNumber) {
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

  const remoteOnly = options.failOnRemoteOnly
    ? assertNoRemoteOnly([headComparison, deployedComparison])
    : Array.from(new Set([
      ...headComparison.remoteOnly,
      ...(deployedComparison ? deployedComparison.remoteOnly : [])
    ])).sort();
  return {
    deployments,
    existing,
    head: { clone: headClone, comparison: headComparison },
    deployed: deployedClone ? { clone: deployedClone, comparison: deployedComparison } : null,
    remoteOnly
  };
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

function status(options = {}) {
  const config = loadConfiguration();
  verifyClaspVersion();
  process.stdout.write('Local upload candidates (this alone is not a remote synchronization check):\n');
  runClasp(commandFor('status', config));
  if (options.dryRun) {
    process.stdout.write('Dry run: skipped authenticated remote clone.\n');
    return;
  }
  compareRemote(config);
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

function release(options = {}) {
  const config = loadConfiguration();
  verifyClaspVersion();
  runChecks();
  if (!options.dryRun) assertCleanWorktree();
  const description = releaseDescription(options.description);

  if (options.dryRun) {
    const plan = [
      commandFor('deployments', config),
      commandFor('push', config),
      commandFor('version', config, { description }),
      commandFor('update', config, { description, versionNumber: 1 })
        .map((part) => part === '1' ? '<new-version>' : part)
    ];
    plan.forEach((args) => process.stdout.write(`Dry run: ${printableCommand('clasp', args)}\n`));
    process.stdout.write(`Target existing deployment only: ${config.deploymentId}\n`);
    return;
  }

  const remote = compareRemote(config, { failOnRemoteOnly: true });
  const existing = remote.existing;
  const previousVersion = Number.isInteger(existing.versionNumber) ? existing.versionNumber : null;

  runClasp(commandFor('push', config));
  const version = parseJsonOutput(
    runClasp(commandFor('version', config, { description }), { capture: true }),
    'clasp create-version'
  );
  if (!Number.isInteger(version.versionNumber) || version.versionNumber < 1) {
    fail('clasp create-version did not return a positive version number.');
  }
  const updated = parseJsonOutput(
    runClasp(commandFor('update', config, {
      description,
      versionNumber: version.versionNumber
    }), { capture: true }),
    'clasp update-deployment'
  );
  assertDeploymentUpdated(updated, config, version.versionNumber);
  const confirmedDeployment = listDeployments(config)
    .find((deployment) => deployment.deploymentId === config.deploymentId);
  assertDeploymentUpdated(confirmedDeployment, config, version.versionNumber);

  process.stdout.write(`Released Apps Script version ${version.versionNumber}.\n`);
  process.stdout.write(`Preserved permanent deployment: ${config.deploymentId}\n`);
  process.stdout.write(`Permanent URL: https://script.google.com/macros/s/${config.deploymentId}/exec\n`);
  if (previousVersion) {
    const rollback = commandFor('update', config, {
      description: `Rollback to version ${previousVersion}`,
      versionNumber: previousVersion
    });
    process.stdout.write(`Previous version: ${previousVersion}\n`);
    process.stdout.write(`Rollback command: ${printableCommand('npx', ['clasp', ...rollback])}\n`);
  }
}

function usage() {
  return [
    'Usage: node scripts/gas-tooling.js <configure|login|status|compare|push|open|dev|release> [--dry-run] [description]',
    '',
    'Remote operations require `npm run gas:login` and the Apps Script API enabled at:',
    'https://script.google.com/home/usersettings'
  ].join('\n');
}

function main(argv = process.argv.slice(2)) {
  const action = argv[0];
  const dryRun = argv.includes('--dry-run');
  const description = argv.slice(1).filter((part) => part !== '--dry-run').join(' ');
  switch (action) {
    case 'configure': configure(); break;
    case 'login': login(); break;
    case 'status': status({ dryRun }); break;
    case 'compare': {
      const config = loadConfiguration();
      verifyClaspVersion();
      if (dryRun) process.stdout.write('Dry run: clasp clone-script <configured-script-id> --rootDir apps-script\n');
      else compareRemote(config);
      break;
    }
    case 'push': push({ dryRun }); break;
    case 'open': openScript({ dryRun }); break;
    case 'dev': dev({ dryRun }); break;
    case 'release': release({ dryRun, description }); break;
    default:
      process.stderr.write(`${usage()}\n`);
      process.exitCode = 1;
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`Apps Script tooling stopped: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  CLASP_CONFIG_FILE,
  DEPLOY_CONFIG_FILE,
  EXPECTED_SOURCE_ROOT,
  REQUIRED_CLASP_VERSION,
  assertDeploymentUpdated,
  assertNoRemoteOnly,
  commandFor,
  compareRuntimeDirectories,
  loadConfiguration,
  parseJsonOutput,
  printableCommand,
  readJsonFile,
  runChecks,
  validateConfiguration,
  verifyNodeVersion
};
