const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const cookieParser = require('cookie-parser');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ CORS configurado para permitir cookies
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

// Dados de Sensores (SIMULADO)
let sensorData = []; // Armazena dados históricos

// Carregar estado salvo
function loadState() {
    try {
        if (fs.existsSync(STATE_FILE)) {
            const data = fs.readFileSync(STATE_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (e) {
        console.error('Erro ao carregar estado:', e);
    }
    // Estado inicial padrão
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
            modo: 'manual', // manual | automatico
            evitar_chuva: true,
            duracao: 5, // minutos
            programacoes: [
                { hora: '08:00', dias: ['SEG', 'QUA', 'SEX'] },
                { hora: '18:30', dias: ['SAB', 'DOM'] }
            ]
        }
    };
}

let devicesState = loadState();

function saveState(state) {
    try {
        fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
        devicesState = state; // Atualiza o estado em memória
    } catch (e) {
        console.error('Erro ao salvar estado:', e);
    }
}

// Simulação de autenticação (simplificada)
const VALID_AUTH_TOKEN = 'admin123';
const VALID_USERS = {
    'admin': 'admin123',
    'usuario': 'user123',
    'charles': '061084Cc@',
    'casa': 'automacao2024'
};

function authenticate(req, res, next) {
    const authToken = req.cookies.authToken;
    const isAuthenticated = authToken === VALID_AUTH_TOKEN;
    
    if (isAuthenticated) {
        req.user = { id: 'admin', role: 'admin' };
        next();
    } else {
        console.log('❌ Tentativa de acesso não autorizado.');
        // Para requisições da API, retorna 401
        if (req.path.startsWith('/api/')) {
            res.status(401).json({ error: 'Não autorizado. Faça login novamente.' });
        } else {
            // Para acesso a páginas (deve ser tratado pelo script.js)
            next();
        }
    }
}

// ==================== ROTAS DE AUTENTICAÇÃO ====================

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    if (VALID_USERS[username] === password) {
        console.log(`✅ Login bem-sucedido: ${username}`);
        
        // Seta o cookie de autenticação
        res.cookie('authToken', VALID_AUTH_TOKEN, { 
            maxAge: 24 * 60 * 60 * 1000, // 24 horas
            httpOnly: false, // Necessário para que o frontend possa enviar (o fetch precisa)
            secure: false, // Permite uso em HTTP (desenvolvimento)
            sameSite: 'lax', 
            path: '/', 
        });
        
        return res.json({ 
            success: true, 
            message: 'Login bem-sucedido', 
            redirect: '/index.html' 
        });
    } else {
        console.log(`❌ Tentativa de login falhou para: ${username}`);
        return res.status(401).json({ 
            success: false, 
            message: 'Usuário ou senha inválidos' 
        });
    }
});

app.post('/api/logout', (req, res) => {
    res.clearCookie('authToken', { path: '/' });
    res.json({ success: true, message: 'Logout bem-sucedido', redirect: '/login.html' });
});

// Verifica o status de autenticação (usado pelo script.js)
app.get('/api/status', (req, res) => {
    const isAuthenticated = req.cookies.authToken === VALID_AUTH_TOKEN;
    res.json({ 
        authenticated: isAuthenticated, 
        esp32Status: esp32Status.connected ? 'ONLINE' : 'OFFLINE' 
    });
});

// ==================== ROTAS PROTEGIDAS (APÓS AUTENTICAÇÃO) ====================

app.use('/api', authenticate); // Aplica o middleware de autenticação a todas as rotas /api/*

// Busca o estado atual dos dispositivos
app.get('/api/devices', (req, res) => {
    // Retorna o estado atual com o status do ESP32
    res.json(devicesState);
});

// Rota de controle de dispositivos
app.post('/api/control', (req, res) => {
    const { type, device, state } = req.body;
    
    if (!type || !device || typeof state !== 'boolean') {
        return res.status(400).json({ error: 'Dados inválidos' });
    }

    if (devicesState[type] && devicesState[type].hasOwnProperty(device)) {
        devicesState[type][device] = state;
        saveState(devicesState);
        console.log(`⚙️  CONTROLE: ${type}/${device} => ${state ? 'LIGADO' : 'DESLIGADO'}`);
        // Aqui você enviaria o comando real para o ESP32...
        // ...
        return res.json({ status: 'OK', message: 'Comando enviado' });
    } else {
        return res.status(404).json({ error: 'Dispositivo não encontrado' });
    }
});

// ==================== ROTAS DE DADOS (ESP32) ====================

// Recebe dados de sensores do ESP32
app.post('/api/data', (req, res) => {
    const { deviceId, temperature, humidity, gasLevel, apiKey } = req.body;

    // 🚨 SEGURANÇA BÁSICA: Verifica a API Key
    if (apiKey !== process.env.ESP32_API_KEY) {
        console.log('❌ ESP32: Tentativa de envio de dados com API Key inválida');
        return res.status(401).json({ status: 'ERROR', error: 'API Key inválida' });
    }
    
    const now = new Date();
    
    // Atualiza o estado do ESP32
    esp32Status.connected = true;
    esp32Status.lastSeen = now.toISOString();
    esp32Status.deviceId = deviceId;
    esp32Status.ipAddress = req.ip;

    const newSensorData = {
        timestamp: now.toISOString(),
        temperatura: parseFloat(temperature),
        umidade: parseFloat(humidity),
        nivelGas: parseInt(gasLevel),
        esp32Status: 'ONLINE'
    };

    // Adiciona o novo dado e limita o histórico a 100 itens
    sensorData.push(newSensorData);
    if (sensorData.length > 100) {
        sensorData.shift();
    }
    
    console.log(`📊 DADO RECEBIDO de ${deviceId}: Temp=${newSensorData.temperatura}°C, Gás=${newSensorData.nivelGas}`);
    
    // Responde com o estado atual dos dispositivos para o ESP32
    res.json({ 
        status: 'OK', 
        message: 'Dados recebidos', 
        deviceStates: {
            lights: devicesState.lights,
            outlets: devicesState.outlets,
            irrigation: devicesState.irrigation.bomba_irrigacao 
        }
    });
});

// Envia dados de sensores para o Frontend
app.get('/api/sensor-data', (req, res) => {
    // Adiciona o status do ESP32 ao último dado enviado para o frontend
    if (sensorData.length > 0) {
        sensorData[sensorData.length - 1].esp32Status = esp32Status.connected ? 'ONLINE' : 'OFFLINE';
    }

    res.json({ 
        status: 'OK',
        sensorData: sensorData
    });
});

// Simulação de Heartbeat (apenas para atualizar o status de conexão)
app.post('/api/heartbeat', (req, res) => {
    const { deviceId, apiKey } = req.body;
    
    if (apiKey !== process.env.ESP32_API_KEY) {
        return res.status(401).json({ status: 'ERROR', error: 'API Key inválida' });
    }

    esp32Status.connected = true;
    esp32Status.lastHeartbeat = new Date().toISOString();
    esp32Status.deviceId = deviceId;
    esp32Status.ipAddress = req.ip;

    res.json({ status: 'OK', message: 'Heartbeat recebido' });
});

// Monitoramento de conexão (limpa o status após 30 segundos sem heartbeat/dados)
setInterval(() => {
    if (esp32Status.lastSeen) {
        const lastSeenTime = new Date(esp32Status.lastSeen).getTime();
        const now = Date.now();
        const timeout = 30000; // 30 segundos

        if (now - lastSeenTime > timeout && esp32Status.connected) {
            esp32Status.connected = false;
            console.log('🔴 ESP32 DESCONECTADO (Timeout)');
            // Adiciona um registro de offline
            sensorData.push({
                timestamp: new Date().toISOString(),
                temperatura: -1, // Valor sentinela
                umidade: -1,
                nivelGas: -1,
                esp32Status: 'OFFLINE'
            });
            if (sensorData.length > 100) sensorData.shift();
        }
    }
}, 5000); // Roda a cada 5 segundos

// ==================== ROTAS DE IRRIGACAO ====================

app.post('/api/irrigation/save', async (req, res) => {
    const settings = req.body;
    
    if (!settings || !settings.modo) {
        return res.status(400).json({ error: 'Dados de configuração inválidos' });
    }

    // 🚨 Regra de segurança: Se está no modo automático, não permite ligar a bomba manualmente
    if (settings.modo === 'automatico') {
        devicesState.irrigation.bomba_irrigacao = false;
    }
    
    devicesState.irrigation = {
        ...devicesState.irrigation,
        ...settings,
    };
    
    saveState(devicesState);
    console.log('💧 Configurações de irrigação salvas:', devicesState.irrigation);
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

// ==================== ROTAS DE CLIMA ====================

// Cache de clima
let weatherCache = {
    data: null,
    timestamp: 0,
    city: 'Curitiba, BR', // Cidade padrão
    url: 'http://api.openweathermap.org/data/2.5/weather'
};
const WEATHER_CACHE_DURATION = 600000; // 10 minutos

// Função auxiliar para verificar chuva no OpenWeather
async function isRaining() {
    await updateWeatherCache();
    if (weatherCache.data && weatherCache.data.weather) {
        // Verifica se há alguma condição de clima que contenha 'rain' (chuva)
        return weatherCache.data.weather.some(w => w.main.toLowerCase().includes('rain'));
    }
    return false; // Retorna falso se não houver dados
}

async function updateWeatherCache() {
    const now = Date.now();
    if (now - weatherCache.timestamp < WEATHER_CACHE_DURATION && weatherCache.data) {
        return; // Retorna se o cache for recente
    }

    try {
        const apiKey = process.env.OPENWEATHER_API_KEY;
        const city = weatherCache.city;
        const lang = 'pt_br';
        const units = 'metric';

        const apiUrl = `${weatherCache.url}?q=${city}&appid=${apiKey}&lang=${lang}&units=${units}`;
        
        const response = await fetch(apiUrl);
        const data = await response.json();
        
        if (data.cod === 200) {
            weatherCache.data = data;
            weatherCache.timestamp = now;
            console.log('☁️  Clima atualizado:', data.weather[0].description, `${data.main.temp}°C`);
        } else {
            console.error('❌ Erro ao buscar clima:', data.message);
        }
    } catch (error) {
        console.error('❌ Erro na requisição do clima:', error.message);
    }
}

app.get('/api/weather', async (req, res) => {
    await updateWeatherCache();
    if (weatherCache.data) {
        res.json({ status: 'OK', weather: weatherCache.data });
    } else {
        res.status(500).json({ status: 'ERROR', message: 'Não foi possível carregar dados do clima' });
    }
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
    console.log(`🔧 Modo: ${process.env.NODE_ENV}`);
});
