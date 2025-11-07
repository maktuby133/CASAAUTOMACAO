const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// ==================== DADOS DO SISTEMA ====================
let sensorData = [];
let lightStates = {
  sala: false,
  quarto1: false,
  quarto2: false,
  quarto3: false,
  cozinha: false,
  banheiro: false
};

// ==================== ROTAS DA API ====================

// Página inicial - Status do sistema
app.get('/', (req, res) => {
  res.json({ 
    message: '🏠 Servidor de Automação Residencial Online!',
    status: 'funcionando',
    time: new Date().toLocaleString('pt-BR'),
    comodos: Object.keys(lightStates).length
  });
});

// ESP32 envia dados dos sensores aqui
app.post('/api/data', (req, res) => {
  const { temperature, device, lights } = req.body;
  
  const newData = {
    device: device || 'ESP32-Casa',
    temperature: temperature || 25.0,
    lights: lights || lightStates,
    timestamp: new Date().toLocaleString('pt-BR')
  };
  
  sensorData.unshift(newData);
  if (sensorData.length > 100) sensorData = sensorData.slice(0, 100);
  
  console.log('📨 Dados recebidos:', {
    device: newData.device,
    temperature: newData.temperature + '°C',
    lights: newData.lights
  });
  
  res.json({ 
    status: 'OK', 
    message: 'Dados salvos!',
    commands: lightStates // Retorna estado atual das luzes
  });
});

// Ver dados coletados dos sensores
app.get('/api/data', (req, res) => {
  res.json({ 
    total: sensorData.length,
    data: sensorData 
  });
});

// ==================== CONTROLE DE LÂMPADAS ====================

// Ver estado de TODAS as lâmpadas
app.get('/api/lights', (req, res) => {
  res.json({ 
    lights: lightStates,
    timestamp: new Date().toLocaleString('pt-BR')
  });
});

// Controlar lâmpada ESPECÍFICA
app.post('/api/lights/:comodo', (req, res) => {
  const { comodo } = req.params;
  const { state } = req.body;
  
  if (lightStates.hasOwnProperty(comodo)) {
    lightStates[comodo] = state === true;
    
    console.log(`💡 ${comodo.toUpperCase()} ${state ? 'LIGADO' : 'DESLIGADO'}`);
    
    res.json({ 
      status: 'OK', 
      comodo: comodo,
      state: lightStates[comodo],
      message: `${comodo} ${state ? 'ligado' : 'desligado'} com sucesso!`
    });
  } else {
    res.status(400).json({ 
      status: 'ERROR', 
      message: 'Cômodo não encontrado!',
      comodos_disponiveis: Object.keys(lightStates)
    });
  }
});

// Alternar estado de uma lâmpada (toggle)
app.post('/api/lights/:comodo/toggle', (req, res) => {
  const { comodo } = req.params;
  
  if (lightStates.hasOwnProperty(comodo)) {
    lightStates[comodo] = !lightStates[comodo];
    
    console.log(`🔘 ${comodo.toUpperCase()} TOGGLED: ${lightStates[comodo] ? 'LIGADO' : 'DESLIGADO'}`);
    
    res.json({ 
      status: 'OK', 
      comodo: comodo,
      state: lightStates[comodo],
      message: `${comodo} ${lightStates[comodo] ? 'ligado' : 'desligado'}`
    });
  } else {
    res.status(400).json({ 
      status: 'ERROR', 
      message: 'Cômodo não encontrado!'
    });
  }
});

// Controlar TODAS as lâmpadas de uma vez
app.post('/api/lights/all', (req, res) => {
  const { state } = req.body;
  
  Object.keys(lightStates).forEach(comodo => {
    lightStates[comodo] = state === true;
  });
  
  console.log(`🏠 TODAS AS LUZES ${state ? 'LIGADAS' : 'DESLIGADAS'}`);
  
  res.json({ 
    status: 'OK', 
    lights: lightStates,
    message: `Todas as luzes ${state ? 'ligadas' : 'desligadas'}`
  });
});

// ESP32 busca comandos aqui
app.get('/api/commands', (req, res) => {
  res.json(lightStates);
});

// ==================== ROTAS EXTRAS ====================

// Status do sistema
app.get('/api/status', (req, res) => {
  const comodosLigados = Object.values(lightStates).filter(state => state).length;
  
  res.json({
    status: 'online',
    server_time: new Date().toLocaleString('pt-BR'),
    uptime: process.uptime(),
    comodos_total: Object.keys(lightStates).length,
    comodos_ligados: comodosLigados,
    dados_coletados: sensorData.length
  });
});

// Reset do sistema
app.post('/api/reset', (req, res) => {
  sensorData = [];
  Object.keys(lightStates).forEach(comodo => {
    lightStates[comodo] = false;
  });
  
  console.log('🔄 Sistema resetado!');
  
  res.json({ 
    status: 'OK', 
    message: 'Sistema resetado com sucesso!',
    lights: lightStates
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🔥 Servidor de Automação rodando na porta ${PORT}`);
  console.log(`🏠 Cômodos disponíveis: ${Object.keys(lightStates).join(', ')}`);
  console.log(`🌐 Acesse: http://localhost:${PORT}`);
});
