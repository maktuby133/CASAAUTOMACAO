const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Dados dos sensores
let sensorData = [];

app.get('/', (req, res) =
  res.json({ 
    message: '🚀 Servidor ESP32 Online!',
    status: 'funcionando',
    time: new Date().toLocaleString('pt-BR')
  });
});

// ESP32 envia dados aqui
app.post('/api/data', (req, res) =
  const { temperature, humidity, device } = req.body;

  const newData = {
    timestamp: new Date().toLocaleString('pt-BR')
  };

  sensorData.unshift(newData);
  if (sensorData.length  sensorData = sensorData.slice(0, 50);

  console.log('📨 Dados recebidos:', newData);
  res.json({ status: 'OK', message: 'Dados salvos!' });
});

// Ver dados coletados
app.get('/api/data', (req, res) =
  res.json({ data: sensorData });
});

app.listen(PORT, () =
  console.log(`🔥 Servidor rodando na porta ${PORT}`);
});
