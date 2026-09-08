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