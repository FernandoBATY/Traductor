const signUpButton = document.getElementById('signUp');
const signInButton = document.getElementById('signIn');
const container = document.getElementById('container');

signUpButton.addEventListener('click', () => {
    container.classList.add("right-panel-active");
});

signInButton.addEventListener('click', () => {
    container.classList.remove("right-panel-active");
});

async function register() {
    const username = document.getElementById('username').value;
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;

    // Validaciones básicas
    if (!username || !email || !password) {
        showCustomAlert('Por favor, complete todos los campos.', 'warning');
        return;
    }

    if (!validateEmail(email)) {
        showCustomAlert('Por favor, ingrese un correo electrónico válido.', 'warning');
        return;
    }

    if (!validatePassword(password)) {
        showCustomAlert('La contraseña debe tener al menos 6 caracteres e incluir números y letras.', 'warning');
        return;
    }

    try {
        const response = await fetch('/api/auth/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, email, password })
        });

        const data = await response.json();
        if (response.status === 200) {
            showCustomAlert('Usuario registrado con éxito', 'success');
            // Redirigir a la página de inicio de sesión
            setTimeout(() => {
                container.classList.remove("right-panel-active");
            }, 1500);
        } else {
            showCustomAlert(data.msg, 'error');
        }
    } catch (error) {
        console.error('Error:', error);
        showCustomAlert('Error registrando el usuario. Por favor, intente de nuevo.', 'error');
    }
}

async function login() {
    const email = document.getElementById('emailLogin').value;
    const password = document.getElementById('passwordLogin').value;

    if (!email || !password) {
        showCustomAlert('Por favor, complete todos los campos.', 'warning');
        return;
    }

    try {
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email, password })
        });

        if (!response.ok) {
            const errorData = await response.json();
            showCustomAlert(errorData.msg || 'Error al iniciar sesión', 'error');
            return;
        }

        const data = await response.json();
        if (data.token) {
            showCustomAlert('Inicio de sesión exitoso', 'success');
            localStorage.setItem('userId', data.user.id);
            localStorage.setItem('userName', data.user.username);
            setTimeout(() => {
                window.location.href = 'index.html';
            }, 1500);
        }
    } catch (error) {
        console.error('Error:', error);
        showCustomAlert('Error al iniciar sesión. Por favor, intente de nuevo.', 'error');
    }
}

// Validación de correo electrónico
function validateEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(String(email).toLowerCase());
}

// Validación de contraseña
function validatePassword(password) {
    const re = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{6,}$/; // Al menos 6 caracteres, una letra y un número
    return re.test(password);
}

// Función para visualizar la contraseña
function togglePasswordVisibility(fieldId) {
    const passwordField = document.getElementById(fieldId);
    if (passwordField.type === "password") {
        passwordField.type = "text";
    } else {
        passwordField.type = "password";
    }
}

// Evento para toggle password en los campos de contraseña
document.querySelectorAll('.toggle-password').forEach(button => {
    button.addEventListener('click', (e) => {
        const targetId = e.target.getAttribute('data-target');
        togglePasswordVisibility(targetId);
    });
});
