import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { 
  initDb, 
  dbAll, 
  dbRun, 
  getOrCreateUser, 
  updateUserAuthorization 
} from './db.js';
import { processMessage, botEvents } from './botLogic.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir arquivos estáticos do dashboard administrativo
app.use(express.static(path.resolve('public')));

// Inicializa banco de dados e inicia o servidor
async function startServer() {
  await initDb();
  app.listen(PORT, () => {
    console.log(`Servidor do Chatbot rodando na porta ${PORT}`);
    console.log(`Acesse o Dashboard Administrativo em: http://localhost:${PORT}`);
  });
}

// ----------------------------------------------------
// 1. WEBHOOK RECEPTOR DE WHATSAPP (Evolution API / Z-API / Genérico)
// ----------------------------------------------------
app.post('/webhook/whatsapp', async (req, res) => {
  try {
    const payload = req.body;
    console.log('[Webhook Recebido] Payload:', JSON.stringify(payload));

    let phone = '';
    let text = '';
    let name = '';

    // Tratamento de formato: Evolution API
    if (payload.event === 'messages.upsert' && payload.data) {
      const data = payload.data;
      const key = data.key || {};
      
      // Ignorar mensagens enviadas pelo próprio bot
      if (key.fromMe) {
        return res.status(200).send('Mensagem enviada pelo próprio bot ignorada.');
      }

      phone = key.remoteJid ? key.remoteJid.split('@')[0] : '';
      name = data.pushName || '';

      // Extrai o texto da mensagem (pode vir em diferentes campos de acordo com a API)
      const message = data.message || {};
      text = message.conversation || 
             (message.extendedTextMessage && message.extendedTextMessage.text) || 
             (message.imageMessage && message.imageMessage.caption) || 
             '';
    } 
    // Tratamento de formato: Z-API
    else if (payload.phone && payload.text) {
      phone = payload.phone;
      name = payload.senderName || '';
      text = payload.text.message || '';
      
      if (payload.fromMe) {
        return res.status(200).send('Mensagem enviada pelo próprio bot ignorada.');
      }
    } 
    // Tratamento de formato: Genérico / Postman
    else {
      phone = payload.phone || payload.number;
      text = payload.text || payload.message;
      name = payload.name || payload.sender || '';
    }

    if (!phone || !text) {
      return res.status(400).send('Telefone e texto da mensagem são obrigatórios.');
    }

    // Processa a mensagem na máquina de estados de forma assíncrona
    // para liberar a resposta HTTP imediatamente para o provedor de Whatsapp
    processMessage(phone, text, name).catch(err => {
      console.error('[Erro] Falha ao processar mensagem no fluxo:', err);
    });

    return res.status(200).send('Mensagem recebida e em processamento.');
  } catch (error) {
    console.error('Erro no webhook de WhatsApp:', error);
    return res.status(500).send('Erro interno no servidor.');
  }
});

// ----------------------------------------------------
// 2. ENDPOINTS DA API DO DASHBOARD ADMINISTRATIVO
// ----------------------------------------------------

// Listar todos os usuários
app.get('/api/users', async (req, res) => {
  try {
    const users = await dbAll(`SELECT * FROM users ORDER BY is_authorized DESC, created_at DESC`);
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Criar/Cadastrar novo usuário manualmente
app.post('/api/users', async (req, res) => {
  const { phone, name, is_authorized } = req.body;
  if (!phone) {
    return res.status(400).json({ error: 'Número de telefone é obrigatório.' });
  }
  const cleanPhone = String(phone).replace(/\D/g, '');
  try {
    await getOrCreateUser(cleanPhone, name);
    await updateUserAuthorization(cleanPhone, is_authorized === 1 || is_authorized === true);
    res.json({ success: true, message: 'Usuário cadastrado com sucesso.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Atualizar cadastro do usuário (Nome / Autorização)
app.put('/api/users/:phone', async (req, res) => {
  const { phone } = req.params;
  const { name, is_authorized } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Nome do contato é obrigatório.' });
  }
  try {
    await dbRun(`UPDATE users SET name = ? WHERE phone = ?`, [name, phone]);
    if (is_authorized !== undefined) {
      await updateUserAuthorization(phone, is_authorized === 1 || is_authorized === true);
    }
    res.json({ success: true, message: 'Cadastro do contato atualizado.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Atualizar autorização do usuário (Ativar / Inativar)
app.put('/api/users/:phone/authorize', async (req, res) => {
  const { phone } = req.params;
  const { is_authorized } = req.body;
  try {
    await updateUserAuthorization(phone, is_authorized);
    res.json({ success: true, message: 'Autorização atualizada.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Excluir usuário do banco
app.delete('/api/users/:phone', async (req, res) => {
  const { phone } = req.params;
  try {
    await dbRun(`DELETE FROM users WHERE phone = ?`, [phone]);
    res.json({ success: true, message: 'Usuário removido com sucesso.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Histórico de Interações
app.get('/api/interactions', async (req, res) => {
  const { phone, limit = 100 } = req.query;
  try {
    let logs;
    if (phone) {
      logs = await dbAll(`
        SELECT * FROM interactions 
        WHERE phone = ? 
        ORDER BY created_at ASC 
        LIMIT ?
      `, [phone, Number(limit)]);
    } else {
      logs = await dbAll(`
        SELECT i.*, u.name 
        FROM interactions i 
        LEFT JOIN users u ON i.phone = u.phone 
        ORDER BY i.created_at DESC 
        LIMIT ?
      `, [Number(limit)]);
    }
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Listar Sessões ativas
app.get('/api/sessions', async (req, res) => {
  try {
    const sessions = await dbAll(`
      SELECT s.*, u.name 
      FROM sessions s 
      LEFT JOIN users u ON s.phone = u.phone 
      ORDER BY s.updated_at DESC
    `);
    // Converte os dados temporários de texto para JSON objeto
    sessions.forEach(s => {
      s.temp_data = JSON.parse(s.temp_data || '{}');
    });
    res.json(sessions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Simulador: Simular envio de mensagem pelo usuário
app.post('/api/simulate-message', async (req, res) => {
  const { phone, text, name } = req.body;
  if (!phone || !text) {
    return res.status(400).json({ error: 'Telefone e texto da mensagem são obrigatórios.' });
  }
  const cleanPhone = String(phone).replace(/\D/g, '');

  try {
    // Processa a mensagem diretamente
    await processMessage(cleanPhone, text, name);
    res.json({ success: true, message: 'Mensagem simulada enviada ao chatbot.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// 3. SERVER-SENT EVENTS (SSE) PARA ATUALIZAÇÃO EM TEMPO REAL
// ----------------------------------------------------
let clients = [];

app.get('/api/live-chats', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // Envia cabeçalho inicial para o cliente
  res.write(':ok\n\n');

  const clientId = Date.now();
  const newClient = { id: clientId, res };
  clients.push(newClient);

  req.on('close', () => {
    clients = clients.filter(c => c.id !== clientId);
  });
});

// Escuta os eventos do bot e distribui para os clientes conectados no painel
botEvents.on('message', (msgData) => {
  clients.forEach(client => {
    client.res.write(`data: ${JSON.stringify(msgData)}\n\n`);
  });
});

startServer();
