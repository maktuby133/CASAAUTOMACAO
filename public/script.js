// public/script.js - Cliente CORRIGIDO

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
                const response = await fetch('/api/login', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ username, password })
                });
                
                const data = await response.json();
                
                if (data.success) {
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

// ✅ CORREÇÃO: Função assíncrona adicionada
async function handleSystemPage() {
    console.log('🔧 Página do sistema carregada');
    
    // ✅ CORREÇÃO: Aguardar verificação de autenticação
    await checkSystemAuth();
    
    // Configurar botão de logout se existir
    const logoutBtn = document.querySelector('.logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', logout);
    }
}

// Verificação apenas para páginas do sistema
async function checkSystemAuth() {
    try {
        const response = await fetch('/api/status');
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

// Função para inicializar o sistema
function initializeSystem() {
    console.log('✅ Sistema autenticado, inicializando...');
    startDataUpdates();
    
    // Carregar tema
    const savedTheme = loadFromLocalStorage('theme') || 'light';
    document.body.setAttribute('data-theme', savedTheme);
    const themeIcon = document.querySelector('.theme-toggle i');
    if (themeIcon) {
        themeIcon.className = savedTheme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
    }
    
    showNotification('Sistema inicializado com sucesso!', 'success', 3000);
}

// Logout function
async function logout() {
    try {
        const response = await fetch('/api/logout', {
            method: 'POST'
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

// Adicionar função global para logout
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
                <img src="${state ? 'https://img.icons8.com/?size=100&id=KgisVcJhnUAQ&format=png&color=000000' : 'https://img.icons8.com/?size=100&id=55787&format=png&color=000000'}" 
                     alt="${device}" class="${state ? 'lamp-icon-on' : 'lamp-icon-off'}">
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
                <i class="fas fa-plug" style="color: ${state ? '#4CAF50' : '#666'}"></i>
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
    const largeIcon = document.getElementById('irrigation-large-icon');
    
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

    if (largeIcon) {
        largeIcon.src = irrigation.bomba_irrigacao ? 
            'https://img.icons8.com/?size=100&id=W0H2A502ZxcY&format=png&color=000000' : 
            'https://img.icons8.com/?size=100&id=0T39sTznXkBt&format=png&color=000000';
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
            showNotification(`${getDeviceDisplayName(device)} ${state ? 'ligado' : 'desligado'}`, 'success');
            
            // Atualizar estado local
            if (currentDevices[type]) {
                currentDevices[type][device] = state;
            }
            updateDeviceDisplays();
        } else {
            console.error('❌ Erro ao controlar dispositivo:', data.error);
            showNotification(`Erro: ${data.error}`, 'error');
            // Reverter visualmente em caso de erro
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

async function controlIrrigation(state) {
    try {
        const response = await fetch('/api/irrigation/control', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ state })
        });
        
        const data = await response.json();
        
        if (data.status === 'OK') {
            const action = state ? 'ligada' : 'desligada';
            console.log(`💧 Bomba ${action}`);
            showNotification(`Bomba de irrigação ${action}`, 'success');
            
            // Atualizar estado local
            if (currentDevices.irrigation) {
                currentDevices.irrigation.bomba_irrigacao = state;
            }
            updateIrrigationDisplay();
        } else {
            console.error('❌ Erro ao controlar irrigação:', data.error);
            showNotification(`Erro: ${data.error}`, 'error');
            loadDevices();
        }
    } catch (error) {
        console.error('❌ Erro na comunicação:', error);
        showNotification('Erro de conexão com o servidor', 'error');
        loadDevices();
    }
}

// Atualização de dados em tempo real
function startDataUpdates() {
    // Atualizar dados a cada 5 segundos
    setInterval(async () => {
        await loadDevices();
        await updateSensorData();
    }, 5000);
    
    // Atualizar clima a cada 15 minutos
    setInterval(() => {
        updateWeather();
    }, 15 * 60 * 1000);
    
    // Carregar inicialmente
    loadDevices();
    updateWeather();
    updateSensorData();
}

// Atualização de dados dos sensores com umidade correta
async function updateSensorData() {
    try {
        const response = await fetch('/api/sensor-data');
        const data = await response.json();
        
        if (data.data && data.data.length > 0) {
            const latest = data.data[0];
            
            // Atualizar temperatura
            const tempElement = document.getElementById('sensor-temperature');
            if (tempElement && latest.temperature !== undefined) {
                tempElement.textContent = `${latest.temperature}°C`;
                
                // Mudar cor baseada na temperatura
                if (latest.temperature > 30) {
                    tempElement.style.color = '#ff4444';
                } else if (latest.temperature < 15) {
                    tempElement.style.color = '#4444ff';
                } else {
                    tempElement.style.color = 'white';
                }
            }
            
            // Atualizar umidade REAL do ESP32
            const humidityElement = document.getElementById('sensor-humidity');
            if (humidityElement && latest.humidity !== undefined) {
                humidityElement.textContent = `${Math.round(latest.humidity)}%`;
                
                // Mudar cor baseada na umidade
                if (latest.humidity > 80) {
                    humidityElement.style.color = '#4444ff';
                } else if (latest.humidity < 30) {
                    humidityElement.style.color = '#ffaa00';
                } else {
                    humidityElement.style.color = 'white';
                }
            }
            
            // Atualizar gás
            const gasElement = document.getElementById('sensor-gas');
            if (gasElement && latest.gas_level !== undefined) {
                gasElement.textContent = latest.gas_level;
                
                // Mudar cor baseada no nível de gás
                if (latest.gas_level > 500) {
                    gasElement.style.color = '#ff4444';
                } else if (latest.gas_level > 300) {
                    gasElement.style.color = '#ffaa00';
                } else {
                    gasElement.style.color = 'white';
                }
            }
            
            // Atualizar alerta
            const alertElement = document.getElementById('sensor-alert');
            if (alertElement) {
                const isAlert = latest.gas_alert || latest.gas_level > 300;
                alertElement.textContent = isAlert ? 'ALERTA!' : 'NORMAL';
                alertElement.style.color = isAlert ? '#ff4444' : '#4CAF50';
                alertElement.style.fontWeight = isAlert ? 'bold' : 'normal';
                
                if (isAlert && latest.gas_level > 500) {
                    showNotification('⚠️ ALERTA CRÍTICO: Nível de gás muito alto!', 'error');
                } else if (isAlert) {
                    showNotification('⚠️ Alerta: Nível de gás elevado', 'warning');
                }
            }
        }

        // Atualizar status ESP32
        const esp32StatusElement = document.getElementById('esp32-header-status');
        if (esp32StatusElement) {
            if (data.esp32.connected) {
                esp32StatusElement.className = 'esp32-header-status online';
                esp32StatusElement.innerHTML = '<i class="fas fa-microchip"></i><span>ESP32 Online</span>';
            } else {
                esp32StatusElement.className = 'esp32-header-status offline';
                esp32StatusElement.innerHTML = '<i class="fas fa-microchip"></i><span>ESP32 Offline</span>';
            }
        }
    } catch (error) {
        console.error('❌ Erro ao atualizar sensores:', error);
    }
}

// METEOROLOGIA EXPANDIDA
async function updateWeather() {
    try {
        const response = await fetch('/api/weather');
        const data = await response.json();
        
        if (data && data.main) {
            // Temperatura principal
            const mainTempElement = document.getElementById('weather-main-temp');
            if (mainTempElement) {
                mainTempElement.textContent = `${Math.round(data.main.temp)}°C`;
            }
            
            // Descrição principal
            const mainDescElement = document.getElementById('weather-main-desc');
            if (mainDescElement && data.weather && data.weather[0]) {
                mainDescElement.textContent = data.weather[0].description;
            }
            
            // Ícone principal
            const mainIconElement = document.getElementById('weather-main-icon');
            if (mainIconElement && data.weather && data.weather[0]) {
                const weatherMain = data.weather[0].main.toLowerCase();
                mainIconElement.className = `fas ${getWeatherMainIcon(weatherMain)} weather-icon-large ${getWeatherAnimationClass(weatherMain)}`;
            }
            
            // Sensação térmica
            const feelsLikeElement = document.getElementById('weather-feels-like');
            if (feelsLikeElement) {
                feelsLikeElement.textContent = `${Math.round(data.main.feels_like)}°C`;
            }
            
            // Umidade
            const humidityElement = document.getElementById('weather-humidity');
            if (humidityElement) {
                humidityElement.textContent = `${data.main.humidity}%`;
            }
            
            // Vento
            const windElement = document.getElementById('weather-wind');
            if (windElement && data.wind) {
                windElement.textContent = `${Math.round(data.wind.speed * 3.6)} km/h`;
            }
            
            // Pressão
            const pressureElement = document.getElementById('weather-pressure');
            if (pressureElement) {
                pressureElement.textContent = `${data.main.pressure} hPa`;
            }
            
            // Cidade
            const cityElement = document.getElementById('weather-city');
            if (cityElement && data.name) {
                cityElement.textContent = `${data.name}, BR`;
            }
            
            // Horário de atualização
            const timeElement = document.getElementById('weather-update-time');
            if (timeElement) {
                const now = new Date();
                timeElement.textContent = `Atualizado: ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
            }
        }
    } catch (error) {
        console.error('❌ Erro ao atualizar clima:', error);
        // Mostrar dados padrão em caso de erro
        const mainTempElement = document.getElementById('weather-main-temp');
        if (mainTempElement) mainTempElement.textContent = '--°C';
        
        const mainDescElement = document.getElementById('weather-main-desc');
        if (mainDescElement) mainDescElement.textContent = 'Dados indisponíveis';
    }
}

function getWeatherMainIcon(weatherMain) {
    const icons = {
        'clear': 'fa-sun',
        'clouds': 'fa-cloud',
        'rain': 'fa-cloud-rain',
        'drizzle': 'fa-cloud-drizzle',
        'thunderstorm': 'fa-bolt',
        'snow': 'fa-snowflake',
        'mist': 'fa-smog',
        'fog': 'fa-smog',
        'haze': 'fa-smog'
    };
    
    return icons[weatherMain] || 'fa-cloud';
}

function getWeatherAnimationClass(weatherMain) {
    const animations = {
        'clear': 'weather-icon-sun',
        'clouds': 'weather-icon-cloud',
        'rain': 'weather-icon-rain',
        'drizzle': 'weather-icon-rain',
        'thunderstorm': 'weather-icon-storm',
        'snow': 'weather-icon-snow',
        'mist': 'weather-icon-mist',
        'fog': 'weather-icon-mist',
        'haze': 'weather-icon-mist'
    };
    
    return animations[weatherMain] || 'weather-icon-cloud';
}

async function checkWeather() {
    try {
        const response = await fetch('/api/weather/raining');
        const data = await response.json();
        
        if (data.raining) {
            showNotification('⚠️ Está chovendo! A irrigação automática está bloqueada.', 'warning');
        } else {
            showNotification('☀️ Tempo seco - Irrigação automática permitida.', 'success');
        }
    } catch (error) {
        console.error('❌ Erro ao verificar clima:', error);
        showNotification('Erro ao verificar condições climáticas', 'error');
    }
}

// MODAL DE IRRIGAÇÃO MELHORADO
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
    
    // Duração
    const durationInput = document.getElementById('irrigation-duration');
    if (durationInput) {
        durationInput.value = irrigation.duracao || 5;
    }
    
    // Limpar e carregar programações
    const programmingList = document.getElementById('programming-list');
    programmingList.innerHTML = '';
    
    const programacoes = irrigation.programacoes || [];
    if (programacoes.length === 0) {
        programmingList.innerHTML = `
            <div class="no-programming">
                <i class="fas fa-calendar-plus" style="font-size: 2em; margin-bottom: 10px; opacity: 0.5;"></i>
                <br>
                Nenhuma programação configurada
            </div>
        `;
    } else {
        programacoes.forEach(prog => {
            addProgrammingToList(prog);
        });
    }
    
    // Limpar seleções atuais
    document.querySelectorAll('.day-checkbox').forEach(cb => cb.checked = false);
    document.getElementById('irrigation-time').value = '08:00';
}

function showTimePicker() {
    const timeInput = document.getElementById('irrigation-time');
    timeInput.showPicker(); // Abre o seletor nativo de hora
}

function addProgramming() {
    const timeInput = document.getElementById('irrigation-time');
    const selectedTime = timeInput.value;
    
    if (!selectedTime) {
        showNotification('Por favor, selecione um horário.', 'warning');
        return;
    }

    // Coletar dias selecionados
    const selectedDays = [];
    const dayCheckboxes = document.querySelectorAll('.day-checkbox:checked');
    
    if (dayCheckboxes.length === 0) {
        showNotification('Por favor, selecione pelo menos um dia da semana.', 'warning');
        return;
    }

    dayCheckboxes.forEach(checkbox => {
        selectedDays.push(checkbox.value);
    });

    // Criar nova programação
    const newProgramming = {
        hora: selectedTime,
        dias: selectedDays
    };

    // Adicionar à lista visual
    addProgrammingToList(newProgramming);
    
    // Limpar seleção
    timeInput.value = '08:00';
    document.querySelectorAll('.day-checkbox').forEach(cb => cb.checked = false);
    
    showNotification('Programação adicionada com sucesso!', 'success');
}

function addProgrammingToList(programming) {
    const programmingList = document.getElementById('programming-list');
    
    // Remover mensagem "nenhuma programação" se for a primeira
    if (programmingList.querySelector('.no-programming')) {
        programmingList.innerHTML = '';
    }

    const programmingElement = document.createElement('div');
    programmingElement.className = 'programming-item';
    programmingElement.innerHTML = `
        <div class="programming-header">
            <span class="programming-time">${programming.hora}</span>
            <button class="delete-programming" onclick="removeProgramming(this)">
                <i class="fas fa-trash"></i>
            </button>
        </div>
        <div class="programming-days">
            ${getDaysBadges(programming.dias)}
        </div>
    `;
    
    programmingList.appendChild(programmingElement);
}

function getDaysBadges(days) {
    const dayNames = {
        'seg': 'Seg', 'ter': 'Ter', 'qua': 'Qua', 
        'qui': 'Qui', 'sex': 'Sex', 'sab': 'Sab', 'dom': 'Dom'
    };
    
    return days.map(day => 
        `<span class="day-badge active">${dayNames[day]}</span>`
    ).join('');
}

function removeProgramming(button) {
    const programmingItem = button.closest('.programming-item');
    programmingItem.remove();
    
    const programmingList = document.getElementById('programming-list');
    if (programmingList.children.length === 0) {
        programmingList.innerHTML = `
            <div class="no-programming">
                <i class="fas fa-calendar-plus" style="font-size: 2em; margin-bottom: 10px; opacity: 0.5;"></i>
                <br>
                Nenhuma programação configurada
            </div>
        `;
    }
    
    showNotification('Programação removida', 'info');
}

function getSelectedProgrammings() {
    const programmingList = document.getElementById('programming-list');
    const programmings = [];
    
    programmingList.querySelectorAll('.programming-item').forEach(item => {
        const time = item.querySelector('.programming-time').textContent;
        const days = Array.from(item.querySelectorAll('.day-badge')).map(badge => {
            const dayText = badge.textContent.toLowerCase();
            const dayMap = {
                'seg': 'seg', 'ter': 'ter', 'qua': 'qua', 'qui': 'qui', 
                'sex': 'sex', 'sab': 'sab', 'dom': 'dom'
            };
            return dayMap[dayText];
        }).filter(day => day);
        
        programmings.push({
            hora: time,
            dias: days
        });
    });
    
    return programmings;
}

// Salvar configurações de irrigação de forma robusta
async function saveIrrigationSettings() {
    try {
        const modeSelect = document.getElementById('irrigation-mode-select');
        const rainCheckbox = document.getElementById('avoid-rain-checkbox');
        const durationInput = document.getElementById('irrigation-duration');
        
        const settings = {
            modo: modeSelect?.value || 'manual',
            evitar_chuva: rainCheckbox?.checked !== false,
            duracao: parseInt(durationInput?.value) || 5,
            programacoes: getSelectedProgrammings()
        };
        
        console.log('💧 Enviando configurações para servidor:', settings);
        
        const response = await fetch('/api/irrigation/save', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(settings)
        });
        
        const data = await response.json();
        
        if (data.status === 'OK') {
            console.log('✅ Configurações de irrigação salvas com sucesso');
            console.log('📋 Dados salvos:', data.savedData);
            showNotification('Configurações salvas com sucesso!', 'success');
            closeIrrigationModal();
            loadDevices(); // Recarregar dados
        } else {
            console.error('❌ Erro ao salvar configurações:', data.error);
            showNotification('Erro ao salvar configurações: ' + data.error, 'error');
        }
    } catch (error) {
        console.error('❌ Erro ao salvar configurações:', error);
        showNotification('Erro de conexão ao salvar configurações', 'error');
    }
}

// SISTEMA DE NOTIFICAÇÕES
function showNotification(message, type = 'info', duration = 5000) {
    // Remove notificações existentes para evitar acumulação
    const existingNotifications = document.querySelectorAll('.custom-notification');
    existingNotifications.forEach(notif => {
        if (notif.parentNode) {
            notif.parentNode.removeChild(notif);
        }
    });

    // Cria uma notificação
    const notification = document.createElement('div');
    notification.className = 'custom-notification';
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 15px 20px;
        border-radius: 8px;
        color: white;
        font-weight: 500;
        z-index: 10000;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        animation: slideInRight 0.3s ease;
        max-width: 400px;
        word-wrap: break-word;
    `;
    
    const colors = {
        success: 'linear-gradient(135deg, #4CAF50 0%, #45a049 100%)',
        error: 'linear-gradient(135deg, #ff6b6b 0%, #ee5a24 100%)',
        info: 'linear-gradient(135deg, #2196F3 0%, #1976D2 100%)',
        warning: 'linear-gradient(135deg, #ff9800 0%, #f57c00 100%)'
    };
    
    notification.style.background = colors[type] || colors.info;
    notification.textContent = message;
    
    // Adicionar ícone baseado no tipo
    const icons = {
        success: '✅',
        error: '❌',
        info: 'ℹ️',
        warning: '⚠️'
    };
    
    notification.innerHTML = `${icons[type] || 'ℹ️'} ${message}`;
    
    document.body.appendChild(notification);
    
    // Remove após 4 segundos
    setTimeout(() => {
        notification.style.animation = 'slideOutRight 0.3s ease';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, 4000);
}

// ADICIONAR ANIMAÇÕES CSS PARA NOTIFICAÇÕES
if (!document.querySelector('#notification-styles')) {
    const style = document.createElement('style');
    style.id = 'notification-styles';
    style.textContent = `
        @keyframes slideInRight {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
        @keyframes slideOutRight {
            from { transform: translateX(0); opacity: 1; }
            to { transform: translateX(100%); opacity: 0; }
        }
    `;
    document.head.appendChild(style);
}

// ==================== PERSISTÊNCIA LOCAL ====================
function saveToLocalStorage(key, data) {
    try {
        localStorage.setItem(`casa-automacao-${key}`, JSON.stringify(data));
    } catch (error) {
        console.error('Erro ao salvar no localStorage:', error);
    }
}

function loadFromLocalStorage(key) {
    try {
        const data = localStorage.getItem(`casa-automacao-${key}`);
        return data ? JSON.parse(data) : null;
    } catch (error) {
        console.error('Erro ao carregar do localStorage:', error);
        return null;
    }
}

// ==================== TEMA ====================
function toggleTheme() {
    const currentTheme = document.body.getAttribute('data-theme') || 'light';
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    
    document.body.setAttribute('data-theme', newTheme);
    saveToLocalStorage('theme', newTheme);
    
    const themeIcon = document.querySelector('.theme-toggle i');
    if (themeIcon) {
        themeIcon.className = newTheme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
    }
    
    showNotification(`Tema ${newTheme === 'dark' ? 'escuro' : 'claro'} ativado`, 'info', 2000);
}

// ==================== VERIFICAÇÃO DE CONEXÃO ====================
function checkConnection() {
    const offlineIndicator = document.getElementById('offline-indicator');
    if (!navigator.onLine) {
        if (offlineIndicator) offlineIndicator.classList.add('show');
        showNotification('Modo offline ativado. Algumas funções podem não estar disponíveis.', 'warning', 3000);
    } else {
        if (offlineIndicator) offlineIndicator.classList.remove('show');
    }
}

// Prevenir fechamento acidental
window.addEventListener('beforeunload', function (e) {
    // Opcional: Confirmar saída se houver operações pendentes
});

// Configurar eventos
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

console.log('🔧 Script.js carregado com todas as funcionalidades!');
