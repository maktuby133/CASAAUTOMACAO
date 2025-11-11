// public/script.js - Cliente CORRIGIDO sem loops

document.addEventListener('DOMContentLoaded', function() {
    // Verificar se estamos na página de login
    if (window.location.pathname === '/' || window.location.pathname === '/login.html') {
        handleLoginPage();
    } else {
        handleSystemPage();
    }
});

function handleLoginPage() {
    const loginForm = document.getElementById('loginForm');
    const errorMessage = document.getElementById('errorMessage');
    
    if (loginForm) {
        loginForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;
            
            try {
                const response = await fetch('/api/login', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ username, password })
                });
                
                const data = await response.json();
                
                if (data.success) {
                    window.location.href = data.redirect;
                } else {
                    if (errorMessage) {
                        errorMessage.textContent = data.message;
                        errorMessage.style.display = 'block';
                    }
                }
            } catch (error) {
                console.error('❌ Erro no login:', error);
                if (errorMessage) {
                    errorMessage.textContent = 'Erro de conexão com o servidor';
                    errorMessage.style.display = 'block';
                }
            }
        });
    }
}

function handleSystemPage() {
    console.log('🔧 Página do sistema carregada');
    
    // 🚨 CORREÇÃO: Verificação de auth apenas para sistema
    checkSystemAuth();
    
    // Configurar botão de logout se existir
    const logoutBtn = document.querySelector('.logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', logout);
    }
}

// 🚨 CORREÇÃO: Verificação apenas para páginas do sistema
async function checkSystemAuth() {
    try {
        const response = await fetch('/api/status');
        const data = await response.json();
        
        if (!data.authenticated) {
            console.log('❌ Não autenticado, redirecionando...');
            window.location.href = '/login.html';
        }
    } catch (error) {
        console.error('❌ Erro ao verificar auth:', error);
        window.location.href = '/login.html';
    }
}

// Logout function
async function logout() {
    try {
        const response = await fetch('/api/logout', {
            method: 'POST'
        });
        
        const data = await response.json();
        
        if (data.success) {
            window.location.href = data.redirect;
        }
    } catch (error) {
        console.error('❌ Erro no logout:', error);
        window.location.href = '/login.html';
    }
}

// 🚨 CORREÇÃO: Adicionar função global para logout
window.logout = logout;

// Sistema de Automação - Funções principais
let currentDevices = {};

async function loadDevices() {
    try {
        const response = await fetch('/api/devices');
        const data = await response.json();
        currentDevices = data;
        updateDeviceDisplays();
        updateSensorData();
    } catch (error) {
        console.error('❌ Erro ao carregar dispositivos:', error);
    }
}

function updateDeviceDisplays() {
    updateLightsDisplay();
    updateOutletsDisplay();
    updateIrrigationDisplay();
}

function updateLightsDisplay() {
    const container = document.getElementById('lights-container');
    if (!container) return;

    container.innerHTML = '';
    
    Object.entries(currentDevices.lights || {}).forEach(([device, state]) => {
        const deviceElement = document.createElement('div');
        deviceElement.className = `device-compact-item ${state ? 'active' : ''}`;
        deviceElement.innerHTML = `
            <div class="device-compact-icon">
                <i class="fas fa-lightbulb ${state ? 'text-warning' : 'text-muted'}"></i>
            </div>
            <div class="device-compact-name">${getDeviceDisplayName(device)}</div>
            <label class="switch">
                <input type="checkbox" ${state ? 'checked' : ''} onchange="toggleDevice('lights', '${device}', this.checked)">
                <span class="slider"></span>
            </label>
        `;
        container.appendChild(deviceElement);
    });
}

function updateOutletsDisplay() {
    const container = document.getElementById('outlets-container');
    if (!container) return;

    container.innerHTML = '';
    
    Object.entries(currentDevices.outlets || {}).forEach(([device, state]) => {
        const deviceElement = document.createElement('div');
        deviceElement.className = `device-compact-item ${state ? 'active' : ''}`;
        deviceElement.innerHTML = `
            <div class="device-compact-icon">
                <i class="fas fa-plug ${state ? 'text-success' : 'text-muted'}"></i>
            </div>
            <div class="device-compact-name">${getDeviceDisplayName(device)}</div>
            <label class="switch">
                <input type="checkbox" ${state ? 'checked' : ''} onchange="toggleDevice('outlets', '${device}', this.checked)">
                <span class="slider"></span>
            </label>
        `;
        container.appendChild(deviceElement);
    });
}

function updateIrrigationDisplay() {
    const irrigation = currentDevices.irrigation || {};
    const statusElement = document.getElementById('irrigation-status');
    const modeElement = document.getElementById('irrigation-mode');
    const rainElement = document.getElementById('rain-avoidance');
    
    if (statusElement) {
        statusElement.textContent = irrigation.bomba_irrigacao ? 'LIGADA' : 'DESLIGADA';
        statusElement.className = irrigation.bomba_irrigacao ? 'status-on' : 'status-off';
    }
    
    if (modeElement) {
        modeElement.textContent = irrigation.modo === 'automatico' ? 'Automático' : 'Manual';
    }
    
    if (rainElement) {
        rainElement.textContent = irrigation.evitar_chuva ? 'Ativado' : 'Desativado';
    }
}

function getDeviceDisplayName(deviceKey) {
    const names = {
        // Lâmpadas
        'sala': 'Sala de Estar',
        'quarto1': 'Quarto Principal',
        'quarto2': 'Quarto 2',
        'quarto3': 'Quarto 3',
        'corredor': 'Corredor',
        'cozinha': 'Cozinha',
        'banheiro': 'Banheiro',
        
        // Tomadas
        'tomada_sala': 'Tomada Sala',
        'tomada_cozinha': 'Tomada Cozinha',
        'tomada_quarto1': 'Tomada Quarto 1',
        'tomada_quarto2': 'Tomada Quarto 2',
        'tomada_quarto3': 'Tomada Quarto 3'
    };
    
    return names[deviceKey] || deviceKey;
}

async function toggleDevice(type, device, state) {
    try {
        const response = await fetch('/api/control', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ type, device, state })
        });
        
        const data = await response.json();
        
        if (data.status === 'OK') {
            console.log(`✅ ${device}: ${state ? 'Ligado' : 'Desligado'}`);
            // Atualizar estado local
            if (currentDevices[type]) {
                currentDevices[type][device] = state;
            }
            updateDeviceDisplays();
        } else {
            console.error('❌ Erro ao controlar dispositivo:', data.error);
            // Reverter visualmente em caso de erro
            loadDevices();
        }
    } catch (error) {
        console.error('❌ Erro na comunicação:', error);
        loadDevices();
    }
}

async function controlAllLights(state) {
    const lights = currentDevices.lights || {};
    for (const device of Object.keys(lights)) {
        await toggleDevice('lights', device, state);
    }
}

async function controlAllOutlets(state) {
    const outlets = currentDevices.outlets || {};
    for (const device of Object.keys(outlets)) {
        await toggleDevice('outlets', device, state);
    }
}

async function controlIrrigation(state) {
    await toggleDevice('irrigation', 'bomba_irrigacao', state);
}

// Atualização de dados em tempo real
function startDataUpdates() {
    // Atualizar dados a cada 5 segundos
    setInterval(async () => {
        await loadDevices();
        await updateWeather();
        await updateESP32Status();
    }, 5000);
    
    // Carregar inicialmente
    loadDevices();
    updateWeather();
    updateESP32Status();
}

async function updateSensorData() {
    try {
        const response = await fetch('/api/data');
        const data = await response.json();
        
        if (data.data && data.data.length > 0) {
            const latest = data.data[0];
            
            // Atualizar temperatura
            const tempElement = document.getElementById('sensor-temperature');
            if (tempElement && latest.temperature !== undefined) {
                tempElement.textContent = `${latest.temperature}°C`;
            }
            
            // Atualizar umidade (simulada)
            const humidityElement = document.getElementById('sensor-humidity');
            if (humidityElement) {
                // Simular umidade baseada na temperatura
                const simulatedHumidity = Math.max(30, Math.min(80, 60 - (latest.temperature - 22) * 2));
                humidityElement.textContent = `${Math.round(simulatedHumidity)}%`;
            }
            
            // Atualizar gás
            const gasElement = document.getElementById('sensor-gas');
            if (gasElement && latest.gas_level !== undefined) {
                gasElement.textContent = latest.gas_level;
            }
            
            // Atualizar alerta
            const alertElement = document.getElementById('sensor-alert');
            if (alertElement) {
                const isAlert = latest.gas_alert || latest.gas_level > 300;
                alertElement.textContent = isAlert ? 'ALERTA!' : 'NORMAL';
                alertElement.style.color = isAlert ? '#ff4444' : '#4CAF50';
            }
        }
    } catch (error) {
        console.error('❌ Erro ao atualizar sensores:', error);
    }
}

async function updateWeather() {
    try {
        const response = await fetch('/api/weather');
        const data = await response.json();
        
        if (data && data.main) {
            // Temperatura
            const tempElement = document.getElementById('weather-temp');
            if (tempElement) {
                tempElement.textContent = `${Math.round(data.main.temp)}°C`;
            }
            
            // Umidade
            const humidityElement = document.getElementById('weather-humidity');
            if (humidityElement) {
                humidityElement.textContent = `${data.main.humidity}%`;
            }
            
            // Descrição
            const descElement = document.getElementById('weather-desc');
            if (descElement && data.weather && data.weather[0]) {
                descElement.textContent = data.weather[0].description;
            }
            
            // Ícone
            const iconElement = document.getElementById('weather-icon');
            if (iconElement && data.weather && data.weather[0]) {
                const weatherMain = data.weather[0].main.toLowerCase();
                iconElement.className = getWeatherIconClass(weatherMain);
            }
            
            // Horário
            const timeElement = document.getElementById('weather-time');
            if (timeElement) {
                const now = new Date();
                timeElement.textContent = `Atualizado: ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
            }
        }
    } catch (error) {
        console.error('❌ Erro ao atualizar clima:', error);
    }
}

function getWeatherIconClass(weatherMain) {
    const icons = {
        'clear': 'fas fa-sun weather-icon-sun',
        'clouds': 'fas fa-cloud weather-icon-cloud',
        'rain': 'fas fa-cloud-rain weather-icon-rain',
        'drizzle': 'fas fa-cloud-drizzle weather-icon-rain',
        'thunderstorm': 'fas fa-bolt weather-icon-storm',
        'snow': 'fas fa-snowflake weather-icon-snow',
        'mist': 'fas fa-smog weather-icon-mist',
        'fog': 'fas fa-smog weather-icon-mist'
    };
    
    return icons[weatherMain] || 'fas fa-cloud weather-icon-cloud';
}

async function updateESP32Status() {
    try {
        const response = await fetch('/api/esp32-status');
        const data = await response.json();
        
        const statusElement = document.getElementById('esp32-status');
        if (statusElement) {
            if (data.connected) {
                statusElement.className = 'esp32-indicator online';
                statusElement.innerHTML = '<i class="fas fa-microchip"></i><span>ESP32 Online</span>';
            } else {
                statusElement.className = 'esp32-indicator offline';
                statusElement.innerHTML = '<i class="fas fa-microchip"></i><span>ESP32 Offline</span>';
            }
        }
    } catch (error) {
        console.error('❌ Erro ao atualizar status ESP32:', error);
    }
}

// Modal de Irrigação
function openIrrigationModal() {
    const modal = document.getElementById('irrigation-modal');
    if (modal) {
        loadIrrigationSettings();
        modal.style.display = 'flex';
    }
}

function closeIrrigationModal() {
    const modal = document.getElementById('irrigation-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

function loadIrrigationSettings() {
    const irrigation = currentDevices.irrigation || {};
    
    // Modo
    const modeSelect = document.getElementById('irrigation-mode-select');
    if (modeSelect) {
        modeSelect.value = irrigation.modo || 'manual';
    }
    
    // Evitar chuva
    const rainCheckbox = document.getElementById('avoid-rain-checkbox');
    if (rainCheckbox) {
        rainCheckbox.checked = irrigation.evitar_chuva !== false;
    }
    
    // Programações
    updateProgrammingList();
}

function updateProgrammingList() {
    const programmingList = document.getElementById('programming-list');
    if (!programmingList) return;
    
    const programacoes = currentDevices.irrigation?.programacoes || [];
    
    programmingList.innerHTML = '';
    
    if (programacoes.length === 0) {
        programmingList.innerHTML = '<p style="text-align: center; color: #666;">Nenhuma programação configurada</p>';
        return;
    }
    
    programacoes.forEach((prog, index) => {
        const progElement = document.createElement('div');
        progElement.className = 'programming-item';
        progElement.innerHTML = `
            <div class="programming-header">
                <span class="programming-time">${prog.hora}</span>
                <button class="delete-programming" onclick="deleteProgramming(${index})">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
            <div class="programming-days">
                Dias: ${prog.dias ? prog.dias.join(', ') : 'Todos'}
            </div>
        `;
        programmingList.appendChild(progElement);
    });
}

function addProgramming() {
    const hora = prompt('Digite o horário (HH:MM):');
    if (!hora) return;
    
    const dias = prompt('Digite os dias (ex: seg,ter,qua ou * para todos):', '*');
    if (!dias) return;
    
    const programacoes = currentDevices.irrigation?.programacoes || [];
    programacoes.push({
        hora: hora,
        dias: dias === '*' ? [] : dias.split(',')
    });
    
    if (!currentDevices.irrigation) currentDevices.irrigation = {};
    currentDevices.irrigation.programacoes = programacoes;
    
    updateProgrammingList();
}

function deleteProgramming(index) {
    const programacoes = currentDevices.irrigation?.programacoes || [];
    programacoes.splice(index, 1);
    updateProgrammingList();
}

async function saveIrrigationSettings() {
    try {
        const modeSelect = document.getElementById('irrigation-mode-select');
        const rainCheckbox = document.getElementById('avoid-rain-checkbox');
        
        const settings = {
            modo: modeSelect?.value || 'manual',
            evitar_chuva: rainCheckbox?.checked !== false,
            programacoes: currentDevices.irrigation?.programacoes || []
        };
        
        const response = await fetch('/api/irrigation/save', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(settings)
        });
        
        const data = await response.json();
        
        if (data.status === 'OK') {
            console.log('✅ Configurações de irrigação salvas');
            closeIrrigationModal();
            loadDevices(); // Recarregar dados
        } else {
            console.error('❌ Erro ao salvar configurações:', data.error);
            alert('Erro ao salvar configurações: ' + data.error);
        }
    } catch (error) {
        console.error('❌ Erro ao salvar configurações:', error);
        alert('Erro de conexão ao salvar configurações');
    }
}

async function checkWeather() {
    try {
        const response = await fetch('/api/weather/raining');
        const data = await response.json();
        
        if (data.raining) {
            alert('⚠️ Está chovendo! A irrigação pode ser bloqueada.');
        } else {
            alert('☀️ Tempo seco - Irrigação permitida.');
        }
    } catch (error) {
        console.error('❌ Erro ao verificar clima:', error);
        alert('Erro ao verificar condições climáticas');
    }
}

// Prevenir fechamento acidental
window.addEventListener('beforeunload', function (e) {
    // Opcional: Confirmar saída se houver operações pendentes
});

// 🚨 CORREÇÃO: Exportar funções globais
window.controlAllLights = controlAllLights;
window.controlAllOutlets = controlAllOutlets;
window.controlIrrigation = controlIrrigation;
window.openIrrigationModal = openIrrigationModal;
window.closeIrrigationModal = closeIrrigationModal;
window.saveIrrigationSettings = saveIrrigationSettings;
window.checkWeather = checkWeather;
window.toggleDevice = toggleDevice;
window.addProgramming = addProgramming;
window.deleteProgramming = deleteProgramming;