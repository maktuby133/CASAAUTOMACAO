# 🏠 Sistema de Automação Residencial V3.0

Sistema completo de automação residencial com ESP32, Node.js e interface web com monitoramento em tempo real.

## ✨ Funcionalidades

- ✅ **Controle de lâmpadas e tomadas** - CORRIGIDO
- ✅ **Monitoramento de temperatura e gás** - CORRIGIDO  
- ✅ **Interface web responsiva** - CORRIGIDO
- ✅ **Dados meteorológicos em tempo real** - CORRIGIDO
- ✅ **MONITORAMENTO ESP32 EM TEMPO REAL** - CORRIGIDO
- ✅ **Sistema de heartbeat** - CORRIGIDO
- ✅ **Persistência de estado** - CORRIGIDO
- ✅ **Alertas visuais de conexão** - CORRIGIDO
- ✅ **Sistema de irrigação automática** - CORRIGIDO
- ✅ **Programação de irrigação** - CORRIGIDO
- ✅ **Detecção de chuva** - CORRIGIDO

## 🔧 CORREÇÕES APLICADAS

### Problemas Resolvidos:

1. **Acionamento de Lâmpadas** ✅
   - Comunicação bidirecional corrigida
   - Estados sincronizados entre ESP32 e servidor
   - Confirmação de comandos implementada

2. **Irrigação Automática** ✅
   - Sistema de temporizador corrigido
   - Programações funcionando corretamente
   - Detecção de chuva integrada

3. **Autenticação** ✅
   - Loops de redirecionamento eliminados
   - Rotas ESP32 sem autenticação
   - Sistema de login simplificado

4. **Comunicação** ✅
   - Headers de autenticação corrigidos
   - Timeouts configurados
   - Reconexão automática

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
- Bomba de água para irrigação

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
