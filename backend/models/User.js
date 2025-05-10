const db = require('../config/db');

class User {
    static async findOneByEmail(email) {
        const connection = await db();
        const [rows] = await connection.execute('SELECT * FROM users WHERE email = ?', [email]);
        console.log('Usuario encontrado:', rows[0]);
        return rows[0];
    }

    static async create({ username, email, password }) {
        const connection = await db();
        const [result] = await connection.execute(
            'INSERT INTO users (usuario, email, contraseña) VALUES (?, ?, ?)',
            [username, email, password]
        );
        console.log('Usuario creado con ID:', result.insertId);
        return result.insertId;
    }
}

module.exports = User;
