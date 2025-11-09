const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Dados dos sensores
let sensorData = [];
let devicesState = {
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

// Página principal com interface bonita
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Status do servidor
app.get('/api/status', (req, res) => {
  res.json({ 
    message: '🚀 Servidor Automação Residencial V2.0',
    status: 'online',
    version: '2.0',
    time: new Date().toLocaleString('pt-BR'),
    devices: {
      lights: Object.keys(devicesState.lights).length,
      outlets: Object.keys(devicesState.outlets).length
    }
  });
});

// ESP32 envia dados dos sensores
app.post('/api/data', (req, res) => {
  const { temperature, gas_level, gas_alert, device } = req.body;

  const newData = {
    temperature,
    gas_level,
    gas_alert,
    device,
    timestamp: new Date().toLocaleString('pt-BR')
  };

  sensorData.unshift(newData);
  if (sensorData.length > 100) sensorData = sensorData.slice(0, 100);

  console.log('📨 Dados recebidos:', newData);
  res.json({ status: 'OK', message: 'Dados salvos!' });
});

// ESP32 busca estado dos dispositivos
app.get('/api/devices', (req, res) => {
  res.json(devicesState);
});

// Interface web controla dispositivos
app.post('/api/control', (req, res) => {
  const { type, device, state } = req.body;
  
  if (devicesState[type] && devicesState[type].hasOwnProperty(device)) {
    devicesState[type][device] = state;
    console.log(`🎛️  ${type} ${device}: ${state ? 'LIGADO' : 'DESLIGADO'}`);
    res.json({ status: 'OK', type, device, state });
  } else {
    res.status(400).json({ error: 'Dispositivo não encontrado' });
  }
});

// Ver dados dos sensores
app.get('/api/data', (req, res) => {
  res.json({ 
    data: sensorData,
    summary: {
      total_readings: sensorData.length,
      last_temperature: sensorData[0]?.temperature || 'N/A',
      last_gas_level: sensorData[0]?.gas_level || 'N/A',
      gas_alert: sensorData[0]?.gas_alert || false
    }
  });
});

// Reset dos dispositivos
app.post('/api/reset', (req, res) => {
  Object.keys(devicesState.lights).forEach(key => {
    devicesState.lights[key] = false;
  });
  Object.keys(devicesState.outlets).forEach(key => {
    devicesState.outlets[key] = false;
  });
  
  console.log('🔄 Todos os dispositivos resetados');
  res.json({ status: 'OK', message: 'Todos os dispositivos desligados' });
});

app.listen(PORT, () => {
  console.log(`🔥 Servidor Automação V2.0 rodando na porta ${PORT}`);
  console.log(`🌐 Acesse: http://localhost:${PORT}`);
});
