const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// 🚨 CORREÇÃO CRÍTICA: CORS configurado ANTES de tudo
app.use(cors({
    origin: true, // 🚨 Permite TODOS os origins durante o desenvolvimento
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie']
}));

// Middleware
app.use(express.json());
app.use(cookieParser());
app.use(express.static('public'));

// Headers de segurança
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

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
            const saved = JSON.parse(data);
            return {
                lights: saved.lights || {
                    sala: false, quarto1: false, quarto2: false, quarto3: false,
                    corredor: false, cozinha: false, banheiro: false
                },
                outlets: saved.outlets || {
                    tomada_sala: false, tomada_cozinha: false, tomada_quarto1: false,
                    tomada_quarto2: false, tomada_quarto3: false
                },
                irrigation: saved.irrigation || {
                    bomba_irrigacao: false, modo: 'manual', programacoes: [], evitar_chuva: true
                },
                sensorData: saved.sensorData || []
            };
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
        console.log('💾 Estado salvo');
    } catch (error) {
        console.error('❌ Erro ao salvar estado:', error);
    }
}

// Atualizar status do ESP32
function updateESP32Status(device, ip) {
    esp32Status = {
        connected: true,
        lastSeen: new Date(),
        lastHeartbeat: new Date(),
        deviceId: device || 'ESP32-AUTOMACAO-V3',
        ipAddress: ip || 'Desconhecido'
    };
    console.log(`📡 ESP32 conectado: ${device} | IP: ${ip}`);
}

// Verificar se ESP32 está conectado
function checkESP32Connection() {
    if (esp32Status.lastHeartbeat) {
        const timeSinceLastHeartbeat = new Date() - esp32Status.lastHeartbeat;
        if (timeSinceLastHeartbeat > 120000) {
            esp32Status.connected = false;
            console.log('⚠️ ESP32 desconectado');
        }
    }
    return esp32Status.connected;
}

// Inicializar dados
let devicesState = loadState();
setInterval(checkESP32Connection, 60000);

// Função para buscar dados do clima
async function fetchWeatherData() {
    try {
        const API_KEY = process.env.OPENWEATHER_API_KEY;
        if (!API_KEY) throw new Error('API key não configurada');

        const lat = -22.9068;
        const lon = -43.1729;
        const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${API_KEY}&units=metric&lang=pt_br`;
        
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Erro API: ${response.status}`);
        
        return await response.json();
    } catch (error) {
        console.error('❌ Erro ao buscar clima:', error);
        return null;
    }
}

// Verificar se está chovendo
async function isRaining() {
    try {
        const weatherData = await fetchWeatherData();
        if (weatherData && weatherData.weather && weatherData.weather.length > 0) {
            const condition = weatherData.weather[0].main.toLowerCase();
            return condition.includes('rain') || condition.includes('drizzle') || condition.includes('storm');
        }
        return false;
    } catch (error) {
        console.error('❌ Erro ao verificar chuva:', error);
        return false;
    }
}

// 🚨 CORREÇÃO CRÍTICA: Middleware de autenticação SIMPLIFICADO
function requireAuth(req, res, next) {
    console.log(`\n🔐 [AUTH] ${req.method} ${req.path}`);
    console.log(`🍪 [COOKIE]`, req.cookies);
    
    // 🚨 ROTAS PÚBLICAS - SEMPRE ACESSÍVEIS
    const publicRoutes = [
        '/', 
        '/login.html',
        '/api/login', 
        '/api/logout',
        '/api/status',
        '/health',
        '/favicon.ico'
    ];

    // 🚨 ROTAS DO ESP32 - SEMPRE ACESSÍVEIS
    const esp32Routes = [
        '/api/data',
        '/api/devices'
    ];

    // Verifica se é rota pública
    if (publicRoutes.includes(req.path)) {
        console.log(`✅ [PUBLIC] Rota pública liberada`);
        return next();
    }

    // Verifica se é rota do ESP32
    if (esp32Routes.includes(req.path) && 
        ((req.path === '/api/data' && req.method === 'POST') || 
         (req.path === '/api/devices' && req.method === 'GET'))) {
        console.log(`✅ [ESP32] Rota ESP32 liberada`);
        return next();
    }

    // 🚨 VERIFICA AUTENTICAÇÃO
    const authToken = req.cookies?.authToken;
    console.log(`🔑 [TOKEN] ${authToken ? 'PRESENTE' : 'AUSENTE'}`);

    if (authToken === 'admin123') {
        console.log(`✅ [AUTH] Usuário autenticado`);
        return next();
    }

    console.log(`❌ [AUTH] ACESSO NEGADO - Redirecionando para login`);
    
    if (req.path.startsWith('/api/')) {
        return res.status(401).json({ error: 'Não autorizado - Faça login' });
    } else {
        return res.redirect('/');
    }
}

// Aplica o middleware
app.use(requireAuth);

// 🚨 Rota principal SEMPRE serve login
app.get('/', (req, res) => {
    console.log('📄 [ROUTE] Servindo página de LOGIN');
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// 🚨 Rota do sistema - só acessível se autenticado
app.get('/sistema', (req, res) => {
    console.log('📄 [ROUTE] Servindo página do SISTEMA');
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/index.html', (req, res) => {
    console.log('📄 [ROUTE] Servindo página do SISTEMA (index.html)');
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 🚨 CORREÇÃO CRÍTICA: Login com cookie SIMPLES
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    console.log('🔐 [LOGIN] Tentativa:', username);
    
    if (username === 'admin' && password === 'admin123') {
        // 🚨 CORREÇÃO: Cookie SIMPLES sem opções complexas
        res.cookie('authToken', 'admin123', {
            maxAge: 24 * 60 * 60 * 1000, // 24 horas
            httpOnly: false, // 🚨 IMPORTANTE: false para desenvolvimento
            secure: false,   // 🚨 IMPORTANTE: false para desenvolvimento  
            sameSite: 'lax',
            path: '/'
        });
        
        console.log('✅ [LOGIN] Bem-sucedido - Cookie configurado');
        
        res.json({ 
            success: true, 
            message: 'Login realizado',
            redirect: '/sistema'
        });
    } else {
        console.log('❌ [LOGIN] Falhou');
        res.status(401).json({ 
            success: false, 
            message: 'Usuário ou senha incorretos' 
        });
    }
});

// Logout
app.post('/api/logout', (req, res) => {
    console.log('🚪 [LOGOUT] Solicitado');
    res.clearCookie('authToken');
    res.json({ 
        success: true, 
        message: 'Logout realizado',
        redirect: '/'
    });
});

// Status do servidor
app.get('/api/status', (req, res) => {
    const espConnected = checkESP32Connection();
    res.json({ 
        message: '🚀 Servidor Automação V3.0',
        status: 'online',
        esp32: { connected: espConnected },
        systemStatus: espConnected ? '✅ Sistema normal' : '⚠️ ESP32 offline'
    });
});

// Status ESP32
app.get('/api/esp32-status', (req, res) => {
    res.json({
        connected: esp32Status.connected,
        lastSeen: esp32Status.lastSeen,
        deviceId: esp32Status.deviceId,
        ipAddress: esp32Status.ipAddress
    });
});

// Clima
app.get('/api/weather', async (req, res) => {
    try {
        const weatherData = await fetchWeatherData();
        if (weatherData) {
            res.json(weatherData);
        } else {
            res.status(500).json({ error: 'Erro ao buscar clima' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Verificar chuva
app.get('/api/weather/raining', async (req, res) => {
    try {
        const raining = await isRaining();
        res.json({ raining });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ESP32 envia dados
app.post('/api/data', (req, res) => {
    const { temperature, gas_level, gas_alert, device, heartbeat, wifi_rssi } = req.body;

    if (typeof temperature === 'undefined' || typeof gas_level === 'undefined') {
        return res.status(400).json({ error: 'Dados inválidos' });
    }

    const newData = {
        temperature, gas_level, gas_alert: gas_alert || false,
        device: device || 'ESP32', heartbeat: heartbeat || false,
        wifi_rssi: wifi_rssi || 0, timestamp: new Date().toLocaleString('pt-BR'),
        receivedAt: new Date()
    };

    if (!devicesState.sensorData) devicesState.sensorData = [];
    devicesState.sensorData.unshift(newData);
    if (devicesState.sensorData.length > 100) {
        devicesState.sensorData = devicesState.sensorData.slice(0, 100);
    }

    saveState(devicesState);
    const clientIP = req.ip || req.connection.remoteAddress;
    updateESP32Status(device, clientIP);

    console.log(heartbeat ? '💓 Heartbeat' : '📨 Dados recebidos');
    
    res.json({ 
        status: 'OK', 
        message: heartbeat ? 'Heartbeat recebido!' : 'Dados salvos!',
        devices: devicesState
    });
});

// ESP32 busca dispositivos
app.get('/api/devices', (req, res) => {
    const clientIP = req.ip || req.connection.remoteAddress;
    updateESP32Status('ESP32-AUTOMACAO-V3', clientIP);
    res.json(devicesState);
});

// Controlar dispositivos
app.post('/api/control', async (req, res) => {
    const { type, device, state } = req.body;
    
    if (!type || !device || typeof state === 'undefined') {
        return res.status(400).json({ error: 'Dados incompletos' });
    }
    
    if (!['lights', 'outlets', 'irrigation'].includes(type)) {
        return res.status(400).json({ error: 'Tipo inválido' });
    }
    
    if (!devicesState[type] || !devicesState[type].hasOwnProperty(device)) {
        return res.status(400).json({ error: 'Dispositivo não encontrado' });
    }
    
    if (type === 'irrigation' && device === 'bomba_irrigacao' && state === true) {
        if (devicesState.irrigation.modo === 'automatico' && devicesState.irrigation.evitar_chuva) {
            const raining = await isRaining();
            if (raining) {
                return res.status(400).json({ 
                    error: 'Irrigação bloqueada - Está chovendo'
                });
            }
        }
    }
    
    const espConnected = checkESP32Connection();
    if (!espConnected && type !== 'irrigation') {
        return res.status(503).json({ 
            error: 'ESP32 desconectado'
        });
    }
    
    devicesState[type][device] = state;
    saveState(devicesState);
    
    console.log(`🎛️ ${type} ${device}: ${state ? 'LIGADO' : 'DESLIGADO'}`);
    res.json({ 
        status: 'OK', 
        message: `Comando enviado - ${device} ${state ? 'ligado' : 'desligado'}`
    });
});

// Dados dos sensores
app.get('/api/data', (req, res) => {
    const espConnected = checkESP32Connection();
    res.json({ 
        data: devicesState.sensorData || [],
        esp32: { connected: espConnected },
        summary: {
            total_readings: devicesState.sensorData?.length || 0,
            last_temperature: devicesState.sensorData?.[0]?.temperature || 'N/A',
            last_gas_level: devicesState.sensorData?.[0]?.gas_level || 'N/A'
        }
    });
});

// Reset dispositivos
app.post('/api/reset', (req, res) => {
    const espConnected = checkESP32Connection();
    if (!espConnected) {
        return res.status(503).json({ error: 'ESP32 desconectado' });
    }
    
    Object.keys(devicesState.lights).forEach(key => devicesState.lights[key] = false);
    Object.keys(devicesState.outlets).forEach(key => devicesState.outlets[key] = false);
    devicesState.irrigation.bomba_irrigacao = false;
    
    saveState(devicesState);
    console.log('🔄 Todos os dispositivos resetados');
    res.json({ status: 'OK', message: 'Todos os dispositivos desligados' });
});

// Irrigação
app.get('/api/irrigation', (req, res) => {
    res.json(devicesState.irrigation);
});

app.post('/api/irrigation/save', (req, res) => {
    const { modo, programacoes, evitar_chuva } = req.body;
    devicesState.irrigation.modo = modo;
    devicesState.irrigation.programacoes = programacoes || [];
    devicesState.irrigation.evitar_chuva = evitar_chuva !== false;
    saveState(devicesState);
    console.log('💧 Configurações salvas');
    res.json({ status: 'OK', message: 'Configurações salvas' });
});

app.post('/api/irrigation/control', async (req, res) => {
    const { state } = req.body;
    
    if (state === true && devicesState.irrigation.evitar_chuva) {
        const raining = await isRaining();
        if (raining) {
            return res.status(400).json({ error: 'Irrigação bloqueada - Está chovendo' });
        }
    }
    
    devicesState.irrigation.bomba_irrigacao = state;
    saveState(devicesState);
    console.log(`💧 Bomba: ${state ? 'LIGADA' : 'DESLIGADA'}`);
    res.json({ status: 'OK', message: `Bomba ${state ? 'ligada' : 'desligada'}` });
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        esp32: { connected: esp32Status.connected }
    });
});

// 404 handler
app.use((req, res) => {
    console.log('❌ Rota não encontrada:', req.path);
    res.status(404).json({ error: 'Rota não encontrada' });
});

app.listen(PORT, () => {
    console.log(`\n🔥 Servidor Automação V3.0 rodando na porta ${PORT}`);
    console.log(`🌐 Acesse: http://localhost:${PORT}`);
    console.log(`🔧 Modo: ${process.env.NODE_ENV || 'development'}`);
    console.log('📡 Monitoramento ESP32: ATIVADO');
    console.log('💧 Sistema de Irrigação: ATIVADO');
    console.log('🔐 Sistema de Login: ATIVADO\n');
});