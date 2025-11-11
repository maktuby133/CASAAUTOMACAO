const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// 🚨 CORS MÁXIMO - PERMITE TUDO
app.use(cors({
    origin: true, // PERMITE QUALQUER ORIGIN
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie', '*']
}));

app.use(express.json());
app.use(cookieParser());
app.use(express.static('public'));

// Arquivo para persistência
const STATE_FILE = 'devices-state.json';

// Monitoramento de conexão ESP32
let esp32Status = {
    connected: false,
    lastSeen: null,
    deviceId: null,
    ipAddress: null,
    lastHeartbeat: null
};

// Carregar estado salvo
function loadState() {
    try {
        if (fs.existsSync(STATE_FILE)) {
            const data = fs.readFileSync(STATE_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.log('❌ Erro ao carregar estado:', error.message);
    }
    
    return {
        lights: {
            sala: false, quarto1: false, quarto2: false, quarto3: false,
            corredor: false, cozinha: false, banheiro: false
        },
        outlets: {
            tomada_sala: false, tomada_cozinha: false, tomada_quarto1: false,
            tomada_quarto2: false, tomada_quarto3: false
        },
        irrigation: {
            bomba_irrigacao: false, modo: 'manual', programacoes: [], evitar_chuva: true
        },
        sensorData: []
    };
}

// Salvar estado
function saveState(state) {
    try {
        fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    } catch (error) {
        console.error('❌ Erro ao salvar estado:', error);
    }
}

let devicesState = loadState();

// 🚨 MIDDLEWARE DE AUTENTICAÇÃO SIMPLIFICADO AO MÁXIMO
function checkAuth(req, res, next) {
    console.log(`📍 ${req.method} ${req.path} | Cookie:`, req.cookies.authToken ? 'SIM' : 'NÃO');
    
    // Rotas públicas
    if (['/', '/login.html', '/api/login', '/api/logout', '/api/status', '/health'].includes(req.path)) {
        return next();
    }
    
    // Rotas ESP32
    if (['/api/data', '/api/devices'].includes(req.path)) {
        return next();
    }
    
    // 🚨 VERIFICA SE ESTÁ AUTENTICADO
    if (req.cookies.authToken === 'admin123') {
        console.log('✅ AUTENTICADO');
        return next();
    }
    
    console.log('❌ NÃO AUTENTICADO - REDIRECIONANDO PARA LOGIN');
    return res.redirect('/');
}

app.use(checkAuth);

// 🚨 ROTA PRINCIPAL - SEMPRE LOGIN
app.get('/', (req, res) => {
    console.log('📄 SERVINDO LOGIN');
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// 🚨 ROTA DO SISTEMA - SÓ SE AUTENTICADO
app.get('/sistema', (req, res) => {
    console.log('📄 SERVINDO SISTEMA');
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/index.html', (req, res) => {
    console.log('📄 SERVINDO INDEX');
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 🚨 LOGIN - COOKIE MÁXIMO SIMPLES
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    console.log('🔐 LOGIN:', username);
    
    if (username === 'admin' && password === 'admin123') {
        // 🚨 COOKIE SUPER SIMPLES - SEM OPÇÕES COMPLEXAS
        res.cookie('authToken', 'admin123');
        
        console.log('✅ LOGIN BEM-SUCEDIDO');
        
        res.json({ 
            success: true, 
            message: 'Login realizado',
            redirect: '/sistema'
        });
    } else {
        console.log('❌ LOGIN FALHOU');
        res.status(401).json({ 
            success: false, 
            message: 'Usuário ou senha incorretos' 
        });
    }
});

// LOGOUT
app.post('/api/logout', (req, res) => {
    console.log('🚪 LOGOUT');
    res.clearCookie('authToken');
    res.json({ 
        success: true, 
        message: 'Logout realizado',
        redirect: '/'
    });
});

// STATUS
app.get('/api/status', (req, res) => {
    res.json({ 
        status: 'online',
        message: 'Servidor funcionando'
    });
});

// 🚨 ADICIONE ESTAS ROTAS BÁSICAS PARA TESTE
app.get('/api/test-auth', (req, res) => {
    res.json({ 
        authenticated: req.cookies.authToken === 'admin123',
        cookie: req.cookies.authToken 
    });
});

app.get('/api/test-cookie', (req, res) => {
    res.cookie('testCookie', 'funcionando');
    res.json({ message: 'Cookie setado' });
});

app.listen(PORT, () => {
    console.log(`\n🚀 SERVIDOR RODANDO: http://localhost:${PORT}`);
    console.log('🔐 SISTEMA DE LOGIN: ATIVADO\n');
});