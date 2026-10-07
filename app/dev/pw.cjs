// Dev-only: Playwright is not an app dependency — use a local install if there is one, else the
// global one (npm i -g playwright).
const { execSync } = require('node:child_process');
const path = require('node:path');

function loadPlaywright() {
  try {
    return require('playwright');
  } catch {
    return require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));
  }
}

module.exports = { loadPlaywright };
