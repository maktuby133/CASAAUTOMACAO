const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const cookieParser = require('cookie-parser');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Credenciais de Login (Puxando de .env para segurança)
const VALID_USERNAME = process.env.DEFAULT_USERNAME || 'admin';
const VALID_PASSWORD = process.env.DEFAULT_PASSWORD || 'admin123';
const ESP32_API_KEY = process.env.ESP32_API_KEY || 'casa-automacao-2024-secret-key';


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

let devicesState = loadState();

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

// Verificar se ESP32 está conectado (120 segundos de timeout)
function checkESP32Connection() {
    if (esp32Status.lastHeartbeat) {
        const timeSinceLastHeartbeat = new Date() - esp32Status.lastHeartbeat;
        if (timeSinceLastHeartbeat > 120000) {
            esp32Status.connected = false;
        }
    }
    return esp32Status.connected;
}

// ==================== AGENDAMENTO IRRIGAÇÃO ====================

function startIrrigationScheduler() {
    // 1 minuto de intervalo
    setInterval(() => {
        checkScheduledIrrigation();
    }, 60000); 
    console.log('⏰ Agendador de irrigação iniciado');
}

function getCurrentDayOfWeek() {
    // Retorna o dia em português (ex: seg, ter, etc.)
    const days = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB'];
    return days[new Date().getDay()];
}

async function isRaining() {
    try {
        const weatherData = await fetchWeatherData();
        if (weatherData && weatherData.weather && weatherData.weather.length > 0) {
            // Verifica se a descrição do clima inclui "rain" ou "chuva"
            const mainWeather = weatherData.weather[0].main.toLowerCase();
            const description = weatherData.weather[0].description.toLowerCase();
            return mainWeather.includes('rain') || description.includes('chuva');
        }
        return false;
    } catch (error) {
        console.error('❌ Falha ao verificar se está chovendo:', error);
        return false; // Em caso de erro, assume que não está chovendo para evitar bloqueio
    }
}


function checkScheduledIrrigation() {
    if (devicesState.irrigation.modo !== 'automatico') {
        return;
    }

    const now = new Date();
    // Formato HH:MM
    const currentTime = now.getHours().toString().padStart(2, '0') + ':' + 
                       now.getMinutes().toString().padStart(2, '0');
    const currentDay = getCurrentDayOfWeek();

    const programacoes = devicesState.irrigation.programacoes || [];
    programacoes.forEach((prog, index) => {
        if (prog.hora === currentTime && prog.dias.includes(currentDay)) {
            console.log(`💧 Programação ${index + 1} ativada: ${prog.hora} - ${prog.dias.join(',')}`);
            
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

function startScheduledIrrigation(programIndex) {
    if (devicesState.irrigation.bomba_irrigacao) {
        console.log('💧 Bomba já está ligada, ignorando programação');
        return;
    }

    console.log(`💧 INICIANDO IRRIGAÇÃO PROGRAMADA #${programIndex + 1}`);
    
    devicesState.irrigation.bomba_irrigacao = true;
    saveState(devicesState);
    const duracao = devicesState.irrigation.duracao || 5;
    console.log(`⏰ Irrigação programada por ${duracao} minutos`);
    
    // Desliga a bomba após o tempo de duração
    setTimeout(() => {
        // Verifica se a bomba não foi desligada manualmente
        if (devicesState.irrigation.bomba_irrigacao) {
            console.log(`💧 DESLIGANDO IRRIGAÇÃO PROGRAMADA após ${duracao} minutos`);
            devicesState.irrigation.bomba_irrigacao = false;
            saveState(devicesState);
        }
    }, duracao * 60 * 1000);
}


// Função para buscar dados do clima (OpenWeatherMap)
async function fetchWeatherData() {
    try {
        const API_KEY = process.env.OPENWEATHER_API_KEY;
        if (!API_KEY) throw new Error('API key não configurada');

        const lat = -22.9068; // Rio de Janeiro
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

// ==================== MIDDLEWARE DE AUTENTICAÇÃO ====================

// ✅ CORREÇÃO CRÍTICA: Middleware para verificar o cookie
function authenticateToken(req, res, next) {
    const token = req.cookies.authToken;
    
    if (!token) {
        console.log('❌ Acesso não autorizado: Cookie ausente');
        return res.status(401).json({ authenticated: false, message: 'Não autorizado: Token ausente' });
    }
    
    // Simplificação: apenas verifica se o token corresponde à senha padrão
    if (token === VALID_PASSWORD) { 
        req.user = { username: VALID_USERNAME };
        next();
    } else {
        console.log('❌ Acesso negado: Token inválido');
        // Limpa o cookie inválido
        res.clearCookie('authToken', { path: '/' }); 
        return res.status(403).json({ authenticated: false, message: 'Acesso negado: Token inválido' });
    }
}

// ==================== ROTAS PÚBLICAS (Sem Autenticação) ====================

// Redireciona a raiz para o login
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Arquivos da interface (para que o frontend possa carregar sem auth)
app.get('/login.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});
app.get('/index.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


// Rota de login
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    console.log('🔐 Tentativa de login:', { username });
    
    if (username === VALID_USERNAME && password === VALID_PASSWORD) {
        // ✅ CORREÇÃO: Cookie configurado para funcionar em localhost e ser acessível
        res.cookie('authToken', VALID_PASSWORD, {
            maxAge: 24 * 60 * 60 * 1000, // 24 horas
            httpOnly: false, // ✅ Permite acesso via JavaScript
            secure: false,   // ✅ HTTP (desenvolvimento)
            sameSite: 'lax', // ✅ Compatível com cross-origin
            path: '/',       // ✅ Disponível em todas as rotas
        });
        console.log('✅ Login realizado - Cookie configurado');
        res.json({ success: true, message: 'Login realizado', redirect: '/index.html' });
    } else {
        console.log('❌ Login falhou');
        res.status(401).json({ success: false, message: 'Usuário ou senha incorretos' });
    }
});

// Logout
app.post('/api/logout', (req, res) => {
    // ✅ CORREÇÃO: Limpa o cookie corretamente
    res.clearCookie('authToken', { path: '/' });
    res.json({ success: true, message: 'Logout realizado', redirect: '/login.html' });
});

// Rota de status de autenticação (Para o frontend verificar a sessão)
app.get('/api/status', (req, res) => {
    const authenticated = req.cookies.authToken === VALID_PASSWORD;
    res.json({ authenticated });
});

// Rota para buscar dados do clima (PÚBLICA)
app.get('/api/weather', async (req, res) => {
    const weatherData = await fetchWeatherData();
    if (weatherData) {
        res.json({ status: 'OK', weather: weatherData });
    } else {
        res.status(500).json({ status: 'ERROR', message: 'Falha ao buscar dados do clima' });
    }
});


// ==================== ROTAS PROTEGIDAS (APÓS AUTH) ====================

// Aplica o middleware de autenticação em todas as rotas abaixo
app.use(authenticateToken); 

// Rota para o frontend buscar estado dos dispositivos
app.get('/api/devices', (req, res) => {
    // Adicionar um status de conexão do ESP32 para o frontend
    const espConnected = checkESP32Connection();
    
    res.json({ 
        lights: devicesState.lights, 
        outlets: devicesState.outlets,
        irrigation: devicesState.irrigation,
        esp32Status: {
            connected: espConnected,
            lastSeen: esp32Status.lastSeen
        }
    });
});

// Rota para o frontend buscar dados do sensor
app.get('/api/sensor-data', (req, res) => {
    const espConnected = checkESP32Connection();
    const esp32Info = {
        esp32Status: espConnected ? 'ONLINE' : 'OFFLINE',
        lastSeen: esp32Status.lastSeen,
    };
    
    // Retorna apenas a leitura mais recente + status do ESP32
    const latestSensorData = devicesState.sensorData.length > 0 ? 
                             [devicesState.sensorData[devicesState.sensorData.length - 1]] : 
                             [];

    res.json({ 
        sensorData: latestSensorData.map(d => ({ 
            temperatura: d.temperature, 
            umidade: d.humidity, 
            nivelGas: d.gas_alert,
            lastSeen: d.timestamp,
            esp32Status: esp32Info.esp32Status
        })) 
    });
});

// Rota de controle (Luzes/Tomadas)
app.post('/api/control', async (req, res) => {
    const { type, device, state } = req.body;
    
    if (devicesState[type] && devicesState[type][device] !== undefined) {
        devicesState[type][device] = state;
        saveState(devicesState);
        console.log(`✅ ${type} - ${device}: ${state ? 'Ligado' : 'Desligado'}`);
        res.json({ status: 'OK', message: 'Comando enviado' });
    } else {
        res.status(400).json({ status: 'ERROR', error: 'Dispositivo ou tipo inválido' });
    }
});

// Rotas de Irrigação
app.post('/api/irrigation/save', async (req, res) => {
    const { modo, evitar_chuva, duracao, programacoes } = req.body;

    devicesState.irrigation.modo = modo;
    devicesState.irrigation.evitar_chuva = evitar_chuva;
    devicesState.irrigation.duracao = duracao;
    devicesState.irrigation.programacoes = programacoes;

    saveState(devicesState);
    res.json({ status: 'OK', message: 'Configurações salvas', savedData: devicesState.irrigation });
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


// ==================== ROTAS ESP32 (API Key) ====================

// Middleware simples para autenticação ESP32
function authenticateESP32(req, res, next) {
    const key = req.headers['x-device-id'];
    if (key === ESP32_API_KEY) {
        next();
    } else {
        console.log('❌ Acesso ESP32 negado: API Key inválida');
        res.status(403).json({ error: 'Chave de API do dispositivo inválida' });
    }
}

// ESP32 envia dados
app.post('/api/data', authenticateESP32, (req, res) => {
    const { temperature, humidity, gas_level, gas_alert, device, heartbeat, wifi_rssi, irrigation_auto } = req.body;
    console.log('📨 Dados recebidos do ESP32:', { temperature, humidity, gas_level, gas_alert, device, heartbeat, wifi_rssi, irrigation_auto });
    
    // ✅ CORREÇÃO CRÍTICA: Processar umidade CORRETAMENTE
    let processedHumidity = humidity; 
    if (typeof humidity === 'string' && humidity.endsWith('%')) {
        processedHumidity = parseFloat(humidity.replace('%', ''));
    }
    
    const newReading = {
        timestamp: new Date().toISOString(),
        temperature: parseFloat(temperature),
        humidity: parseFloat(processedHumidity),
        gas_level: parseInt(gas_level),
        gas_alert: parseInt(gas_alert),
        wifi_rssi: parseInt(wifi_rssi)
    };

    // Adiciona a nova leitura (mantendo apenas as 100 mais recentes para evitar inchaço do arquivo)
    devicesState.sensorData.push(newReading);
    if (devicesState.sensorData.length > 100) {
        devicesState.sensorData.shift();
    }
    
    saveState(devicesState);
    
    updateESP32Status(device, req.ip || req.connection.remoteAddress);
    
    res.json({ status: 'OK', message: 'Dados recebidos', timestamp: newReading.timestamp });
});

// ESP32 busca dispositivos
app.get('/api/devices-esp32', authenticateESP32, (req, res) => {
    const clientIP = req.ip || req.connection.remoteAddress;
    updateESP32Status('ESP32-CASA-AUTOMACAO-V3', clientIP);
    console.log('📡 ESP32 solicitando estados dos dispositivos');
    
    // O ESP32 pode querer um formato mais simples
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


// ==================== INICIALIZAÇÃO ====================

// 404 handler
app.use((req, res) => {
    console.log('❌ Rota não encontrada:', req.path);
    res.status(404).json({ error: 'Rota não encontrada' });
});

app.listen(PORT, () => {
    console.log(`\n🔥 Servidor Automação V3.0 rodando na porta ${PORT}`);
    console.log(`🌐 Acesse: http://localhost:${PORT}`);
    console.log(`🔧 Modo: ${process.env.NODE_ENV}`);
    startIrrigationScheduler();
});
