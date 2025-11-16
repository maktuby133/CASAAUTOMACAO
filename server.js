const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const cookieParser = require('cookie-parser');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ CORS configurado corretamente
app.use(cors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Middleware
app.use(express.json());
app.use(cookieParser());

// Servir arquivos estáticos
app.use(express.static('public'));

// Arquivo para persistência
const STATE_FILE = 'devices-state.json';

// ✅ DADOS INICIAIS GARANTIDOS
function loadState() {
    try {
        if (fs.existsSync(STATE_FILE)) {
            const data = fs.readFileSync(STATE_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.log('❌ Erro ao carregar estado, usando padrão:', error.message);
    }
    
    // ✅ DADOS PADRÃO COMPLETOS
    return {
        lights: {
            sala: false, 
            quarto1: false, 
            quarto2: false, 
            quarto3: false,
            corredor: false, 
            cozinha: false, 
            banheiro: false
        },
        outlets: {
            tomada_sala: false, 
            tomada_cozinha: false, 
            tomada_quarto1: false,
            tomada_quarto2: false, 
            tomada_quarto3: false
        },
        irrigation: {
            bomba_irrigacao: false, 
            modo: 'manual', 
            programacoes: [], 
            evitar_chuva: true,
            duracao: 5
        },
        sensorData: []
    };
}

function saveState(state) {
    try {
        fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
        console.log('💾 Estado salvo');
    } catch (error) {
        console.error('❌ Erro ao salvar estado:', error);
    }
}

let devicesState = loadState();

// ✅ MIDDLEWARE DE AUTENTICAÇÃO SIMPLIFICADO
const requireAuth = (req, res, next) => {
    const publicRoutes = [
        '/', 
        '/login.html',
        '/index.html',
        '/api/login', 
        '/api/logout',
        '/api/status',
        '/api/weather',
        '/api/weather/raining',
        '/api/sensor-data',
        '/api/data',
        '/api/commands',
        '/api/confirm',
        '/health',
        '/favicon.ico',
        '/styles.css',
        '/script.js'
    ];

    if (publicRoutes.includes(req.path)) {
        return next();
    }

    if (req.path.startsWith('/api/')) {
        const authToken = req.cookies?.authToken;
        
        if (authToken === 'admin123') {
            return next();
        } else {
            console.log('🔐 Acesso negado para:', req.path);
            return res.status(401).json({ 
                error: 'Não autorizado',
                redirect: '/login.html'
            });
        }
    }

    next();
};

app.use(requireAuth);

// ==================== ROTAS ====================

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/index.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ✅ LOGIN FUNCIONAL
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    console.log('🔐 Tentativa de login:', username);
    
    if (username === 'admin' && password === 'admin123') {
        res.cookie('authToken', 'admin123', {
            maxAge: 24 * 60 * 60 * 1000,
            httpOnly: false,
            secure: false,
            sameSite: 'lax',
            path: '/',
        });
        
        console.log('✅ Login realizado');
        
        res.json({ 
            success: true, 
            message: 'Login realizado',
            redirect: '/index.html'
        });
    } else {
        console.log('❌ Login falhou');
        res.status(401).json({ 
            success: false, 
            message: 'Usuário ou senha incorretos' 
        });
    }
});

// ✅ LOGOUT
app.post('/api/logout', (req, res) => {
    res.clearCookie('authToken', { path: '/' });
    res.json({ 
        success: true, 
        message: 'Logout realizado',
        redirect: '/'
    });
});

// ✅ STATUS
app.get('/api/status', (req, res) => {
    res.json({ 
        message: '🚀 Servidor Automação V3.0',
        status: 'online',
        authenticated: true,
        esp32: { connected: false }
    });
});

// ✅ DISPOSITIVOS - GARANTINDO RESPOSTA CORRETA
app.get('/api/devices', (req, res) => {
    console.log('📡 Enviando dados dos dispositivos:', devicesState);
    
    res.json({
        lights: devicesState.lights,
        outlets: devicesState.outlets,
        irrigation: devicesState.irrigation
    });
});

// ✅ CONTROLE DE DISPOSITIVOS
app.post('/api/control', (req, res) => {
    const { type, device, state } = req.body;
    
    console.log('🎛️ Comando recebido:', { type, device, state });
    
    if (!type || !device || typeof state === 'undefined') {
        return res.status(400).json({ error: 'Dados incompletos' });
    }
    
    if (!devicesState[type]) {
        return res.status(400).json({ error: 'Tipo inválido' });
    }
    
    if (!devicesState[type].hasOwnProperty(device)) {
        return res.status(400).json({ error: 'Dispositivo não encontrado' });
    }
    
    // ✅ ATUALIZA O ESTADO
    devicesState[type][device] = state;
    saveState(devicesState);
    
    console.log(`✅ ${type} ${device}: ${state ? 'LIGADO' : 'DESLIGADO'}`);
    
    res.json({ 
        status: 'OK', 
        message: `${device} ${state ? 'ligado' : 'desligado'}`
    });
});

// ✅ IRRIGAÇÃO
app.post('/api/irrigation/control', (req, res) => {
    const { state } = req.body;
    
    devicesState.irrigation.bomba_irrigacao = state;
    saveState(devicesState);
    
    console.log(`💧 Bomba: ${state ? 'LIGADA' : 'DESLIGADA'}`);
    
    res.json({ 
        status: 'OK', 
        message: `Bomba ${state ? 'ligada' : 'desligada'}`
    });
});

// ✅ SALVAR CONFIGURAÇÕES DE IRRIGAÇÃO
app.post('/api/irrigation/save', (req, res) => {
    try {
        const { modo, programacoes, evitar_chuva, duracao } = req.body;
        
        console.log('💧 Salvando configurações:', { modo, programacoes, evitar_chuva, duracao });
        
        devicesState.irrigation.modo = modo || 'manual';
        devicesState.irrigation.programacoes = programacoes || [];
        devicesState.irrigation.evitar_chuva = evitar_chuva !== false;
        devicesState.irrigation.duracao = duracao || 5;
        
        saveState(devicesState);
        
        res.json({ 
            status: 'OK', 
            message: 'Configurações salvas',
            savedData: devicesState.irrigation
        });
    } catch (error) {
        console.error('❌ Erro ao salvar:', error);
        res.status(500).json({ error: 'Erro interno' });
    }
});

// ✅ DADOS DOS SENSORES
app.get('/api/sensor-data', (req, res) => {
    res.json({ 
        data: devicesState.sensorData || [],
        esp32: { connected: false },
        summary: {
            total_readings: 0,
            last_temperature: 'N/A',
            last_humidity: 'N/A',
            last_gas_level: 'N/A'
        }
    });
});

// ✅ CLIMA
app.get('/api/weather', async (req, res) => {
    try {
        // Dados simulados para teste
        res.json({
            main: {
                temp: 25,
                feels_like: 26,
                humidity: 65,
                pressure: 1013
            },
            weather: [{ description: 'céu limpo' }],
            wind: { speed: 3.5 },
            name: 'Rio de Janeiro'
        });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao buscar clima' });
    }
});

app.get('/api/weather/raining', (req, res) => {
    res.json({ raining: false });
});

// ✅ HEALTH CHECK
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString()
    });
});

// ✅ ROTA PARA TESTAR DADOS
app.get('/api/debug/devices', (req, res) => {
    res.json({
        message: 'Dados de debug',
        devicesState: devicesState,
        hasLights: !!devicesState.lights,
        hasOutlets: !!devicesState.outlets,
        lightsCount: Object.keys(devicesState.lights).length,
        outletsCount: Object.keys(devicesState.outlets).length
    });
});

app.listen(PORT, () => {
    console.log(`\n🔥 Servidor rodando na porta ${PORT}`);
    console.log(`🌐 Acesse: http://localhost:${PORT}`);
    console.log('💡 Dispositivos disponíveis:');
    console.log('   - Lâmpadas:', Object.keys(devicesState.lights).join(', '));
    console.log('   - Tomadas:', Object.keys(devicesState.outlets).join(', '));
    console.log('🔐 Login: admin / admin123\n');
});
