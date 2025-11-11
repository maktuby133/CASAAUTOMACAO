const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware - CORS PRIMEIRO
app.use(cors({
    origin: ['http://localhost:3000', 'http://192.168.1.100:3000', 'https://casaautomacao.onrender.com'],
    credentials: true
}));
app.use(express.json());
app.use(cookieParser());
app.use(express.static('public'));

// ... (mantenha as outras funções loadState, saveState, etc. iguais)

// MIDDLEWARE DE AUTENTICAÇÃO SIMPLIFICADO
function requireAuth(req, res, next) {
    // Lista de rotas que NÃO precisam de autenticação
    const publicRoutes = [
        '/',
        '/login.html', 
        '/api/login',
        '/api/logout', 
        '/api/status',
        '/api/weather',
        '/api/weather/raining',
        '/health',
        '/favicon.ico'
    ];

    // Verifica se a rota atual é pública
    const isPublic = publicRoutes.includes(req.path);
    
    if (isPublic) {
        return next(); // Libera o acesso
    }

    // Verifica autenticação apenas para rotas protegidas
    const authToken = req.cookies?.authToken;
    
    if (authToken === 'admin123') {
        return next(); // Usuário autenticado
    }

    // Usuário não autenticado tentando acessar rota protegida
    console.log('❌ Acesso não autorizado:', req.path);
    
    if (req.path.startsWith('/api/')) {
        return res.status(401).json({ error: 'Não autorizado' });
    } else {
        return res.redirect('/');
    }
}

// APLICA o middleware de autenticação
app.use(requireAuth);

// ROTA PRINCIPAL - SEMPRE mostra login ou redireciona
app.get('/', (req, res) => {
    const authToken = req.cookies?.authToken;
    
    // Se JÁ ESTÁ LOGADO, vai para o sistema
    if (authToken === 'admin123') {
        return res.redirect('/sistema');
    }
    
    // Se NÃO ESTÁ LOGADO, mostra a página de login
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// ROTA DO SISTEMA - só é acessível via redirecionamento do login
app.get('/sistema', (req, res) => {
    // Esta rota já é protegida pelo middleware requireAuth
    // Se chegou aqui, é porque está autenticado
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// LOGIN - CORRIGIDO
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    console.log('🔐 Tentativa de login:', username);
    
    if (username === 'admin' && password === 'admin123') {
        // Configura cookie de autenticação
        res.cookie('authToken', 'admin123', { 
            maxAge: 24 * 60 * 60 * 1000,
            httpOnly: true,
            secure: false, // Mude para true em produção com HTTPS
            sameSite: 'lax'
        });
        
        console.log('✅ Login bem-sucedido');
        
        return res.json({ 
            success: true, 
            message: 'Login realizado com sucesso',
            redirect: '/sistema'
        });
    } else {
        console.log('❌ Login falhou');
        return res.status(401).json({ 
            success: false, 
            message: 'Usuário ou senha incorretos' 
        });
    }
});

// LOGOUT - CORRIGIDO
app.post('/api/logout', (req, res) => {
    console.log('🚪 Logout solicitado');
    
    // Limpa o cookie
    res.clearCookie('authToken');
    
    res.json({ 
        success: true, 
        message: 'Logout realizado com sucesso',
        redirect: '/'
    });
});

// ... (mantenha todas as outras rotas API iguais)

app.listen(PORT, () => {
    console.log(`🔥 Servidor Automação V3.0 rodando na porta ${PORT}`);
    console.log(`🌐 Acesse: http://localhost:${PORT}`);
    console.log('🔐 Sistema de Login: ATIVADO');
});
