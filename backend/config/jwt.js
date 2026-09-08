const crypto = require('crypto');

const ENV = process.env.NODE_ENV || 'development';

function resolveJwtSecret() {
    const secret = process.env.JWT_SECRET;
    if (secret && secret !== 'secret' && secret.length >= 32) {
        return secret;
    }
    if (ENV === 'production') {
        console.error('FATAL: JWT_SECRET no está configurado o es débil (mínimo 32 caracteres). Abortando.');
        process.exit(1);
    }
    console.warn('[DEV] JWT_SECRET no configurado: se genera un secreto aleatorio (los tokens se invalidan al reiniciar).');
    return crypto.randomBytes(48).toString('hex');
}

module.exports = {
    secret: resolveJwtSecret(),
    expiresIn: process.env.JWT_EXPIRES || '24h'
};