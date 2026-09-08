const nodemailer = require('nodemailer');

const RESEND_API_URL = 'https://api.resend.com/emails';

let transporter = null;
let resendKey = process.env.RESEND_API_KEY || null;

if (process.env.SMTP_HOST) {
    try {
        transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: parseInt(process.env.SMTP_PORT, 10) || 587,
            secure: process.env.SMTP_SECURE === 'true',
            auth: process.env.SMTP_USER
                ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
                : undefined
        });
    } catch (e) {
        console.error('[mailer] SMTP mal configurado:', e.message);
        transporter = null;
    }
}

// Se considera configurado si hay API key de Resend o transporte SMTP
function mailerConfigured() {
    return !!(resendKey || transporter);
}

function defaultFrom() {
    return process.env.RESEND_FROM || process.env.SMTP_FROM || process.env.SMTP_USER || process.env.RESEND_API_KEY_FROM || undefined;
}

async function sendViaResend({ to, from, subject, html, replyTo }) {
    const res = await fetch(RESEND_API_URL, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${resendKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ from, to, subject, html, ...(replyTo ? { reply_to: replyTo } : {}) })
    });
    if (!res.ok) {
        const detail = await res.text();
        throw new Error(`Resend ${res.status}: ${detail}`);
    }
    return true;
}

async function sendMail({ to, from, subject, html, replyTo }) {
    if (resendKey) {
        return sendViaResend({ to, from: from && !replyTo ? from : defaultFrom(), subject, html, replyTo: replyTo || from });
    }
    if (!transporter) return false;
    await transporter.sendMail({ from: from || defaultFrom(), to, subject, html, ...(replyTo ? { replyTo } : {}) });
    return true;
}

async function sendPasswordReset(email, resetLink) {
    return sendMail({
        to: email,
        subject: 'Restablecer contraseña - Traductor de Lengua de Señas',
        html: `<p>Recibimos una solicitud para restablecer tu contraseña.</p>
               <p>Haz clic en el siguiente enlace (válido por 30 minutos):</p>
               <p><a href="${resetLink}">${resetLink}</a></p>
               <p>Si no la solicitaste, ignora este correo.</p>`
    });
}

module.exports = { mailerConfigured, sendMail, sendPasswordReset };