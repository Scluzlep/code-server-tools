'use strict';

const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

function resolveRoutesIndexPath() {
  if (process.argv[2]) {
    return process.argv[2];
  }
  const paths = execFileSync('find', [
    '/opt/code-server', '-type', 'f', '-path', '*/out/node/routes/index.js',
  ], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  if (paths.length !== 1) {
    throw new Error(`Expected one code-server routes/index.js, found ${paths.length}: ${paths.join(', ')}`);
  }
  return paths[0];
}

function patchRoutesFile(targetPath, consoleModulePath = '/usr/local/lib/agy-console.cjs') {
  let source = fs.readFileSync(targetPath, 'utf8');
  const marker = '/* Antigravity /agy graphical WebUI & shell routes */';
  if (source.includes(marker)) {
    console.log(`Already patched ${targetPath}`);
    return false;
  }

  const mountHook = /app\.router\.all\(\s*(['"])\/proxy\/:port\{\/\*path\}\1/;
  const mountMatch = source.match(mountHook);
  if (!mountMatch) {
    throw new Error(`Could not locate /proxy/:port route registration in ${targetPath}`);
  }

  const disposeHook = /disposeRoutes\s*:\s*\(\s*\)\s*=>\s*\{\s*heart\.dispose\(\)\s*;?/;
  const disposeMatch = source.match(disposeHook);
  if (!disposeMatch) {
    throw new Error(`Could not locate disposeRoutes heart.dispose() in ${targetPath}`);
  }

  const mountSnippet = [
    marker,
    `const agyConsole = require(${JSON.stringify(consoleModulePath)}).registerRoutes(app, args, {`,
    '  http: require("../http"),',
    '  proxy: require("../proxy"),',
    '  wsRouter: require("../wsRouter"),',
    '});',
    '',
  ].join('\n');

  source = source.replace(mountHook, (matched) => mountSnippet + matched);
  source = source.replace(disposeHook, (matched) => matched + '\n      agyConsole.dispose();');
  fs.writeFileSync(targetPath, source);
  console.log(`Patched Antigravity /agy routes in ${targetPath}`);
  return true;
}

if (require.main === module) {
  patchRoutesFile(resolveRoutesIndexPath());
} else {
  module.exports = { patchRoutesFile };
}
