const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const cookieParser = require('cookie-parser');
const fetch = require('node-fetch');
const webpush = require('web-push');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Configurações Web Push (VAPID) - USE SUAS CHAVES
const vapidKeys = {
  publicKey: process.env.VAPID_PUBLIC_KEY || 'BEl62iUYb3e2kEuFw_3rKWj0eO6q5eXyVWjKdXqoY3jz1JhLmZpYqXqoY3jz1JhLmZpYqXqoY3jz1JhLmZpYq',
  privateKey: process.env.VAPID_PRIVATE_KEY || 'q1w2e3r4t5y6u7i8o9p0a1s2d3f4g5h6j7k8l9z0x1c2v3b4n5m6'
};

webpush.setVapidDetails(
  'mailto:admin@casaautomacao.com',
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

// Armazenamento de subscriptions
let pushSubscriptions = [];

// Sistema de alertas de gás
let gasAlertHistory = [];
let activeGasAlerts = {
  warning: false,
  critical: false
};

// CORS configurado para permitir cookies
app.use(cors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Device-ID', 'X-Device-Type']
}));

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));

// Servir arquivos estáticos ANTES da autenticação
app.use(express.static('public'));

// Arquivo para persistência
const STATE_FILE = 'devices-state.json';
const SUBSCRIPTIONS_FILE = 'push-subscriptions.json';

// Monitoramento de conexão ESP32
let esp32Status = {
    connected: false,
    lastSeen: null,
    deviceId: null,
    ipAddress: null,
    lastHeartbeat: null
};

// 🔥 CORREÇÃO: Carregar subscriptions salvas
function loadSubscriptions() {
    try {
        if (fs.existsSync(SUBSCRIPTIONS_FILE)) {
            const data = fs.readFileSync(SUBSCRIPTIONS_FILE, 'utf8');
            const subscriptions = JSON.parse(data);
            pushSubscriptions = subscriptions;
            console.log(`📱 ${subscriptions.length} subscriptions carregadas do arquivo`);
        }
    } catch (error) {
        console.log('❌ Erro ao carregar subscriptions:', error.message);
        pushSubscriptions = [];
    }
}

// 🔥 CORREÇÃO: Salvar subscriptions
function saveSubscriptions() {
    try {
        fs.writeFileSync(SUBSCRIPTIONS_FILE, JSON.stringify(pushSubscriptions, null, 2));
        console.log(`💾 ${pushSubscriptions.length} subscriptions salvas`);
        return true;
    } catch (error) {
        console.error('❌ Erro ao salvar subscriptions:', error);
        return false;
    }
}

// Carregar estado salvo
function loadState() {
    try {
        if (fs.existsSync(STATE_FILE)) {
            const data = fs.readFileSync(STATE_FILE, 'utf8');
            console.log('💾 Estado carregado do arquivo');
            const state = JSON.parse(data);
            
            if (!state.irrigation) {
                state.irrigation = {
                    bomba_irrigacao: false,
                    modo: 'manual',
                    programacoes: [],
                    evitar_chuva: true,
                    duracao: 5,
                    modo_automatico: false,
                    horario_irrigacao: ""
                };
            }
            
            if (typeof state.irrigation.modo_automatico === 'undefined') {
                state.irrigation.modo_automatico = state.irrigation.modo === 'automatico';
            }
            
            if (!state.irrigation.horario_irrigacao) {
                state.irrigation.horario_irrigacao = "";
            }
            
            state.irrigation.bomba_irrigacao = false;
            
            return state;
        }
    } catch (error) {
        console.log('❌ Erro ao carregar estado:', error.message);
    }
    
    console.log('💾 Criando estado inicial COMPATÍVEL');
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
            horario_irrigacao: ""
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

// 🔥 CORREÇÃO CRÍTICA: Enviar notificação push com tratamento robusto
async function sendPushNotification(subscription, payload) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            console.log('⏰ Timeout na notificação push');
            reject(new Error('Timeout ao enviar notificação'));
        }, 10000);

        console.log('📤 Enviando notificação push para:', subscription.endpoint.substring(0, 50) + '...');
        
        webpush.sendNotification(subscription, JSON.stringify(payload))
            .then(response => {
                clearTimeout(timeout);
                console.log('✅ Notificação push enviada com sucesso');
                resolve(response);
            })
            .catch(error => {
                clearTimeout(timeout);
                console.error('❌ Erro ao enviar notificação push:', error);
                
                // Remover subscription inválida
                if (error.statusCode === 410 || error.statusCode === 404) {
                    console.log('🗑️ Removendo subscription expirada/inválida');
                    pushSubscriptions = pushSubscriptions.filter(sub => 
                        sub.endpoint !== subscription.endpoint
                    );
                    saveSubscriptions();
                }
                reject(error);
            });
    });
}

// 🔥 CORREÇÃO: Enviar alerta de gás para todos os dispositivos
async function sendGasAlert(gasLevel, alertType) {
    const alertMessages = {
        warning: {
            title: '⚠️ Alerta de Gás - Nível Elevado',
            body: `Nível de gás detectado: ${gasLevel}. Verifique possíveis vazamentos.`,
            alertType: 'gas_warning',
            critical: false
        },
        critical: {
            title: '🚨 ALERTA CRÍTICO DE GÁS',
            body: `NÍVEL PERIGOSO: ${gasLevel}! EVACUAR ÁREA E CHAMAR BOMBEIROS!`,
            alertType: 'gas_critical',
            critical: true
        }
    };

    const alert = alertMessages[alertType];
    if (!alert) return;

    const payload = {
        title: alert.title,
        body: alert.body,
        icon: '/icons/icon-192x192.png',
        image: '/icons/alert-gas-512x512.png',
        badge: '/icons/badge-72x72.png',
        vibrate: [1000, 500, 1000, 500, 1000],
        requireInteraction: true,
        timestamp: new Date().toISOString(),
        gasLevel: gasLevel,
        alertType: alert.alertType,
        critical: alert.critical,
        url: '/index.html'
    };

    console.log(`🚨 Enviando alerta de gás (${alertType}): ${gasLevel} para ${pushSubscriptions.length} dispositivos`);

    // Registrar no histórico
    gasAlertHistory.unshift({
        type: alertType,
        level: gasLevel,
        timestamp: new Date(),
        message: alert.body,
        sentTo: pushSubscriptions.length
    });

    // Manter apenas últimos 100 alertas
    if (gasAlertHistory.length > 100) {
        gasAlertHistory = gasAlertHistory.slice(0, 100);
    }

    // Atualizar estado do alerta ativo
    activeGasAlerts[alertType] = true;

    // Enviar para todas as subscriptions com tratamento individual
    const sendPromises = pushSubscriptions.map((subscription, index) => 
        sendPushNotification(subscription, payload)
            .then(() => {
                console.log(`✅ Notificação ${index + 1} enviada com sucesso`);
                return { success: true, index };
            })
            .catch(error => {
                console.error(`❌ Falha na notificação ${index + 1}:`, error.message);
                return { success: false, index, error: error.message };
            })
    );

    const results = await Promise.all(sendPromises);
    
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    
    console.log(`📊 Resultado do envio: ${successful} sucesso, ${failed} falhas`);
    
    return {
        total: pushSubscriptions.length,
        successful,
        failed,
        results
    };
}

// 🔥 CORREÇÃO: Gerenciar subscriptions existentes
function managePushSubscription(newSubscription) {
    if (!newSubscription || !newSubscription.endpoint) {
        return { error: 'Subscription inválida' };
    }

    // Verificar se já existe uma subscription com o mesmo endpoint
    const existingIndex = pushSubscriptions.findIndex(sub => 
        sub.endpoint === newSubscription.endpoint
    );

    if (existingIndex !== -1) {
        console.log('🔄 Atualizando subscription existente');
        // Atualizar a subscription existente
        pushSubscriptions[existingIndex] = newSubscription;
        saveSubscriptions();
        return { 
            status: 'UPDATED', 
            message: 'Subscription atualizada',
            totalSubscriptions: pushSubscriptions.length
        };
    } else {
        console.log('✅ Nova subscription adicionada');
        // Adicionar nova subscription
        pushSubscriptions.push(newSubscription);
        saveSubscriptions();
        return { 
            status: 'CREATED', 
            message: 'Nova subscription criada',
            totalSubscriptions: pushSubscriptions.length
        };
    }
}

// Função para verificar e enviar alertas de gás
function checkGasAlerts(gasLevel) {
    // Limpar alertas anteriores se o nível voltou ao normal
    if (gasLevel <= 300) {
        if (activeGasAlerts.warning || activeGasAlerts.critical) {
            console.log('✅ Nível de gás normalizado');
            activeGasAlerts.warning = false;
            activeGasAlerts.critical = false;
        }
        return;
    }

    // Verificar se já existe um alerta ativo para evitar spam
    const now = new Date();
    const lastAlert = gasAlertHistory[0];
    const timeSinceLastAlert = lastAlert ? now - new Date(lastAlert.timestamp) : Infinity;

    // Alerta crítico (acima de 500)
    if (gasLevel > 500 && !activeGasAlerts.critical && timeSinceLastAlert > 30000) {
        sendGasAlert(gasLevel, 'critical');
    }
    // Alerta de aviso (acima de 300)
    else if (gasLevel > 300 && !activeGasAlerts.warning && timeSinceLastAlert > 60000) {
        sendGasAlert(gasLevel, 'warning');
    }
}

// Sistema de irrigação automática
let irrigationCheckInterval = null;
let activeIrrigationTimer = null;

function startIrrigationScheduler() {
    if (irrigationCheckInterval) {
        clearInterval(irrigationCheckInterval);
    }
    
    irrigationCheckInterval = setInterval(() => {
        checkScheduledIrrigation();
    }, 30000);
    
    console.log('⏰ Agendador de irrigação iniciado (verificação a cada 30 segundos)');
    
    setTimeout(() => {
        checkScheduledIrrigation();
    }, 2000);
}

function checkScheduledIrrigation() {
    const now = new Date();
    const currentTime = now.getHours().toString().padStart(2, '0') + ':' + 
                       now.getMinutes().toString().padStart(2, '0');
    const currentDay = getCurrentDayOfWeek();

    console.log(`💧 [${currentTime}] Verificando programações...`);

    if (devicesState.irrigation.modo !== 'automatico') {
        console.log('💧 Modo não é automático, ignorando verificação');
        return;
    }

    const programacoes = devicesState.irrigation.programacoes || [];
    
    console.log(`💧 Programações configuradas: ${programacoes.length}`);
    
    if (programacoes.length === 0) {
        console.log('💧 Nenhuma programação configurada');
        return;
    }

    let foundActiveSchedules = [];
    
    programacoes.forEach((prog, index) => {
        console.log(`💧 Verificando programação ${index + 1}: ${prog.hora} - Dias: ${prog.dias.join(', ')}`);
        
        if (prog.hora === currentTime && prog.dias.includes(currentDay)) {
            foundActiveSchedules.push({ index, prog });
            console.log(`💧 ✅ PROGRAMação ${index + 1} ATIVADA!`);
        }
    });

    if (foundActiveSchedules.length > 0) {
        console.log(`💧 🎯 Encontradas ${foundActiveSchedules.length} programações ativas!`);
        
        foundActiveSchedules.forEach(({ index, prog }) => {
            console.log(`💧 🚀 PROCESSANDO programação ${index + 1}: ${prog.hora}`);
            
            if (devicesState.irrigation.bomba_irrigacao) {
                console.log('💧 Bomba já está ligada, ignorando ativação duplicada');
                return;
            }

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
                    console.log('💧 Erro ao verificar chuva, iniciando irrigação:', error);
                    startScheduledIrrigation(index);
                });
            } else {
                console.log('💧 ✅ Evitar chuva desativado - Iniciando irrigação');
                startScheduledIrrigation(index);
            }
        });
    } else {
        console.log('💧 Nenhuma programação ativa no momento');
    }
}

function getCurrentDayOfWeek() {
    const days = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
    return days[new Date().getDay()];
}

function startScheduledIrrigation(programIndex) {
    console.log(`💧 🚀 INICIANDO IRRIGAÇÃO PROGRAMADA #${programIndex + 1}`);
    
    devicesState.irrigation.bomba_irrigacao = true;
    saveState(devicesState);

    const duracao = devicesState.irrigation.duracao || 5;
    console.log(`⏰ Irrigação programada por ${duracao} minutos`);
    
    if (activeIrrigationTimer) {
        clearTimeout(activeIrrigationTimer);
    }
    
    activeIrrigationTimer = setTimeout(() => {
        console.log(`💧 ⏹️ DESLIGANDO IRRIGAÇÃO PROGRAMADA #${programIndex + 1} após ${duracao} minutos`);
        
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

// Converter programações do frontend para formato ESP32
function converterProgramacoesParaESP32(programacoesFrontend) {
    console.log('🔄 Convertendo programações do frontend para ESP32...');
    
    const programacoesESP32 = [];
    const programacoesLimitadas = programacoesFrontend.slice(0, 4);
    
    programacoesLimitadas.forEach((prog, index) => {
        programacoesESP32.push({
            hora: prog.hora || "08:00",
            duracao: prog.duracao || 5,
            dias: prog.dias || []
        });
        console.log(`   ✅ Programação ${index + 1}: ${prog.hora} - Dias: ${prog.dias?.join(', ') || 'nenhum'}`);
    });

    console.log(`📋 Total de programações convertidas: ${programacoesESP32.length}`);
    return programacoesESP32;
}

// Inicializar dados
let devicesState = loadState();
loadSubscriptions(); // 🔥 CARREGAR SUBSCRIPTIONS AO INICIAR

// Inicializar sistemas
function initializeSystems() {
    setInterval(checkESP32Connection, 60000);
    startIrrigationScheduler();
    console.log('✅ Sistemas inicializados: ESP32 + Irrigação Automática');
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
        '/api/push/subscribe',
        '/api/push/unsubscribe',
        '/api/push/vapid-public-key',
        '/api/push/test',
        '/api/push/disable',
        '/api/push/status',
        '/api/alerts/history',
        '/health',
        '/favicon.ico',
        '/styles.css',
        '/script.js',
        '/sw.js',
        '/manifest.json',
        '/icons/*'
    ];

    if (publicRoutes.includes(req.path) || req.path.startsWith('/icons/')) {
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
        esp32: { connected: espConnected },
        pushSubscriptions: pushSubscriptions.length,
        pushEnabled: pushSubscriptions.length > 0
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
        duracao: devicesState.irrigation.duracao,
        horario_irrigacao: devicesState.irrigation.horario_irrigacao
    });
});

// ==================== SISTEMA DE NOTIFICAÇÕES PUSH CORRIGIDO ====================

// Rota para salvar subscription push
app.post('/api/push/subscribe', (req, res) => {
    const subscription = req.body;
    
    if (!subscription || !subscription.endpoint) {
        return res.status(400).json({ error: 'Subscription inválida' });
    }

    const result = managePushSubscription(subscription);
    
    console.log(`📱 Subscription ${result.status}. Total: ${pushSubscriptions.length}`);

    res.json(result);
});

// 🔥 CORREÇÃO CRÍTICA: Nova rota para desativar notificações push
app.post('/api/push/disable', async (req, res) => {
    try {
        const { endpoint } = req.body;
        
        console.log('🔕 Solicitando desativação de notificações push:', endpoint);
        
        if (endpoint === 'all') {
            console.log('🔕 Desativando TODAS as notificações push');
            const previousCount = pushSubscriptions.length;
            
            // Limpar todas as subscriptions do servidor
            pushSubscriptions = [];
            const saveResult = saveSubscriptions();
            
            if (saveResult) {
                console.log(`✅ ${previousCount} subscriptions removidas com sucesso`);
                res.json({ 
                    status: 'OK', 
                    message: `Todas as notificações push desativadas (${previousCount} removidas)`,
                    removed: previousCount,
                    pushEnabled: false
                });
            } else {
                console.error('❌ Erro ao salvar estado após desativação');
                res.status(500).json({ 
                    error: 'Erro ao salvar estado das notificações' 
                });
            }
        } else if (endpoint) {
            // Remover subscription específica
            const initialCount = pushSubscriptions.length;
            pushSubscriptions = pushSubscriptions.filter(sub => sub.endpoint !== endpoint);
            const removedCount = initialCount - pushSubscriptions.length;
            saveSubscriptions();
            
            console.log(`✅ ${removedCount} subscription específica removida`);
            res.json({ 
                status: 'OK', 
                message: 'Notificações push desativadas para este dispositivo',
                removed: removedCount,
                pushEnabled: pushSubscriptions.length > 0
            });
        } else {
            res.status(400).json({ error: 'Endpoint não especificado' });
        }
    } catch (error) {
        console.error('❌ Erro ao desativar notificações:', error);
        res.status(500).json({ error: 'Erro interno ao desativar notificações: ' + error.message });
    }
});

// Rota para obter chave pública VAPID
app.get('/api/push/vapid-public-key', (req, res) => {
    res.json({ publicKey: vapidKeys.publicKey });
});

// Rota para testar notificação push
app.post('/api/push/test', async (req, res) => {
    try {
        if (pushSubscriptions.length === 0) {
            return res.status(400).json({ 
                error: 'Nenhum dispositivo inscrito para notificações push' 
            });
        }

        const payload = {
            title: '🔔 Teste de Notificação Push',
            body: 'Esta é uma notificação de teste do sistema de automação! Funcionando perfeitamente! 🎉',
            icon: '/icons/icon-192x192.png',
            badge: '/icons/badge-72x72.png',
            image: '/icons/alert-gas-512x512.png',
            vibrate: [200, 100, 200, 100, 200],
            requireInteraction: true,
            timestamp: new Date().toISOString(),
            url: '/index.html',
            alertType: 'test'
        };

        console.log(`📤 Enviando notificação de teste para ${pushSubscriptions.length} dispositivos`);

        const results = await Promise.all(
            pushSubscriptions.map((subscription, index) => 
                sendPushNotification(subscription, payload)
                    .then(() => ({ success: true, index }))
                    .catch(error => ({ success: false, index, error: error.message }))
            )
        );

        const successful = results.filter(r => r.success).length;
        
        res.json({ 
            status: 'OK', 
            message: `Notificação de teste enviada para ${successful}/${pushSubscriptions.length} dispositivos`,
            results: results,
            pushEnabled: pushSubscriptions.length > 0
        });
    } catch (error) {
        console.error('❌ Erro ao enviar notificação de teste:', error);
        res.status(500).json({ error: 'Erro ao enviar notificação de teste: ' + error.message });
    }
});

// Rota para verificar status das notificações
app.get('/api/push/status', (req, res) => {
    res.json({
        pushEnabled: pushSubscriptions.length > 0,
        totalSubscriptions: pushSubscriptions.length,
        vapidPublicKey: vapidKeys.publicKey ? 'Configurada' : 'Não configurada'
    });
});

// Rota para histórico de alertas
app.get('/api/alerts/history', (req, res) => {
    res.json({
        alerts: gasAlertHistory.slice(0, 20),
        activeAlerts: activeGasAlerts,
        totalSubscriptions: pushSubscriptions.length,
        pushEnabled: pushSubscriptions.length > 0
    });
});

// Rota para forçar alerta de gás (apenas para testes)
app.post('/api/alerts/test-gas', async (req, res) => {
    const { level = 450, type = 'warning' } = req.body;
    
    if (!['warning', 'critical'].includes(type)) {
        return res.status(400).json({ error: 'Tipo de alerta inválido' });
    }

    if (pushSubscriptions.length === 0) {
        return res.status(400).json({ 
            error: 'Nenhum dispositivo inscrito para notificações push' 
        });
    }

    try {
        const results = await sendGasAlert(level, type);
        res.json({ 
            status: 'OK', 
            message: `Alerta de gás ${type} enviado`,
            level: level,
            results: results
        });
    } catch (error) {
        console.error('❌ Erro ao enviar alerta de teste:', error);
        res.status(500).json({ error: 'Erro ao enviar alerta de teste: ' + error.message });
    }
});

// ESP32 envia dados
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

    // 🚨 SISTEMA DE ALERTAS DE GÁS - Verificar e enviar notificações
    if (processedGasLevel > 300) {
        console.log(`🚨 Nível de gás elevado detectado: ${processedGasLevel}`);
        checkGasAlerts(processedGasLevel);
    } else {
        // Limpar alertas se o nível voltou ao normal
        if (activeGasAlerts.warning || activeGasAlerts.critical) {
            console.log('✅ Nível de gás normalizado');
            activeGasAlerts.warning = false;
            activeGasAlerts.critical = false;
        }
    }

    // Sincronizar estado da bomba com o ESP32
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
        devices: devicesState,
        gas_alert: processedGasLevel > 300
    });
});

// ESP32 busca comandos
app.get('/api/commands', (req, res) => {
    const clientIP = req.ip || req.connection.remoteAddress;
    updateESP32Status('ESP32-CASA-AUTOMACAO-V3', clientIP);
    
    console.log('📥 ESP32 solicitando comandos');
    
    // Converter programações do frontend para formato ESP32
    const programacoesESP32 = converterProgramacoesParaESP32(devicesState.irrigation.programacoes || []);
    
    console.log('💧 Programações que serão enviadas para ESP32:');
    programacoesESP32.forEach((prog, index) => {
        console.log(`   ${index + 1}. ${prog.hora} - ${prog.duracao}min - Dias: ${prog.dias.join(', ')}`);
    });
    
    const response = {
        lights: devicesState.lights,
        outlets: devicesState.outlets,
        irrigation: {
            bomba_irrigacao: devicesState.irrigation.bomba_irrigacao,
            modo_automatico: devicesState.irrigation.modo === 'automatico',
            horario_irrigacao: devicesState.irrigation.horario_irrigacao || "",
            duracao: devicesState.irrigation.duracao || 5,
            programacoes: programacoesESP32
        }
    };
    
    console.log('📤 Enviando para ESP32 - Bomba:', response.irrigation.bomba_irrigacao ? 'LIGADA' : 'DESLIGADA');
    console.log('📤 Programações enviadas:', programacoesESP32.length);
    
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
        // Sincronizar TODOS os dados do ESP32
        const espBombaEstado = req.body.irrigation.bomba_irrigacao || false;
        const espModoAuto = req.body.irrigation.modo_automatico || false;
        const espHorario = req.body.irrigation.horario_programado || "";
        
        console.log('💧 Sincronizando com ESP32:', {
            bomba: `Servidor: ${devicesState.irrigation.bomba_irrigacao} -> ESP32: ${espBombaEstado}`,
            modo: `Servidor: ${devicesState.irrigation.modo} -> ESP32: ${espModoAuto ? 'automatico' : 'manual'}`,
            horario: `Servidor: ${devicesState.irrigation.horario_irrigacao} -> ESP32: ${espHorario}`
        });
        
        // Sincronizar estado da bomba
        if (devicesState.irrigation.bomba_irrigacao !== espBombaEstado) {
            devicesState.irrigation.bomba_irrigacao = espBombaEstado;
            console.log('💧 ✅ Bomba sincronizada:', espBombaEstado ? 'LIGADA' : 'DESLIGADA');
        }
        
        // Sincronizar modo
        devicesState.irrigation.modo = espModoAuto ? 'automatico' : 'manual';
        devicesState.irrigation.modo_automatico = espModoAuto;
        
        // Sincronizar horário
        if (espHorario && espHorario !== devicesState.irrigation.horario_irrigacao) {
            devicesState.irrigation.horario_irrigacao = espHorario;
            console.log('💧 ✅ Horário sincronizado:', espHorario);
        }
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
            programacoes: devicesState.irrigation.programacoes || [],
            horario_irrigacao: devicesState.irrigation.horario_irrigacao || ""
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
        const { modo, programacoes, evitar_chuva, duracao, horario_irrigacao } = req.body;
        
        console.log('💧 Salvando configurações de irrigação:', { 
            modo, 
            programacoes: programacoes?.length || 0, 
            evitar_chuva, 
            duracao,
            horario_irrigacao 
        });
        
        // Manter sincronia entre modo e modo_automatico
        devicesState.irrigation.modo = modo || 'manual';
        devicesState.irrigation.programacoes = Array.isArray(programacoes) ? programacoes : [];
        devicesState.irrigation.evitar_chuva = evitar_chuva !== false;
        devicesState.irrigation.duracao = parseInt(duracao) || 5;
        devicesState.irrigation.modo_automatico = modo === 'automatico';
        
        // Salvar horário CORRETAMENTE
        if (horario_irrigacao && horario_irrigacao !== "0:00") {
            console.log('💧 Horário recebido para salvar:', horario_irrigacao);
            // Garantir que está no formato HH:MM
            if (typeof horario_irrigacao === 'string' && horario_irrigacao.includes(':')) {
                const [hora, minutos] = horario_irrigacao.split(':');
                if (hora && minutos) {
                    devicesState.irrigation.horario_irrigacao = horario_irrigacao;
                    console.log('💧 Horário salvo com sucesso:', devicesState.irrigation.horario_irrigacao);
                }
            }
        } else {
            // Se não recebeu horário, usar o primeiro horário das programações
            if (programacoes && programacoes.length > 0 && programacoes[0].hora) {
                devicesState.irrigation.horario_irrigacao = programacoes[0].hora;
                console.log('💧 Usando horário da primeira programação:', devicesState.irrigation.horario_irrigacao);
            } else {
                // Manter o horário atual se não houver programações
                console.log('💧 Mantendo horário atual:', devicesState.irrigation.horario_irrigacao);
            }
        }
        
        saveState(devicesState);
        
        // Reiniciar agendador
        startIrrigationScheduler();
        
        console.log('✅ Configurações de irrigação salvas - modo_automatico:', devicesState.irrigation.modo_automatico);
        console.log('🕒 Horário de irrigação SALVO:', devicesState.irrigation.horario_irrigacao);
        
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
        esp32: { connected: esp32Status.connected },
        pushSubscriptions: pushSubscriptions.length,
        pushEnabled: pushSubscriptions.length > 0,
        version: '3.0.0-push-fixed'
    });
});

// 404 handler
app.use((req, res) => {
    console.log('❌ Rota não encontrada:', req.path);
    res.status(404).json({ error: 'Rota não encontrada' });
});

app.listen(PORT, () => {
    console.log(`\n🔥 Servidor Automação V3.0 CORRIGIDO rodando na porta ${PORT}`);
    console.log(`🌐 Acesse: http://localhost:${PORT}`);
    console.log(`📡 Monitoramento ESP32: ATIVADO`);
    console.log(`💧 Sistema de Irrigação: SINCRONIZAÇÃO COMPLETA`);
    console.log(`🔔 Sistema de Notificações Push: CORRIGIDO E FUNCIONANDO`);
    console.log(`🚨 Alertas de Gás: FUNCIONANDO COM NAVEGADOR FECHADO`);
    console.log(`🔐 Sistema de Login: FUNCIONANDO`);
    console.log(`📊 Sensores: FUNCIONANDO`);
    console.log(`📱 Notificações Push: ${pushSubscriptions.length} dispositivos registrados`);
    console.log(`🔕 Sistema de Desativação: IMPLEMENTADO\n`);
});
