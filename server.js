const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const cookieParser = require('cookie-parser');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ CORREÇÃO CRÍTICA: CORS configurado para permitir cookies
app.use(cors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Device-ID', 'X-Device-Type']
}));

// Middleware
app.use(express.json());
app.use(cookieParser());

// ✅ CORREÇÃO: Servir arquivos estáticos ANTES da autenticação
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
            console.log('💾 Estado carregado do arquivo');
            const state = JSON.parse(data);
            
            // ✅ CORREÇÃO: Garantir que o modo_automatico esteja sincronizado
            if (state.irrigation) {
                state.irrigation.modo_automatico = state.irrigation.modo === 'automatico';
            }
            
            return state;
        }
    } catch (error) {
        console.log('❌ Erro ao carregar estado:', error.message);
    }
    
    console.log('💾 Criando estado inicial');
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
        // ✅ CORREÇÃO: Garantir sincronização do modo_automatico
        if (state.irrigation) {
            state.irrigation.modo_automatico = state.irrigation.modo === 'automatico';
        }
        
        fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
        console.log('💾 Estado salvo com sucesso');
        return true;
    } catch (error) {
        console.error('❌ Erro ao salvar estado:', error);
        return false;
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

// Sistema de irrigação automática
let irrigationCheckInterval = null;

function startIrrigationScheduler() {
    // Para qualquer intervalo existente
    if (irrigationCheckInterval) {
        clearInterval(irrigationCheckInterval);
    }
    
    // Verifica a cada 10 segundos para ser mais responsivo
    irrigationCheckInterval = setInterval(() => {
        checkScheduledIrrigation();
    }, 10000);
    
    console.log('⏰ Agendador de irrigação iniciado (verificação a cada 10 segundos)');
}

function checkScheduledIrrigation() {
    const now = new Date();
    const currentTime = now.getHours().toString().padStart(2, '0') + ':' + 
                       now.getMinutes().toString().padStart(2, '0');
    const currentDay = getCurrentDayOfWeek();

    if (devicesState.irrigation.modo !== 'automatico') {
        return;
    }

    const programacoes = devicesState.irrigation.programacoes || [];
    
    if (programacoes.length === 0) {
        return;
    }

    programacoes.forEach((prog, index) => {
        if (prog.hora === currentTime && prog.dias.includes(currentDay)) {
            console.log(`💧 ✅ PROGRAMação ${index + 1} ATIVADA! Hora: ${prog.hora}, Dia: ${currentDay}`);
            
            // Verificar se já está executando
            if (devicesState.irrigation.bomba_irrigacao) {
                console.log('💧 ⚠️ Bomba já está ligada, ignorando ativação duplicada');
                return;
            }

            if (devicesState.irrigation.evitar_chuva) {
                isRaining().then(raining => {
                    if (!raining) {
                        console.log('💧 ✅ Condições climáticas OK - Iniciando irrigação programada');
                        startScheduledIrrigation(index);
                    } else {
                        console.log('💧 ❌ Irrigação cancelada - Está chovendo');
                    }
                }).catch(error => {
                    console.log('💧 ⚠️ Erro ao verificar chuva, iniciando irrigação:', error);
                    startScheduledIrrigation(index);
                });
            } else {
                console.log('💧 ✅ Evitar chuva desativado - Iniciando irrigação');
                startScheduledIrrigation(index);
            }
        }
    });
}

function getCurrentDayOfWeek() {
    const days = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
    return days[new Date().getDay()];
}

function startScheduledIrrigation(programIndex) {
    console.log(`💧 🚀 INICIANDO IRRIGAÇÃO PROGRAMADA #${programIndex + 1}`);
    
    // Atualiza estado e salva imediatamente
    devicesState.irrigation.bomba_irrigacao = true;
    saveState(devicesState);

    const duracao = devicesState.irrigation.duracao || 5;
    console.log(`⏰ Irrigação programada por ${duracao} minutos`);
    
    // Timer para desligar a bomba
    setTimeout(() => {
        if (devicesState.irrigation.bomba_irrigacao) {
            console.log(`💧 ⏹️ DESLIGANDO IRRIGAÇÃO PROGRAMADA #${programIndex + 1} após ${duracao} minutos`);
            devicesState.irrigation.bomba_irrigacao = false;
            saveState(devicesState);
        }
    }, duracao * 60 * 1000);
}

// Função para buscar dados do clima
async function fetchWeatherData() {
    try {
        const API_KEY = process.env.OPENWEATHER_API_KEY;
        if (!API_KEY) {
            return null;
        }

        const lat = -22.9068;
        const lon = -43.1729;
        const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${API_KEY}&units=metric&lang=pt_br`;
        
        const response = await fetch(url);
        
        if (!response.ok) {
            return null;
        }
        
        const data = await response.json();
        return data;
    } catch (error) {
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
        return false;
    }
}

// Inicializar dados
let devicesState = loadState();

// Inicializar sistemas
function initializeSystems() {
    setInterval(checkESP32Connection, 60000);
    startIrrigationScheduler();
    console.log('✅ Sistemas inicializados: ESP32 + Irrigação Automática');
}

initializeSystems();

// ✅ Middleware para permitir acesso do ESP32 sem autenticação
const allowESP32 = (req, res, next) => {
    const esp32Routes = [
        '/api/data', 
        '/api/commands', 
        '/api/confirm', 
        '/api/control', 
        '/api/devices',
        '/api/irrigation',
        '/api/irrigation/control',
        '/api/sensor-data'
    ];
    
    if (esp32Routes.includes(req.path)) {
        console.log(`✅ Acesso permitido para ESP32: ${req.path}`);
        return next();
    }
    
    next();
};

// Aplica o middleware do ESP32 primeiro
app.use(allowESP32);

// ✅✅✅ Middleware de autenticação
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
        '/api/devices',
        '/api/data',
        '/api/commands',
        '/api/confirm',
        '/api/control',
        '/api/irrigation',       
        '/api/irrigation/control',
        '/api/irrigation/save',
        '/api/irrigation/test-schedule',
        '/api/irrigation/schedule-status',
        '/health',
        '/favicon.ico',
        '/styles.css',
        '/script.js'
    ];

    if (publicRoutes.includes(req.path)) {
        return next();
    }

    const authToken = req.cookies?.authToken;
    
    if (authToken === 'admin123') {
        return next();
    } else {
        console.log('🔐 Acesso negado para:', req.path);
        
        if (req.path.startsWith('/api/')) {
            return res.status(401).json({ 
                error: 'Não autorizado - Faça login novamente',
                redirect: '/login.html'
            });
        } else {
            return res.redirect('/login.html');
        }
    }
};

// Aplica o middleware de autenticação
app.use(requireAuth);

// ==================== ROTAS ====================

// Rota principal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/index.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Login
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    if (username === 'admin' && password === 'admin123') {
        res.cookie('authToken', 'admin123', {
            maxAge: 24 * 60 * 60 * 1000,
            httpOnly: false,
            secure: false,
            sameSite: 'lax',
            path: '/',
        });
        
        res.json({ 
            success: true, 
            message: 'Login realizado',
            redirect: '/index.html'
        });
    } else {
        res.status(401).json({ 
            success: false, 
            message: 'Usuário ou senha incorretos' 
        });
    }
});

// Logout
app.post('/api/logout', (req, res) => {
    res.clearCookie('authToken', { path: '/' });
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

// Dados dos sensores
app.get('/api/sensor-data', (req, res) => {
    const espConnected = checkESP32Connection();
    
    const sensorData = (devicesState.sensorData || []).map(data => {
        let humidity = data.humidity;
        if (typeof humidity === 'string') humidity = parseFloat(humidity);
        if (isNaN(humidity)) humidity = 0;
        
        let temperature = data.temperature;
        if (typeof temperature === 'string') temperature = parseFloat(temperature);
        if (isNaN(temperature)) temperature = 0;
        
        let gas_level = data.gas_level;
        if (typeof gas_level === 'string') gas_level = parseFloat(gas_level);
        if (isNaN(gas_level)) gas_level = 0;

        return {
            ...data,
            humidity: humidity,
            temperature: temperature,
            gas_level: gas_level,
            gas_alert: data.gas_alert || gas_level > 300
        };
    });
    
    const latestData = sensorData[0] || {};
    
    res.json({ 
        data: sensorData,
        esp32: { connected: espConnected },
        summary: {
            total_readings: sensorData.length || 0,
            last_temperature: latestData.temperature || 'N/A',
            last_humidity: latestData.humidity || 'N/A',
            last_gas_level: latestData.gas_level || 'N/A',
            last_gas_alert: latestData.gas_alert || false
        }
    });
});

// Teste irrigação automática
app.get('/api/irrigation/test-schedule', (req, res) => {
    console.log('💧 TESTE MANUAL: Verificando programações...');
    checkScheduledIrrigation();
    res.json({ 
        status: 'OK', 
        message: 'Verificação de programações executada',
        programacoes: devicesState.irrigation.programacoes
    });
});

// Status programações
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
        bomba_ativa: devicesState.irrigation.bomba_irrigacao,
        evitar_chuva: devicesState.irrigation.evitar_chuva,
        duracao: devicesState.irrigation.duracao
    });
});

// ESP32 envia dados
app.post('/api/data', (req, res) => {
    const { temperature, humidity, gas_level, gas_alert, device, heartbeat, wifi_rssi, irrigation_auto } = req.body;

    console.log('📨 Dados recebidos do ESP32:', {
        temperature, humidity, gas_level, gas_alert, device, heartbeat, wifi_rssi, irrigation_auto
    });

    let processedHumidity = humidity;
    if (typeof humidity === 'string') processedHumidity = parseFloat(humidity);
    if (isNaN(processedHumidity)) processedHumidity = 0;

    let processedTemperature = temperature;
    if (typeof temperature === 'string') processedTemperature = parseFloat(temperature);
    if (isNaN(processedTemperature)) processedTemperature = 0;

    let processedGasLevel = gas_level;
    if (typeof gas_level === 'string') processedGasLevel = parseFloat(gas_level);
    if (isNaN(processedGasLevel)) processedGasLevel = 0;

    const newData = {
        temperature: processedTemperature, 
        humidity: processedHumidity,
        gas_level: processedGasLevel, 
        gas_alert: gas_alert || processedGasLevel > 300,
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

    if (typeof irrigation_auto !== 'undefined') {
        devicesState.irrigation.modo = irrigation_auto ? 'automatico' : 'manual';
        devicesState.irrigation.modo_automatico = irrigation_auto;
        saveState(devicesState);
    }

    const clientIP = req.ip || req.connection.remoteAddress;
    updateESP32Status(device, clientIP);

    console.log(`📊 Dados salvos - Temp: ${processedTemperature}°C, Umidade: ${processedHumidity}%, Gás: ${processedGasLevel}`);
    
    res.json({ 
        status: 'OK', 
        message: heartbeat ? 'Heartbeat recebido!' : 'Dados salvos!',
        devices: devicesState
    });
});

// ESP32 busca comandos - ✅ CORREÇÃO CRÍTICA: Envia estado CORRETO para o ESP32
app.get('/api/commands', (req, res) => {
    const clientIP = req.ip || req.connection.remoteAddress;
    updateESP32Status('ESP32-CASA-AUTOMACAO-V3', clientIP);
    
    console.log('📥 ESP32 solicitando comandos - Enviando estado atual:', {
        bomba_irrigacao: devicesState.irrigation.bomba_irrigacao,
        modo: devicesState.irrigation.modo,
        modo_automatico: devicesState.irrigation.modo_automatico
    });
    
    const programacoesParaESP32 = (devicesState.irrigation.programacoes || []).map(prog => ({
        hora: prog.hora,
        dias: prog.dias
    }));
    
    // ✅ CORREÇÃO CRÍTICA: Envia o estado EXATO que o ESP32 precisa
    const response = {
        lights: devicesState.lights,
        outlets: devicesState.outlets,
        irrigation: {
            bomba_irrigacao: devicesState.irrigation.bomba_irrigacao,
            modo_automatico: devicesState.irrigation.modo === 'automatico', // ✅ SEMPRE sincronizado
            duracao: devicesState.irrigation.duracao || 5,
            programacoes: programacoesParaESP32
        }
    };
    
    console.log('📤 Enviando para ESP32:', JSON.stringify(response, null, 2));
    
    res.json(response);
});

// ESP32 confirma comandos - ✅ CORREÇÃO CRÍTICA: Atualiza estado do ESP32
app.post('/api/confirm', (req, res) => {
    console.log('✅ Confirmação recebida do ESP32:', req.body);
    
    if (req.body.lights) {
        devicesState.lights = { ...devicesState.lights, ...req.body.lights };
    }
    if (req.body.outlets) {
        devicesState.outlets = { ...devicesState.outlets, ...req.body.outlets };
    }
    if (req.body.irrigation) {
        // ✅ CORREÇÃO CRÍTICA: Atualiza o estado da bomba do ESP32
        devicesState.irrigation.bomba_irrigacao = req.body.irrigation.bomba_irrigacao || false;
        devicesState.irrigation.modo = req.body.irrigation.modo_automatico ? 'automatico' : 'manual';
        devicesState.irrigation.modo_automatico = req.body.irrigation.modo_automatico || false;
        
        console.log('💧 Estado da bomba atualizado pelo ESP32:', devicesState.irrigation.bomba_irrigacao);
    }
    
    saveState(devicesState);
    
    res.json({ 
        status: 'OK', 
        message: 'Confirmação recebida',
        timestamp: new Date().toISOString()
    });
});

// ESP32 busca dispositivos
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

// Controlar dispositivos - ✅ CORREÇÃO CRÍTICA: Força sincronização com ESP32
app.post('/api/control', async (req, res) => {
    const { type, device, state } = req.body;
    
    console.log('🎛️ Comando recebido:', { type, device, state, from: req.get('User-Agent') || 'Unknown' });
    
    if (!type || !device || typeof state === 'undefined') {
        return res.status(400).json({ error: 'Dados incompletos' });
    }
    
    if (!['lights', 'outlets', 'irrigation'].includes(type)) {
        return res.status(400).json({ error: 'Tipo inválido' });
    }
    
    if (!devicesState[type] || !devicesState[type].hasOwnProperty(device)) {
        return res.status(400).json({ error: 'Dispositivo não encontrado' });
    }
    
    const isFromESP32 = req.get('User-Agent')?.includes('ESP32') || false;
    
    if (type === 'irrigation' && device === 'bomba_irrigacao' && state === true && !isFromESP32) {
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
    if (!espConnected && type !== 'irrigation' && !isFromESP32) {
        return res.status(503).json({ 
            error: 'ESP32 desconectado'
        });
    }
    
    // ✅ CORREÇÃO CRÍTICA: Atualiza estado
    devicesState[type][device] = state;
    
    // ✅ CORREÇÃO CRÍTICA: Se for irrigação, força sincronização do modo_automatico
    if (type === 'irrigation' && device === 'bomba_irrigacao') {
        console.log(`💧 Bomba ${state ? 'LIGADA' : 'DESLIGADA'} pelo ${isFromESP32 ? 'ESP32' : 'frontend'}`);
    }
    
    saveState(devicesState);
    
    console.log(`🎛️ ${type} ${device}: ${state ? 'LIGADO' : 'DESLIGADO'} ${isFromESP32 ? '(pelo ESP32)' : '(pelo frontend)'}`);
    res.json({ 
        status: 'OK', 
        message: `Comando enviado - ${device} ${state ? 'ligado' : 'desligado'}`
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

// Salvar configurações de irrigação - ✅ CORREÇÃO: Reinicia o agendador
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
        
        // ✅ CORREÇÃO: Reinicia o agendador quando as configurações mudam
        startIrrigationScheduler();
        
        console.log('✅ Configurações de irrigação salvas e agendador reiniciado');
        
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

// Controle de irrigação
app.post('/api/irrigation/control', async (req, res) => {
    const { state } = req.body;
    
    console.log('💧 Controle de irrigação recebido:', { state, from: req.get('User-Agent') || 'Unknown' });
    
    const isFromESP32 = req.get('User-Agent')?.includes('ESP32') || false;
    
    if (state === true && devicesState.irrigation.evitar_chuva && !isFromESP32) {
        const raining = await isRaining();
        if (raining) {
            return res.status(400).json({ error: 'Irrigação bloqueada - Está chovendo' });
        }
    }
    
    devicesState.irrigation.bomba_irrigacao = state;
    saveState(devicesState);
    
    console.log(`💧 Bomba: ${state ? 'LIGADA' : 'DESLIGADA'} ${isFromESP32 ? '(pelo ESP32)' : '(pelo frontend)'}`);
    res.json({ 
        status: 'OK', 
        message: `Bomba ${state ? 'ligada' : 'desligada'}`
    });
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
    console.log('💧 SISTEMA DE IRRIGAÇÃO CORRIGIDO - SINCRONIZAÇÃO ESP32/FORNTEND');
    console.log('📡 ESP32: COMUNICAÇÃO OTIMIZADA');
    console.log('⏰ IRRIGAÇÃO AUTOMÁTICA: VERIFICAÇÃO A CADA 10 SEGUNDOS\n');
});
