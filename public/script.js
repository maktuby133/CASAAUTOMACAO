// public/script.js - Versão Simplificada e Testada

let currentDevices = {};

// ✅ INICIALIZAÇÃO SIMPLES
document.addEventListener('DOMContentLoaded', function() {
    console.log('🔧 Iniciando sistema...');
    
    if (window.location.pathname.includes('login.html') || window.location.pathname === '/') {
        setupLoginPage();
    } else {
        setupMainPage();
    }
});

function setupLoginPage() {
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
    }
}

async function handleLogin(e) {
    e.preventDefault();
    
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    
    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
            credentials: 'include'
        });
        
        const data = await response.json();
        
        if (data.success) {
            localStorage.setItem('casa-automacao-authenticated', 'true');
            window.location.href = data.redirect;
        } else {
            alert('Login falhou: ' + data.message);
        }
    } catch (error) {
        console.error('Erro no login:', error);
        alert('Erro de conexão');
    }
}

function setupMainPage() {
    console.log('🏠 Configurando página principal...');
    loadDevices();
    startAutoRefresh();
}

// ✅ CARREGAR DISPOSITIVOS - VERSÃO SIMPLES
async function loadDevices() {
    try {
        console.log('📡 Carregando dispositivos...');
        
        const response = await fetch('/api/devices', {
            credentials: 'include'
        });
        
        if (!response.ok) {
            throw new Error('Erro na resposta: ' + response.status);
        }
        
        const data = await response.json();
        console.log('✅ Dados recebidos:', data);
        
        currentDevices = data;
        displayDevices();
        
    } catch (error) {
        console.error('❌ Erro ao carregar dispositivos:', error);
        showError('Erro ao carregar dispositivos');
    }
}

// ✅ MOSTRAR DISPOSITIVOS NA TELA
function displayDevices() {
    displayLights();
    displayOutlets();
    displayIrrigation();
}

function displayLights() {
    const container = document.getElementById('lights-container');
    if (!container) {
        console.log('❌ Container de lâmpadas não encontrado!');
        return;
    }
    
    console.log('💡 Mostrando lâmpadas:', currentDevices.lights);
    
    if (!currentDevices.lights || Object.keys(currentDevices.lights).length === 0) {
        container.innerHTML = '<div style="text-align: center; padding: 20px; color: #666;">Nenhuma lâmpada configurada</div>';
        return;
    }
    
    let html = '';
    Object.entries(currentDevices.lights).forEach(([device, state]) => {
        html += `
            <div class="device-compact-item ${state ? 'active' : ''}">
                <div class="device-compact-icon">
                    <img src="${state ? 'https://img.icons8.com/?size=100&id=KgisVcJhnUAQ&format=png&color=000000' : 'https://img.icons8.com/?size=100&id=55787&format=png&color=000000'}" 
                         alt="${device}" class="${state ? 'lamp-icon-on' : 'lamp-icon-off'}">
                </div>
                <div class="device-compact-name">${getDeviceName(device)}</div>
                <label class="switch">
                    <input type="checkbox" ${state ? 'checked' : ''} 
                           onchange="toggleDevice('lights', '${device}', this.checked)">
                    <span class="slider"></span>
                </label>
            </div>
        `;
    });
    
    container.innerHTML = html;
    console.log(`✅ ${Object.keys(currentDevices.lights).length} lâmpadas exibidas`);
}

function displayOutlets() {
    const container = document.getElementById('outlets-container');
    if (!container) {
        console.log('❌ Container de tomadas não encontrado!');
        return;
    }
    
    console.log('🔌 Mostrando tomadas:', currentDevices.outlets);
    
    if (!currentDevices.outlets || Object.keys(currentDevices.outlets).length === 0) {
        container.innerHTML = '<div style="text-align: center; padding: 20px; color: #666;">Nenhuma tomada configurada</div>';
        return;
    }
    
    let html = '';
    Object.entries(currentDevices.outlets).forEach(([device, state]) => {
        html += `
            <div class="device-compact-item ${state ? 'active' : ''}">
                <div class="device-compact-icon">
                    <i class="fas fa-plug" style="color: ${state ? '#4CAF50' : '#666'}"></i>
                </div>
                <div class="device-compact-name">${getDeviceName(device)}</div>
                <label class="switch">
                    <input type="checkbox" ${state ? 'checked' : ''} 
                           onchange="toggleDevice('outlets', '${device}', this.checked)">
                    <span class="slider"></span>
                </label>
            </div>
        `;
    });
    
    container.innerHTML = html;
    console.log(`✅ ${Object.keys(currentDevices.outlets).length} tomadas exibidas`);
}

function displayIrrigation() {
    const irrigation = currentDevices.irrigation || {};
    
    const statusElement = document.getElementById('irrigation-status');
    const modeElement = document.getElementById('irrigation-mode');
    
    if (statusElement) {
        statusElement.textContent = irrigation.bomba_irrigacao ? 'LIGADA' : 'DESLIGADA';
        statusElement.className = irrigation.bomba_irrigacao ? 'status-on' : 'status-off';
    }
    
    if (modeElement) {
        modeElement.textContent = irrigation.modo === 'automatico' ? 'Automático' : 'Manual';
    }
}

function getDeviceName(deviceKey) {
    const names = {
        'sala': 'Sala de Estar',
        'quarto1': 'Quarto Principal',
        'quarto2': 'Quarto 2',
        'quarto3': 'Quarto 3',
        'corredor': 'Corredor',
        'cozinha': 'Cozinha',
        'banheiro': 'Banheiro',
        'tomada_sala': 'Tomada Sala',
        'tomada_cozinha': 'Tomada Cozinha',
        'tomada_quarto1': 'Tomada Quarto 1',
        'tomada_quarto2': 'Tomada Quarto 2',
        'tomada_quarto3': 'Tomada Quarto 3'
    };
    
    return names[deviceKey] || deviceKey;
}

// ✅ CONTROLE DE DISPOSITIVOS
async function toggleDevice(type, device, state) {
    try {
        console.log(`🎛️ Controlando: ${type} ${device} -> ${state}`);
        
        const response = await fetch('/api/control', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type, device, state }),
            credentials: 'include'
        });
        
        const data = await response.json();
        
        if (data.status === 'OK') {
            showMessage(`${getDeviceName(device)} ${state ? 'ligado' : 'desligado'}`, 'success');
            
            // Atualiza localmente
            if (currentDevices[type]) {
                currentDevices[type][device] = state;
            }
            displayDevices();
        } else {
            throw new Error(data.error);
        }
    } catch (error) {
        console.error('❌ Erro ao controlar:', error);
        showMessage('Erro: ' + error.message, 'error');
        loadDevices(); // Recarrega para sincronizar
    }
}

// ✅ CONTROLES EM MASSA
async function controlAllLights(state) {
    const lights = currentDevices.lights || {};
    const action = state ? 'ligadas' : 'desligadas';
    
    for (const device of Object.keys(lights)) {
        await toggleDevice('lights', device, state);
    }
    showMessage(`Todas as lâmpadas ${action}`, 'success');
}

async function controlAllOutlets(state) {
    const outlets = currentDevices.outlets || {};
    const action = state ? 'ligadas' : 'desligadas';
    
    for (const device of Object.keys(outlets)) {
        await toggleDevice('outlets', device, state);
    }
    showMessage(`Todas as tomadas ${action}`, 'success');
}

async function controlIrrigation(state) {
    try {
        const response = await fetch('/api/irrigation/control', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ state }),
            credentials: 'include'
        });
        
        const data = await response.json();
        
        if (data.status === 'OK') {
            showMessage(`Bomba ${state ? 'ligada' : 'desligada'}`, 'success');
            
            if (currentDevices.irrigation) {
                currentDevices.irrigation.bomba_irrigacao = state;
            }
            displayIrrigation();
        }
    } catch (error) {
        console.error('❌ Erro na irrigação:', error);
        showMessage('Erro na irrigação', 'error');
    }
}

// ✅ ATUALIZAÇÃO AUTOMÁTICA
function startAutoRefresh() {
    // Atualiza a cada 10 segundos
    setInterval(() => {
        loadDevices();
    }, 10000);
}

// ✅ SISTEMA DE MENSAGENS
function showMessage(message, type = 'info') {
    // Usando alert simples para debug
    console.log(`📢 ${type}: ${message}`);
    
    // Pode ser substituído por um sistema de notificações mais elaborado
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 15px 20px;
        border-radius: 8px;
        color: white;
        font-weight: 500;
        z-index: 10000;
        background: ${type === 'success' ? '#4CAF50' : type === 'error' ? '#f44336' : '#2196F3'};
    `;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        document.body.removeChild(notification);
    }, 3000);
}

function showError(message) {
    showMessage(message, 'error');
}

// ✅ FUNÇÕES GLOBAIS
window.toggleDevice = toggleDevice;
window.controlAllLights = controlAllLights;
window.controlAllOutlets = controlAllOutlets;
window.controlIrrigation = controlIrrigation;
window.loadDevices = loadDevices;

console.log('✅ Script.js carregado com sucesso!');
