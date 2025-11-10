const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
    origin: ['http://localhost:3000', 'http://192.168.1.100:3000', 'https://casaautomacao.onrender.com'],
    credentials: true
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
        console.log('❌ Erro ao carregar estado, usando padrão');
    }
    
    // Estado padrão
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
            evitar_chuva: true
        }
    };
}

// Salvar estado
function saveState(state) {
    try {
        fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
        console.log('💾 Estado salvo com sucesso');
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
        if (timeSinceLastHeartbeat > 120000) { // 2 minutos sem heartbeat
            esp32Status.connected = false;
            console.log('⚠️ ESP32 considerado desconectado (sem heartbeat)');
        }
    }
    return esp32Status.connected;
}

// Inicializar dados
let sensorData = [];
let devicesState = loadState();

// Verificar conexão do ESP32 a cada minuto
setInterval(checkESP32Connection, 60000);

// Função para buscar dados do clima
async function fetchWeatherData() {
    try {
        const API_KEY = process.env.OPENWEATHER_API_KEY;
        if (!API_KEY) {
            throw new Error('API key não configurada');
        }

        const lat = -22.9068;
        const lon = -43.1729;
        const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${API_KEY}&units=metric&lang=pt_br`;
        
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Erro API: ${response.status}`);
        }
        
        return await response.json();
    } catch (error) {
        console.error('❌ Erro ao buscar clima:', error);
        return null;
    }
}

// Verificar se está chovendo baseado nos dados do clima
async function isRaining() {
    try {
        const weatherData = await fetchWeatherData();
        if (weatherData && weatherData.weather && weatherData.weather.length > 0) {
            const condition = weatherData.weather[0].main.toLowerCase();
            return condition.includes('rain') || condition.includes('drizzle') || condition.includes('storm');
        }
        return false;
    } catch (error) {
        console.error('❌ Erro ao verificar condição de chuva:', error);
        return false;
    }
}

// Middleware de autenticação CORRIGIDO
function requireAuth(req, res, next) {
    // Rotas públicas que não precisam de autenticação
    const publicRoutes = [
        '/', 
        '/login.html', 
        '/api/login', 
        '/api/logout',
        '/api/status',
        '/health',
        '/favicon.ico'
    ];
    
    // Verificar se é uma rota pública
    if (publicRoutes.some(route => req.path === route || req.path.startsWith('/public/'))) {
        return next();
    }
    
    // Verificar autenticação para todas as outras rotas
    const authToken = req.cookies?.authToken === 'admin123';
    
    if (authToken) {
        return next();
    } else {
        // Para API routes, retornar erro JSON
        if (req.path.startsWith('/api/')) {
            return res.status(401).json({ error: 'Não autorizado' });
        }
        // Para páginas, redirecionar para login
        return res.redirect('/');
    }
}

// Aplicar middleware de autenticação em TODAS as rotas
app.use(requireAuth);

// Rotas

// Página de login - SEMPRE acessível
app.get('/', (req, res) => {
    // Se já estiver autenticado, redirecionar para o sistema
    if (req.cookies?.authToken === 'admin123') {
        return res.redirect('/sistema');
    }
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Página do sistema - REQUER autenticação
app.get('/sistema', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Login
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    if (username === 'admin' && password === 'admin123') {
        // Configurar cookie de autenticação (expira em 24 horas)
        res.cookie('authToken', 'admin123', { 
            maxAge: 24 * 60 * 60 * 1000, // 24 horas
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax'
        });
        
        res.json({ 
            success: true, 
            token: 'admin123',
            message: 'Login realizado com sucesso'
        });
    } else {
        res.status(401).json({ 
            success: false, 
            message: 'Usuário ou senha incorretos' 
        });
    }
});

// Logout - CORRIGIDO
app.post('/api/logout', (req, res) => {
    // Limpar o cookie de autenticação
    res.clearCookie('authToken', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax'
    });
    
    res.json({ 
        success: true, 
        message: 'Logout realizado com sucesso' 
    });
});

// Status do servidor
app.get('/api/status', (req, res) => {
    const espConnected = checkESP32Connection();
    const statusMessage = espConnected ? 
        '✅ Sistema operando normalmente' : 
        '⚠️ ESP32 desconectado';
    
    res.json({ 
        message: '🚀 Servidor Automação Residencial V3.0',
        status: 'online',
        version: '3.0',
        time: new Date().toLocaleString('pt-BR'),
        esp32: {
            connected: espConnected,
            lastSeen: esp32Status.lastSeen,
            deviceId: esp32Status.deviceId,
            ipAddress: esp32Status.ipAddress
        },
        devices: {
            lights: Object.keys(devicesState.lights).length,
            outlets: Object.keys(devicesState.outlets).length,
            irrigation: 1
        },
        systemStatus: statusMessage
    });
});

// Status específico do ESP32
app.get('/api/esp32-status', (req, res) => {
    const espConnected = checkESP32Connection();
    
    res.json({
        connected: espConnected,
        lastSeen: esp32Status.lastSeen,
        deviceId: esp32Status.deviceId,
        ipAddress: esp32Status.ipAddress,
        status: espConnected ? 'online' : 'offline',
        uptime: espConnected ? Math.floor((new Date() - esp32Status.lastSeen) / 1000) + ' segundos' : 'N/A'
    });
});

// Dados do clima
app.get('/api/weather', async (req, res) => {
    try {
        const weatherData = await fetchWeatherData();
        if (weatherData) {
            res.json(weatherData);
        } else {
            res.status(500).json({ error: 'Erro ao buscar dados do clima' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Verificar condição de chuva
app.get('/api/weather/raining', async (req, res) => {
    try {
        const raining = await isRaining();
        res.json({ raining });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ESP32 envia dados dos sensores
app.post('/api/data', (req, res) => {
    const { temperature, gas_level, gas_alert, device, heartbeat, wifi_rssi } = req.body;

    // Validação básica
    if (typeof temperature === 'undefined' || typeof gas_level === 'undefined') {
        return res.status(400).json({ error: 'Dados inválidos' });
    }

    const newData = {
        temperature,
        gas_level,
        gas_alert: gas_alert || false,
        device: device || 'ESP32',
        heartbeat: heartbeat || false,
        wifi_rssi: wifi_rssi || 0,
        timestamp: new Date().toLocaleString('pt-BR'),
        receivedAt: new Date()
    };

    sensorData.unshift(newData);
    if (sensorData.length > 100) sensorData = sensorData.slice(0, 100);

    // Atualizar status do ESP32
    const clientIP = req.ip || req.connection.remoteAddress || req.socket.remoteAddress;
    updateESP32Status(device, clientIP);

    if (heartbeat) {
        console.log('💓 Heartbeat recebido:', { device, ip: clientIP, rssi: wifi_rssi });
    } else {
        console.log('📨 Dados recebidos:', {
            device,
            temperature,
            gas_level,
            ip: clientIP,
            rssi: wifi_rssi
        });
    }
    
    res.json({ 
        status: 'OK', 
        message: heartbeat ? 'Heartbeat recebido!' : 'Dados salvos!',
        serverTime: new Date().toLocaleString('pt-BR'),
        devices: devicesState // Retorna estado atual dos dispositivos
    });
});

// ESP32 busca estado dos dispositivos
app.get('/api/devices', (req, res) => {
    // Atualizar status do ESP32
    const clientIP = req.ip || req.connection.remoteAddress || req.socket.remoteAddress;
    updateESP32Status('ESP32-AUTOMACAO-V3', clientIP);
    
    res.json(devicesState);
});

// Interface web controla dispositivos
app.post('/api/control', async (req, res) => {
    const { type, device, state } = req.body;
    
    // Validação
    if (!type || !device || typeof state === 'undefined') {
        return res.status(400).json({ error: 'Dados incompletos' });
    }
    
    if (!['lights', 'outlets', 'irrigation'].includes(type)) {
        return res.status(400).json({ error: 'Tipo inválido' });
    }
    
    if (!devicesState[type] || !devicesState[type].hasOwnProperty(device)) {
        return res.status(400).json({ error: 'Dispositivo não encontrado' });
    }
    
    // Verificação especial para irrigação automática em dias chuvosos
    if (type === 'irrigation' && device === 'bomba_irrigacao' && state === true) {
        if (devicesState.irrigation.modo === 'automatico' && devicesState.irrigation.evitar_chuva) {
            const raining = await isRaining();
            if (raining) {
                return res.status(400).json({ 
                    error: 'Irrigação bloqueada - Está chovendo',
                    message: 'O sistema detectou chuva e bloqueou a irrigação automática'
                });
            }
        }
    }
    
    // Verificar se ESP32 está conectado antes de enviar comando
    const espConnected = checkESP32Connection();
    if (!espConnected && type !== 'irrigation') {
        return res.status(503).json({ 
            error: 'ESP32 desconectado - Comando não enviado',
            suggestion: 'Verifique a conexão do ESP32 com a rede WiFi'
        });
    }
    
    devicesState[type][device] = state;
    saveState(devicesState);
    
    console.log(`🎛️ ${type} ${device}: ${state ? 'LIGADO' : 'DESLIGADO'}`);
    res.json({ 
        status: 'OK', 
        type, 
        device, 
        state,
        esp32Connected: type === 'irrigation' ? true : espConnected,
        message: `Comando enviado - ${device} ${state ? 'ligado' : 'desligado'}`
    });
});

// Ver dados dos sensores
app.get('/api/data', (req, res) => {
    const espConnected = checkESP32Connection();
    
    res.json({ 
        data: sensorData,
        esp32: {
            connected: espConnected,
            lastUpdate: sensorData[0]?.receivedAt || null
        },
        summary: {
            total_readings: sensorData.length,
            last_temperature: sensorData[0]?.temperature || 'N/A',
            last_gas_level: sensorData[0]?.gas_level || 'N/A',
            gas_alert: sensorData[0]?.gas_alert || false,
            last_update: sensorData[0]?.timestamp || 'N/A'
        }
    });
});

// Reset dos dispositivos
app.post('/api/reset', (req, res) => {
    // Verificar se ESP32 está conectado
    const espConnected = checkESP32Connection();
    if (!espConnected) {
        return res.status(503).json({ 
            error: 'ESP32 desconectado - Reset não realizado',
            suggestion: 'Verifique a conexão do ESP32'
        });
    }
    
    Object.keys(devicesState.lights).forEach(key => {
        devicesState.lights[key] = false;
    });
    Object.keys(devicesState.outlets).forEach(key => {
        devicesState.outlets[key] = false;
    });
    devicesState.irrigation.bomba_irrigacao = false;
    
    saveState(devicesState);
    console.log('🔄 Todos os dispositivos resetados');
    res.json({ 
        status: 'OK', 
        message: 'Todos os dispositivos desligados',
        esp32Connected: true
    });
});

// Rota para obter configurações de irrigação
app.get('/api/irrigation', (req, res) => {
    res.json(devicesState.irrigation);
});

// Rota para salvar configurações de irrigação
app.post('/api/irrigation/save', (req, res) => {
    const { modo, programacoes, evitar_chuva } = req.body;
    
    devicesState.irrigation.modo = modo;
    devicesState.irrigation.programacoes = programacoes || [];
    devicesState.irrigation.evitar_chuva = evitar_chuva !== false; // Padrão true
    
    saveState(devicesState);
    
    console.log('💧 Configurações de irrigação salvas:', { 
        modo, 
        programacoes: programacoes?.length || 0,
        evitar_chuva: devicesState.irrigation.evitar_chuva
    });
    res.json({ status: 'OK', message: 'Configurações salvas com sucesso' });
});

// Rota para controlar a bomba manualmente
app.post('/api/irrigation/control', async (req, res) => {
    const { state } = req.body;
    
    // Verificar se está chovendo para irrigação manual com prevenção ativa
    if (state === true && devicesState.irrigation.evitar_chuva) {
        const raining = await isRaining();
        if (raining) {
            return res.status(400).json({ 
                error: 'Irrigação bloqueada - Está chovendo',
                message: 'O sistema detectou chuva e bloqueou a irrigação'
            });
        }
    }
    
    devicesState.irrigation.bomba_irrigacao = state;
    saveState(devicesState);
    
    console.log(`💧 Bomba irrigação: ${state ? 'LIGADA' : 'DESLIGADA'}`);
    res.json({ 
        status: 'OK', 
        state,
        message: `Bomba ${state ? 'ligada' : 'desligada'} com sucesso`
    });
});

// Health check
app.get('/health', (req, res) => {
    const espConnected = checkESP32Connection();
    
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        esp32: {
            connected: espConnected,
            lastSeen: esp32Status.lastSeen
        }
    });
});

// Middleware de erro
app.use((error, req, res, next) => {
    console.error('❌ Erro:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Rota não encontrada' });
});

app.listen(PORT, () => {
    console.log(`🔥 Servidor Automação V3.0 rodando na porta ${PORT}`);
    console.log(`🌐 Acesse: http://localhost:${PORT}`);
    console.log(`🔧 Modo: ${process.env.NODE_ENV || 'development'}`);
    console.log('📡 Monitoramento ESP32: ATIVADO');
    console.log('💧 Sistema de Irrigação: ATIVADO');
    console.log('🔐 Sistema de Login: ATIVADO');
    console.log('🌤️  API Clima: ' + (process.env.OPENWEATHER_API_KEY ? 'CONFIGURADA' : 'NÃO CONFIGURADA'));
});
