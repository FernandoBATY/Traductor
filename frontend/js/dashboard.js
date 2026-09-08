function navigateTo(page) {
    const userId = localStorage.getItem('userId'); // Obtener el ID del usuario
    if (!userId) {
        showCustomAlert('ID de usuario no encontrado. Por favor, inicie sesión de nuevo.', 'warning');
        setTimeout(() => {
            window.location.href = 'index.html';
        }, 1500);
        return;
    }
    window.location.href = `${page}?userId=${userId}`;
}

function logout() {
    // Lógica para cerrar sesión, puede incluir limpieza de tokens, cookies, etc.
    showCustomAlert('Sesión cerrada. ¡Hasta pronto!', 'success');
    setTimeout(() => {
        window.location.href = 'index.html';
    }, 1500);
}
