const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Arquivo para persistência
const STATE_FILE = 'devices-state.json';

// Monitoramento de conexão ESP32
let esp32Status = {
    connected: false,
    lastSeen: null,
    deviceId: null,
    ipAddress: null
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
        deviceId: device || 'ESP32-AUTOMACAO-V3',
        ipAddress: ip || 'Desconhecido'
    };
    
    console.log(`📡 ESP32 conectado: ${device} | IP: ${ip}`);
    
    // Agendar verificação de desconexão (3 minutos sem sinal = desconectado)
    setTimeout(() => {
        const timeSinceLastSeen = new Date() - esp32Status.lastSeen;
        if (timeSinceLastSeen > 180000) { // 3 minutos
            esp32Status.connected = false;
            console.log('⚠️  ESP32 considerado desconectado (timeout)');
        }
    }, 180000);
}

// Verificar se ESP32 está conectado
function checkESP32Connection() {
    if (esp32Status.lastSeen) {
        const timeSinceLastSeen = new Date() - esp32Status.lastSeen;
        if (timeSinceLastSeen > 120000) { // 2 minutos sem sinal
            esp32Status.connected = false;
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

// Rotas

// Página principal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Status do servidor
app.get('/api/status', (req, res) => {
    const espConnected = checkESP32Connection();
    const statusMessage = espConnected ? 
        '✅ Sistema operando normalmente' : 
        '⚠️  ESP32 desconectado';
    
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
            outlets: Object.keys(devicesState.outlets).length
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

// ESP32 envia dados dos sensores
app.post('/api/data', (req, res) => {
    const { temperature, gas_level, gas_alert, device, heartbeat } = req.body;

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
        timestamp: new Date().toLocaleString('pt-BR'),
        receivedAt: new Date()
    };

    sensorData.unshift(newData);
    if (sensorData.length > 100) sensorData = sensorData.slice(0, 100);

    // Atualizar status do ESP32
    const clientIP = req.ip || req.connection.remoteAddress;
    updateESP32Status(device, clientIP);

    if (heartbeat) {
        console.log('💓 Heartbeat recebido:', { device, ip: clientIP });
    } else {
        console.log('📨 Dados recebidos:', {
            device,
            temperature,
            gas_level,
            ip: clientIP
        });
    }
    
    res.json({ 
        status: 'OK', 
        message: heartbeat ? 'Heartbeat recebido!' : 'Dados salvos!',
        serverTime: new Date().toLocaleString('pt-BR')
    });
});

// ESP32 busca estado dos dispositivos
app.get('/api/devices', (req, res) => {
    // Atualizar status do ESP32
    const clientIP = req.ip || req.connection.remoteAddress;
    updateESP32Status('ESP32-AUTOMACAO-V3', clientIP);
    
    res.json(devicesState);
});

// Interface web controla dispositivos
app.post('/api/control', (req, res) => {
    const { type, device, state } = req.body;
    
    // Validação
    if (!type || !device || typeof state === 'undefined') {
        return res.status(400).json({ error: 'Dados incompletos' });
    }
    
    if (!['lights', 'outlets'].includes(type)) {
        return res.status(400).json({ error: 'Tipo inválido' });
    }
    
    if (!devicesState[type] || !devicesState[type].hasOwnProperty(device)) {
        return res.status(400).json({ error: 'Dispositivo não encontrado' });
    }
    
    // Verificar se ESP32 está conectado antes de enviar comando
    const espConnected = checkESP32Connection();
    if (!espConnected) {
        return res.status(503).json({ 
            error: 'ESP32 desconectado - Comando não enviado',
            suggestion: 'Verifique a conexão do ESP32 com a rede WiFi'
        });
    }
    
    devicesState[type][device] = state;
    saveState(devicesState);
    
    console.log(`🎛️  ${type} ${device}: ${state ? 'LIGADO' : 'DESLIGADO'}`);
    res.json({ 
        status: 'OK', 
        type, 
        device, 
        state,
        esp32Connected: true,
        message: `Comando enviado para ESP32 - ${device} ${state ? 'ligado' : 'desligado'}`
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
    
    saveState(devicesState);
    console.log('🔄 Todos os dispositivos resetados');
    res.json({ 
        status: 'OK', 
        message: 'Todos os dispositivos desligados',
        esp32Connected: true
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
});
