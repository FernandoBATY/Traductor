#!/usr/bin/env node
/**
 * Diagnóstico de la conexión a MySQL.
 *
 * Dice EXACTAMENTE por qué falla la base de datos, que no es lo mismo según el caso:
 * el servidor no responde, las credenciales son incorrectas, la base no existe o
 * falta la tabla `users`. Cada uno se arregla de forma distinta.
 *
 * Uso:
 *   node backend/scripts/diagnostico-db.js
 *
 * Lee las mismas variables que la aplicación (DB_HOST, DB_PORT, DB_USER, DB_PASS,
 * DB_NAME, DB_SSL). Para comprobar la base de PRODUCCIÓN, ponlas delante:
 *
 *   DB_HOST=... DB_USER=... DB_PASS=... DB_NAME=defaultdb DB_PORT=... DB_SSL=true \
 *     node backend/scripts/diagnostico-db.js
 *
 * No imprime la contraseña en ningún caso.
 */
const mysql = require('mysql2/promise');

const host = process.env.DB_HOST || 'localhost';
const port = parseInt(process.env.DB_PORT, 10) || 3306;
const user = process.env.DB_USER || 'root';
const password = process.env.DB_PASS;
const database = process.env.DB_NAME || 'usuarios';
const ssl = process.env.DB_SSL === 'true' || host.includes('aivencloud.com')
    ? { rejectUnauthorized: false }
    : undefined;

const CAUSAS = {
    ENOTFOUND: 'El host no existe (DNS). Revisa DB_HOST.',
    ECONNREFUSED: 'El host existe pero rechaza la conexión. ¿Servicio apagado o puerto equivocado?',
    ETIMEDOUT: 'Tiempo de espera agotado. Suele ser un cortafuegos o un allowlist de IPs.',
    ER_ACCESS_DENIED_ERROR: 'Usuario o contraseña incorrectos. Revisa DB_USER y DB_PASS.',
    ER_BAD_DB_ERROR: 'La base de datos no existe. Revisa DB_NAME (en Aiven suele ser "defaultdb").',
    ER_NO_SUCH_TABLE: 'Falta una tabla. Ejecuta database_setup.sql contra esta base.',
    PROTOCOL_CONNECTION_LOST: 'El servidor cerró la conexión.',
    HANDSHAKE_NO_SSL_SUPPORT: 'El servidor no admite SSL con esta configuración. Revisa DB_SSL.'
};

async function main() {
    console.log('--- Configuración leída del entorno ---');
    console.log(`  DB_HOST : ${host}`);
    console.log(`  DB_PORT : ${port}`);
    console.log(`  DB_USER : ${user}`);
    console.log(`  DB_PASS : ${password ? `definida (${password.length} caracteres)` : 'NO DEFINIDA  <-- la app no podrá conectar'}`);
    console.log(`  DB_NAME : ${database}`);
    console.log(`  SSL     : ${ssl ? 'sí' : 'no'}`);
    console.log('');

    let conn;
    try {
        console.log('Conectando...');
        conn = await mysql.createConnection({
            host, port, user, password, database, ssl, connectTimeout: 15000
        });
        console.log('OK: conexión establecida.\n');
    } catch (err) {
        console.error(`FALLO al conectar: ${err.code || 'sin código'} - ${err.message}`);
        const pista = CAUSAS[err.code];
        if (pista) console.error(`Causa probable: ${pista}`);
        process.exit(1);
    }

    try {
        const [[{ v }]] = await conn.query('SELECT VERSION() AS v');
        console.log(`Servidor MySQL: ${v}`);

        const [tablas] = await conn.query('SHOW TABLES');
        const nombres = tablas.map(t => Object.values(t)[0]);
        console.log(`Tablas en "${database}": ${nombres.length ? nombres.join(', ') : '(ninguna)'}`);

        if (!nombres.includes('users')) {
            console.error('\nFALTA la tabla `users`: el login fallará con 500.');
            console.error('Solución: ejecuta database_setup.sql contra esta base de datos.');
            process.exit(1);
        }

        const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM users');
        console.log(`Usuarios registrados: ${n}`);

        const [cols] = await conn.query(
            `SELECT COLUMN_NAME FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users'`, [database]
        );
        const nombresCols = cols.map(c => c.COLUMN_NAME);
        console.log(`Columnas de users: ${nombresCols.join(', ')}`);
        if (!nombresCols.includes('token_version')) {
            console.warn('AVISO: falta users.token_version (la app la crea sola al arrancar).');
        }

        // Cuenta semilla con contraseña conocida y publicada en el repositorio.
        const [semilla] = await conn.query(
            'SELECT id, usuario, email FROM users WHERE email = ?', ['admin@test.com']
        );
        if (semilla.length) {
            console.error('\nATENCIÓN: existe la cuenta admin@test.com, cuya contraseña bcrypt');
            console.error('estuvo publicada en database_setup.sql. Bórrala:');
            console.error("  DELETE FROM users WHERE email = 'admin@test.com';");
        } else {
            console.log('OK: no existe la cuenta semilla admin@test.com.');
        }

        console.log('\nDiagnóstico completado: la base de datos responde correctamente.');
    } catch (err) {
        console.error(`\nFALLO consultando: ${err.code || 'sin código'} - ${err.message}`);
        const pista = CAUSAS[err.code];
        if (pista) console.error(`Causa probable: ${pista}`);
        process.exit(1);
    } finally {
        await conn.end().catch(() => {});
    }
}

main().catch((e) => {
    console.error('Error inesperado:', e.message);
    process.exit(1);
});
