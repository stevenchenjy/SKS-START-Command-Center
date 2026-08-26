#!/usr/bin/env node

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const REPOSITORY_ROOT = path.resolve(__dirname, '..');
const SOURCE_ROOT = path.join(REPOSITORY_ROOT, 'apps-script');
const REQUIRED_FILES = ['Code.gs', 'Index.html', 'appsscript.json'];
const ALLOWED_RUNTIME_EXTENSIONS = new Set(['.gs', '.html', '.json']);
const SECRET_PATTERNS = [
  { label: 'OpenAI API key', pattern: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/ },
  { label: 'private key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { label: 'OAuth refresh token value', pattern: /["']refresh_token["']\s*:\s*["'][^"']{12,}["']/i },
  { label: 'Google OAuth client secret value', pattern: /["']client_secret["']\s*:\s*["'][^"']{12,}["']/i }
];

function fail(message) {
  throw new Error(message);
}

function listFilesRecursively(directory) {
  const files = [];
  fs.readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .forEach((entry) => {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        files.push(...listFilesRecursively(fullPath));
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    });
  return files;
}

function repositoryTextFiles() {
  const output = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard'],
    { cwd: REPOSITORY_ROOT, encoding: 'utf8' }
  );
  return output.split(/\r?\n/).filter(Boolean).filter((relativePath) => {
    if (relativePath.startsWith('node_modules/')) return false;
    const extension = path.extname(relativePath).toLowerCase();
    return ['.gs', '.html', '.js', '.json', '.md', '.txt', '.yml', '.yaml'].includes(extension) ||
      ['.gitignore', '.clasp.json.example'].includes(relativePath);
  });
}

function verifyRequiredFiles() {
  REQUIRED_FILES.forEach((name) => {
    const filePath = path.join(SOURCE_ROOT, name);
    if (!fs.existsSync(filePath)) fail(`Missing required Apps Script source: apps-script/${name}`);
  });

  const runtimeFiles = listFilesRecursively(SOURCE_ROOT);
  if (!runtimeFiles.some((filePath) => filePath.endsWith('.gs'))) {
    fail('apps-script must contain at least one .gs server file.');
  }
  runtimeFiles.forEach((filePath) => {
    const extension = path.extname(filePath).toLowerCase();
    if (!ALLOWED_RUNTIME_EXTENSIONS.has(extension)) {
      fail(`Unexpected non-runtime file below apps-script/: ${path.relative(REPOSITORY_ROOT, filePath)}`);
    }
    if (extension === '.json' && path.basename(filePath) !== 'appsscript.json') {
      fail(`Only appsscript.json may be synchronized as runtime JSON: ${path.relative(REPOSITORY_ROOT, filePath)}`);
    }
  });
}

function verifyManifest() {
  const manifestPath = path.join(SOURCE_ROOT, 'appsscript.json');
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    fail(`apps-script/appsscript.json is not valid JSON: ${error.message}`);
  }
  if (manifest.runtimeVersion !== 'V8') fail('Apps Script manifest must use the V8 runtime.');
  const expectedWebApp = {
    executeAs: 'USER_DEPLOYING',
    access: 'ANYONE_ANONYMOUS'
  };
  if (!manifest.webapp ||
      manifest.webapp.executeAs !== expectedWebApp.executeAs ||
      manifest.webapp.access !== expectedWebApp.access) {
    fail(
      'Apps Script manifest must preserve the permanent Web App configuration: ' +
      'executeAs USER_DEPLOYING and access ANYONE_ANONYMOUS.'
    );
  }
  if (!Array.isArray(manifest.oauthScopes)) fail('Apps Script manifest must declare oauthScopes explicitly.');
  const requiredScopes = [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/userinfo.email'
  ];
  requiredScopes.forEach((scope) => {
    if (!manifest.oauthScopes.includes(scope)) fail(`Apps Script manifest is missing required scope: ${scope}`);
  });
  return manifest;
}

function verifyServerSyntax() {
  const serverFiles = listFilesRecursively(SOURCE_ROOT)
    .filter((filePath) => filePath.endsWith('.gs'));
  const combinedSource = serverFiles.map((filePath) => fs.readFileSync(filePath, 'utf8')).join('\n');
  if (!/function\s+doGet\s*\(/.test(combinedSource)) {
    fail('Apps Script web app must keep a public doGet entry point.');
  }
  const compile = (files, label) => {
    const source = files.map((filePath) => (
      `\n// ${path.relative(SOURCE_ROOT, filePath)}\n${fs.readFileSync(filePath, 'utf8')}`
    )).join('\n');
    try {
      new vm.Script(source, { filename: `apps-script-${label}.js` });
    } catch (error) {
      fail(`Apps Script server syntax failed (${label} order): ${error.message}`);
    }
  };
  compile(serverFiles, 'forward');
  compile(serverFiles.slice().reverse(), 'reverse');
  return serverFiles.length;
}

function parseRuntimeReleaseMetadata(source) {
  const versionMatch = String(source).match(/\bvar\s+START_WEB_VERSION\s*=\s*['"]([^'"]+)['"]\s*;/);
  const buildMatch = String(source).match(/\bvar\s+START_WEB_BUILD\s*=\s*['"]([^'"]+)['"]\s*;/);
  if (!versionMatch || !buildMatch) {
    fail('Config.gs must define self-contained START_WEB_VERSION and START_WEB_BUILD string constants.');
  }
  if (!/^\d+\.\d+\.\d+$/.test(versionMatch[1])) fail('Config.gs has an invalid Web version.');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/.test(buildMatch[1])) {
    fail('Config.gs has an invalid build token.');
  }
  return { version: versionMatch[1], build: buildMatch[1] };
}

function verifyWebReleaseMetadata() {
  const html = fs.readFileSync(path.join(SOURCE_ROOT, 'Index.html'), 'utf8');
  const tag = html.match(/<[^>]+\bid=["']release-indicator["'][^>]*>/i);
  if (!tag) fail('Index.html must contain the release-indicator footer.');
  const attribute = (name) => {
    const match = tag[0].match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i'));
    return match ? match[1] : '';
  };
  const version = attribute('data-web-version');
  const build = attribute('data-web-build');
  if (!/^\d+\.\d+\.\d+$/.test(version)) fail('Release indicator has an invalid Web version.');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/.test(build)) {
    fail('Release indicator has an invalid build token.');
  }
  const marker = `Web v${version} · build ${build}`;
  if (!html.includes(marker)) fail('Release indicator text does not match its machine-readable metadata.');
  const runtime = parseRuntimeReleaseMetadata(fs.readFileSync(path.join(SOURCE_ROOT, 'Config.gs'), 'utf8'));
  if (runtime.version !== version || runtime.build !== build) {
    fail('Config.gs release metadata must match the visible Web version and build.');
  }
  const packageVersion = JSON.parse(fs.readFileSync(path.join(REPOSITORY_ROOT, 'package.json'), 'utf8')).version;
  if (packageVersion !== version) fail('package.json version must match the visible Web version.');
  const packageLock = JSON.parse(fs.readFileSync(path.join(REPOSITORY_ROOT, 'package-lock.json'), 'utf8'));
  const lockedRootVersion = packageLock.packages && packageLock.packages[''] && packageLock.packages[''].version;
  if (packageLock.version !== version || lockedRootVersion !== version) {
    fail('package-lock.json version must match the visible Web version.');
  }
  return { version, build, marker };
}

function verifyBrowserSyntax() {
  const htmlPath = path.join(SOURCE_ROOT, 'Index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const scripts = [];
  const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scriptPattern.exec(html))) {
    if (/\bsrc\s*=/.test(match[1])) continue;
    scripts.push(match[2]);
  }
  if (!scripts.length) fail('apps-script/Index.html does not contain inline browser JavaScript.');
  scripts.forEach((source, index) => {
    try {
      new vm.Script(source, { filename: `Index.inline-${index + 1}.js` });
    } catch (error) {
      fail(`Index.html inline script ${index + 1} has invalid syntax: ${error.message}`);
    }
  });
  return scripts.length;
}

function verifyNoConflictMarkers(files) {
  const conflictPattern = /^(?:<<<<<<<|=======|>>>>>>>)(?: .*)?$/m;
  files.forEach((relativePath) => {
    const content = fs.readFileSync(path.join(REPOSITORY_ROOT, relativePath), 'utf8');
    if (conflictPattern.test(content)) fail(`Git conflict marker found in ${relativePath}`);
  });
}

function verifyNoObviousSecrets(files) {
  files.forEach((relativePath) => {
    const content = fs.readFileSync(path.join(REPOSITORY_ROOT, relativePath), 'utf8');
    SECRET_PATTERNS.forEach(({ label, pattern }) => {
      if (pattern.test(content)) fail(`Possible ${label} found in ${relativePath}`);
    });
  });
}

function verifySensitiveFilesIgnored() {
  const sensitivePaths = ['.clasprc.json', '.clasp.json', '.gas-deploy.json'];
  sensitivePaths.forEach((relativePath) => {
    let tracked = true;
    try {
      execFileSync('git', ['ls-files', '--error-unmatch', relativePath], {
        cwd: REPOSITORY_ROOT,
        stdio: 'ignore'
      });
    } catch (_error) {
      tracked = false;
    }
    if (tracked) fail(`${relativePath} must not be tracked.`);

    const ignored = execFileSync(
      'git',
      ['check-ignore', '--quiet', relativePath],
      { cwd: REPOSITORY_ROOT, stdio: 'ignore' }
    );
    void ignored;
  });
}

function verifyNoSensitivePathsTracked() {
  const tracked = execFileSync('git', ['ls-files'], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8'
  }).split(/\r?\n/).filter(Boolean);
  const forbidden = tracked.filter((relativePath) => {
    const base = path.basename(relativePath).toLowerCase();
    return base === '.clasprc.json' ||
      base === '.clasp.json' ||
      base === '.gas-deploy.json' ||
      /^client_secret.*\.json$/i.test(base) ||
      /^credentials.*\.json$/i.test(base) ||
      base === '.env' || /^\.env\./.test(base) && base !== '.env.example';
  });
  if (forbidden.length) fail(`Sensitive or local-only path is tracked: ${forbidden.join(', ')}`);
}

function verifyDiffWhitespace() {
  execFileSync('git', ['diff', '--check'], { cwd: REPOSITORY_ROOT, stdio: 'inherit' });
}

function main() {
  verifyRequiredFiles();
  const manifest = verifyManifest();
  const serverCount = verifyServerSyntax();
  const browserScriptCount = verifyBrowserSyntax();
  const release = verifyWebReleaseMetadata();
  const files = repositoryTextFiles();
  verifyNoConflictMarkers(files);
  verifyNoObviousSecrets(files);
  verifySensitiveFilesIgnored();
  verifyNoSensitivePathsTracked();
  verifyDiffWhitespace();

  process.stdout.write(
    `Static checks passed: ${serverCount} server file(s), ${browserScriptCount} browser script(s), ` +
    `${manifest.oauthScopes.length} explicit OAuth scope(s), ${release.marker}.\n`
  );
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`Static check failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  REPOSITORY_ROOT,
  SOURCE_ROOT,
  parseRuntimeReleaseMetadata,
  repositoryTextFiles,
  verifyBrowserSyntax,
  verifyManifest,
  verifyNoConflictMarkers,
  verifyNoObviousSecrets,
  verifyNoSensitivePathsTracked,
  verifyRequiredFiles,
  verifySensitiveFilesIgnored,
  verifyServerSyntax,
  verifyWebReleaseMetadata
};
