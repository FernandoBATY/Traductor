const { execSync } = require('child_process');

function tryExec(cmd, description, extraEnv) {
  try {
    console.log(`\n> ${description}: ${cmd}`);
    execSync(cmd, { stdio: 'inherit', env: { ...process.env, ...(extraEnv || {}) } });
    return true;
  } catch (e) {
    console.warn(`Failed: ${description}`);
    return false;
  }
}

if (process.platform !== 'win32') {
    console.log('Skipping Python dependency install on non-Windows (use the service build instead).');
    process.exit(0);
}
console.log('Running postinstall: installing Python dependencies...');
// Try Windows Python launcher first, then generic python
if (!tryExec('py -m pip install -r requirements.txt', 'Install via py')) {
  if (!tryExec('python -m pip install -r requirements.txt', 'Install via python')) {
    console.error('Could not install Python dependencies automatically. Please install manually.');
  }
}

console.log('\nAttempting MySQL initialization using base.sql (optional)...');
const host = process.env.DB_HOST || 'localhost';
const user = process.env.DB_USER || 'root';
// Sin valor por defecto: aquí había una contraseña real escrita en el repositorio.
const pass = process.env.DB_PASS;

if (!pass) {
  console.log('DB_PASS no definida; se omite la inicialización de la base de datos.');
} else {
  try {
    execSync('mysql --version', { stdio: 'ignore' });
    // La contraseña viaja por el entorno (MYSQL_PWD) y no en la línea de comandos,
    // donde cualquier usuario de la máquina podría leerla en el listado de procesos.
    tryExec(`mysql -h ${host} -u ${user} < base.sql`, 'Import base.sql', { MYSQL_PWD: pass });
  } catch {
    console.log('MySQL CLI not found in PATH; skipping DB init.');
  }
}

console.log('\nPostinstall completed.');
