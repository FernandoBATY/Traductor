// Helpers compartidos de autenticación (JWT almacenado en localStorage)
function getToken() {
    return localStorage.getItem('token');
}

function authHeaders(extraHeaders) {
    const headers = Object.assign({}, extraHeaders || {});
    const token = getToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;
    return headers;
}

function getAuthUser() {
    return {
        id: localStorage.getItem('userId'),
        username: localStorage.getItem('userName')
    };
}

function setSession(token, user) {
    localStorage.setItem('token', token);
    if (user) {
        localStorage.setItem('userId', user.id);
        localStorage.setItem('userName', user.username);
    }
}

function clearSession() {
    localStorage.removeItem('token');
    localStorage.removeItem('userId');
    localStorage.removeItem('userName');
}

// Decodifica el payload de un JWT sin librerías (solo para leer exp, no hay firma verificada aquí)
function decodeJwtPayload(token) {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return {};
        let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        while (base64.length % 4 !== 0) base64 += '=';
        const json = decodeURIComponent(Array.prototype.map.call(
            atob(base64),
            (c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
        ).join(''));
        return JSON.parse(json);
    } catch (e) {
        return {};
    }
}

// Renueva el token silenciosamente si está por expirar (< 1 h restante).
// El servidor extiende la sesión sin pedir credenciales de nuevo.
async function refreshTokenIfNeeded() {
    const token = getToken();
    if (!token) return;
    const payload = decodeJwtPayload(token);
    const expMs = (payload.exp || 0) * 1000;
    if (expMs - Date.now() > 60 * 60 * 1000) return;

    try {
        const response = await fetch('/api/auth/refresh', {
            method: 'POST',
            headers: authHeaders()
        });
        const data = await response.json();
        if (response.ok && data.token) {
            localStorage.setItem('token', data.token);
        } else if (response.status === 401) {
            // Token revocado o sesión cerrada en otro lado
            clearSession();
            mostrarSesionExpirada();
        }
    } catch (e) {
        // Sin red: se deja el token viejo; volverá a intentar en el próximo tick
    }
}

// Programa el refresco cada 5 minutos (el token se renueva solo si hace falta)
function scheduleTokenRefresh() {
    refreshTokenIfNeeded();
    setInterval(refreshTokenIfNeeded, 5 * 60 * 1000);
}

// Cierra sesión en el servidor (revoca TODAS las sesiones del usuario) y limpia localmente
async function serverLogout() {
    try {
        await fetch('/api/auth/logout', { method: 'POST', headers: authHeaders() });
    } catch (e) {
        // Aunque el servidor no responda, se limpia la sesión local
    }
    clearSession();
}

function mostrarSesionExpirada() {
    if (window.showCustomAlert) {
        showCustomAlert('Tu sesión expiró o fue revocada. Inicia sesión de nuevo.', 'warning');
    }
    window.location.href = 'inicio-sesion.html';
}

// Para páginas protegidas: reenvía a login si no hay token
function requireAuth(redirectTo) {
    const token = getToken();
    if (!token) {
        window.location.href = redirectTo || 'inicio-sesion.html';
        return null;
    }
    scheduleTokenRefresh();
    return token;
}