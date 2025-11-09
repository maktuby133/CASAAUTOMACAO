# 🏠 Sistema de Automação Residencial V3.0

Sistema completo de automação residencial com ESP32, Node.js e interface web com monitoramento em tempo real.

## ✨ Funcionalidades

- ✅ Controle de lâmpadas e tomadas
- ✅ Monitoramento de temperatura e gás
- ✅ Interface web responsiva
- ✅ Dados meteorológicos em tempo real
- ✅ **MONITORAMENTO ESP32 EM TEMPO REAL**
- ✅ Sistema de heartbeat
- ✅ Persistência de estado
- ✅ Alertas visuais de conexão

## 🎯 Status do ESP32 no Painel

Agora o sistema mostra claramente o status do ESP32:

- **🟢 ONLINE**: ESP32 conectado e funcionando
- **🔴 OFFLINE**: ESP32 desconectado
- **🟡 CONECTANDO**: Estabelecendo conexão

## 📋 Pré-requisitos

- Node.js 16+
- ESP32
- Sensores: NTC (temperatura), MQ-2/MQ-5 (gás)
- Módulos relé para lâmpadas/tomadas

## 🚀 Instalação Rápida

### 1. Servidor Node.js
```bash
# Instalar dependências
npm install

# Configurar variáveis de ambiente
cp .env.example .env
# Edite o .env com suas configurações

# Iniciar servidor
npm run dev    # Desenvolvimento
npm start      # Produção
