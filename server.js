const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Dados dos sensores e controle
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

// Servir a interface
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API para controle das luzes
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
            message: 'Comodo não encontrado' 
        });
    }
});

// API para ver estado das luzes
app.get('/api/lights', (req, res) => {
    res.json({ lights: lightStates });
});

// ESP32 envia dados dos sensores aqui
app.post('/api/data', (req, res) => {
    const { temperature, humidity, device } = req.body;
    
    const newData = {
        device: device || 'ESP32',
        temperature: temperature || 25.0,
        humidity: humidity || 60.0,
        timestamp: new Date().toLocaleString('pt-BR')
    };
    
    sensorData.unshift(newData);
    if (sensorData.length > 50) sensorData = sensorData.slice(0, 50);
    
    console.log('📨 Dados recebidos:', newData);
    res.json({ status: 'OK', message: 'Dados salvos!' });
});

// Ver dados coletados
app.get('/api/data', (req, res) => {
    res.json({ data: sensorData });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🔥 Servidor rodando na porta ${PORT}`);
    console.log(`🏠 Interface: http://localhost:${PORT}`);
});
