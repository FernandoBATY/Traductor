const db = require('../config/db');

async function withConn(fn) {
    const conn = await db();
    try {
        return await fn(conn);
    } finally {
        conn.release();
    }
}

class PasswordReset {
    static async create({ userId, tokenHash, expiresAt }) {
        return withConn(async (conn) => {
            // Limpieza perezosa: borra resets vencidos del usuario al crear uno nuevo
            await conn.execute(
                'DELETE FROM password_resets WHERE user_id = ? AND expires_at < NOW()',
                [userId]
            );
            const [result] = await conn.execute(
                'INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
                [userId, tokenHash, expiresAt]
            );
            return result.insertId;
        });
    }

    // Invalida los tokens de reset previos (solo queda válido el último emitido)
    static async invalidateOthers(userId, keepTokenHash) {
        return withConn(async (conn) => {
            await conn.execute(
                'UPDATE password_resets SET used = 1 WHERE user_id = ? AND token_hash <> ? AND used = 0',
                [userId, keepTokenHash]
            );
        });
    }

    // Busca un token de reset no usado y vigente
    static async findByHash(tokenHash) {
        return withConn(async (conn) => {
            const [rows] = await conn.execute(
                `SELECT * FROM password_resets
                 WHERE token_hash = ? AND used = 0 AND expires_at > NOW()`,
                [tokenHash]
            );
            return rows[0];
        });
    }

    static async markUsed(id) {
        return withConn(async (conn) => {
            await conn.execute('UPDATE password_resets SET used = 1 WHERE id = ?', [id]);
        });
    }

    static async deleteForUser(userId) {
        return withConn(async (conn) => {
            await conn.execute('DELETE FROM password_resets WHERE user_id = ?', [userId]);
        });
    }
}

module.exports = PasswordReset;