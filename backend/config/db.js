const mysql = require('mysql2/promise');

const connectDB = async () => {
    try {
        const host = process.env.DB_HOST || 'localhost';
        const ssl = process.env.DB_SSL === 'true' || host.includes('aivencloud.com')
            ? { rejectUnauthorized: false }
            : undefined;
        const connection = await mysql.createConnection({
            host: host,
            port: parseInt(process.env.DB_PORT, 10) || 3306,
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASS || '21617',
            database: process.env.DB_NAME || 'usuarios',
            ssl: ssl,
            connectTimeout: 15000
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
