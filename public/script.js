// public/script.js - Cliente corrigido para evitar loops

document.addEventListener('DOMContentLoaded', function() {
    // Verificar se estamos na página de login
    if (window.location.pathname === '/' || window.location.pathname === '/login.html') {
        handleLoginPage();
    } else {
        handleSystemPage();
    }
});

function handleLoginPage() {
    const loginForm = document.getElementById('loginForm');
    const errorMessage = document.getElementById('errorMessage');
    
    if (loginForm) {
        loginForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;
            
            try {
                const response = await fetch('/api/login', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ username, password })
                });
                
                const data = await response.json();
                
                if (data.success) {
                    // Login bem-sucedido - redirecionar para o sistema
                    console.log('✅ Login bem-sucedido, redirecionando...');
                    window.location.href = data.redirect;
                } else {
                    // Mostrar erro
                    if (errorMessage) {
                        errorMessage.textContent = data.message;
                        errorMessage.style.display = 'block';
                    }
                }
            } catch (error) {
                console.error('❌ Erro no login:', error);
                if (errorMessage) {
                    errorMessage.textContent = 'Erro de conexão com o servidor';
                    errorMessage.style.display = 'block';
                }
            }
        });
    }
    
    // Verificar se já está logado (opcional - pode remover se causar problemas)
    checkAuthStatus();
}

function handleSystemPage() {
    // Lógica do sistema principal aqui
    console.log('🔧 Página do sistema carregada');
    
    // Verificar autenticação periodicamente
    setInterval(checkAuthStatus, 30000);
}

async function checkAuthStatus() {
    try {
        const response = await fetch('/api/status');
        if (!response.ok) {
            // Se não autorizado, redirecionar para login
            if (response.status === 401) {
                window.location.href = '/';
            }
        }
    } catch (error) {
        console.error('❌ Erro ao verificar status:', error);
        // Em caso de erro, manter na página atual
    }
}

// Logout function
async function logout() {
    try {
        const response = await fetch('/api/logout', {
            method: 'POST'
        });
        
        const data = await response.json();
        
        if (data.success) {
            window.location.href = data.redirect;
        }
    } catch (error) {
        console.error('❌ Erro no logout:', error);
        window.location.href = '/';
    }
}