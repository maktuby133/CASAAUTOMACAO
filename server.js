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
            
            // 🚨 CORREÇÃO: Garantir estrutura compatível com ESP32 MULTI-PROGRAMAÇÕES
            if (!state.irrigation) {
                state.irrigation = {
                    bomba_irrigacao: false,
                    modo: 'manual',
                    programacoes: [],
                    evitar_chuva: true,
                    duracao: 5,
                    modo_automatico: false,
                    horarios_irrigacao: ["", "", "", "", ""], // 🚨 ARRAY PARA 5 HORÁRIOS
                    dias_irrigacao: [ // 🚨 MATRIZ PARA 5×7 DIAS
                        [0, 1, 0, 1, 0, 1, 0],
                        [0, 0, 0, 0, 0, 0, 0],
                        [0, 0, 0, 0, 0, 0, 0],
                        [0, 0, 0, 0, 0, 0, 0],
                        [0, 0, 0, 0, 0, 0, 0]
                    ],
                    duracao_irrigacao: [10, 10, 10, 10, 10] // 🚨 ARRAY PARA 5 DURAÇÕES
                };
            }
            
            // Garantir que modo_automatico existe e é booleano
            if (typeof state.irrigation.modo_automatico === 'undefined') {
                state.irrigation.modo_automatico = state.irrigation.modo === 'automatico';
            }
            
            // 🚨 GARANTIR ESTRUTURAS MULTI-PROGRAMAÇÕES
            if (!state.irrigation.horarios_irrigacao) {
                state.irrigation.horarios_irrigacao = ["", "", "", "", ""];
            }
            if (!state.irrigation.dias_irrigacao) {
                state.irrigation.dias_irrigacao = [
                    [0, 1, 0, 1, 0, 1, 0],
                    [0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0]
                ];
            }
            if (!state.irrigation.duracao_irrigacao) {
                state.irrigation.duracao_irrigacao = [10, 10, 10, 10, 10];
            }
            
            // 🚨 CORREÇÃO CRÍTICA: Forçar bomba desligada ao carregar
            state.irrigation.bomba_irrigacao = false;
            
            return state;
        }
    } catch (error) {
        console.log('❌ Erro ao carregar estado:', error.message);
    }
    
    console.log('💾 Criando estado inicial COMPATÍVEL MULTI-PROGRAMAÇÕES');
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
            modo_automatico: false,
            horarios_irrigacao: ["", "", "", "", ""], // 🚨 5 HORÁRIOS
            dias_irrigacao: [ // 🚨 5 PROGRAMAÇÕES × 7 DIAS
                [0, 1, 0, 1, 0, 1, 0],
                [0, 0, 0, 0, 0, 0, 0],
                [0, 0, 0, 0, 0, 0, 0],
                [0, 0, 0, 0, 0, 0, 0],
                [0, 0, 0, 0, 0, 0, 0]
            ],
            duracao_irrigacao: [10, 10, 10, 10, 10] // 🚨 5 DURAÇÕES
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

// Sistema de irrigação automática MULTI-PROGRAMAÇÕES
let irrigationCheckInterval = null;
let activeIrrigationTimer = null;

function startIrrigationScheduler() {
    // Para qualquer intervalo existente
    if (irrigationCheckInterval) {
        clearInterval(irrigationCheckInterval);
    }
    
    // Verifica a cada 30 segundos
    irrigationCheckInterval = setInterval(() => {
        checkScheduledIrrigation();
    }, 30000);
    
    console.log('⏰ Agendador de irrigação MULTI-PROGRAMAÇÕES iniciado (verificação a cada 30 segundos)');
    
    // Verifica imediatamente ao iniciar
    setTimeout(() => {
        checkScheduledIrrigation();
    }, 2000);
}

function checkScheduledIrrigation() {
    const now = new Date();
    const currentTime = now.getHours().toString().padStart(2, '0') + ':' + 
                       now.getMinutes().toString().padStart(2, '0');
    const currentDay = getCurrentDayOfWeek();

    console.log(`💧 [${currentTime}] Verificando MULTI-PROGRAMAÇÕES...`);

    // Verificar se está no modo automático
    if (devicesState.irrigation.modo !== 'automatico') {
        console.log('💧 Modo não é automático, ignorando verificação');
        return;
    }

    // 🚨 VERIFICAR CADA UMA DAS 5 PROGRAMAÇÕES
    for (let progIndex = 0; progIndex < 5; progIndex++) {
        const horario = devicesState.irrigation.horarios_irrigacao[progIndex];
        
        // Pular programações vazias
        if (!horario || horario === "") {
            continue;
        }

        // Verificar se está no horário e dia correto
        const diaIndex = getDayIndex(currentDay);
        const diaAtivo = devicesState.irrigation.dias_irrigacao[progIndex][diaIndex];
        
        console.log(`💧 Prog ${progIndex + 1}: ${horario} - Dia ${currentDay}: ${diaAtivo ? 'ATIVO' : 'INATIVO'}`);
        
        if (horario === currentTime && diaAtivo) {
            console.log(`💧 ✅ PROGRAMAÇÃO ${progIndex + 1} ATIVADA!`);
            
            // Verificar se já está executando
            if (devicesState.irrigation.bomba_irrigacao) {
                console.log('💧 Bomba já está ligada, ignorando ativação duplicada');
                continue;
            }

            // Verificar condições climáticas se necessário
            if (devicesState.irrigation.evitar_chuva) {
                console.log('💧 Verificando se está chovendo...');
                isRaining().then(raining => {
                    if (!raining) {
                        console.log(`💧 ✅ Não está chovendo - Iniciando irrigação programada ${progIndex + 1}`);
                        startScheduledIrrigation(progIndex);
                    } else {
                        console.log('💧 ❌ Está chovendo - Irrigação cancelada');
                    }
                }).catch(error => {
                    console.log('💧 Erro ao verificar chuva, iniciando irrigação:', error);
                    startScheduledIrrigation(progIndex);
                });
            } else {
                console.log(`💧 ✅ Evitar chuva desativado - Iniciando programação ${progIndex + 1}`);
                startScheduledIrrigation(progIndex);
            }
            
            break; // Executa apenas uma programação por ciclo
        }
    }
}

function getCurrentDayOfWeek() {
    const days = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
    return days[new Date().getDay()];
}

function getDayIndex(dayName) {
    const days = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
    return days.indexOf(dayName);
}

function startScheduledIrrigation(programIndex) {
    console.log(`💧 🚀 INICIANDO IRRIGAÇÃO PROGRAMADA #${programIndex + 1}`);
    
    // Atualiza estado e salva
    devicesState.irrigation.bomba_irrigacao = true;
    saveState(devicesState);

    const duracao = devicesState.irrigation.duracao_irrigacao[programIndex] || 5;
    console.log(`⏰ Irrigação programada #${programIndex + 1} por ${duracao} minutos`);
    
    // Limpar timer anterior se existir
    if (activeIrrigationTimer) {
        clearTimeout(activeIrrigationTimer);
    }
    
    // Timer para desligar a bomba
    activeIrrigationTimer = setTimeout(() => {
        console.log(`💧 ⏹️ DESLIGANDO IRRIGAÇÃO PROGRAMADA #${programIndex + 1} após ${duracao} minutos`);
        
        // 🚨 CORREÇÃO CRÍTICA: Atualiza o estado no servidor também
        devicesState.irrigation.bomba_irrigacao = false;
        saveState(devicesState);
        console.log('💧 ✅ Estado da bomba atualizado para DESLIGADA no servidor');
        
        activeIrrigationTimer = null;
    }, duracao * 60 * 1000);
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

// Inicializar dados
let devicesState = loadState();

// Inicializar sistemas
function initializeSystems() {
    setInterval(checkESP32Connection, 60000);
    startIrrigationScheduler();
    console.log('✅ Sistemas inicializados: ESP32 + Irrigação Automática MULTI-PROGRAMAÇÕES');
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
        message: '🚀 Servidor Automação V3.0 MULTI-PROGRAMAÇÕES',
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
    console.log('💧 TESTE MANUAL: Verificando MULTI-PROGRAMAÇÕES...');
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
        duracao: devicesState.irrigation.duracao,
        horarios_irrigacao: devicesState.irrigation.horarios_irrigacao,
        dias_irrigacao: devicesState.irrigation.dias_irrigacao,
        duracao_irrigacao: devicesState.irrigation.duracao_irrigacao
    });
});

// ESP32 envia dados - CORREÇÃO CRÍTICA MULTI-PROGRAMAÇÕES
app.post('/api/data', (req, res) => {
    const { temperature, humidity, gas_level, gas_alert, device, heartbeat, wifi_rssi, irrigation_auto, irrigation_active } = req.body;

    console.log('📨 Dados recebidos do ESP32:', {
        temperature, humidity, gas_level, gas_alert, device, heartbeat, wifi_rssi, irrigation_auto, irrigation_active
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

    // 🚨 CORREÇÃO CRÍTICA: Sincronizar estado da bomba com o ESP32
    if (typeof irrigation_active !== 'undefined') {
        console.log('💧 Sincronizando estado da bomba com ESP32:', 
                   `Servidor: ${devicesState.irrigation.bomba_irrigacao} -> ESP32: ${irrigation_active}`);
        
        if (devicesState.irrigation.bomba_irrigacao !== irrigation_active) {
            devicesState.irrigation.bomba_irrigacao = irrigation_active;
            console.log('💧 ✅ Estado da bomba sincronizado com ESP32:', irrigation_active);
        }
    }

    // Atualizar modo de irrigação se enviado pelo ESP32
    if (typeof irrigation_auto !== 'undefined') {
        devicesState.irrigation.modo = irrigation_auto ? 'automatico' : 'manual';
        devicesState.irrigation.modo_automatico = irrigation_auto;
        console.log(`💧 Modo atualizado pelo ESP32: ${devicesState.irrigation.modo}`);
    }

    saveState(devicesState);

    const clientIP = req.ip || req.connection.remoteAddress;
    updateESP32Status(device, clientIP);

    console.log(`📊 Dados salvos - Temp: ${processedTemperature}°C, Umidade: ${processedHumidity}%, Gás: ${processedGasLevel}, Bomba: ${devicesState.irrigation.bomba_irrigacao ? 'LIGADA' : 'DESLIGADA'}`);
    
    res.json({ 
        status: 'OK', 
        message: heartbeat ? 'Heartbeat recebido!' : 'Dados salvos!',
        devices: devicesState
    });
});

// 🚨 CORREÇÃO CRÍTICA: ESP32 busca comandos - Estrutura MULTI-PROGRAMAÇÕES
app.get('/api/commands', (req, res) => {
    const clientIP = req.ip || req.connection.remoteAddress;
    updateESP32Status('ESP32-CASA-AUTOMACAO-V3', clientIP);
    
    console.log('📥 ESP32 solicitando comandos MULTI-PROGRAMAÇÕES');
    
    // 🚨 CORREÇÃO: Estrutura MULTI-PROGRAMAÇÕES que o ESP32 espera
    console.log('💧 Horários que serão enviados:', devicesState.irrigation.horarios_irrigacao);
    console.log('💧 Estado da bomba no servidor:', devicesState.irrigation.bomba_irrigacao ? 'LIGADA' : 'DESLIGADA');
    
    const response = {
        lights: devicesState.lights,
        outlets: devicesState.outlets,
        irrigation: {
            bomba_irrigacao: devicesState.irrigation.bomba_irrigacao,
            modo_automatico: devicesState.irrigation.modo === 'automatico',
            horarios_irrigacao: devicesState.irrigation.horarios_irrigacao, // 🚨 ARRAY COM 5 HORÁRIOS
            dias_irrigacao: devicesState.irrigation.dias_irrigacao, // 🚨 MATRIZ 5×7 DIAS
            duracao_irrigacao: devicesState.irrigation.duracao_irrigacao // 🚨 ARRAY COM 5 DURAÇÕES
        }
    };
    
    console.log('📤 Enviando para ESP32 - Bomba:', response.irrigation.bomba_irrigacao ? 'LIGADA' : 'DESLIGADA');
    console.log('📤 Programações ativas:', devicesState.irrigation.horarios_irrigacao.filter(h => h !== "").length);
    
    res.json(response);
});

// 🚨 CORREÇÃO: ESP32 confirma comandos - Estrutura MULTI-PROGRAMAÇÕES
app.post('/api/confirm', (req, res) => {
    console.log('✅ Confirmação MULTI-PROGRAMAÇÕES recebida do ESP32:', req.body);
    
    if (req.body.lights) {
        devicesState.lights = { ...devicesState.lights, ...req.body.lights };
    }
    if (req.body.outlets) {
        devicesState.outlets = { ...devicesState.outlets, ...req.body.outlets };
    }
    if (req.body.irrigation) {
        // 🚨 CORREÇÃO CRÍTICA: Sincronizar TODOS os dados do ESP32 MULTI-PROGRAMAÇÕES
        const espBombaEstado = req.body.irrigation.bomba_irrigacao || false;
        const espModoAuto = req.body.irrigation.modo_automatico || false;
        const espHorarios = req.body.irrigation.horarios_programados || [];
        const espExecutadas = req.body.irrigation.executadas_hoje || [];
        
        console.log('💧 Sincronizando MULTI-PROGRAMAÇÕES com ESP32:', {
            bomba: `Servidor: ${devicesState.irrigation.bomba_irrigacao} -> ESP32: ${espBombaEstado}`,
            modo: `Servidor: ${devicesState.irrigation.modo} -> ESP32: ${espModoAuto ? 'automatico' : 'manual'}`,
            horarios: `Recebidos ${espHorarios.length} horários do ESP32`
        });
        
        // Sincronizar estado da bomba
        if (devicesState.irrigation.bomba_irrigacao !== espBombaEstado) {
            devicesState.irrigation.bomba_irrigacao = espBombaEstado;
            console.log('💧 ✅ Bomba sincronizada:', espBombaEstado ? 'LIGADA' : 'DESLIGADA');
        }
        
        // Sincronizar modo
        devicesState.irrigation.modo = espModoAuto ? 'automatico' : 'manual';
        devicesState.irrigation.modo_automatico = espModoAuto;
        
        // 🚨 Sincronizar horários múltiplos
        if (Array.isArray(espHorarios)) {
            for (let i = 0; i < 5 && i < espHorarios.length; i++) {
                if (espHorarios[i] && espHorarios[i] !== devicesState.irrigation.horarios_irrigacao[i]) {
                    devicesState.irrigation.horarios_irrigacao[i] = espHorarios[i];
                    console.log(`💧 ✅ Horário ${i + 1} sincronizado:`, espHorarios[i]);
                }
            }
        }
    }
    
    saveState(devicesState);
    
    res.json({ 
        status: 'OK', 
        message: 'Confirmação MULTI-PROGRAMAÇÕES recebida',
        timestamp: new Date().toISOString()
    });
});

// ESP32 busca dispositivos
app.get('/api/devices', (req, res) => {
    const clientIP = req.ip || req.connection.remoteAddress;
    updateESP32Status('ESP32-CASA-AUTOMACAO-V3', clientIP);
    
    console.log('📡 ESP32 solicitando estados dos dispositivos MULTI-PROGRAMAÇÕES');
    
    res.json({
        lights: devicesState.lights,
        outlets: devicesState.outlets,
        irrigation: {
            bomba_irrigacao: devicesState.irrigation.bomba_irrigacao,
            modo: devicesState.irrigation.modo,
            evitar_chuva: devicesState.irrigation.evitar_chuva,
            duracao: devicesState.irrigation.duracao || 5,
            programacoes: devicesState.irrigation.programacoes || [],
            horarios_irrigacao: devicesState.irrigation.horarios_irrigacao || ["", "", "", "", ""],
            dias_irrigacao: devicesState.irrigation.dias_irrigacao || [],
            duracao_irrigacao: devicesState.irrigation.duracao_irrigacao || [10, 10, 10, 10, 10]
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

// 🚨 CORREÇÃO COMPLETA: Salvar configurações de irrigação MULTI-PROGRAMAÇÕES
app.post('/api/irrigation/save', (req, res) => {
    try {
        const { modo, programacoes, evitar_chuva, duracao, horarios_irrigacao, dias_irrigacao, duracao_irrigacao } = req.body;
        
        console.log('💧 Salvando configurações MULTI-PROGRAMAÇÕES de irrigação:', { 
            modo, 
            programacoes: programacoes?.length || 0, 
            evitar_chuva, 
            duracao,
            horarios_irrigacao: horarios_irrigacao?.length || 0,
            dias_irrigacao: dias_irrigacao?.length || 0,
            duracao_irrigacao: duracao_irrigacao?.length || 0
        });
        
        // 🚨 CORREÇÃO: Manter sincronia entre modo e modo_automatico
        devicesState.irrigation.modo = modo || 'manual';
        devicesState.irrigation.programacoes = Array.isArray(programacoes) ? programacoes : [];
        devicesState.irrigation.evitar_chuva = evitar_chuva !== false;
        devicesState.irrigation.duracao = parseInt(duracao) || 5;
        devicesState.irrigation.modo_automatico = modo === 'automatico';
        
        // 🚨 CORREÇÃO CRÍTICA: Salvar MULTI-PROGRAMAÇÕES
        if (Array.isArray(horarios_irrigacao)) {
            for (let i = 0; i < 5 && i < horarios_irrigacao.length; i++) {
                if (horarios_irrigacao[i] && horarios_irrigacao[i] !== "0:00") {
                    console.log(`💧 Horário ${i + 1} recebido para salvar:`, horarios_irrigacao[i]);
                    // Garantir que está no formato HH:MM
                    if (typeof horarios_irrigacao[i] === 'string' && horarios_irrigacao[i].includes(':')) {
                        const [hora, minutos] = horarios_irrigacao[i].split(':');
                        if (hora && minutos) {
                            devicesState.irrigation.horarios_irrigacao[i] = horarios_irrigacao[i];
                            console.log(`💧 Horário ${i + 1} salvo com sucesso:`, devicesState.irrigation.horarios_irrigacao[i]);
                        }
                    }
                } else {
                    devicesState.irrigation.horarios_irrigacao[i] = "";
                }
            }
        }
        
        // 🚨 SALVAR DIAS MULTIPLOS
        if (Array.isArray(dias_irrigacao)) {
            for (let i = 0; i < 5 && i < dias_irrigacao.length; i++) {
                if (Array.isArray(dias_irrigacao[i])) {
                    for (let j = 0; j < 7 && j < dias_irrigacao[i].length; j++) {
                        devicesState.irrigation.dias_irrigacao[i][j] = dias_irrigacao[i][j] ? 1 : 0;
                    }
                }
            }
        }
        
        // 🚨 SALVAR DURAÇÕES MÚLTIPLAS
        if (Array.isArray(duracao_irrigacao)) {
            for (let i = 0; i < 5 && i < duracao_irrigacao.length; i++) {
                if (duracao_irrigacao[i] > 0) {
                    devicesState.irrigation.duracao_irrigacao[i] = duracao_irrigacao[i];
                }
            }
        }
        
        saveState(devicesState);
        
        // Reiniciar agendador
        startIrrigationScheduler();
        
        console.log('✅ Configurações MULTI-PROGRAMAÇÕES de irrigação salvas');
        console.log('🕒 Horários de irrigação SALVOS:', devicesState.irrigation.horarios_irrigacao.filter(h => h !== "").length + ' ativos');
        
        res.json({ 
            status: 'OK', 
            message: 'Configurações MULTI-PROGRAMAÇÕES salvas',
            savedData: devicesState.irrigation
        });
    } catch (error) {
        console.error('❌ Erro ao salvar configurações MULTI-PROGRAMAÇÕES de irrigação:', error);
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
    console.log(`\n🔥 Servidor Automação V3.0 MULTI-PROGRAMAÇÕES rodando na porta ${PORT}`);
    console.log(`🌐 Acesse: http://localhost:${PORT}`);
    console.log('📡 Monitoramento ESP32: ATIVADO');
    console.log('💧 Sistema de Irrigação: MULTI-PROGRAMAÇÕES (5 programações)');
    console.log('🔐 Sistema de Login: FUNCIONANDO');
    console.log('📊 Sensores: FUNCIONANDO');
    console.log('🔧 ESP32: COMUNICAÇÃO MULTI-PROGRAMAÇÕES ESTÁVEL\n');
});
