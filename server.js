const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const cookieParser = require('cookie-parser');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ CORREÇÃO: CORS configurado corretamente para cookies
app.use(cors({
    origin: true,
    credentials: true
}));

// Middleware
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
            bomba_irrigacao: false, 
            modo: 'manual', 
            programacoes: [], 
            evitar_chuva: true,
            duracao: 5,
            modo_automatico: false
        },
        sensorData: []
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
        deviceId: device || 'ESP32-CASA-AUTOMACAO-V3',
        ipAddress: ip || 'Desconhecido'
    };
}

// Verificar se ESP32 está conectado
function checkESP32Connection() {
    if (esp32Status.lastHeartbeat) {
        const timeSinceLastHeartbeat = new Date() - esp32Status.lastHeartbeat;
        if (timeSinceLastHeartbeat > 120000) {
            esp32Status.connected = false;
        }
    }
    return esp32Status.connected;
}

// ✅ CORREÇÃO: Sistema de irrigação automática
function startIrrigationScheduler() {
    setInterval(() => {
        checkScheduledIrrigation();
    }, 60000); // Verificar a cada minuto
    console.log('⏰ Agendador de irrigação iniciado');
}

// ✅ CORREÇÃO: Função para verificar programações
function checkScheduledIrrigation() {
    if (devicesState.irrigation.modo !== 'automatico') {
        return; // Só executa no modo automático
    }

    const now = new Date();
    const currentTime = now.getHours().toString().padStart(2, '0') + ':' + 
                       now.getMinutes().toString().padStart(2, '0');
    const currentDay = getCurrentDayOfWeek();

    const programacoes = devicesState.irrigation.programacoes || [];
    
    programacoes.forEach((prog, index) => {
        // Verificar se é o horário e dia correto
        if (prog.hora === currentTime && prog.dias.includes(currentDay)) {
            console.log(`💧 Programação ${index + 1} ativada: ${prog.hora} - ${prog.dias.join(',')}`);
            
            // Verificar se não está chovendo (se configurado)
            if (devicesState.irrigation.evitar_chuva) {
                isRaining().then(raining => {
                    if (!raining) {
                        startScheduledIrrigation(index);
                    } else {
                        console.log('💧 Irrigação programada cancelada - Está chovendo');
                    }
                });
            } else {
                startScheduledIrrigation(index);
            }
        }
    });
}

// ✅ CORREÇÃO: Função para obter dia da semana atual
function getCurrentDayOfWeek() {
    const days = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
    return days[new Date().getDay()];
}

// ✅ CORREÇÃO: Função para iniciar irrigação programada
function startScheduledIrrigation(programIndex) {
    if (devicesState.irrigation.bomba_irrigacao) {
        console.log('💧 Bomba já está ligada, ignorando programação');
        return;
    }

    console.log(`💧 INICIANDO IRRIGAÇÃO PROGRAMADA #${programIndex + 1}`);
    
    // Ligar a bomba
    devicesState.irrigation.bomba_irrigacao = true;
    saveState(devicesState);

    // Programar desligamento automático
    const duracao = devicesState.irrigation.duracao || 5;
    console.log(`⏰ Irrigação programada por ${duracao} minutos`);
    
    setTimeout(() => {
        if (devicesState.irrigation.bomba_irrigacao) {
            console.log(`💧 DESLIGANDO IRRIGAÇÃO PROGRAMADA após ${duracao} minutos`);
            devicesState.irrigation.bomba_irrigacao = false;
            saveState(devicesState);
        }
    }, duracao * 60 * 1000);
}

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

// Inicializar dados
let devicesState = loadState();

// ✅ CORREÇÃO: Inicializar sistemas
function initializeSystems() {
    setInterval(checkESP32Connection, 60000);
    startIrrigationScheduler(); // 🆕 INICIAR AGENDADOR
    console.log('✅ Sistemas inicializados: ESP32 + Irrigação Automática');
}

initializeSystems();

// ✅✅✅ CORREÇÃO CRÍTICA: Middleware de autenticação SIMPLIFICADO E FUNCIONAL
function requireAuth(req, res, next) {
    console.log('🔐 Verificando autenticação para:', req.path);
    console.log('🍪 Cookies recebidos:', req.cookies);
    
    // Rotas públicas - SEMPRE permitidas
    const publicRoutes = [
        '/', 
        '/login.html',
        '/api/login', 
        '/api/logout',
        '/api/status',
        '/health',
        '/favicon.ico',
        '/styles.css',
        '/script.js',
        '/index.html' // ✅ CORREÇÃO: Adicionado index.html como pública
    ];

    // Rotas do ESP32 - SEM AUTENTICAÇÃO
    const esp32Routes = [
        '/api/data',
        '/api/devices',
        '/api/commands',
        '/api/confirm'
    ];

    // ✅ CORREÇÃO: Verificar rotas públicas PRIMEIRO
    if (publicRoutes.includes(req.path)) {
        console.log('✅ Rota pública, acesso permitido');
        return next();
    }

    // ✅ CORREÇÃO: Verificar rotas ESP32
    if (esp32Routes.includes(req.path)) {
        console.log('📡 Rota ESP32, acesso permitido');
        return next();
    }

    // ✅ CORREÇÃO: Verificar autenticação de forma SIMPLES
    const authToken = req.cookies?.authToken;
    console.log('🔑 Token de autenticação:', authToken);
    
    if (authToken === 'admin123') {
        console.log('✅ Usuário autenticado, acesso permitido');
        return next();
    } else {
        console.log('❌ Usuário NÃO autenticado, redirecionando para login');
        
        // Se for uma rota API, retorna erro JSON
        if (req.path.startsWith('/api/')) {
            return res.status(401).json({ 
                error: 'Não autorizado',
                redirect: '/login.html'
            });
        } else {
            // Se for uma página HTML, redireciona
            return res.redirect('/login.html');
        }
    }
}

// Aplica o middleware
app.use(requireAuth);

// Rota principal serve login
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Rota do sistema
app.get('/index.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ✅ CORREÇÃO: Login com configuração CORRETA de cookies
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    console.log('🔐 Tentativa de login:', { username });
    
    if (username === 'admin' && password === 'admin123') {
        // ✅ CORREÇÃO CRÍTICA: Configuração CORRETA do cookie
        res.cookie('authToken', 'admin123', {
            maxAge: 24 * 60 * 60 * 1000, // 24 horas
            httpOnly: false, // ✅ Permitir acesso via JavaScript
            secure: false,   // ✅ Permitir em HTTP (desenvolvimento)
            sameSite: 'lax', // ✅ Compatível com cross-origin
            path: '/',       // ✅ Disponível em todas as rotas
            domain: 'localhost' // ✅ Especificar domínio
        });
        
        console.log('✅ Login realizado com sucesso - Cookie configurado');
        
        res.json({ 
            success: true, 
            message: 'Login realizado',
            redirect: '/index.html'
        });
    } else {
        console.log('❌ Login falhou - Credenciais inválidas');
        res.status(401).json({ 
            success: false, 
            message: 'Usuário ou senha incorretos' 
        });
    }
});

// Logout
app.post('/api/logout', (req, res) => {
    // ✅ CORREÇÃO: Limpar cookie corretamente
    res.clearCookie('authToken', {
        path: '/',
        domain: 'localhost'
    });
    
    console.log('✅ Logout realizado - Cookie removido');
    
    res.json({ 
        success: true, 
        message: 'Logout realizado',
        redirect: '/'
    });
});

// Status do servidor
app.get('/api/status', (req, res) => {
    const espConnected = checkESP32Connection();
    const authToken = req.cookies?.authToken;
    
    console.log('📊 Status solicitado - AuthToken:', authToken);
    
    res.json({ 
        message: '🚀 Servidor Automação V3.0',
        status: 'online',
        authenticated: authToken === 'admin123',
        esp32: { connected: espConnected }
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

// ✅ CORREÇÃO: Rota para testar irrigação automática
app.get('/api/irrigation/test-schedule', (req, res) => {
    checkScheduledIrrigation();
    res.json({ 
        status: 'OK', 
        message: 'Verificação de programações executada',
        programacoes: devicesState.irrigation.programacoes
    });
});

// ✅ CORREÇÃO: Rota para ver status das programações
app.get('/api/irrigation/schedule-status', (req, res) => {
    const now = new Date();
    const currentTime = now.getHours().toString().padStart(2, '0') + ':' + 
                       now.getMinutes().toString().padStart(2, '0');
    const currentDay = getCurrentDayOfWeek();
    
    res.json({
        currentTime,
        currentDay,
        programacoes: devicesState.irrigation.programacoes,
        modo: devicesState.irrigation.modo,
        bomba_ativa: devicesState.irrigation.bomba_irrigacao
    });
});

// ESP32 envia dados - SEM AUTENTICAÇÃO
app.post('/api/data', (req, res) => {
    const { temperature, humidity, gas_level, gas_alert, device, heartbeat, wifi_rssi, irrigation_auto } = req.body;

    console.log('📨 Dados recebidos do ESP32:', {
        temperature, humidity, gas_level, gas_alert, device, heartbeat, wifi_rssi, irrigation_auto
    });

    if (typeof temperature === 'undefined' || typeof gas_level === 'undefined') {
        return res.status(400).json({ error: 'Dados inválidos' });
    }

    const newData = {
        temperature, 
        humidity: humidity || 0,
        gas_level, 
        gas_alert: gas_alert || false,
        device: device || 'ESP32', 
        heartbeat: heartbeat || false,
        wifi_rssi: wifi_rssi || 0, 
        timestamp: new Date().toLocaleString('pt-BR'),
        receivedAt: new Date()
    };

    if (!devicesState.sensorData) devicesState.sensorData = [];
    devicesState.sensorData.unshift(newData);
    if (devicesState.sensorData.length > 100) {
        devicesState.sensorData = devicesState.sensorData.slice(0, 100);
    }

    // Atualizar modo automático da irrigação se recebido
    if (typeof irrigation_auto !== 'undefined') {
        devicesState.irrigation.modo = irrigation_auto ? 'automatico' : 'manual';
        devicesState.irrigation.modo_automatico = irrigation_auto;
        saveState(devicesState);
    }

    const clientIP = req.ip || req.connection.remoteAddress;
    updateESP32Status(device, clientIP);

    console.log(heartbeat ? '💓 Heartbeat recebido' : '📊 Dados dos sensores recebidos');
    
    res.json({ 
        status: 'OK', 
        message: heartbeat ? 'Heartbeat recebido!' : 'Dados salvos!',
        devices: devicesState
    });
});

// ESP32 busca comandos - SEM AUTENTICAÇÃO
app.get('/api/commands', (req, res) => {
    const clientIP = req.ip || req.connection.remoteAddress;
    updateESP32Status('ESP32-CASA-AUTOMACAO-V3', clientIP);
    
    console.log('📥 ESP32 solicitando comandos');
    
    const programacoesParaESP32 = devicesState.irrigation.programacoes.map(prog => ({
        hora: prog.hora,
        dias: prog.dias
    }));
    
    res.json({
        lights: devicesState.lights,
        outlets: devicesState.outlets,
        irrigation: {
            bomba_irrigacao: devicesState.irrigation.bomba_irrigacao,
            modo_automatico: devicesState.irrigation.modo === 'automatico',
            duracao: devicesState.irrigation.duracao || 5,
            programacoes: programacoesParaESP32
        }
    });
});

// ESP32 confirma comandos - SEM AUTENTICAÇÃO
app.post('/api/confirm', (req, res) => {
    console.log('✅ Confirmação recebida do ESP32:', req.body);
    
    // Atualizar estados baseado na confirmação do ESP32
    if (req.body.lights) {
        devicesState.lights = { ...devicesState.lights, ...req.body.lights };
    }
    if (req.body.outlets) {
        devicesState.outlets = { ...devicesState.outlets, ...req.body.outlets };
    }
    if (req.body.irrigation) {
        devicesState.irrigation.bomba_irrigacao = req.body.irrigation.bomba_irrigacao || false;
        devicesState.irrigation.modo = req.body.irrigation.modo_automatico ? 'automatico' : 'manual';
        devicesState.irrigation.modo_automatico = req.body.irrigation.modo_automatico || false;
    }
    
    saveState(devicesState);
    
    res.json({ 
        status: 'OK', 
        message: 'Confirmação recebida',
        timestamp: new Date().toISOString()
    });
});

// ESP32 busca dispositivos - SEM AUTENTICAÇÃO
app.get('/api/devices', (req, res) => {
    const clientIP = req.ip || req.connection.remoteAddress;
    updateESP32Status('ESP32-CASA-AUTOMACAO-V3', clientIP);
    
    console.log('📡 ESP32 solicitando estados dos dispositivos');
    
    res.json({
        lights: devicesState.lights,
        outlets: devicesState.outlets,
        irrigation: {
            bomba_irrigacao: devicesState.irrigation.bomba_irrigacao,
            modo: devicesState.irrigation.modo,
            evitar_chuva: devicesState.irrigation.evitar_chuva,
            duracao: devicesState.irrigation.duracao || 5,
            programacoes: devicesState.irrigation.programacoes || []
        }
    });
});

// Controlar dispositivos (Frontend)
app.post('/api/control', async (req, res) => {
    const { type, device, state } = req.body;
    
    console.log('🎛️ Comando do frontend:', { type, device, state });
    
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
app.get('/api/sensor-data', (req, res) => {
    const espConnected = checkESP32Connection();
    
    const sensorData = (devicesState.sensorData || []).map(data => ({
        ...data,
        humidity: data.humidity || 0
    }));
    
    res.json({ 
        data: sensorData,
        esp32: { connected: espConnected },
        summary: {
            total_readings: sensorData.length || 0,
            last_temperature: sensorData[0]?.temperature || 'N/A',
            last_humidity: sensorData[0]?.humidity || 'N/A',
            last_gas_level: sensorData[0]?.gas_level || 'N/A'
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

// Salvar configurações de irrigação
app.post('/api/irrigation/save', (req, res) => {
    try {
        const { modo, programacoes, evitar_chuva, duracao } = req.body;
        
        console.log('💧 Salvando configurações de irrigação:', { 
            modo, 
            programacoes: programacoes?.length || 0, 
            evitar_chuva, 
            duracao 
        });
        
        devicesState.irrigation.modo = modo || 'manual';
        devicesState.irrigation.programacoes = Array.isArray(programacoes) ? programacoes : [];
        devicesState.irrigation.evitar_chuva = evitar_chuva !== false;
        devicesState.irrigation.duracao = parseInt(duracao) || 5;
        devicesState.irrigation.modo_automatico = modo === 'automatico';
        
        saveState(devicesState);
        
        console.log('✅ Configurações de irrigação salvas com sucesso');
        console.log('📋 Programações salvas:', devicesState.irrigation.programacoes);
        
        res.json({ 
            status: 'OK', 
            message: 'Configurações salvas',
            savedData: devicesState.irrigation
        });
    } catch (error) {
        console.error('❌ Erro ao salvar configurações de irrigação:', error);
        res.status(500).json({ 
            status: 'ERROR', 
            error: 'Erro interno ao salvar configurações' 
        });
    }
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
    console.log('⏰ Irrigação Automática: CORRIGIDA E FUNCIONAL');
    console.log('🔐 Sistema de Login: CORRIGIDO - SEM ERRO 401');
    console.log('🚨 Rotas ESP32: SEM AUTENTICAÇÃO');
    console.log('🔄 Configurações de Irrigação: CORRIGIDAS\n');
});
