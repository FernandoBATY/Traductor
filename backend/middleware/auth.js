const jwt = require('jsonwebtoken');
const { secret } = require('../config/jwt');
const User = require('../models/User');

module.exports = async function auth(req, res, next) {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) {
        return res.status(401).json({ msg: 'No hay token, autorización denegada' });
    }

    let payload;
    try {
        payload = jwt.verify(header.slice(7), secret);
    } catch (err) {
        return res.status(401).json({ msg: 'Token inválido o expirado' });
    }

    try {
        const ver = await User.getTokenVersion(payload.user.id);
        if (ver === -1) {
            return res.status(401).json({ msg: 'Usuario no existe' });
        }
        if (ver !== (payload.ver || 0)) {
            return res.status(401).json({ msg: 'Sesión revocada. Vuelve a iniciar sesión.' });
        }
        req.user = payload.user;
        req.userId = payload.user.id;
        req.ver = payload.ver || 0;
        return next();
    } catch (err) {
        // Fallar CERRADO. Antes se dejaba pasar la petición cuando la BD no respondía,
        // y eso desactivaba la revocación de sesiones justo cuando menos se puede
        // comprobar: un token de una cuenta borrada, de una sesión cerrada o de una
        // contraseña ya cambiada seguía siendo válido mientras MySQL estuviera caído.
        console.error('[auth] BD no disponible al verificar token:', err.message);
        return res.status(503).json({
            msg: 'El servicio no está disponible temporalmente. Inténtalo de nuevo en unos minutos.'
        });
    }
};