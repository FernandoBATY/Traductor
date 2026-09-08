const express = require('express');
const router = express.Router();
const { check, validationResult } = require('express-validator');
const rateLimit = require('../middleware/rateLimit');
const { mailerConfigured, sendMail } = require('../utils/mailer');
const { error: logError } = require('../utils/logger');

const contactLimiter = rateLimit({ windowMs: 60000, max: 5 });

// Destinatario de los mensajes de soporte
const supportEmail = () => process.env.SUPPORT_EMAIL || process.env.SMTP_USER || 'soporte@traductor.local';

// Enviar mensaje de ayuda/contacto (público, con rate-limit anti-spam)
router.post(
    '/contact',
    contactLimiter,
    [
        check('name', 'El nombre es obligatorio').optional().isLength({ min: 2, max: 80 }),
        check('email', 'Ingresa un correo válido para poder responderte').isEmail(),
        check('subject', 'El asunto debe tener entre 3 y 120 caracteres').isLength({ min: 3, max: 120 }),
        check('message', 'El mensaje debe tener entre 5 y 2000 caracteres').isLength({ min: 5, max: 2000 })
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const name = req.body.name ? String(req.body.name).trim() : 'Usuario';
        const fromEmail = req.body.email.trim();
        const subject = `[Soporte] ${String(req.body.subject).trim()}`;
        const message = String(req.body.message).trim();

        const html = `
<p>Mensaje de contacto desde el Traductor de Lengua de Señas:</p>
<table>
  <tr><td><b>Nombre:</b></td><td>${name.replace(/</g, '&lt;')}</td></tr>
  <tr><td><b>Correo (responder a):</b></td><td>${fromEmail.replace(/</g, '&lt;')}</td></tr>
  <tr><td><b>Asunto:</b></td><td>${subject.replace(/</g, '&lt;')}</td></tr>
</table>
<hr />
<p>${message.replace(/</g, '&lt;').replace(/\n/g, '<br/>')}</p>`;

        if (mailerConfigured()) {
            try {
                // En Resend/SMTP el remitente (from) debe ser un dominio verificado;
                // el correo del usuario viaja como reply-to para poder responderle.
                await sendMail({ to: supportEmail(), replyTo: fromEmail, subject, html });
                return res.json({ msg: 'Mensaje enviado. Te responderemos a tu correo.' });
            } catch (e) {
                logError('[contact] error enviando correo', { message: e.message });
                return res.status(500).json({ msg: 'No se pudo enviar el mensaje. Inténtalo de nuevo.' });
            }
        }

        // Sin SMTP configurado: se abre el cliente de correo del usuario (mailto)
        const to = supportEmail();
        const mailto = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(`Nombre: ${name}\nCorreo: ${fromEmail}\n\n${message}`)}`;
        return res.json({
            msg: 'El envío automático no está disponible; se abrirá tu correo para completar el mensaje.',
            mailto
        });
    }
);

module.exports = router;