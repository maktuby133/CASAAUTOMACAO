// public/script.js - Cliente CORRIGIDO (Versão Final com Tratamento de Erro Robusto)

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
    
    if (loginForm) {
        loginForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;
            
            try {
                // A requisição de login SETA o cookie e não precisa enviá-lo
                const response = await fetch('/api/login', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ username, password })
                });
                
                const data = await response.json();
                
                if (data.success) {
                    // Salva autenticação no localStorage para referência rápida
                    localStorage.setItem('casa-automacao-authenticated', 'true');
                    localStorage.setItem('casa-automacao-user', JSON.stringify({
                        username: username,
                        loginTime: new Date().toISOString()
                    }));
                    window.location.href = data.redirect;
                } else {
                    showNotification(data.message, 'error');
                }
            } catch (error) {
                console.error('❌ Erro no login:', error);
                showNotification('Erro de conexão com o servidor', 'error');
            }
        });
    }
}

function handleSystemPage() {
    console.log('🔧 Página do sistema carregada');
    // Chama a verificação de autenticação
    checkSystemAuth();
    // Configurar botão de logout se existir
    const logoutBtn = document.querySelector('.logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', logout);
    }
}

// Verifica se o cookie de autenticação está presente
async function checkSystemAuth() {
    try {
        const response = await fetch('/api/status', { credentials: 'include' });
        const data = await response.json();
        
        if (!data.authenticated) {
            console.log('❌ Não autenticado, redirecionando...');
            window.location.href = '/login.html';
        } else {
            initializeSystem();
        }
    } catch (error) {
        console.error('❌ Erro ao verificar auth:', error);
        window.location.href = '/login.html';
    }
}

function initializeSystem() {
    console.log('✅ Sistema autenticado, inicializando...');
    
    // Chama a função de atualização de dados
    startDataUpdates(); 
    
    // Carregar tema
    const savedTheme = loadFromLocalStorage('theme') || 'light';
    document.body.setAttribute('data-theme', savedTheme);
    const themeIcon = document.querySelector('.theme-toggle i');
    if (themeIcon) {
        themeIcon.className = savedTheme === 'dark' ?
        'fas fa-sun' : 'fas fa-moon';
    }
    
    showNotification('Sistema inicializado com sucesso!', 'success', 3000);
}

// Faz o logout e limpa o cookie
async function logout() {
    try {
        const response = await fetch('/api/logout', {
            method: 'POST',
            credentials: 'include'
        });
        
        const data = await response.json();
        
        if (data.success) {
            localStorage.removeItem('casa-automacao-authenticated');
            localStorage.removeItem('casa-automacao-user');
            window.location.href = data.redirect;
        }
    } catch (error) {
        console.error('❌ Erro no logout:', error);
        window.location.href = '/login.html';
    }
}

// ==================== SISTEMA DE AUTOMAÇÃO - FUNÇÕES PRINCIPAIS ====================
let currentDevices = {};
let sensorData = [];
let weatherData = null;
let lastWeatherUpdate = 0;
const WEATHER_UPDATE_INTERVAL = 600000; // 10 minutos
let systemStatus = 'ONLINE'; 

// Definição da função de atualização de dados (evita erro de "função não definida")
function startDataUpdates() {
    // Carregamento inicial de todos os dados
    loadDevices();
    fetchSensorData();
    updateWeather();
    
    // Configura os intervalos de atualização
    setInterval(loadDevices, 5000);
    setInterval(fetchSensorData, 5000);
    setInterval(updateWeather, WEATHER_UPDATE_INTERVAL); // 10 minutos
    
    console.log('🔄 Atualizações de dados iniciadas');
}


// 🚨 CORREÇÃO CRÍTICA: Tratamento de erro 401/403 adicionado
async function loadDevices() {
    try {
        const response = await fetch('/api/devices', { credentials: 'include' });
        
        if (response.status === 401 || response.status === 403) {
            showNotification('Sessão expirada. Redirecionando para login.', 'danger', 3000);
            // Redireciona após o aviso
            setTimeout(() => window.location.href = '/login.html', 1500);
            return;
        }

        if (!response.ok) {
             throw new Error(`Erro de rede ao carregar dispositivos: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
        currentDevices = data;
        updateDeviceDisplays();
        // Inclui status do ESP32 na checagem de dispositivos
        updateESP32Status(data.esp32Status?.connected ? 'ONLINE' : 'OFFLINE', data.esp32Status?.lastSeen);
    } catch (error) {
        console.error('❌ Erro ao carregar dispositivos:', error);
        showNotification('Erro ao carregar dados dos dispositivos. Verifique o console.', 'error', 7000);
    }
}

function updateDeviceDisplays() {
    updateLightsDisplay();
    updateOutletsDisplay();
    updateIrrigationDisplay();
    checkConnection(); // Chama a verificação de conexão (online/offline)
}


function updateLightsDisplay() {
    const lightsDiv = document.getElementById('lights-control');
    if (!lightsDiv) return;
    lightsDiv.innerHTML = '';

    // Botões de controle geral
    const allControl = document.createElement('div');
    allControl.className = 'device-grid-item-all';
    allControl.innerHTML = `
        <h3>Geral</h3>
        <button class="btn btn-success" onclick="controlAllLights(true)">
            <i class="fas fa-lightbulb"></i> Ligar Tudo
        </button>
        <button class="btn btn-danger" onclick="controlAllLights(false)">
            <i class="fas fa-lightbulb-slash"></i> Desligar Tudo
        </button>
    `;
    lightsDiv.appendChild(allControl);
    
    for (const [deviceKey, state] of Object.entries(currentDevices.lights || {})) {
        const item = document.createElement('div');
        item.className = 'device-grid-item';
        item.innerHTML = `
            <h4>${getDeviceDisplayName(deviceKey)}</h4>
            <i class="fas fa-lightbulb icon ${state ? 'active' : 'inactive'}"></i>
            <span class="status-label ${state ? 'status-on' : 'status-off'}">${state ? 'Ligada' : 'Desligada'}</span>
            <button class="btn ${state ? 'btn-warning' : 'btn-success'}" onclick="toggleDevice('lights', '${deviceKey}', ${!state})">
                ${state ? 'Desligar' : 'Ligar'}
            </button>
        `;
        lightsDiv.appendChild(item);
    }
}

function updateOutletsDisplay() {
    const outletsDiv = document.getElementById('outlets-control');
    if (!outletsDiv) return;
    outletsDiv.innerHTML = '';
    
    // Botões de controle geral
    const allControl = document.createElement('div');
    allControl.className = 'device-grid-item-all';
    allControl.innerHTML = `
        <h3>Geral</h3>
        <button class="btn btn-success" onclick="controlAllOutlets(true)">
            <i class="fas fa-plug"></i> Ligar Tudo
        </button>
        <button class="btn btn-danger" onclick="controlAllOutlets(false)">
            <i class="fas fa-plug"></i> Desligar Tudo
        </button>
    `;
    outletsDiv.appendChild(allControl);

    for (const [deviceKey, state] of Object.entries(currentDevices.outlets || {})) {
        const item = document.createElement('div');
        item.className = 'device-grid-item';
        item.innerHTML = `
            <h4>${getDeviceDisplayName(deviceKey)}</h4>
            <i class="fas fa-plug icon ${state ? 'active' : 'inactive'}"></i>
            <span class="status-label ${state ? 'status-on' : 'status-off'}">${state ? 'Ligada' : 'Desligada'}</span>
            <button class="btn ${state ? 'btn-warning' : 'btn-success'}" onclick="toggleDevice('outlets', '${deviceKey}', ${!state})">
                ${state ? 'Desligar' : 'Ligar'}
            </button>
        `;
        outletsDiv.appendChild(item);
    }
}

function updateIrrigationDisplay() {
    const irrigationDiv = document.getElementById('irrigation-control');
    if (!irrigationDiv) return;

    const pumpState = currentDevices.irrigation?.bomba_irrigacao;
    const mode = currentDevices.irrigation?.modo || 'manual';

    // Se a bomba de irrigação não estiver definida, usa um valor padrão.
    const isRunning = pumpState || false;

    // Atualiza o card de irrigação
    const statusText = isRunning ? 'Ativada' : 'Desativada';
    const statusClass = isRunning ? 'status-on' : 'status-off';
    const btnText = isRunning ? 'Desativar' : 'Ativar';
    const btnClass = isRunning ? 'btn-danger' : 'btn-success';
    const iconClass = isRunning ? 'fa-tint' : 'fa-hand-holding-water';

    irrigationDiv.innerHTML = `
        <div class="card-header">
            <h3>💧 Irrigação</h3>
            <i class="fas fa-cog config-icon" onclick="openIrrigationModal()"></i>
        </div>
        <div class="card-content">
            <p><strong>Status:</strong> <span class="${statusClass}">${statusText}</span></p>
            <p><strong>Modo:</strong> <span class="status-label status-info">${mode.toUpperCase()}</span></p>
            <button class="btn ${btnClass}" onclick="controlIrrigation(${!isRunning})">
                <i class="fas ${iconClass}"></i> ${btnText} Irrigação
            </button>
        </div>
    `;

    // Atualiza o modal (se estiver aberto)
    const modeSelect = document.getElementById('irrigation-mode-select');
    if (modeSelect) {
        modeSelect.value = mode;
        updateIrrigationModeDisplay(mode);
        document.getElementById('rain-avoidance-checkbox').checked = currentDevices.irrigation?.evitar_chuva || false;
        document.getElementById('irrigation-duration').value = currentDevices.irrigation?.duracao || 5;
        
        // Atualizar programações
        const progList = document.getElementById('programming-list');
        progList.innerHTML = '';
        (currentDevices.irrigation?.programacoes || []).forEach(prog => {
            renderProgrammingItem(prog.hora, prog.dias);
        });
    }
}

function updateIrrigationModeDisplay(mode) {
    const manualControls = document.getElementById('manual-controls');
    const autoControls = document.getElementById('automatic-controls');
    
    if (manualControls) manualControls.style.display = mode === 'manual' ? 'block' : 'none';
    if (autoControls) autoControls.style.display = mode === 'automatico' ? 'block' : 'none';
}

function getDeviceDisplayName(deviceKey) {
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

// Ligar/Desligar Dispositivo
async function toggleDevice(type, device, state) {
    try {
        const response = await fetch('/api/control', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ type, device, state }),
            credentials: 'include' 
        });
        
        if (response.status === 401 || response.status === 403) {
            showNotification('Sessão expirada. Redirecionando para login.', 'danger', 3000);
            setTimeout(() => window.location.href = '/login.html', 1500);
            return;
        }

        const data = await response.json();
        if (data.status === 'OK') {
            console.log(`✅ ${device}: ${state ? 'Ligado' : 'Desligado'}`);
            showNotification(`${getDeviceDisplayName(device)} ${state ? 'ligado' : 'desligado'}`, 'success');
            
            // Atualizar estado local
            if (currentDevices[type]) {
                currentDevices[type][device] = state;
            }
            updateDeviceDisplays();
        } else {
            console.error('❌ Erro ao controlar dispositivo:', data.error);
            showNotification(`Erro: ${data.error}`, 'error');
            loadDevices();
        }
    } catch (error) {
        console.error('❌ Erro na comunicação:', error);
        showNotification('Erro de conexão com o servidor', 'error');
        loadDevices();
    }
}

async function controlAllLights(state) {
    const lights = currentDevices.lights || {};
    const action = state ? 'ligadas' : 'desligadas';
    
    try {
        for (const device of Object.keys(lights)) {
            await toggleDevice('lights', device, state);
        }
        showNotification(`Todas as lâmpadas ${action}`, 'success');
    } catch (error) {
        console.error('❌ Erro ao controlar lâmpadas:', error);
    }
}

async function controlAllOutlets(state) {
    const outlets = currentDevices.outlets || {};
    const action = state ? 'ligadas' : 'desligadas';
    
    try {
        for (const device of Object.keys(outlets)) {
            await toggleDevice('outlets', device, state);
        }
        showNotification(`Todas as tomadas ${action}`, 'success');
    } catch (error) {
        console.error('❌ Erro ao controlar tomadas:', error);
    }
}

// Controle de Irrigação
async function controlIrrigation(state) {
    const action = state ? 'ligar' : 'desligar';
    try {
        const response = await fetch('/api/irrigation/control', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ state }),
            credentials: 'include'
        });
        
        if (response.status === 401 || response.status === 403) {
            showNotification('Sessão expirada. Redirecionando para login.', 'danger', 3000);
            setTimeout(() => window.location.href = '/login.html', 1500);
            return;
        }

        const data = await response.json();
        if (data.status === 'OK') {
            showNotification(`💧 Irrigação ${state ? 'ativada' : 'desativada'}`, 'success');
            loadDevices();
        } else {
            showNotification(`Erro: ${data.error}`, 'error');
        }
    } catch (error) {
        console.error(`❌ Erro ao ${action} irrigação:`, error);
        showNotification('Erro de conexão com o servidor', 'error');
    }
}

// Salvar Configurações de Irrigação
async function saveIrrigationSettings() {
    const mode = document.getElementById('irrigation-mode-select')?.value;
    const rainAvoidance = document.getElementById('rain-avoidance-checkbox')?.checked;
    const durationInput = document.getElementById('irrigation-duration');
    
    if (mode === 'automatico' && getSelectedProgrammings().length === 0) {
        showNotification('Adicione pelo menos uma programação para o modo automático.', 'warning');
        return;
    }

    const settings = {
        modo: mode,
        evitar_chuva: rainAvoidance,
        duracao: parseInt(durationInput?.value) || 5,
        programacoes: getSelectedProgrammings()
    };
    
    console.log('💧 Enviando configurações para servidor:', settings);

    try {
        const response = await fetch('/api/irrigation/save', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(settings),
            credentials: 'include'
        });
        
        if (response.status === 401 || response.status === 403) {
            showNotification('Sessão expirada. Redirecionando para login.', 'danger', 3000);
            setTimeout(() => window.location.href = '/login.html', 1500);
            return;
        }

        const data = await response.json();
        if (data.status === 'OK') {
            console.log('✅ Configurações de irrigação salvas com sucesso');
            console.log('📋 Dados salvos:', data.savedData);
            showNotification('Configurações salvas com sucesso!', 'success');
            closeIrrigationModal();
            loadDevices();
        } else {
            console.error('❌ Erro ao salvar configurações:', data.error);
            showNotification('Erro ao salvar configurações: ' + data.error, 'error');
        }
    } catch (error) {
        console.error('❌ Erro ao salvar configurações:', error);
        showNotification('Erro de conexão ao salvar configurações', 'error');
    }
}

// Funções do Modal de Irrigação
function openIrrigationModal() {
    document.getElementById('irrigation-modal').classList.add('show');
    // Garante que os dados mais recentes sejam carregados ao abrir
    if (currentDevices.irrigation) {
        const mode = currentDevices.irrigation.modo || 'manual';
        document.getElementById('irrigation-mode-select').value = mode;
        updateIrrigationModeDisplay(mode);
        document.getElementById('rain-avoidance-checkbox').checked = currentDevices.irrigation.evitar_chuva || false;
        document.getElementById('irrigation-duration').value = currentDevices.irrigation.duracao || 5;
        
        // Renderizar programações salvas
        const progList = document.getElementById('programming-list');
        progList.innerHTML = '';
        (currentDevices.irrigation.programacoes || []).forEach(prog => {
            renderProgrammingItem(prog.hora, prog.dias);
        });
    }
}

function closeIrrigationModal() {
    document.getElementById('irrigation-modal').classList.remove('show');
}

// Funções de Programação
function showTimePicker(button) {
    const timeInput = document.createElement('input');
    timeInput.type = 'time';
    timeInput.value = '08:00';
    timeInput.style.position = 'absolute';
    timeInput.style.opacity = 0;
    timeInput.style.pointerEvents = 'none';

    document.body.appendChild(timeInput);
    timeInput.focus();
    timeInput.click();

    timeInput.onchange = () => {
        button.textContent = timeInput.value;
        document.body.removeChild(timeInput);
    };
    
    timeInput.onblur = () => {
        // Remove se o usuário clicar fora sem selecionar
        if (document.body.contains(timeInput)) {
            document.body.removeChild(timeInput);
        }
    };
}

function addProgramming() {
    renderProgrammingItem('08:00', ['SEG', 'TER', 'QUA', 'QUI', 'SEX']);
}

function removeProgramming(button) {
    button.closest('.programming-item').remove();
}

function renderProgrammingItem(time, days) {
    const progList = document.getElementById('programming-list');
    const item = document.createElement('div');
    item.className = 'programming-item';
    item.innerHTML = `
        <button class="time-btn" onclick="showTimePicker(this)">${time}</button>
        <div class="day-selectors">
            ${['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM'].map(day => `
                <button class="day-btn ${days.includes(day) ? 'active' : ''}" data-day="${day}" onclick="this.classList.toggle('active')">${day}</button>
            `).join('')}
        </div>
        <button class="remove-btn" onclick="removeProgramming(this)"><i class="fas fa-trash"></i></button>
    `;
    progList.appendChild(item);
}

function getSelectedProgrammings() {
    const programacoes = [];
    const items = document.querySelectorAll('.programming-item');
    
    items.forEach(item => {
        const time = item.querySelector('.time-btn').textContent;
        const selectedDays = Array.from(item.querySelectorAll('.day-btn.active'))
                                .map(btn => btn.getAttribute('data-day'));
        
        programacoes.push({
            hora: time,
            dias: selectedDays
        });
    });
    return programacoes;
}

// Funções de Sensores e Clima

function updateSensorData() {
    const tempElement = document.getElementById('sensor-temp');
    const humidityElement = document.getElementById('sensor-humidity');
    const gasElement = document.getElementById('sensor-gas');

    if (sensorData.length > 0) {
        const latest = sensorData[sensorData.length - 1];
        if (tempElement) tempElement.textContent = `${latest.temperatura.toFixed(1)}°C`;
        if (humidityElement) humidityElement.textContent = `${latest.umidade.toFixed(1)}%`;

        let gasStatus;
        if (latest.nivelGas === 0) {
            gasStatus = 'NORMAL';
            gasElement.className = 'status-on';
        } else if (latest.nivelGas === 1) {
            gasStatus = 'MODERADO';
            gasElement.className = 'status-warning';
        } else {
            gasStatus = 'PERIGO!';
            gasElement.className = 'status-danger';
        }
        if (gasElement) gasElement.textContent = gasStatus;

        // Se o nível de gás for perigoso, mostre um alerta
        if (latest.nivelGas === 2) {
            showNotification('🚨 ALERTA DE GÁS! Perigo de Vazamento!', 'danger', 0);
        }
    } else {
        if (tempElement) tempElement.textContent = '--';
        if (humidityElement) humidityElement.textContent = '--';
        if (gasElement) gasElement.textContent = 'N/A';
    }
}

function updateESP32Status(status, lastSeen) {
    const esp32StatusElement = document.getElementById('esp32-status');
    const esp32LastSeenElement = document.getElementById('esp32-last-seen');

    systemStatus = status;

    if (esp32StatusElement) {
        esp32StatusElement.textContent = status;
        esp32StatusElement.className = '';
        if (status === 'ONLINE') esp32StatusElement.classList.add('status-on');
        else if (status === 'OFFLINE') esp32StatusElement.classList.add('status-danger');
        else esp32StatusElement.classList.add('status-warning');
    }
    
    if (esp32LastSeenElement && lastSeen) {
        const date = new Date(lastSeen);
        esp32LastSeenElement.textContent = `Última atualização: ${date.toLocaleTimeString('pt-BR')}`;
    } else if (esp32LastSeenElement) {
        esp32LastSeenElement.textContent = 'Última atualização: N/A';
    }
}

// 🚨 CORREÇÃO CRÍTICA: Tratamento de erro 401/403 adicionado
async function fetchSensorData() {
    try {
        const response = await fetch('/api/sensor-data', { credentials: 'include' });
        
        if (response.status === 401 || response.status === 403) {
            showNotification('Sessão expirada. Redirecionando para login.', 'danger', 3000);
            setTimeout(() => window.location.href = '/login.html', 1500);
            return;
        }

        if (!response.ok) {
             throw new Error(`Erro de rede ao carregar sensores: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        sensorData = data.sensorData || [];
        updateSensorData();
    } catch (error) {
        console.error('❌ Erro ao buscar dados do sensor:', error);
        showNotification('Erro ao carregar dados dos sensores. Verifique o console.', 'error', 7000);
    }
}

async function updateWeather() {
    const now = Date.now();
    // Use the global constant for interval check
    if (weatherData && (now - lastWeatherUpdate < WEATHER_UPDATE_INTERVAL)) {
        renderWeather();
        return;
    }

    // Não precisa de credentials, pois esta rota é pública (no server.js)
    try {
        const response = await fetch('/api/weather'); 
        const data = await response.json();
        if (data.status === 'OK') {
            weatherData = data.weather;
            lastWeatherUpdate = now;
            renderWeather();
        } else {
            console.error('❌ Erro ao buscar dados do clima:', data.message);
        }
    } catch (error) {
        console.error('❌ Erro ao carregar clima:', error);
    }
}

function renderWeather() {
    const weatherElement = document.getElementById('weather-info');
    if (!weatherElement || !weatherData) return;

    const { name, main, weather } = weatherData;
    const icon = getWeatherIcon(weather[0].icon);

    weatherElement.innerHTML = `
        <i class="weather-icon fas ${icon}"></i>
        <div class="weather-details">
            <p class="city">${name}</p>
            <p class="temp">${main.temp.toFixed(1)}°C</p>
            <p class="description">${weather[0].description}</p>
        </div>
        <div class="weather-extra">
            <p>Umidade: ${main.humidity}%</p>
            <p>Máx: ${main.temp_max.toFixed(1)}°C</p>
            <p>Mín: ${main.temp_min.toFixed(1)}°C</p>
        </div>
    `;
}

function getWeatherIcon(iconCode) {
    const icons = {
        '01d': 'fa-sun', '01n': 'fa-moon',
        '02d': 'fa-cloud-sun', '02n': 'fa-cloud-moon',
        '03d': 'fa-cloud', '03n': 'fa-cloud',
        '04d': 'fa-cloud-meatball', '04n': 'fa-cloud-meatball',
        '09d': 'fa-cloud-showers-heavy', '09n': 'fa-cloud-showers-heavy',
        '10d': 'fa-cloud-sun-rain', '10n': 'fa-cloud-moon-rain',
        '11d': 'fa-bolt', '11n': 'fa-bolt',
        '13d': 'fa-snowflake', '13n': 'fa-snowflake',
        '50d': 'fa-smog', '50n': 'fa-smog'
    };
    return icons[iconCode] || 'fa-question-circle';
}

async function checkWeather() {
    await updateWeather();
    if (weatherData && weatherData.weather[0].main.toLowerCase().includes('rain')) {
        showNotification('Alerta: Possibilidade de chuva detectada.', 'warning');
        return true;
    }
    return false;
}

// Funções de Interface
function showNotification(message, type = 'info', duration = 5000) {
    const container = document.getElementById('notification-container');
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
        <i class="fas ${getNotificationIcon(type)}"></i>
        <span>${message}</span>
    `;

    container.appendChild(notification);

    // Auto-destruição
    if (duration > 0) {
        setTimeout(() => {
            notification.classList.add('hide');
            notification.addEventListener('transitionend', () => notification.remove());
        }, duration);
    }
}

function getNotificationIcon(type) {
    switch(type) {
        case 'success': return 'fa-check-circle';
        case 'error': case 'danger': return 'fa-times-circle';
        case 'warning': return 'fa-exclamation-triangle';
        default: return 'fa-info-circle';
    }
}

function checkConnection() {
    const connectionStatus = document.getElementById('connection-status');
    if (navigator.onLine) {
        connectionStatus.textContent = 'Online';
        connectionStatus.className = 'connection-status online';
    } else {
        connectionStatus.textContent = 'Offline';
        connectionStatus.className = 'connection-status offline';
    }
}

function toggleTheme() {
    const body = document.body;
    const themeIcon = document.querySelector('.theme-toggle i');
    const currentTheme = body.getAttribute('data-theme');
    
    if (currentTheme === 'dark') {
        body.setAttribute('data-theme', 'light');
        localStorage.setItem('theme', 'light');
        if (themeIcon) themeIcon.className = 'fas fa-moon';
    } else {
        body.setAttribute('data-theme', 'dark');
        localStorage.setItem('theme', 'dark');
        if (themeIcon) themeIcon.className = 'fas fa-sun';
    }
}

function loadFromLocalStorage(key) {
    try {
        return localStorage.getItem(key);
    } catch (e) {
        console.error('Erro ao ler do localStorage:', e);
        return null;
    }
}

// Inicia as verificações de conexão
checkConnection();
window.addEventListener('online', checkConnection);
window.addEventListener('offline', checkConnection);

// Fechar modal clicando fora
const modal = document.getElementById('irrigation-modal');
if (modal) {
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            closeIrrigationModal();
        }
    });
}

// Exportar todas as funções globais
window.controlAllLights = controlAllLights;
window.controlAllOutlets = controlAllOutlets;
window.controlIrrigation = controlIrrigation;
window.openIrrigationModal = openIrrigationModal;
window.closeIrrigationModal = closeIrrigationModal;
window.saveIrrigationSettings = saveIrrigationSettings;
window.checkWeather = checkWeather;
window.toggleDevice = toggleDevice;
window.addProgramming = addProgramming;
window.removeProgramming = removeProgramming;
window.showTimePicker = showTimePicker;
window.updateWeather = updateWeather;
window.showNotification = showNotification;
window.logout = logout;
window.toggleTheme = toggleTheme;
