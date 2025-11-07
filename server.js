const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ==================== DADOS DO SISTEMA ====================
let sensorData = [];
let lightStates = {
    sala: false,
    quarto1: false,
    quarto2: false,
    quarto3: false,
    corredor: false,
    cozinha: false,
    banheiro: false
};

// ==================== ROTAS PRINCIPAIS ====================

// Interface web
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API para controle das luzes (interface web usa esta)
app.post('/api/control', (req, res) => {
    const { room, state } = req.body;
    
    if (lightStates.hasOwnProperty(room)) {
        lightStates[room] = state;
        console.log(`💡 ${room}: ${state ? 'LIGADA' : 'DESLIGADA'}`);
        
        res.json({ 
            status: 'success', 
            room: room, 
            state: state,
            message: `Luz ${room} ${state ? 'ligada' : 'desligada'}`
        });
    } else {
        res.status(400).json({ 
            status: 'error', 
            message: 'Cômodo não encontrado' 
        });
    }
});

// API para ver estado das luzes (ESP32 chama esta)
app.get('/api/lights', (req, res) => {
    res.json({ lights: lightStates });
});

// ESP32 envia dados dos sensores aqui
app.post('/api/data', (req, res) => {
    const { temperature, device } = req.body;
    
    const newData = {
        device: device || 'ESP32-NTC',
        temperature: temperature || 25.0,
        timestamp: new Date().toLocaleString('pt-BR')
    };
    
    sensorData.unshift(newData);
    if (sensorData.length > 50) sensorData = sensorData.slice(0, 50);
    
    console.log('📨 Dados recebidos:', newData);
    res.json({ status: 'OK', message: 'Dados salvos!' });
});

// Interface web busca dados dos sensores
app.get('/api/data', (req, res) => {
    res.json({ data: sensorData });
});

// Status do servidor
app.get('/api/status', (req, res) => {
    res.json({ 
        message: '🏠 Servidor de Automação Residencial Online!',
        status: 'funcionando',
        time: new Date().toLocaleString('pt-BR'),
        comodos: Object.keys(lightStates).length
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🔥 Servidor rodando na porta ${PORT}`);
    console.log(`🏠 Interface: http://localhost:${PORT}`);
});
