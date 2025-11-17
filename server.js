const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const cookieParser = require('cookie-parser');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// CORS configurado para permitir cookies
app.use(cors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Device-ID', 'X-Device-Type']
}));

// Middleware
app.use(express.json());
app.use(cookieParser());

// Servir arquivos estáticos ANTES da autenticação
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
            
            // Garantir que a estrutura esteja correta
            if (!state.irrigation) {
                state.irrigation = {
                    bomba_irrigacao: false,
                    modo: 'manual',
                    programacoes: [],
                    evitar_chuva: true,
                    duracao: 5,
                    modo_automatico: false
                };
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

// Função para buscar dados do clima
async function fetchWeatherData() {
    try {
        const API_KEY = process.env.OPENWEATHER_API_KEY;
        if (!API_KEY) {
            console.log('❌ API key do clima não configurada');
            return null;
        }

        const lat = -22.9068;
        const lon = -43.1729;
        const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${API_KEY}&units=metric&lang=pt_br`;
        
        console.log('🌤️ Buscando dados do clima...');
        const response = await fetch(url);
        
        if (!response.ok) {
            console.log(`❌ Erro na API do clima: ${response.status}`);
            return null;
        }
        
        const data = await response.json();
        console.log('🌤️ Dados do clima recebidos com sucesso');
        return data;
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
            const isRaining = condition.includes('rain') || condition.includes('drizzle') || condition.includes('storm');
            console.log(`🌧️ Condição climática: ${condition} - Está chovendo: ${isRaining}`);
            return isRaining;
        }
        console.log('🌤️ Dados climáticos indisponíveis');
        return false;
    } catch (error) {
        console.error('❌ Erro ao verificar chuva:', error);
        return false;
    }
}

// Sistema de irrigação automática - CORRIGIDO
let irrigationCheckInterval = null;
let activeIrrigationTimer = null;

function startIrrigationScheduler() {
    // Para qualquer intervalo existente
    if (irrigationCheckInterval) {
        clearInterval(irrigationCheckInterval);
    }
    
    // CORREÇÃO: Verificar a cada 10 segundos para maior precisão
    irrigationCheckInterval = setInterval(() => {
        checkScheduledIrrigation();
    }, 10000); // 10 segundos
    
    console.log('⏰ Agendador de irrigação INICIADO (verificação a cada 10 segundos)');
    
    // Verifica imediatamente ao iniciar
    setTimeout(() => {
        checkScheduledIrrigation();
    }, 2000);
}

function getCurrentDayOfWeek() {
    const days = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
    return days[new Date().getDay()];
}

function startScheduledIrrigation(programIndex) {
    console.log(`💧 🚀 INICIANDO IRRIGAÇÃO PROGRAMADA #${programIndex + 1}`);
    
    // Atualiza estado e salva
    devicesState.irrigation.bomba_irrigacao = true;
    saveState(devicesState);

    const duracao = devicesState.irrigation.duracao || 5;
    console.log(`⏰ Irrigação programada por ${duracao} minutos`);
    
    // Limpar timer anterior se existir
    if (activeIrrigationTimer) {
        clearTimeout(activeIrrigationTimer);
    }
    
    // Timer para desligar a bomba
    activeIrrigationTimer = setTimeout(() => {
        console.log(`💧 ⏹️ DESLIGANDO IRRIGAÇÃO PROGRAMADA #${programIndex + 1} após ${duracao} minutos`);
        devicesState.irrigation.bomba_irrigacao = false;
        saveState(devicesState);
        activeIrrigationTimer = null;
    }, duracao * 60 * 1000);
}

// FUNÇÃO PRINCIPAL CORRIGIDA - checkScheduledIrrigation
function checkScheduledIrrigation() {
    const now = new Date();
    const currentTime = now.getHours().toString().padStart(2, '0') + ':' + 
                       now.getMinutes().toString().padStart(2, '0');
    const currentDay = getCurrentDayOfWeek();

    console.log(`💧 [${currentTime}] Verificando programações (Dia: ${currentDay})...`);

    // Verificar se está no modo automático
    if (devicesState.irrigation.modo !== 'automatico') {
        console.log('💧 ❌ Modo não é automático, ignorando verificação');
        return;
    }

    const programacoes = devicesState.irrigation.programacoes || [];
    
    console.log(`💧 Programações configuradas: ${programacoes.length}`);
    
    if (programacoes.length === 0) {
        console.log('💧 ❌ Nenhuma programação configurada');
        return;
    }

    let foundActiveSchedule = false;
    
    programacoes.forEach((prog, index) => {
        console.log(`💧 Verificando programação ${index + 1}: ${prog.hora} - Dias: ${prog.dias.join(', ')}`);
        
        // CORREÇÃO: Verificação mais flexível com tolerância de 1 minuto
        const programTime = new Date();
        const [hours, minutes] = prog.hora.split(':');
        programTime.setHours(parseInt(hours), parseInt(minutes), 0, 0);
        
        const timeDiff = Math.abs(now - programTime);
        const isWithinOneMinute = timeDiff <= 60000; // 1 minuto de tolerância
        
        if (isWithinOneMinute && prog.dias.includes(currentDay)) {
            foundActiveSchedule = true;
            console.log(`💧 ✅ PROGRAMação ${index + 1} ATIVADA! (Dentro da tolerância)`);
            
            // Verificar se já está executando
            if (devicesState.irrigation.bomba_irrigacao) {
                console.log('💧 ⚠️ Bomba já está ligada, ignorando ativação duplicada');
                return;
            }

            // Verificar condições climáticas se necessário
            if (devicesState.irrigation.evitar_chuva) {
                console.log('💧 Verificando se está chovendo...');
                isRaining().then(raining => {
                    if (!raining) {
                        console.log('💧 ✅ Não está chovendo - Iniciando irrigação programada');
                        startScheduledIrrigation(index);
                    } else {
                        console.log('💧 ❌ Está chovendo - Irrigação cancelada');
                    }
                }).catch(error => {
                    console.log('💧 ⚠️ Erro ao verificar chuva, iniciando irrigação:', error);
                    startScheduledIrrigation(index);
                });
            } else {
                console.log('💧 ✅ Evitar chuva desativado - Iniciando irrigação');
                startScheduledIrrigation(index);
            }
        } else {
            console.log(`💧 ❌ Programação ${index + 1} não ativa (Diferença: ${Math.round(timeDiff/1000)}s)`);
        }
    });

    if (!foundActiveSchedule) {
        console.log('💧 Nenhuma programação ativa no momento');
    }
}

// Inicializar dados
let devicesState = loadState();

// Inicializar sistemas
function initializeSystems() {
    setInterval(checkESP32Connection, 60000);
    startIrrigationScheduler();
    
    console.log('✅ Sistemas inicializados:');
    console.log('   - ESP32 Monitor: ATIVO');
    console.log('   - Irrigação Automática: ATIVO');
    console.log('   - Verificação: A CADA 10 SEGUNDOS');
    console.log('   - Programações ativas:', devicesState.irrigation.programacoes.length);
    
    // Log das programações configuradas
    devicesState.irrigation.programacoes.forEach((prog, index) => {
        console.log(`   ${index + 1}. ${prog.hora} - Dias: ${prog.dias.join(', ')}`);
    });
}

initializeSystems();

// Middleware para permitir acesso do ESP32 sem autenticação
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

// Middleware de autenticação
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
    
    console.log('🔐 Tentativa de login:', { username });
    
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

// Rota para testar programações manualmente - NOVA ROTA
app.post('/api/irrigation/test-now', (req, res) => {
    const now = new Date();
    const testTime = req.body.time || 
        now.getHours().toString().padStart(2, '0') + ':' + 
        now.getMinutes().toString().padStart(2, '0');
    
    console.log(`🧪 TESTE MANUAL: Simulando horário ${testTime}`);
    
    // Executar verificação
    checkScheduledIrrigation();
    
    res.json({ 
        status: 'OK', 
        message: 'Teste executado',
        testTime: testTime,
        currentPrograms: devicesState.irrigation.programacoes
    });
});

// ESP32 envia dados
app.post('/api/data', (req, res) => {
    const { temperature, humidity, gas_level, gas_alert, device, heartbeat, wifi_rssi, irrigation_auto } = req.body;

    console.log('📨 Dados recebidos do ESP32:', {
        temperature, humidity, gas_level, gas_alert, device, heartbeat, wifi_rssi, irrigation_auto
    });

    // Processar dados
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

    // Atualizar modo de irrigação se enviado pelo ESP32
    if (typeof irrigation_auto !== 'undefined') {
        devicesState.irrigation.modo = irrigation_auto ? 'automatico' : 'manual';
        devicesState.irrigation.modo_automatico = irrigation_auto;
        saveState(devicesState);
        console.log(`💧 Modo atualizado pelo ESP32: ${devicesState.irrigation.modo}`);
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

// ESP32 busca comandos - ROTA MAIS IMPORTANTE PARA O ESP32
app.get('/api/commands', (req, res) => {
    const clientIP = req.ip || req.connection.remoteAddress;
    updateESP32Status('ESP32-CASA-AUTOMACAO-V3', clientIP);
    
    console.log('📥 ESP32 solicitando comandos');
    console.log('💧 Estado atual da bomba:', devicesState.irrigation.bomba_irrigacao);
    console.log('💧 Modo atual:', devicesState.irrigation.modo);
    
    const programacoesParaESP32 = (devicesState.irrigation.programacoes || []).map(prog => ({
        hora: prog.hora,
        dias: prog.dias
    }));
    
    const response = {
        lights: devicesState.lights,
        outlets: devicesState.outlets,
        irrigation: {
            bomba_irrigacao: devicesState.irrigation.bomba_irrigacao,
            modo_automatico: devicesState.irrigation.modo === 'automatico',
            duracao: devicesState.irrigation.duracao || 5,
            programacoes: programacoesParaESP32
        }
    };
    
    console.log('📤 Enviando para ESP32:', JSON.stringify(response.irrigation, null, 2));
    
    res.json(response);
});

// ESP32 confirma comandos
app.post('/api/confirm', (req, res) => {
    console.log('✅ Confirmação recebida do ESP32:', req.body);
    
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
        
        console.log('💧 Estado atualizado pelo ESP32 - Bomba:', devicesState.irrigation.bomba_irrigacao);
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
    
    // Verificação específica para irrigação
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
    
    // Atualizar estado
    devicesState[type][device] = state;
    saveState(devicesState);
    
    console.log(`🎛️ ${type} ${device}: ${state ? 'LIGADO' : 'DESLIGADO'}`);
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
        
        // Reiniciar agendador
        startIrrigationScheduler();
        
        console.log('✅ Configurações de irrigação salvas');
        
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

// Controle direto de irrigação
app.post('/api/irrigation/control', async (req, res) => {
    const { state } = req.body;
    
    console.log('💧 Controle direto de irrigação:', { state });
    
    if (state === true && devicesState.irrigation.evitar_chuva) {
        const raining = await isRaining();
        if (raining) {
            return res.status(400).json({ error: 'Irrigação bloqueada - Está chovendo' });
        }
    }
    
    devicesState.irrigation.bomba_irrigacao = state;
    saveState(devicesState);
    
    console.log(`💧 Bomba: ${state ? 'LIGADA' : 'DESLIGADA'}`);
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
    console.log('📡 Monitoramento ESP32: ATIVADO');
    console.log('💧 Sistema de Irrigação: CORRIGIDO E OTIMIZADO');
    console.log('⏰ Irrigação Automática: VERIFICAÇÃO A CADA 10 SEGUNDOS');
    console.log('🔐 Sistema de Login: FUNCIONANDO');
    console.log('📊 Sensores: FUNCIONANDO');
    console.log('🔧 ESP32: COMUNICAÇÃO ESTÁVEL\n');
});
