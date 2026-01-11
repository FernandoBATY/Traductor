const mysql = require('mysql2/promise');

const connectDB = async () => {
    try {
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASS || '21617',
            database: process.env.DB_NAME || 'usuarios'
        });
        console.log('MySQL connected...');
        return connection;
    } catch (err) {
        console.error('MySQL connection error:', err.message);
        console.error('Continuing without database. Some features may be unavailable.');
        return null;
    }
};

module.exports = connectDB;
