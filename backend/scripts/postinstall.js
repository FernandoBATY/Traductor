const { execSync } = require('child_process');

function tryExec(cmd, description) {
  try {
    console.log(`\n> ${description}: ${cmd}`);
    execSync(cmd, { stdio: 'inherit' });
    return true;
  } catch (e) {
    console.warn(`Failed: ${description}`);
    return false;
  }
}

console.log('Running postinstall: installing Python dependencies...');
// Try Windows Python launcher first, then generic python
if (!tryExec('py -m pip install -r requirements.txt', 'Install via py')) {
  if (!tryExec('python -m pip install -r requirements.txt', 'Install via python')) {
    console.error('Could not install Python dependencies automatically. Please install manually.');
  }
}

console.log('\nAttempting MySQL initialization using base.sql (optional)...');
// Use env vars if provided, fallback to defaults in db.js
const host = process.env.DB_HOST || 'localhost';
const user = process.env.DB_USER || 'root';
const pass = process.env.DB_PASS || '21617';

// On Windows, MySQL might be available as `mysql` in PATH
// Import base.sql if mysql CLI exists
try {
  execSync('mysql --version', { stdio: 'ignore' });
  const importCmd = `mysql -h ${host} -u ${user} -p${pass} < base.sql`;
  tryExec(importCmd, 'Import base.sql');
} catch {
  console.log('MySQL CLI not found in PATH; skipping DB init.');
}

console.log('\nPostinstall completed.');
