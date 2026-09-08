const db = require('../config/db');

// Ejecuta una función con una conexión del pool y la libera SIEMPRE.
async function withConn(fn) {
    const conn = await db();
    try {
        return await fn(conn);
    } finally {
        conn.release();
    }
}

class User {
    static async findOneByEmail(email) {
        return withConn(async (conn) => {
            const [rows] = await conn.execute('SELECT * FROM users WHERE email = ?', [email]);
            return rows[0];
        });
    }

    static async findOneByUsername(username) {
        return withConn(async (conn) => {
            const [rows] = await conn.execute('SELECT * FROM users WHERE usuario = ?', [username]);
            return rows[0];
        });
    }

    static async findById(id) {
        return withConn(async (conn) => {
            const [rows] = await conn.execute(
                'SELECT id, usuario, email, contraseña, token_version, fecha_registro, activo FROM users WHERE id = ?',
                [id]
            );
            return rows[0];
        });
    }

    // Datos seguros para devolver al cliente (sin contraseña)
    static async getPublicById(id) {
        const u = await this.findById(id);
        if (!u) return null;
        return { id: u.id, username: u.usuario, email: u.email, fecha_registro: u.fecha_registro };
    }

    static async getTokenVersion(id) {
        const u = await this.findById(id);
        return u ? u.token_version : -1;
    }

    static async create({ username, email, password }) {
        return withConn(async (conn) => {
            const [result] = await conn.execute(
                'INSERT INTO users (usuario, email, contraseña) VALUES (?, ?, ?)',
                [username, email, password]
            );
            return result.insertId;
        });
    }

    static async updateProfile(id, { username, email }) {
        return withConn(async (conn) => {
            const [result] = await conn.execute(
                'UPDATE users SET usuario = ?, email = ? WHERE id = ?',
                [username, email, id]
            );
            return result.affectedRows > 0;
        });
    }

    static async updatePassword(id, hashedPassword) {
        return withConn(async (conn) => {
            const [result] = await conn.execute(
                'UPDATE users SET contraseña = ? WHERE id = ?',
                [hashedPassword, id]
            );
            return result.affectedRows > 0;
        });
    }

    // Revoca todas las sesiones del usuario (logout, cambio de contraseña, reset, borrado).
    static async bumpTokenVersion(id) {
        return withConn(async (conn) => {
            const [result] = await conn.execute(
                'UPDATE users SET token_version = token_version + 1 WHERE id = ?',
                [id]
            );
            return result.affectedRows > 0;
        });
    }

    static async deleteById(id) {
        return withConn(async (conn) => {
            const [result] = await conn.execute('DELETE FROM users WHERE id = ?', [id]);
            return result.affectedRows > 0;
        });
    }
}

module.exports = User;