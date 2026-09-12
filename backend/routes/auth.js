const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const { check, validationResult } = require('express-validator');
const User = require('../models/User');
const PasswordReset = require('../models/PasswordReset');
const rateLimit = require('../middleware/rateLimit');
const paths = require('../config/paths');
const auth = require('../middleware/auth');
const { secret, expiresIn } = require('../config/jwt');
const { sendPasswordReset, mailerConfigured } = require('../utils/mailer');
const { error: logError } = require('../utils/logger');

const loginLimiter = rateLimit({ windowMs: 60000, max: 10 });
const registerLimiter = rateLimit({ windowMs: 60000, max: 5 });
const sensitiveLimiter = rateLimit({ windowMs: 60000, max: 20 });

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Hash de una contraseña que nadie usa; solo sirve para gastar el mismo tiempo de
// bcrypt cuando el correo no existe (ver el login).
const HASH_SENUELO = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 10);

function signToken(userId, ver) {
    return new Promise((resolve, reject) => {
        jwt.sign({ user: { id: userId }, ver }, secret, { expiresIn }, (err, token) => {
            if (err) reject(err);
            else resolve(token);
        });
    });
}

function serverError(res, context, err) {
    logError(`[auth] ${context}`, { message: err.message });
    return res.status(500).json({ msg: 'Error en el servidor' });
}

// ============ Login ============
router.post(
    '/login',
    loginLimiter,
    [
        check('email', 'Por favor incluye un correo electrónico válido').isEmail(),
        check('password', 'La contraseña es requerida').exists()
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const email = req.body.email.trim().toLowerCase();

        try {
            let user = await User.findOneByEmail(email);
            if (user) {
                const isMatch = await bcrypt.compare(req.body.password, user.contraseña);
                if (!isMatch) user = null;
            } else {
                // Comparación señuelo: sin esto el login respondía mucho más rápido
                // cuando el correo NO existía, y ese hueco de tiempo permitía
                // averiguar qué cuentas están registradas pese al mensaje genérico.
                await bcrypt.compare(req.body.password || '', HASH_SENUELO);
            }

            // Mensaje genérico: no revela si el correo existe (evita enumeración de usuarios)
            if (!user) {
                return res.status(400).json({ msg: 'Credenciales inválidas' });
            }

            const token = await signToken(user.id, user.token_version);
            return res.json({
                token,
                user: { id: user.id, username: user.usuario, email: user.email }
            });
        } catch (err) {
            return serverError(res, 'login', err);
        }
    }
);

// ============ Registro ============
router.post(
    '/register',
    registerLimiter,
    [
        check('username', 'Nombre de usuario es requerido').not().isEmpty(),
        check('username', 'El nombre de usuario no puede contener etiquetas HTML').matches(/^[^<>]+$/),
        check('email', 'Por favor incluye un correo electrónico válido').isEmail(),
        check('password', 'La contraseña debe tener 8 o más caracteres').isLength({ min: 8 })
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const username = String(req.body.username).trim();
        const email = req.body.email.trim().toLowerCase();

        try {
            if (await User.findOneByEmail(email)) {
                return res.status(400).json({ msg: 'El correo ya está registrado' });
            }
            if (await User.findOneByUsername(username)) {
                return res.status(400).json({ msg: 'El nombre de usuario ya está en uso' });
            }

            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(req.body.password, salt);

            const userId = await User.create({ username, email, password: hashedPassword });

            const token = await signToken(userId, 0);
            return res.status(201).json({
                token,
                user: { id: userId, username, email }
            });
        } catch (err) {
            return serverError(res, 'register', err);
        }
    }
);

// ============ Renovar token (extiende la sesión sin re-login) ============
router.post('/refresh', auth, async (req, res) => {
    try {
        const user = await User.getPublicById(req.userId);
        if (!user) return res.status(401).json({ msg: 'Usuario no existe' });
        const token = await signToken(req.userId, req.ver);
        return res.json({ token, user });
    } catch (err) {
        return serverError(res, 'refresh', err);
    }
});

// ============ Cerrar sesión (revoca TODAS las sesiones del usuario) ============
router.post('/logout', [auth, sensitiveLimiter], async (req, res) => {
    try {
        await User.bumpTokenVersion(req.userId);
        return res.json({ msg: 'Sesión cerrada' });
    } catch (err) {
        return serverError(res, 'logout', err);
    }
});

// ============ Cambiar contraseña (revoca sesiones y devuelve token nuevo) ============
router.post(
    '/change-password',
    [auth, sensitiveLimiter],
    [
        check('currentPassword', 'La contraseña actual es requerida').exists(),
        check('newPassword', 'La contraseña debe tener 8 o más caracteres').isLength({ min: 8 })
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        try {
            const user = await User.findById(req.userId);
            if (!user) return res.status(401).json({ msg: 'Usuario no existe' });

            const isMatch = await bcrypt.compare(req.body.currentPassword, user.contraseña);
            if (!isMatch) {
                return res.status(400).json({ msg: 'La contraseña actual no es correcta' });
            }

            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(req.body.newPassword, salt);

            await User.updatePassword(req.userId, hashedPassword);
            await User.bumpTokenVersion(req.userId);

            // Token nuevo firmado con la versión REAL leída tras incrementarla.
            // Calcularla en local (token_version + 1) producía un token ya inválido si
            // otra petición del mismo usuario revocaba sesiones al mismo tiempo.
            const newVer = await User.getTokenVersion(req.userId);
            const token = await signToken(req.userId, newVer);
            const publicUser = await User.getPublicById(req.userId);

            return res.json({ token, user: publicUser, msg: 'Contraseña actualizada' });
        } catch (err) {
            return serverError(res, 'change-password', err);
        }
    }
);

// ============ Editar perfil (username / email) ============
router.put(
    '/profile',
    [auth, sensitiveLimiter],
    [
        check('username').optional().trim().isLength({ min: 3, max: 50 }).matches(/^[^<>]+$/),
        check('email').optional().isEmail()
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        try {
            const user = await User.findById(req.userId);
            if (!user) return res.status(401).json({ msg: 'Usuario no existe' });

            const username = req.body.username != null ? String(req.body.username).trim() : user.usuario;
            const email = req.body.email != null ? String(req.body.email).trim().toLowerCase() : user.email;

            if (username !== user.usuario && await User.findOneByUsername(username)) {
                return res.status(400).json({ msg: 'El nombre de usuario ya está en uso' });
            }
            if (email !== user.email && await User.findOneByEmail(email)) {
                return res.status(400).json({ msg: 'El correo ya está registrado' });
            }

            await User.updateProfile(req.userId, { username, email });
            const publicUser = await User.getPublicById(req.userId);
            return res.json({ user: publicUser, msg: 'Perfil actualizado' });
        } catch (err) {
            return serverError(res, 'profile', err);
        }
    }
);

// ============ Eliminar cuenta ============
router.delete(
    '/account',
    [auth, sensitiveLimiter],
    [check('password', 'La contraseña es requerida').exists()],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        try {
            const user = await User.findById(req.userId);
            if (!user) return res.status(401).json({ msg: 'Usuario no existe' });

            const isMatch = await bcrypt.compare(req.body.password, user.contraseña);
            if (!isMatch) {
                return res.status(400).json({ msg: 'La contraseña no es correcta' });
            }

            // Borrar datos de entrenamiento y modelos del usuario del disco
            for (const target of [paths.userTrainingDir(req.userId), paths.userModelDir(req.userId)]) {
                try {
                    fs.rmSync(target, { recursive: true, force: true });
                } catch (e) {
                    logError('[account] no se pudieron borrar los datos del usuario', { message: e.message });
                }
            }

            await PasswordReset.deleteForUser(req.userId);
            await User.deleteById(req.userId);

            return res.json({ msg: 'Cuenta eliminada' });
        } catch (err) {
            return serverError(res, 'delete-account', err);
        }
    }
);

// ============ Solicitar recuperación de contraseña ============
router.post(
    '/forgot-password',
    registerLimiter,
    [check('email', 'Por favor incluye un correo electrónico válido').isEmail()],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const email = req.body.email.trim().toLowerCase();

        // Respuesta genérica SIEMPRE (no revela si el correo existe)
        const genericMsg = 'Revisa tu correo. Si la cuenta existe, recibirás un enlace para restablecer tu contraseña.';

        try {
            const user = await User.findOneByEmail(email);
            if (!user) {
                return res.json({ msg: genericMsg });
            }

            const token = crypto.randomBytes(32).toString('hex');
            const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
            await PasswordReset.create({ userId: user.id, tokenHash: sha256(token), expiresAt });
            await PasswordReset.invalidateOthers(user.id, sha256(token));

            const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
            const resetLink = `${baseUrl}/restablecer-contrasena.html?token=${token}`;

            const sent = await sendPasswordReset(email, resetLink);
            if (!sent) {
                // Sin SMTP: en desarrollo se expone el enlace para poder probar el flujo.
                if (process.env.NODE_ENV !== 'production') {
                    console.log(`[forgot-password] SMTP no configurado (dev). Enlace para ${email}: ${resetLink}`);
                    return res.json({ msg: genericMsg, resetLink });
                }
                logError('[forgot-password] SMTP no configurado; no se envió el email.', { email });
                return res.json({ msg: genericMsg });
            }

            return res.json({ msg: genericMsg });
        } catch (err) {
            return serverError(res, 'forgot-password', err);
        }
    }
);

// ============ Restablecer contraseña con token ============
router.post(
    '/reset-password',
    registerLimiter,
    [
        check('token', 'El token es requerido').notEmpty(),
        check('password', 'La contraseña debe tener 8 o más caracteres').isLength({ min: 8 })
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        try {
            const resetRow = await PasswordReset.findByHash(sha256(req.body.token));
            if (!resetRow) {
                return res.status(400).json({ msg: 'Enlace inválido o expirado. Solicita uno nuevo.' });
            }

            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(req.body.password, salt);

            await User.updatePassword(resetRow.user_id, hashedPassword);
            await User.bumpTokenVersion(resetRow.user_id); // invalida todas las sesiones
            await PasswordReset.markUsed(resetRow.id);
            await PasswordReset.deleteForUser(resetRow.user_id);

            return res.json({ msg: 'Contraseña restablecida. Ya puedes iniciar sesión.' });
        } catch (err) {
            return serverError(res, 'reset-password', err);
        }
    }
);

module.exports = router;