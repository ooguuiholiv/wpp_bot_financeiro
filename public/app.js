// Estado global do Painel Web
let users = [];
let selectedPhone = '';
let eventSource = null;
let isEditMode = false;
let editingPhone = '';

// Elementos do DOM
const usersTableBody = document.getElementById('users-table-body');
const logsTableBody = document.getElementById('logs-table-body');
const selectSimulatorUser = document.getElementById('select-simulator-user');
const chatMessagesContainer = document.getElementById('chat-messages-container');
const chatInputMessage = document.getElementById('chat-input-message');
const btnChatSend = document.getElementById('btn-chat-send');
const btnRefreshLogs = document.getElementById('btn-refresh-logs');
const simulatorUserStatus = document.getElementById('simulator-user-status');
const simulatorUserStatusText = document.getElementById('simulator-user-status-text');

// Modais
const btnShowAddModal = document.getElementById('btn-show-add-modal');
const addUserModal = document.getElementById('add-user-modal');
const btnCloseModal = document.getElementById('btn-close-modal');
const btnCancelModal = document.getElementById('btn-cancel-modal');
const addUserForm = document.getElementById('add-user-form');

// Stats
const statAuthCount = document.getElementById('stat-auth-count');
const statUnauthCount = document.getElementById('stat-unauth-count');
const statMsgCount = document.getElementById('stat-msg-count');

// Inicialização
document.addEventListener('DOMContentLoaded', () => {
  fetchDashboardData();
  setupEventListeners();
  setupSSE();
});

// Configura ouvintes de eventos do DOM
function setupEventListeners() {
  // Modal de Adicionar Usuário
  btnShowAddModal.addEventListener('click', () => {
    isEditMode = false;
    editingPhone = '';
    document.getElementById('modal-title').textContent = 'Adicionar Novo Contato';
    document.getElementById('input-phone').disabled = false;
    document.getElementById('input-phone').value = '';
    document.getElementById('input-name').value = '';
    document.getElementById('input-authorized').checked = true;
    addUserForm.querySelector('button[type="submit"]').textContent = 'Salvar Contato';
    addUserModal.classList.add('open');
  });
  
  const closeModal = () => {
    addUserModal.classList.remove('open');
    addUserForm.reset();
  };
  btnCloseModal.addEventListener('click', closeModal);
  btnCancelModal.addEventListener('click', closeModal);
  
  // Submit do formulário do modal (Adicionar ou Editar)
  addUserForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const phone = document.getElementById('input-phone').value;
    const name = document.getElementById('input-name').value;
    const is_authorized = document.getElementById('input-authorized').checked ? 1 : 0;

    try {
      let res;
      if (isEditMode) {
        res = await fetch(`/api/users/${editingPhone}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, is_authorized })
        });
      } else {
        res = await fetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone, name, is_authorized })
        });
      }
      const data = await res.json();
      if (data.success) {
        closeModal();
        fetchDashboardData();
      } else {
        alert('Erro ao salvar: ' + data.error);
      }
    } catch (err) {
      console.error(err);
      alert('Erro de rede.');
    }
  });

  // Atualizar logs manualmente
  btnRefreshLogs.addEventListener('click', fetchLogs);

  // Mudar usuário no simulador
  selectSimulatorUser.addEventListener('change', (e) => {
    selectedPhone = e.target.value;
    updateSimulatorUserStatus();
    loadSimulatorChatHistory();
  });

  // Enviar mensagem no simulador
  btnChatSend.addEventListener('click', sendSimulatorMessage);
  chatInputMessage.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      sendSimulatorMessage();
    }
  });

  // Eventos do histórico de consultas
  const selectHistoryUser = document.getElementById('select-history-user');
  const btnRefreshHistory = document.getElementById('btn-refresh-history');
  if (selectHistoryUser) selectHistoryUser.addEventListener('change', loadUserQueriesHistory);
  if (btnRefreshHistory) btnRefreshHistory.addEventListener('click', loadUserQueriesHistory);
}

// Configura eventos SSE em tempo real
function setupSSE() {
  if (eventSource) {
    eventSource.close();
  }

  eventSource = new EventSource('/api/live-chats');

  eventSource.onmessage = (event) => {
    const data = JSON.parse(event.data);
    console.log('[SSE Event]', data);

    // Se o evento é do telefone selecionado no simulador, adiciona a mensagem
    if (data.phone === selectedPhone) {
      appendMessageToSimulator(data.direction, data.message, new Date().toISOString());
    }

    // Atualiza estatísticas e tabelas
    fetchDashboardData();
  };

  eventSource.onerror = (err) => {
    console.error('Erro no canal SSE, tentando reconectar...', err);
    setTimeout(setupSSE, 5000);
  };
}

// Busca todos os dados básicos do painel
async function fetchDashboardData() {
  try {
    const resUsers = await fetch('/api/users');
    users = await resUsers.json();
    
    renderUsersTable();
    updateSimulatorDropdown();
    fetchLogs();
  } catch (err) {
    console.error('Erro ao buscar dados:', err);
  }
}

// Busca e renderiza os logs e atualiza as estatísticas
async function fetchLogs() {
  try {
    const resLogs = await fetch('/api/interactions');
    const logs = await resLogs.json();
    
    renderLogsTable(logs);
    updateStatsCounters(logs);
  } catch (err) {
    console.error('Erro ao buscar logs:', err);
  }
}

// Renderiza a tabela de usuários
function renderUsersTable() {
  usersTableBody.innerHTML = '';
  users.forEach(user => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <div style="font-weight: 500;">${user.name}</div>
        <div style="font-size: 0.75rem; color: var(--text-muted);">${new Date(user.created_at).toLocaleDateString()}</div>
      </td>
      <td><code class="state-tag">${user.phone}</code></td>
      <td>
        <label class="switch">
          <input type="checkbox" ${user.is_authorized ? 'checked' : ''} onchange="toggleUserAuthorization('${user.phone}', this.checked)">
          <span class="slider"></span>
        </label>
        <span style="margin-left: 0.5rem;" class="badge ${user.is_authorized ? 'badge-auth' : 'badge-blocked'}">
          ${user.is_authorized ? 'Respondendo' : 'Ignorando'}
        </span>
      </td>
      <td>
        <button class="btn btn-secondary" onclick="openEditUserModal('${user.phone}', '${user.name.replace(/'/g, "\\'")}', ${user.is_authorized})" style="margin-right: 0.5rem;">Editar</button>
        <button class="btn btn-danger" onclick="deleteUser('${user.phone}')">Remover</button>
      </td>
    `;
    usersTableBody.appendChild(tr);
  });
}

// Renderiza a tabela de logs
function renderLogsTable(logs) {
  logsTableBody.innerHTML = '';
  if (logs.length === 0) {
    logsTableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">Nenhuma interação registrada ainda.</td></tr>`;
    return;
  }
  
  logs.forEach(log => {
    const dateStr = new Date(log.created_at).toLocaleTimeString('pt-BR') + ' ' + new Date(log.created_at).toLocaleDateString('pt-BR');
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="white-space: nowrap;">${dateStr}</td>
      <td><strong>${log.name || 'Contato'}</strong><br><small class="state-tag">${log.phone}</small></td>
      <td>
        <span class="badge badge-direction ${log.direction === 'incoming' ? 'badge-in' : 'badge-out'}">
          ${log.direction === 'incoming' ? 'Entrada' : 'Saída'}
        </span>
      </td>
      <td><div class="msg-cell" title="${log.message}">${log.message}</div></td>
      <td><span class="state-tag">${log.state_before || 'START'}</span></td>
      <td><span class="state-tag" style="background: rgba(139, 92, 246, 0.15); border-color: var(--accent-purple);">${log.state_after || 'START'}</span></td>
    `;
    logsTableBody.appendChild(tr);
  });
}

// Atualiza contadores de métricas
function updateStatsCounters(logs) {
  const authCount = users.filter(u => u.is_authorized).length;
  const unauthCount = users.filter(u => !u.is_authorized).length;
  
  statAuthCount.textContent = authCount;
  statUnauthCount.textContent = unauthCount;
  statMsgCount.textContent = logs.length;
}

// Atualiza o dropdown do simulador
function updateSimulatorDropdown() {
  const currentSelection = selectSimulatorUser.value;
  selectSimulatorUser.innerHTML = '<option value="">-- Selecionar Usuário --</option>';
  
  users.forEach(user => {
    const option = document.createElement('option');
    option.value = user.phone;
    option.textContent = `${user.name} (${user.phone})`;
    selectSimulatorUser.appendChild(option);
  });

  if (currentSelection && users.some(u => u.phone === currentSelection)) {
    selectSimulatorUser.value = currentSelection;
  } else {
    selectedPhone = '';
    updateSimulatorUserStatus();
    chatMessagesContainer.innerHTML = `<div class="system-message">Selecione um contato no menu acima para começar a simulação e testar o fluxo.</div>`;
  }
}

// Altera status de autorização via switch
async function toggleUserAuthorization(phone, isAuthorized) {
  try {
    await fetch(`/api/users/${phone}/authorize`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_authorized: isAuthorized })
    });
    fetchDashboardData();
    if (phone === selectedPhone) {
      updateSimulatorUserStatus();
    }
  } catch (err) {
    console.error('Erro ao atualizar autorização:', err);
  }
}

// Exclui um usuário
async function deleteUser(phone) {
  if (!confirm('Deseja realmente remover este contato do sistema?')) return;
  try {
    await fetch(`/api/users/${phone}`, { method: 'DELETE' });
    fetchDashboardData();
  } catch (err) {
    console.error('Erro ao excluir usuário:', err);
  }
}

// Atualiza as tags visuais de status do simulador
function updateSimulatorUserStatus() {
  const user = users.find(u => u.phone === selectedPhone);
  if (!user) {
    simulatorUserStatus.className = 'user-status-indicator';
    simulatorUserStatusText.textContent = 'Nenhum selecionado';
    return;
  }

  if (user.is_authorized) {
    simulatorUserStatus.className = 'user-status-indicator authorized';
    simulatorUserStatusText.textContent = 'Bot Ativo (Autorizado)';
  } else {
    simulatorUserStatus.className = 'user-status-indicator';
    simulatorUserStatusText.textContent = 'Bot Inativo (Ignorando)';
  }
}

// Carrega o histórico de mensagens de um usuário no simulador
async function loadSimulatorChatHistory() {
  if (!selectedPhone) return;

  chatMessagesContainer.innerHTML = '<div class="system-message">Carregando histórico...</div>';

  try {
    const res = await fetch(`/api/interactions?phone=${selectedPhone}`);
    const logs = await res.json();

    chatMessagesContainer.innerHTML = '';
    
    if (logs.length === 0) {
      chatMessagesContainer.innerHTML = '<div class="system-message">Conversa iniciada. Digite uma mensagem abaixo para interagir.</div>';
      return;
    }

    logs.forEach(log => {
      appendMessageToSimulator(log.direction, log.message, log.created_at);
    });
  } catch (err) {
    console.error('Erro ao carregar histórico:', err);
    chatMessagesContainer.innerHTML = '<div class="system-message error">Falha ao carregar histórico.</div>';
  }
}

// Adiciona um balão de conversa no mockup
function appendMessageToSimulator(direction, text, timestamp) {
  // Remove mensagens de sistema iniciais se existirem
  const systemMsg = chatMessagesContainer.querySelector('.system-message');
  if (systemMsg && (chatMessagesContainer.children.length === 1)) {
    systemMsg.remove();
  }

  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${direction}`;
  
  const time = new Date(timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  
  // Substitui quebras de linha por tags <br> para formatação perfeita
  bubble.innerHTML = `${text.replace(/\n/g, '<br>')}<span class="time">${time}</span>`;
  
  chatMessagesContainer.appendChild(bubble);
  chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
}

// Simula o envio de uma mensagem digitada no chat
async function sendSimulatorMessage() {
  const text = chatInputMessage.value.trim();
  if (!text || !selectedPhone) return;

  chatInputMessage.value = '';

  const user = users.find(u => u.phone === selectedPhone);
  const name = user ? user.name : 'Simulador';

  // Adiciona a bolha de entrada imediatamente para resposta fluida
  appendMessageToSimulator('incoming', text, new Date().toISOString());

  try {
    await fetch('/api/simulate-message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: selectedPhone, text, name })
    });
  } catch (err) {
    console.error('Erro ao simular envio:', err);
  }
}

// Abre modal de edição pré-preenchido
function openEditUserModal(phone, name, isAuthorized) {
  isEditMode = true;
  editingPhone = phone;
  
  document.getElementById('modal-title').textContent = 'Editar Nome do Contato';
  document.getElementById('input-phone').value = phone;
  document.getElementById('input-phone').disabled = true;
  document.getElementById('input-name').value = name;
  document.getElementById('input-authorized').checked = isAuthorized ? true : false;
  addUserForm.querySelector('button[type="submit"]').textContent = 'Salvar Alterações';
  
  addUserModal.classList.add('open');
}

// Funções auxiliares para Abas e Histórico de Consultas
function switchTab(tabName) {
  const tabDashboard = document.getElementById('tab-dashboard');
  const tabHistory = document.getElementById('tab-history');
  const viewDashboard = document.getElementById('view-dashboard');
  const viewHistory = document.getElementById('view-history');
  
  if (tabName === 'dashboard') {
    tabDashboard.classList.add('active');
    tabHistory.classList.remove('active');
    viewDashboard.classList.add('active');
    viewHistory.classList.remove('active');
  } else if (tabName === 'history') {
    tabDashboard.classList.remove('active');
    tabHistory.classList.add('active');
    viewDashboard.classList.remove('active');
    viewHistory.classList.add('active');
    
    // Atualiza a lista de usuários no histórico
    updateHistoryUserDropdown();
  }
}

function updateHistoryUserDropdown() {
  const selectHistoryUser = document.getElementById('select-history-user');
  const currentSelection = selectHistoryUser.value;
  
  selectHistoryUser.innerHTML = '<option value="">-- Selecionar Usuário --</option>';
  
  users.forEach(user => {
    const option = document.createElement('option');
    option.value = user.phone;
    option.textContent = `${user.name} (${user.phone})`;
    selectHistoryUser.appendChild(option);
  });
  
  if (currentSelection && users.some(u => u.phone === currentSelection)) {
    selectHistoryUser.value = currentSelection;
  }
}

async function loadUserQueriesHistory() {
  const selectHistoryUser = document.getElementById('select-history-user');
  const timelineBody = document.getElementById('queries-timeline-body');
  const phone = selectHistoryUser.value;
  
  if (!phone) {
    timelineBody.innerHTML = `
      <div class="timeline-empty">
        Selecione um usuário para visualizar o histórico de solicitações e respostas.
      </div>
    `;
    return;
  }
  
  timelineBody.innerHTML = '<div class="timeline-empty">Carregando consultas...</div>';
  
  try {
    const res = await fetch(`/api/interactions?phone=${phone}`);
    const logs = await res.json();
    
    timelineBody.innerHTML = '';
    
    if (logs.length === 0) {
      timelineBody.innerHTML = `
        <div class="timeline-empty">
          Nenhuma interação encontrada para este contato.
        </div>
      `;
      return;
    }
    
    logs.forEach(log => {
      const dateStr = new Date(log.created_at).toLocaleTimeString('pt-BR') + ' - ' + new Date(log.created_at).toLocaleDateString('pt-BR');
      const item = document.createElement('div');
      item.className = `timeline-item ${log.direction}`;
      
      const statesHtml = log.state_before || log.state_after 
        ? `<div class="timeline-states">
             <span class="state-tag">${log.state_before || 'START'}</span> 
             <span>➜</span> 
             <span class="state-tag" style="background: rgba(139, 92, 246, 0.15); border-color: var(--accent-purple);">${log.state_after || 'START'}</span>
           </div>`
        : '';
        
      item.innerHTML = `
        <div class="timeline-header">
          <span>${log.direction === 'incoming' ? '👤 Usuário' : '🤖 Bot'}</span>
          <span>${dateStr}</span>
        </div>
        <div class="timeline-content-card ${log.direction}">
          <div class="timeline-message">${log.message.replace(/\n/g, '<br>')}</div>
          ${statesHtml}
        </div>
      `;
      timelineBody.appendChild(item);
    });
  } catch (err) {
    console.error('Erro ao carregar histórico de consultas:', err);
    timelineBody.innerHTML = '<div class="timeline-empty" style="color: var(--danger);">Erro ao carregar histórico. Tente novamente.</div>';
  }
}

// Vincula funções ao escopo global para onclick no HTML
window.toggleUserAuthorization = toggleUserAuthorization;
window.deleteUser = deleteUser;
window.openEditUserModal = openEditUserModal;
window.switchTab = switchTab;
window.loadUserQueriesHistory = loadUserQueriesHistory;
