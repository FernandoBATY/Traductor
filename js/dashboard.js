function navigateTo(page) {
    const userId = localStorage.getItem('userId'); // Obtener el ID del usuario
    if (!userId) {
        alert('ID de usuario no encontrado. Por favor, inicie sesión de nuevo.');
        window.location.href = 'index.html';
        return;
    }
    window.location.href = `${page}?userId=${userId}`;
}

function logout() {
    // Lógica para cerrar sesión, puede incluir limpieza de tokens, cookies, etc.
    alert('Sesión cerrada. ¡Hasta pronto!');
    window.location.href = 'index.html';
}

function runPythonScript(script) {
    const userId = localStorage.getItem('userId'); // Obtener el ID del usuario
    if (!userId) {
        alert('ID de usuario no encontrado. Por favor, inicie sesión de nuevo.');
        return;
    }
    fetch(`http://localhost:5000/run-script?script=${script}&userId=${userId}`)
        .then(response => response.json())
        .then(data => alert(data.message))
        .catch(error => console.error('Error:', error));
}
