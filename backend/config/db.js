const mysql = require('mysql2/promise');

// Estado de la conexión, para poder diagnosticar una caída de MySQL sin adivinar
// (se expone en /api/ops/stats).
const estado = { conectada: false, ultimoError: null, ultimoIntento: null };

const host = process.env.DB_HOST || 'localhost';
const ssl = process.env.DB_SSL === 'true' || host.includes('aivencloud.com')
    ? { rejectUnauthorized: false }
    : undefined;

// Pool compartido: evita crear/cerrar conexiones por petición (fugas) y
// permite concurrencia. Las conexiones se devuelven con .release().
const pool = mysql.createPool({
    host,
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    user: process.env.DB_USER || 'root',
    // Sin fallback: aquí había una contraseña real escrita en el repositorio.
    // Si DB_PASS no está definida, la conexión falla de forma evidente en vez de
    // intentar entrar con una credencial conocida por cualquiera que lea el código.
    password: process.env.DB_PASS,
    database: process.env.DB_NAME || 'usuarios',
    ssl,
    connectTimeout: 15000,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    charset: 'utf8mb4'
});

// Devuelve una conexión del pool (liberar SIEMPRE con conn.release()).
// De paso actualiza `estado`: así el indicador refleja si la base responde AHORA y no
// solo cómo fue el intento del arranque, que se quedaba obsoleto en cuanto MySQL se
// caía o volvía sin reiniciar el servicio.
const db = async () => {
    try {
        const conn = await pool.getConnection();
        estado.conectada = true;
        estado.ultimoError = null;
        estado.ultimoIntento = new Date().toISOString();
        return conn;
    } catch (err) {
        estado.conectada = false;
        estado.ultimoError = err.message;
        estado.ultimoIntento = new Date().toISOString();
        throw err;
    }
};

// Migraciones idempotentes: se ejecutan al arrancar, sin pasos manuales.
async function ensureSchema(conn) {
    // `users` se crea aquí y no solo en database_setup.sql. Antes, con una base de
    // datos recién creada, esta función buscaba la columna token_version, no la
    // encontraba, lanzaba un ALTER TABLE sobre una tabla inexistente y reventaba
    // entera: `password_resets` tampoco llegaba a crearse y el login fallaba con un
    // 500 hasta que alguien ejecutaba el .sql a mano.
    await conn.execute(`
        CREATE TABLE IF NOT EXISTS users (
            id INT AUTO_INCREMENT PRIMARY KEY,
            usuario VARCHAR(50) NOT NULL UNIQUE,
            email VARCHAR(100) NOT NULL UNIQUE,
            contraseña VARCHAR(255) NOT NULL,
            fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            activo BOOLEAN DEFAULT TRUE,
            token_version INT NOT NULL DEFAULT 0,
            INDEX idx_email (email),
            INDEX idx_usuario (usuario)
        ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);

    // Bases anteriores: la tabla ya existe pero sin la columna.
    const [[row]] = await conn.execute(
        `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'token_version'`
    );
    if (Number(row.c) === 0) {
        await conn.execute(`ALTER TABLE users ADD COLUMN token_version INT NOT NULL DEFAULT 0`);
        console.log('[db] Columna users.token_version creada');
    }

    await conn.execute(`
        CREATE TABLE IF NOT EXISTS password_resets (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            token_hash CHAR(64) NOT NULL,
            expires_at DATETIME NOT NULL,
            used TINYINT(1) NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_user (user_id),
            INDEX idx_token_hash (token_hash)
        )
    `);
}

async function connectDB() {
    estado.ultimoIntento = new Date().toISOString();
    try {
        const conn = await db();
        try {
            await ensureSchema(conn);
            estado.conectada = true;
            estado.ultimoError = null;
            console.log('MySQL connected... (esquema listo)');
            return true;
        } finally {
            conn.release();
        }
    } catch (err) {
        estado.conectada = false;
        estado.ultimoError = err.message;
        console.error('MySQL connection/init error:', err.message);
        console.error('Continuing without database. Some features may be unavailable.');
        return false;
    }
}

if (!process.env.DB_PASS) {
    console.warn('[db] DB_PASS no está definida: la conexión a MySQL fallará.');
}

// Si MySQL no responde al arrancar, se reintenta en segundo plano. Sin esto el
// esquema solo se creaba en el arranque y, si la base tardaba en estar lista o se
// arreglaba después, hacía falta reiniciar el servicio a mano para que se aplicara.
async function connectWithRetry({ esperaMs = 30000, esperaMaxMs = 300000 } = {}) {
    let espera = esperaMs;
    let intento = 0;
    // Sin límite de intentos, pero espaciándolos: si la base se recupera horas después
    // (como pasó al apagarse el servicio de Aiven), el esquema se crea solo en cuanto
    // vuelva, sin reiniciar el servicio a mano.
    for (;;) {
        if (await connectDB()) return true;
        intento += 1;
        if (intento === 5) {
            console.error(`[db] MySQL sigue sin responder; se reintentará cada ${Math.round(esperaMaxMs / 60000)} min.`);
        }
        await new Promise((r) => { const t = setTimeout(r, espera); if (t.unref) t.unref(); });
        espera = Math.min(espera * 2, esperaMaxMs);
    }
}

db.ensureSchema = ensureSchema;
db.connectDB = connectDB;
db.connectWithRetry = connectWithRetry;
db.estado = estado;

module.exports = db;