import axios from 'axios';
import dotenv from 'dotenv';
import { EventEmitter } from 'events';
import { 
  getOrCreateUser, 
  getSession, 
  updateSession, 
  clearSession, 
  logInteraction 
} from './db.js';

dotenv.config();

export const botEvents = new EventEmitter();

// Cabeçalho obrigatório exigido pela API externa (francosys)
const API_HEADERS = {
  'Origin': 'https://app.bubble.io',
  'Accept': 'application/json'
};

function getMenuText(userName) {
  // Se o nome começar com 'Contato' ou 'Default User', ou estiver vazio, tratamos como genérico
  const isGeneric = !userName || userName.startsWith('Contato') || userName.startsWith('Default User') || userName.startsWith('Contact');
  const greeting = isGeneric ? 'Olá,' : `Olá, ${userName}!`;
  return `${greeting}
Selecione a opção desejada:

3 - Consulta status de um lançamento

4 - Valor em aberto de um fornecedor

(digite apenas o número)`;
}

// Envia a mensagem pelo provedor real de WhatsApp e salva no banco de dados
export async function sendResponse(phone, text, stateBefore, stateAfter) {
  // Salva no SQLite
  await logInteraction(phone, 'outgoing', text, stateBefore, stateAfter);
  
  // Emite evento local para o Simulador do Painel Web
  botEvents.emit('message', { phone, direction: 'outgoing', message: text, stateBefore, stateAfter });

  // Envia via API de WhatsApp (se configurado no .env)
  if (process.env.WA_API_URL) {
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (process.env.WA_API_TOKEN) {
        headers['apikey'] = process.env.WA_API_TOKEN;
        headers['Authorization'] = `Bearer ${process.env.WA_API_TOKEN}`;
      }

      // Payload adaptável de acordo com o provedor (Evolution API ou Z-API)
      const payload = {};
      if (process.env.WA_API_TYPE === 'z-api') {
        payload.phone = phone;
        payload.message = text;
      } else {
        // Padrão Evolution API (compatibilidade total v1 e v2 enviando ambos os formatos)
        payload.number = phone;
        payload.text = text;
        payload.textMessage = { text: text };
      }

      console.log(`[WhatsApp Outgoing] Enviando POST para: ${process.env.WA_API_URL}`);
      console.log(`[WhatsApp Outgoing] Payload:`, JSON.stringify(payload));

      const res = await axios.post(process.env.WA_API_URL, payload, { headers });
      console.log(`[WhatsApp Outgoing] Resposta da API status: ${res.status}`);
    } catch (err) {
      console.error(`Erro ao enviar WhatsApp para ${phone}:`, err.message);
      if (err.response) {
        console.error(`[WhatsApp Outgoing Error] Status: ${err.response.status} | Resposta:`, JSON.stringify(err.response.data));
      }
    }
  } else {
    console.log(`[Simulador WhatsApp] Enviado para ${phone}:\n${text}\n`);
  }
}

// Auxiliares de formatação idênticos aos scripts do Typebot
function formatarMoeda(valor) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor);
}

function formatarData(dataStr) {
  if (!dataStr) return 'N/A';
  const data = new Date(dataStr);
  return data.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

// Remove artigos definidos/indefinidos e preposições iniciais comuns para evitar buscas como "A LOJA ELETRICA"
function cleanSupplierName(name) {
  if (!name) return '';
  let cleaned = name.trim();
  let prev;
  do {
    prev = cleaned;
    // Remove palavras como "o", "a", "os", "as", "um", "uma", "uns", "umas", "do", "da", "dos", "das", "de", "para", "fornecedor", "empresa" no início da string
    cleaned = cleaned.replace(/^(?:o|a|os|as|um|uma|uns|umas|do|da|dos|das|de|para|fornecedor|empresa)\b\s+/i, '').trim();
  } while (cleaned !== prev);
  return cleaned;
}

// Verifica se o termo se assemelha a um CPF ou CNPJ (apenas dígitos, pontos, barras e traços)
function isCpfCnpj(text) {
  const clean = text.trim();
  // Se contiver qualquer caractere alfabético, não é CPF/CNPJ
  if (/[a-zA-Z]/.test(clean)) return false;
  
  const digits = clean.replace(/\D/g, '');
  return digits.length === 11 || digits.length === 14;
}

// Retorna apenas os dígitos se for CPF/CNPJ (pois o banco armazena sem formatação), caso contrário retorna o próprio termo
function resolveSupplierName(term) {
  if (!term) return '';
  const clean = term.trim();
  
  if (isCpfCnpj(clean)) {
    return clean.replace(/\D/g, '');
  }
  
  return clean;
}

// Função para extrair intenção e parâmetros de textos livres
function parseIntentAndEntities(text) {
  const cleanText = text.toLowerCase().trim();
  const result = {
    intent: null,
    entities: {}
  };

  // 1. Comandos globais de saída
  if (/\b(sair|cancelar|encerrar|fim|tchau|obrigado)\b/.test(cleanText)) {
    result.intent = 'SAIR';
    return result;
  }

  // 2. Comandos globais de menu
  if (/\b(menu|voltar|inicio|opcoes|opções)\b/.test(cleanText)) {
    result.intent = 'MENU';
    return result;
  }

  // 3. Consulta de Status / Lançamento (Opção 3)
  const hasNFTrigger = /\b(status|lançamento|lancamento|nota|nf|n\.f|documento)\b/.test(cleanText);
  // Procura por número de NF (pelo menos 3 dígitos)
  const numberMatch = text.match(/\b\d{3,}\b/);
  
  const hasCpfCnpj = /\b(?:\d{11}|\d{14}|\d{3}\.\d{3}\.\d{3}-\d{2}|\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})\b/.test(text);
  if (hasNFTrigger || (numberMatch && !hasCpfCnpj && !/\b(1|2|3|4)\b/.test(cleanText))) {
    result.intent = 'CONSULTA_STATUS';
    if (numberMatch) {
      result.entities.nf = numberMatch[0];
    }
    // Tenta extrair o nome do fornecedor após "do", "da", "de", "para", "fornecedor"
    const supplierMatch = text.match(/(?:fornecedor|para|do|da|de)\s+([a-zA-Z0-9\s\-]+)/i);
    if (supplierMatch) {
      const rawName = supplierMatch[1].trim();
      const name = cleanSupplierName(rawName);
      if (name && !/\b(nf|nota|status|lançamento|lancamento|documento)\b/i.test(name)) {
        result.entities.fornecedor = name;
      }
    }
    return result;
  }

  // 4. Valor em aberto / Contas de fornecedor (Opção 4)
  const hasAbertoTrigger = /\b(aberto|valor|deve|devedor|fornecedor|credor|quanto)\b/.test(cleanText);
  if (hasAbertoTrigger) {
    result.intent = 'VALOR_ABERTO';
    const supplierMatch = text.match(/(?:fornecedor|de|do|da|para)\s+([a-zA-Z0-9\s\-]+)/i);
    if (supplierMatch) {
      const rawName = supplierMatch[1].trim();
      const name = cleanSupplierName(rawName);
      if (name && !/\b(valor|aberto|quanto|deve|fornecedor)\b/i.test(name)) {
        result.entities.fornecedor = name;
      }
    }
    return result;
  }

  return result;
}

// Processamento principal de mensagens recebidas
export async function processMessage(phone, text, pushName = '') {
  const cleanPhone = String(phone).replace(/\D/g, '');
  const rawText = String(text).trim();

  // 1. Cria ou obtém o usuário no banco de dados
  const user = await getOrCreateUser(cleanPhone, pushName);

  // 2. Registra a interação de entrada (mensagem recebida) no banco de dados
  const session = await getSession(cleanPhone);
  const stateBefore = session.state;
  await logInteraction(cleanPhone, 'incoming', rawText, stateBefore, stateBefore);

  // Emite evento para atualizar o Simulador do Painel Web em tempo real
  botEvents.emit('message', { phone: cleanPhone, direction: 'incoming', message: rawText, stateBefore, stateAfter: stateBefore });

  // 3. Se o usuário NÃO estiver autorizado, o bot simplesmente ignora (não envia respostas)
  if (!user.is_authorized) {
    console.log(`[Bloqueado] Mensagem de ${cleanPhone} ignorada (não autorizado).`);
    return;
  }

  // Comandos globais inteligentes via PNL
  const nlp = parseIntentAndEntities(rawText);

  if (nlp.intent === 'SAIR') {
    await clearSession(cleanPhone);
    await sendResponse(cleanPhone, `Atendimento encerrado. Obrigado! Digite qualquer mensagem para iniciar um novo atendimento.`, stateBefore, 'START');
    return;
  }
  if (nlp.intent === 'MENU') {
    await clearSession(cleanPhone);
    await sendResponse(cleanPhone, `Voltando ao menu principal...`, stateBefore, 'AWAIT_MENU_OPTION');
    await sendResponse(cleanPhone, getMenuText(user.name), 'AWAIT_MENU_OPTION', 'AWAIT_MENU_OPTION');
    await updateSession(cleanPhone, 'AWAIT_MENU_OPTION', {});
    return;
  }

  // 4. Máquina de Estados (State Machine)
  try {
    let state = session.state;
    let tempData = session.temp_data || {};

    if (state === 'START') {
      // Verifica se o usuário já fez uma consulta direta por texto
      if (nlp.intent === 'CONSULTA_STATUS') {
        if (nlp.entities.nf && nlp.entities.fornecedor) {
          // Extraiu NF e Fornecedor! Executa consulta direta!
          const nfFormatada = String(nlp.entities.nf).padStart(9, '0');
          tempData.nf = nfFormatada;
          
          const resolvedSupplier = resolveSupplierName(nlp.entities.fornecedor);
          const nFornecedorFormatado = String(resolvedSupplier).toUpperCase().trim();

          await sendResponse(cleanPhone, `Certo, localizei sua intenção de buscar a NF ${nfFormatada} do fornecedor ${resolvedSupplier.toUpperCase()}. Buscando dados...`, 'START', 'AWAIT_SUPPLIER_NAME');

          let statusMsg = '';
          try {
            const response = await axios.get('http://api.francosys.com.br/statuslan', {
              params: { numerodocumento: nfFormatada, nomefantasia: nFornecedorFormatado },
              headers: API_HEADERS
            });
            statusMsg = formatarStatusLanResponse(response.data);
          } catch (err) {
            statusMsg = `❌ Erro de comunicação com o servidor financeiro: ${err.message}`;
          }

          const isFailure = statusMsg.startsWith('❌') || statusMsg.includes('Nenhum') || statusMsg.includes('Nenhuma');
          if (isFailure) {
            const retryMsg = `${statusMsg}\n\nComo deseja prosseguir?\n1 - Tentar outro fornecedor para a mesma Nota Fiscal\n2 - Voltar ao Menu Principal\n3 - Encerrar atendimento`;
            await sendResponse(cleanPhone, retryMsg, 'START', 'AWAIT_RETRY_OPTION_3');
            await updateSession(cleanPhone, 'AWAIT_RETRY_OPTION_3', tempData);
          } else {
            const successMsg = `${statusMsg}\n\nDeseja realizar mais alguma consulta?\n1 - Sim, voltar ao Menu Principal\n2 - Não, encerrar atendimento`;
            await sendResponse(cleanPhone, successMsg, 'START', 'AWAIT_POST_QUERY_MENU');
            await updateSession(cleanPhone, 'AWAIT_POST_QUERY_MENU', tempData);
          }
        } 
        else if (nlp.entities.nf) {
          // Extraiu apenas a NF
          const nfFormatada = String(nlp.entities.nf).padStart(9, '0');
          tempData.nf = nfFormatada;
          await sendResponse(cleanPhone, `Entendi, você quer consultar o status da Nota Fiscal ${nfFormatada}.\n\nPor favor, digite o nome do fornecedor:`, 'START', 'AWAIT_SUPPLIER_NAME');
          await updateSession(cleanPhone, 'AWAIT_SUPPLIER_NAME', tempData);
        } 
        else {
          // Sem NF
          const msg = `Certo, diga pra mim, qual o número da nota fiscal?\n\n(digite somente o numero da nota fiscal)`;
          await sendResponse(cleanPhone, msg, 'START', 'AWAIT_NF');
          await updateSession(cleanPhone, 'AWAIT_NF', tempData);
        }
        return;
      }

      if (nlp.intent === 'VALOR_ABERTO') {
        if (nlp.entities.fornecedor) {
          const resolvedSupplier = resolveSupplierName(nlp.entities.fornecedor);

          // Extraiu o fornecedor! Executa consulta direta!
          const fornecedorFormatado = String(resolvedSupplier).toUpperCase().trim();
          await sendResponse(cleanPhone, `Certo, buscando valores em aberto para o fornecedor ${resolvedSupplier.toUpperCase()}...`, 'START', 'AWAIT_VR_SUPPLIER_NAME');

          let vrMsg = '';
          try {
            const response = await axios.get('http://api.francosys.com.br/vr-aberto', {
              params: { nomefantasia: fornecedorFormatado },
              headers: API_HEADERS
            });
            vrMsg = formatarVrAbertoResponse(response.data);
          } catch (err) {
            vrMsg = `❌ Erro de comunicação com o servidor: ${err.message}`;
          }

          const isFailure = vrMsg.startsWith('❌') || vrMsg.includes('Nenhum') || vrMsg.includes('Nenhuma');
          if (isFailure) {
            const retryMsg = `${vrMsg}\n\nComo deseja prosseguir?\n1 - Buscar outro fornecedor\n2 - Voltar ao Menu Principal\n3 - Encerrar atendimento`;
            await sendResponse(cleanPhone, retryMsg, 'START', 'AWAIT_RETRY_OPTION_4');
            await updateSession(cleanPhone, 'AWAIT_RETRY_OPTION_4', tempData);
          } else {
            const successMsg = `${vrMsg}\n\nDeseja realizar mais alguma consulta?\n1 - Sim, voltar ao Menu Principal\n2 - Não, encerrar atendimento`;
            await sendResponse(cleanPhone, successMsg, 'START', 'AWAIT_POST_QUERY_MENU');
            await updateSession(cleanPhone, 'AWAIT_POST_QUERY_MENU', tempData);
          }
        } else {
          // Sem fornecedor
          const msg = `Certo, qual o nome do fornecedor que voce deseja consultar?`;
          await sendResponse(cleanPhone, msg, 'START', 'AWAIT_VR_SUPPLIER_NAME');
          await updateSession(cleanPhone, 'AWAIT_VR_SUPPLIER_NAME', tempData);
        }
        return;
      }

      // Envia o menu de saudação padrão se não identificou intenção direta
      await sendResponse(cleanPhone, getMenuText(user.name), 'START', 'AWAIT_MENU_OPTION');
      await updateSession(cleanPhone, 'AWAIT_MENU_OPTION', tempData);
      return;
    }

    if (state === 'AWAIT_MENU_OPTION') {
      const isStatusOption = rawText === '3' || nlp.intent === 'CONSULTA_STATUS';
      const isAbertoOption = rawText === '4' || nlp.intent === 'VALOR_ABERTO';
      const isLanOption = rawText === '1' || /\b(lançamento|lancamento|lançamentos|lancamentos)\b/i.test(rawText);
      const isPagOption = rawText === '2' || /\b(pagamento|pagamentos|pago|pagos)\b/i.test(rawText);

      if (isStatusOption) {
        if (nlp.entities.nf) {
          const nfFormatada = String(nlp.entities.nf).padStart(9, '0');
          tempData.nf = nfFormatada;
          await sendResponse(cleanPhone, `Entendi, você quer consultar a Nota Fiscal ${nfFormatada}.\n\nPor favor, digite o nome do fornecedor:`, 'AWAIT_MENU_OPTION', 'AWAIT_SUPPLIER_NAME');
          await updateSession(cleanPhone, 'AWAIT_SUPPLIER_NAME', tempData);
        } else {
          const msg = `Certo, diga pra mim, qual o número da nota fiscal?\n\n(digite somente o numero da nota fiscal)`;
          await sendResponse(cleanPhone, msg, 'AWAIT_MENU_OPTION', 'AWAIT_NF');
          await updateSession(cleanPhone, 'AWAIT_NF', tempData);
        }
      } else if (isAbertoOption) {
        if (nlp.entities.fornecedor) {
          const resolvedSupplier = resolveSupplierName(nlp.entities.fornecedor);
          const fornecedorFormatado = String(resolvedSupplier).toUpperCase().trim();
          await sendResponse(cleanPhone, `Certo, buscando valores em aberto para o fornecedor ${resolvedSupplier.toUpperCase()}...`, 'AWAIT_MENU_OPTION', 'AWAIT_VR_SUPPLIER_NAME');
          
          let vrMsg = '';
          try {
            const response = await axios.get('http://api.francosys.com.br/vr-aberto', {
              params: { nomefantasia: fornecedorFormatado },
              headers: API_HEADERS
            });
            vrMsg = formatarVrAbertoResponse(response.data);
          } catch (err) {
            vrMsg = `❌ Erro de comunicação com o servidor: ${err.message}`;
          }

          const isFailure = vrMsg.startsWith('❌') || vrMsg.includes('Nenhum') || vrMsg.includes('Nenhuma');
          if (isFailure) {
            const retryMsg = `${vrMsg}\n\nComo deseja prosseguir?\n1 - Buscar outro fornecedor\n2 - Voltar ao Menu Principal\n3 - Encerrar atendimento`;
            await sendResponse(cleanPhone, retryMsg, 'AWAIT_MENU_OPTION', 'AWAIT_RETRY_OPTION_4');
            await updateSession(cleanPhone, 'AWAIT_RETRY_OPTION_4', tempData);
          } else {
            const successMsg = `${vrMsg}\n\nDeseja realizar mais alguma consulta?\n1 - Sim, voltar ao Menu Principal\n2 - Não, encerrar atendimento`;
            await sendResponse(cleanPhone, successMsg, 'AWAIT_MENU_OPTION', 'AWAIT_POST_QUERY_MENU');
            await updateSession(cleanPhone, 'AWAIT_POST_QUERY_MENU', tempData);
          }
        } else {
          const msg = `Certo, qual o nome do fornecedor que voce deseja consultar?`;
          await sendResponse(cleanPhone, msg, 'AWAIT_MENU_OPTION', 'AWAIT_VR_SUPPLIER_NAME');
          await updateSession(cleanPhone, 'AWAIT_VR_SUPPLIER_NAME', tempData);
        }
      } else if (isLanOption) {
        const msg = `Certo, diz pra mim, você quer verificar uma data especifica, ou um período especifico?\n\n1 - data especifica\n2 - um periodo especifico`;
        await sendResponse(cleanPhone, msg, 'AWAIT_MENU_OPTION', 'AWAIT_LAN_TYPE');
        await updateSession(cleanPhone, 'AWAIT_LAN_TYPE', tempData);
      } else if (isPagOption) {
        const msg = `Certo, diz pra mim, você quer verificar uma data especifica, ou um período especifico?\n\n1 - data especifica\n2 - um periodo especifico`;
        await sendResponse(cleanPhone, msg, 'AWAIT_MENU_OPTION', 'AWAIT_PAG_TYPE');
        await updateSession(cleanPhone, 'AWAIT_PAG_TYPE', tempData);
      } else {
        const msg = `Você não digitou uma opção válida!`;
        await sendResponse(cleanPhone, msg, 'AWAIT_MENU_OPTION', 'AWAIT_MENU_OPTION');
        await sendResponse(cleanPhone, getMenuText(user.name), 'AWAIT_MENU_OPTION', 'AWAIT_MENU_OPTION');
      }
      return;
    }

    // --- Fluxo da OPÇÃO 3 (Consulta Status de Lançamento) ---
    if (state === 'AWAIT_NF') {
      if (/^\d+$/.test(rawText)) {
        // Formata o número da nota fiscal com zeros à esquerda (9 caracteres)
        const nfFormatada = String(rawText).padStart(9, '0');
        tempData.nf = nfFormatada;

        const msg = `Digite o nome do fornecedor`;
        await sendResponse(cleanPhone, msg, 'AWAIT_NF', 'AWAIT_SUPPLIER_NAME');
        await updateSession(cleanPhone, 'AWAIT_SUPPLIER_NAME', tempData);
      } else {
        const msg = `Acredito que você informou outras coisas além do numero da nota fiscal, diga somente o numero da nota fiscal`;
        await sendResponse(cleanPhone, msg, 'AWAIT_NF', 'AWAIT_NF');
      }
      return;
    }

    if (state === 'AWAIT_SUPPLIER_NAME') {
      const nFornecedor = cleanSupplierName(rawText);
      const resolvedSupplier = resolveSupplierName(nFornecedor);

      const nFornecedorFormatado = String(resolvedSupplier).toUpperCase().trim();

      const nf = tempData.nf;

      // API Webhook 3: statuslan
      let statusMsg = '';
      try {
        const response = await axios.get('http://api.francosys.com.br/statuslan', {
          params: {
            numerodocumento: nf,
            nomefantasia: nFornecedorFormatado
          },
          headers: API_HEADERS
        });

        // Executa o script de formatação com os dados da API
        statusMsg = formatarStatusLanResponse(response.data);
      } catch (err) {
        console.error("Erro na API statuslan:", err.message);
        statusMsg = `❌ Erro de comunicação com o servidor financeiro. Detalhes: ${err.message}`;
      }

      const isFailure = statusMsg.startsWith('❌') || statusMsg.includes('Nenhum') || statusMsg.includes('Nenhuma');

      if (isFailure) {
        const retryMsg = `${statusMsg}\n\nComo deseja prosseguir?\n1 - Tentar outro fornecedor para a mesma Nota Fiscal\n2 - Voltar ao Menu Principal\n3 - Encerrar atendimento`;
        await sendResponse(cleanPhone, retryMsg, 'AWAIT_SUPPLIER_NAME', 'AWAIT_RETRY_OPTION_3');
        await updateSession(cleanPhone, 'AWAIT_RETRY_OPTION_3', tempData);
      } else {
        const successMsg = `${statusMsg}\n\nDeseja realizar mais alguma consulta?\n1 - Sim, voltar ao Menu Principal\n2 - Não, encerrar atendimento`;
        await sendResponse(cleanPhone, successMsg, 'AWAIT_SUPPLIER_NAME', 'AWAIT_POST_QUERY_MENU');
        await updateSession(cleanPhone, 'AWAIT_POST_QUERY_MENU', tempData);
      }
      return;
    }

    // --- Fluxo da OPÇÃO 4 (Valor em Aberto de um Fornecedor) ---
    if (state === 'AWAIT_VR_SUPPLIER_NAME') {
      const fornecedor = cleanSupplierName(rawText);
      const resolvedSupplier = resolveSupplierName(fornecedor);

      const fornecedorFormatado = String(resolvedSupplier).toUpperCase().trim();

      // API Webhook 4: vr-aberto
      let vrMsg = '';
      try {
        const response = await axios.get('http://api.francosys.com.br/vr-aberto', {
          params: {
            nomefantasia: fornecedorFormatado
          },
          headers: API_HEADERS
        });

        // Executa o script de formatação com os dados da API
        vrMsg = formatarVrAbertoResponse(response.data);
      } catch (err) {
        console.error("Erro na API vr-aberto:", err.message);
        vrMsg = `❌ Erro de comunicação com o servidor financeiro. Detalhes: ${err.message}`;
      }

      const isFailure = vrMsg.startsWith('❌') || vrMsg.includes('Nenhum') || vrMsg.includes('Nenhuma');

      if (isFailure) {
        const retryMsg = `${vrMsg}\n\nComo deseja prosseguir?\n1 - Buscar outro fornecedor\n2 - Voltar ao Menu Principal\n3 - Encerrar atendimento`;
        await sendResponse(cleanPhone, retryMsg, 'AWAIT_VR_SUPPLIER_NAME', 'AWAIT_RETRY_OPTION_4');
        await updateSession(cleanPhone, 'AWAIT_RETRY_OPTION_4', tempData);
      } else {
        const successMsg = `${vrMsg}\n\nDeseja realizar mais alguma consulta?\n1 - Sim, voltar ao Menu Principal\n2 - Não, encerrar atendimento`;
        await sendResponse(cleanPhone, successMsg, 'AWAIT_VR_SUPPLIER_NAME', 'AWAIT_POST_QUERY_MENU');
        await updateSession(cleanPhone, 'AWAIT_POST_QUERY_MENU', tempData);
      }
      return;
    }

    // --- Novos estados de Inteligência do Fluxo ---
    if (state === 'AWAIT_RETRY_OPTION_3') {
      const isRetry = rawText === '1' || /\b(tentar|outro|buscar|fornecedor|novamente)\b/i.test(rawText);
      const isBackToMenu = rawText === '2' || nlp.intent === 'MENU';
      const isExit = rawText === '3' || nlp.intent === 'SAIR';

      if (isRetry) {
        const msg = `Digite o nome do fornecedor`;
        await sendResponse(cleanPhone, msg, 'AWAIT_RETRY_OPTION_3', 'AWAIT_SUPPLIER_NAME');
        await updateSession(cleanPhone, 'AWAIT_SUPPLIER_NAME', tempData);
      } else if (isBackToMenu) {
        await sendResponse(cleanPhone, getMenuText(user.name), 'AWAIT_RETRY_OPTION_3', 'AWAIT_MENU_OPTION');
        await updateSession(cleanPhone, 'AWAIT_MENU_OPTION', {});
      } else if (isExit) {
        await sendResponse(cleanPhone, `Atendimento encerrado. Obrigado! Digite qualquer mensagem para iniciar um novo atendimento.`, 'AWAIT_RETRY_OPTION_3', 'START');
        await clearSession(cleanPhone);
      } else {
        const msg = `Você não digitou uma opção válida!\n\nPor favor, digite:\n1 - Tentar outro fornecedor para a mesma Nota Fiscal\n2 - Voltar ao Menu Principal\n3 - Encerrar atendimento`;
        await sendResponse(cleanPhone, msg, 'AWAIT_RETRY_OPTION_3', 'AWAIT_RETRY_OPTION_3');
      }
      return;
    }

    if (state === 'AWAIT_RETRY_OPTION_4') {
      const isRetry = rawText === '1' || /\b(buscar|outro|tentar|fornecedor|novamente)\b/i.test(rawText);
      const isBackToMenu = rawText === '2' || nlp.intent === 'MENU';
      const isExit = rawText === '3' || nlp.intent === 'SAIR';

      if (isRetry) {
        const msg = `Certo, qual o nome do fornecedor que voce deseja consultar?`;
        await sendResponse(cleanPhone, msg, 'AWAIT_RETRY_OPTION_4', 'AWAIT_VR_SUPPLIER_NAME');
        await updateSession(cleanPhone, 'AWAIT_VR_SUPPLIER_NAME', tempData);
      } else if (isBackToMenu) {
        await sendResponse(cleanPhone, getMenuText(user.name), 'AWAIT_RETRY_OPTION_4', 'AWAIT_MENU_OPTION');
        await updateSession(cleanPhone, 'AWAIT_MENU_OPTION', {});
      } else if (isExit) {
        await sendResponse(cleanPhone, `Atendimento encerrado. Obrigado! Digite qualquer mensagem para iniciar um novo atendimento.`, 'AWAIT_RETRY_OPTION_4', 'START');
        await clearSession(cleanPhone);
      } else {
        const msg = `Você não digitou uma opção válida!\n\nPor favor, digite:\n1 - Buscar outro fornecedor\n2 - Voltar ao Menu Principal\n3 - Encerrar atendimento`;
        await sendResponse(cleanPhone, msg, 'AWAIT_RETRY_OPTION_4', 'AWAIT_RETRY_OPTION_4');
      }
      return;
    }

    if (state === 'AWAIT_POST_QUERY_MENU') {
      const isBackToMenu = rawText === '1' || /\b(sim|voltar|menu|principal)\b/i.test(rawText) || nlp.intent === 'MENU';
      const isExit = rawText === '2' || /\b(não|nao|sair|encerrar|fim|obrigado|tchau)\b/i.test(rawText) || nlp.intent === 'SAIR';

      if (isBackToMenu) {
        await sendResponse(cleanPhone, getMenuText(user.name), 'AWAIT_POST_QUERY_MENU', 'AWAIT_MENU_OPTION');
        await updateSession(cleanPhone, 'AWAIT_MENU_OPTION', {});
      } else if (isExit) {
        await sendResponse(cleanPhone, `Atendimento encerrado. Obrigado! Digite qualquer mensagem para iniciar um novo atendimento.`, 'AWAIT_POST_QUERY_MENU', 'START');
        await clearSession(cleanPhone);
      } else {
        const msg = `Você não digitou uma opção válida!\n\nDeseja realizar mais alguma consulta?\n1 - Sim, voltar ao Menu Principal\n2 - Não, encerrar atendimento`;
        await sendResponse(cleanPhone, msg, 'AWAIT_POST_QUERY_MENU', 'AWAIT_POST_QUERY_MENU');
      }
      return;
    }

    // --- Fluxos de BÔNUS (OPÇÕES 1 e 2) ---
    if (state === 'AWAIT_LAN_TYPE') {
      if (rawText === '1') {
        await sendResponse(cleanPhone, `Certo digite pra mim a data no padrão yyyy-mm-dd\n\nex: 2026-05-31`, 'AWAIT_LAN_TYPE', 'AWAIT_LAN_DATE_SPECIFIC');
        await updateSession(cleanPhone, 'AWAIT_LAN_DATE_SPECIFIC', tempData);
      } else if (rawText === '2') {
        await sendResponse(cleanPhone, `Digite a data de inicio:\nformato padrão yyyy-mm-dd\n\nex: 2026-05-30`, 'AWAIT_LAN_TYPE', 'AWAIT_LAN_START_DATE');
        await updateSession(cleanPhone, 'AWAIT_LAN_START_DATE', tempData);
      } else {
        await sendResponse(cleanPhone, `Você não digitou uma opção válida!`, 'AWAIT_LAN_TYPE', 'START');
        await clearSession(cleanPhone);
      }
      return;
    }

    if (state === 'AWAIT_LAN_DATE_SPECIFIC') {
      if (/^\d{4}-\d{2}-\d{2}$/.test(rawText)) {
        let responseMsg = '';
        try {
          const response = await axios.get('http://api.francosys.com.br/lancamentos', {
            params: { data_inicio: rawText, data_fim: rawText },
            headers: API_HEADERS
          });
          responseMsg = formatarLancamentosEspecificosResponse(response.data);
        } catch (err) {
          responseMsg = `❌ Erro na API de lançamentos: ${err.message}`;
        }
        await sendResponse(cleanPhone, responseMsg, 'AWAIT_LAN_DATE_SPECIFIC', 'START');
        await clearSession(cleanPhone);
      } else {
        await sendResponse(cleanPhone, `A data digitada não se encontra no padrão solicitado!`, 'AWAIT_LAN_DATE_SPECIFIC', 'AWAIT_LAN_DATE_SPECIFIC');
      }
      return;
    }

    if (state === 'AWAIT_LAN_START_DATE') {
      if (/^\d{4}-\d{2}-\d{2}$/.test(rawText)) {
        tempData.data_inicio = rawText;
        await sendResponse(cleanPhone, `Certo, digite agora a data final!\nformato padrão yyyy-mm-dd\n\nex: 2026-05-30`, 'AWAIT_LAN_START_DATE', 'AWAIT_LAN_END_DATE');
        await updateSession(cleanPhone, 'AWAIT_LAN_END_DATE', tempData);
      } else {
        await sendResponse(cleanPhone, `A data digitada não se encontra no padrão solicitado!`, 'AWAIT_LAN_START_DATE', 'AWAIT_LAN_START_DATE');
      }
      return;
    }

    if (state === 'AWAIT_LAN_END_DATE') {
      if (/^\d{4}-\d{2}-\d{2}$/.test(rawText)) {
        let responseMsg = '';
        try {
          const response = await axios.get('http://api.francosys.com.br/lancamentos', {
            params: { data_inicio: tempData.data_inicio, data_fim: rawText },
            headers: API_HEADERS
          });
          responseMsg = formatarLancamentosPeriodoResponse(response.data);
        } catch (err) {
          responseMsg = `❌ Erro na API de lançamentos por período: ${err.message}`;
        }
        await sendResponse(cleanPhone, responseMsg, 'AWAIT_LAN_END_DATE', 'START');
        await clearSession(cleanPhone);
      } else {
        await sendResponse(cleanPhone, `A data digitada não se encontra no padrão solicitado!`, 'AWAIT_LAN_END_DATE', 'AWAIT_LAN_END_DATE');
      }
      return;
    }

    // Fluxo da Opção 2 (Pagamentos)
    if (state === 'AWAIT_PAG_TYPE') {
      if (rawText === '1') {
        await sendResponse(cleanPhone, `Certo digite pra mim a data no padrão yyyy-mm-dd\n\nex: 2026-05-31`, 'AWAIT_PAG_TYPE', 'AWAIT_PAG_DATE_SPECIFIC');
        await updateSession(cleanPhone, 'AWAIT_PAG_DATE_SPECIFIC', tempData);
      } else if (rawText === '2') {
        await sendResponse(cleanPhone, `Digite a data de inicio:\nformato padrão yyyy-mm-dd\n\nex: 2026-05-30`, 'AWAIT_PAG_TYPE', 'AWAIT_PAG_START_DATE');
        await updateSession(cleanPhone, 'AWAIT_PAG_START_DATE', tempData);
      } else {
        await sendResponse(cleanPhone, `Você não digitou uma opção válida!`, 'AWAIT_PAG_TYPE', 'START');
        await clearSession(cleanPhone);
      }
      return;
    }

    if (state === 'AWAIT_PAG_DATE_SPECIFIC') {
      if (/^\d{4}-\d{2}-\d{2}$/.test(rawText)) {
        let responseMsg = '';
        try {
          const response = await axios.get('http://api.francosys.com.br/pagamentos', {
            params: { data_inicio: rawText, data_fim: rawText },
            headers: API_HEADERS
          });
          responseMsg = formatarPagamentosEspecificosResponse(response.data);
        } catch (err) {
          responseMsg = `❌ Erro na API de pagamentos: ${err.message}`;
        }
        await sendResponse(cleanPhone, responseMsg, 'AWAIT_PAG_DATE_SPECIFIC', 'START');
        await clearSession(cleanPhone);
      } else {
        await sendResponse(cleanPhone, `A data digitada não se encontra no padrão solicitado!`, 'AWAIT_PAG_DATE_SPECIFIC', 'AWAIT_PAG_DATE_SPECIFIC');
      }
      return;
    }

    if (state === 'AWAIT_PAG_START_DATE') {
      if (/^\d{4}-\d{2}-\d{2}$/.test(rawText)) {
        tempData.pag_data_inicio = rawText;
        await sendResponse(cleanPhone, `Digite a data de final:\nformato padrão yyyy-mm-dd\n\nex: 2026-05-30`, 'AWAIT_PAG_START_DATE', 'AWAIT_PAG_END_DATE');
        await updateSession(cleanPhone, 'AWAIT_PAG_END_DATE', tempData);
      } else {
        await sendResponse(cleanPhone, `A data digitada não se encontra no padrão solicitado!`, 'AWAIT_PAG_START_DATE', 'AWAIT_PAG_START_DATE');
      }
      return;
    }

    if (state === 'AWAIT_PAG_END_DATE') {
      if (/^\d{4}-\d{2}-\d{2}$/.test(rawText)) {
        let responseMsg = '';
        try {
          const response = await axios.get('http://api.francosys.com.br/pagamentos', {
            params: { data_inicio: tempData.pag_data_inicio, data_fim: rawText },
            headers: API_HEADERS
          });
          responseMsg = formatarPagamentosPeriodoResponse(response.data);
        } catch (err) {
          responseMsg = `❌ Erro na API de pagamentos por período: ${err.message}`;
        }
        await sendResponse(cleanPhone, responseMsg, 'AWAIT_PAG_END_DATE', 'START');
        await clearSession(cleanPhone);
      } else {
        await sendResponse(cleanPhone, `A data digitada não se encontra no padrão solicitado!`, 'AWAIT_PAG_END_DATE', 'AWAIT_PAG_END_DATE');
      }
      return;
    }

  } catch (err) {
    console.error("Erro no processamento da máquina de estados:", err);
    await sendResponse(cleanPhone, `⚠️ Ocorreu um erro interno no fluxo do bot. Sua sessão foi reiniciada.`, session.state, 'START');
    await clearSession(cleanPhone);
  }
}

// ==========================================
// FUNÇÕES DE TRATAMENTO E FORMATAÇÃO DE DADOS (Copiado do Typebot)
// ==========================================

// OPÇÃO 3: Formatação de statuslan
function formatarStatusLanResponse(rawData) {
  let rawResponse = rawData;
  if (rawResponse && typeof rawResponse === 'object' && rawResponse.response) {
    rawResponse = rawResponse.response;
  }

  let lancamentos = [];
  try {
    if (typeof rawResponse === 'string') {
      lancamentos = JSON.parse(rawResponse);
    } else if (Array.isArray(rawResponse)) {
      lancamentos = rawResponse;
    } else if (rawResponse && rawResponse.data) {
      lancamentos = rawResponse.data;
    }
  } catch (e) {
    return "❌ Erro ao ler os dados dos lançamentos. Formato inválido.";
  }

  if (!Array.isArray(lancamentos) || lancamentos.length === 0) {
    return "❌ Nenhum lançamento foi localizado com este número de documento.";
  }

  const dadosConvertidos = lancamentos.map(item => typeof item === 'string' ? JSON.parse(item) : item);

  const fornecedores = {};
  let totalGeralPendente = 0;

  dadosConvertidos.forEach((lan) => {
    if (lan.STATUSLAN === "A" || lan.STATUSLAN === "a") {
      const nomeFornecedor = (lan.NOME || lan.NOMEFANTASIA || 'Não informado').trim().toUpperCase();
      const valor = parseFloat(lan.VALORORIGINAL) || 0;

      if (!fornecedores[nomeFornecedor]) {
        fornecedores[nomeFornecedor] = {
          totalPendente: 0,
          itens: []
        };
      }

      fornecedores[nomeFornecedor].totalPendente += valor;
      totalGeralPendente += valor;

      fornecedores[nomeFornecedor].itens.push({
        doc: lan.NUMERODOCUMENTO,
        valor: valor,
        vencimento: formatarData(lan.DATAVENCIMENTO)
      });
    }
  });

  const qtdFornecedores = Object.keys(fornecedores).length;
  if (qtdFornecedores === 0) {
    return "⚠️ Nenhum lançamento em aberto foi localizado.";
  }

  let respostaFormatada = "⚠️ *Contas em Aberto Localizadas por Fornecedor:*\n\n";

  for (const nomeFornecedor in fornecedores) {
    const dados = fornecedores[nomeFornecedor];
    respostaFormatada += `🏢 *FORNECEDOR: ${nomeFornecedor}*\n`;
    respostaFormatada += `💰 *Total Pendente:* _${formatarMoeda(dados.totalPendente)}_\n`;
    respostaFormatada += `────────────────────\n`;

    dados.itens.forEach(item => {
      respostaFormatada += `  • *Doc:* ${item.doc} | *Valor:* ${formatarMoeda(item.valor)} | *Venc:* ${item.vencimento}\n`;
    });
    respostaFormatada += `\n`;
  }

  respostaFormatada += `📊 *RESUMO GERAL DOS EM ABERTO*\n`;
  respostaFormatada += `  • Fornecedores Credores: ${qtdFornecedores}\n`;
  respostaFormatada += `💰 *TOTAL GERAL PENDENTE:* ${formatarMoeda(totalGeralPendente)}`;

  return respostaFormatada;
}

// OPÇÃO 4: Formatação de vr-aberto
function formatarVrAbertoResponse(rawData) {
  let rawResponse = rawData;
  if (rawResponse && typeof rawResponse === 'object' && rawResponse.response) {
    rawResponse = rawResponse.response;
  }

  let lancamentos = [];
  try {
    if (typeof rawResponse === 'string') {
      lancamentos = JSON.parse(rawResponse);
    } else if (Array.isArray(rawResponse)) {
      lancamentos = rawResponse;
    } else if (rawResponse && rawResponse.data) {
      lancamentos = rawResponse.data;
    }
  } catch (e) {
    return "❌ Erro ao ler os dados da API. Formato inválido.";
  }

  if (!Array.isArray(lancamentos) || lancamentos.length === 0) {
    return "❌ Nenhuma conta em aberto foi localizada.";
  }

  const dadosConvertidos = lancamentos.map(item => typeof item === 'string' ? JSON.parse(item) : item);

  const agrupadoPorFornecedor = {};

  dadosConvertidos.forEach(lan => {
    const fornecedor = lan.NOMEFANTASIA ? lan.NOMEFANTASIA.trim() : "FORNECEDOR NÃO INFORMADO";

    if (!agrupadoPorFornecedor[fornecedor]) {
      agrupadoPorFornecedor[fornecedor] = {
        documentos: [],
        totalPendente: 0
      };
    }

    const valor = parseFloat(lan.VALORORIGINAL) || 0;
    agrupadoPorFornecedor[fornecedor].documentos.push(lan);
    agrupadoPorFornecedor[fornecedor].totalPendente += valor;
  });

  let respostaFormatada = "⚠️ *Contas em Aberto Localizadas por Fornecedor:*\n\n";
  let totalGeralPendente = 0;

  Object.keys(agrupadoPorFornecedor).forEach(fornecedor => {
    const dados = agrupadoPorFornecedor[fornecedor];
    totalGeralPendente += dados.totalPendente;

    respostaFormatada += `🏢 *FORNECEDOR: ${fornecedor}*\n`;
    respostaFormatada += `💰 Total Pendente: *${formatarMoeda(dados.totalPendente)}*\n`;
    respostaFormatada += `────────────────────\n`;

    dados.documentos.forEach(doc => {
      const dataVenc = formatarData(doc.DATAVENCIMENTO);
      respostaFormatada += `• Doc: ${doc.NUMERODOCUMENTO} | Valor: ${formatarMoeda(doc.VALORORIGINAL)} | Venc: ${dataVenc}\n`;
    });

    respostaFormatada += `\n`;
  });

  respostaFormatada += `📊 *RESUMO GERAL DOS EM ABERTO*\n`;
  respostaFormatada += `• Fornecedores Credores: ${Object.keys(agrupadoPorFornecedor).length}\n`;
  respostaFormatada += `💰 *TOTAL GERAL PENDENTE:* ${formatarMoeda(totalGeralPendente)}`;

  return respostaFormatada;
}

// OPÇÃO 1 BÔNUS: Formatação de Lançamentos em data específica
function formatarLancamentosEspecificosResponse(rawData) {
  if (!rawData || !Array.isArray(rawData)) {
    return "❌ Nenhum lançamento financeiro foi encontrado para esta consulta.";
  }

  const movimentacoes = rawData.map(item => typeof item === 'string' ? JSON.parse(item) : item);

  let respostaFormatada = "📊 *Aqui está o resumo financeiro localizado:*\n\n";

  movimentacoes.forEach((mov, index) => {
    respostaFormatada += `🔹 *Lançamento #${index + 1}*\n`;
    respostaFormatada += `• *Empresa/Nome:* ${mov.NOME || 'Não informado'}\n`;
    respostaFormatada += `• *Documento:* ${mov.NUMERODOCUMENTO} (${mov.TIPO})\n`;
    respostaFormatada += `• *Valor:* ${formatarMoeda(mov.VALORORIGINAL)}\n`;
    respostaFormatada += `• *Vencimento:* ${formatarData(mov.DATAVENCIMENTO)}\n`;
    if (mov.HISTORICO) {
      respostaFormatada += `• *Histórico:* ${mov.HISTORICO.trim()}\n`;
    }
    respostaFormatada += `\n────────────────────\n\n`;
  });

  const qtdLancamentos = movimentacoes.length;
  const valorTotalGeral = movimentacoes.reduce((acumulado, mov) => acumulado + (mov.VALORORIGINAL || 0), 0);

  respostaFormatada += `🧮 *RESUMO DOS TOTAIS*\n`;
  respostaFormatada += `• *Total de lançamentos:* ${qtdLancamentos}\n`;
  respostaFormatada += `💰 *VALOR TOTAL GERAL:* ${formatarMoeda(valorTotalGeral)}`;

  return respostaFormatada;
}

// OPÇÃO 1 BÔNUS: Formatação de Lançamentos em período
function formatarLancamentosPeriodoResponse(rawData) {
  if (!rawData || !Array.isArray(rawData)) {
    return "❌ Nenhum lançamento financeiro foi encontrado para o período selecionado.";
  }

  const movimentacoes = rawData.map(item => typeof item === 'string' ? JSON.parse(item) : item);

  const resumoDias = {};

  movimentacoes.forEach(mov => {
    const dataVenc = formatarData(mov.DATAVENCIMENTO);
    const valor = parseFloat(mov.VALORORIGINAL) || 0;

    if (!resumoDias[dataVenc]) {
      resumoDias[dataVenc] = { totalValor: 0, qtdContas: 0 };
    }

    resumoDias[dataVenc].totalValor += valor;
    resumoDias[dataVenc].qtdContas += 1;
  });

  let respostaFormatada = "📅 *CRONOGRAMA DE VENCIMENTOS DO PERÍODO*\n";
  respostaFormatada += "_Confira os valores totais que vencem a cada dia:_\n\n";

  const datasOrdenadas = Object.keys(resumoDias).sort((a, b) => {
    const [diaA, mesA, anoA] = a.split('/');
    const [diaB, mesB, anoB] = b.split('/');
    return new Date(anoA, mesA - 1, diaA) - new Date(anoB, mesB - 1, diaB);
  });

  datasOrdenadas.forEach(data => {
    const infoDia = resumoDias[data];
    respostaFormatada += `📆 *Dia ${data}*\n`;
    respostaFormatada += `• Qtd. de contas: ${infoDia.qtdContas}\n`;
    respostaFormatada += `• Total do dia: *${formatarMoeda(infoDia.totalValor)}*\n`;
    respostaFormatada += `────────────────────\n`;
  });

  const qtdLancamentos = movimentacoes.length;
  const valorTotalGeral = movimentacoes.reduce((acumulado, mov) => acumulado + (parseFloat(mov.VALORORIGINAL) || 0), 0);

  respostaFormatada += `\n📊 *RESUMO TOTAL DO PERÍODO*\n`;
  respostaFormatada += `• *Total geral de contas:* ${qtdLancamentos}\n`;
  respostaFormatada += `💰 *VALOR ACUMULADO:* ${formatarMoeda(valorTotalGeral)}`;

  return respostaFormatada;
}

// OPÇÃO 2 BÔNUS: Formatação de Pagamentos em data específica
function formatarPagamentosEspecificosResponse(rawData) {
  let rawResponse = rawData;
  if (rawResponse && typeof rawResponse === 'object' && rawResponse.response) {
    rawResponse = rawResponse.response;
  }

  let movimentacoes = [];
  try {
    if (typeof rawResponse === 'string') {
      movimentacoes = JSON.parse(rawResponse);
    } else if (Array.isArray(rawResponse)) {
      movimentacoes = rawResponse;
    }
  } catch (e) {
    return "❌ Erro ao ler os dados da API. Formato inválido.";
  }

  if (!Array.isArray(movimentacoes) || movimentacoes.length === 0) {
    return "❌ Nenhuma movimentação localizada para os dados informados.";
  }

  const dadosConvertidos = movimentacoes.map(item => typeof item === 'string' ? JSON.parse(item) : item);
  const dataConsultada = formatarData(dadosConvertidos[0].DATAVENCIMENTO);

  let respostaFormatada = `📅 *RESUMO FINANCEIRO - DIA ${dataConsultada}*\n`;
  respostaFormatada += `_Confira os lançamentos detalhados abaixo:_\n\n`;

  dadosConvertidos.forEach((mov) => {
    respostaFormatada += `🔹 *${mov.NOME || 'Não informado'}*\n`;
    respostaFormatada += `• Doc: ${mov.NUMERODOCUMENTO} (${mov.TIPO}) | Parcela: ${mov.PARCELA}\n`;
    respostaFormatada += `• Valor Original: ${formatarMoeda(mov.VALORORIGINAL)}\n`;

    if (mov.VALORJUROS > 0) {
      respostaFormatada += `• Juros: ${formatarMoeda(mov.VALORJUROS)}\n`;
    }

    respostaFormatada += `• Valor Baixado: *${formatarMoeda(mov.VALORBAIXADO)}*\n`;

    if (mov.HISTORICO) {
      respostaFormatada += `• Histórico: _${mov.HISTORICO.trim()}_\n`;
    }
    respostaFormatada += `\n────────────────────\n\n`;
  });

  const qtdLancamentos = dadosConvertidos.length;
  const totalOriginal = dadosConvertidos.reduce((sum, mov) => sum + (parseFloat(mov.VALORORIGINAL) || 0), 0);
  const totalBaixado = dadosConvertidos.reduce((sum, mov) => sum + (parseFloat(mov.VALORBAIXADO) || 0), 0);

  respostaFormatada += `🧮 *FECHAMENTO CONSOLIDADO*\n`;
  respostaFormatada += `• *Total de lançamentos:* ${qtdLancamentos}\n`;
  respostaFormatada += `• *Total Valor Original:* ${formatarMoeda(totalOriginal)}\n`;
  respostaFormatada += `💰 *TOTAL EFETIVAMENTE BAIXADO:* ${formatarMoeda(totalBaixado)}`;

  return respostaFormatada;
}

// OPÇÃO 2 BÔNUS: Formatação de Pagamentos em período
function formatarPagamentosPeriodoResponse(rawData) {
  let rawResponse = rawData;
  if (rawResponse && typeof rawResponse === 'object' && rawResponse.response) {
    rawResponse = rawResponse.response;
  }

  let movimentacoes = [];
  try {
    if (typeof rawResponse === 'string') {
      movimentacoes = JSON.parse(rawResponse);
    } else if (Array.isArray(rawResponse)) {
      movimentacoes = rawResponse;
    }
  } catch (e) {
    return "❌ Erro ao ler os dados da API. Formato inválido.";
  }

  if (!Array.isArray(movimentacoes) || movimentacoes.length === 0) {
    return "❌ Nenhuma movimentação localizada para o período informado.";
  }

  const dadosConvertidos = movimentacoes.map(item => typeof item === 'string' ? JSON.parse(item) : item);

  const resumoDias = {};

  dadosConvertidos.forEach(mov => {
    const dataVenc = formatarData(mov.DATAVENCIMENTO);
    const valorOriginal = parseFloat(mov.VALORORIGINAL) || 0;
    const valorBaixado = parseFloat(mov.VALORBAIXADO) || 0;

    if (!resumoDias[dataVenc]) {
      resumoDias[dataVenc] = { totalOriginal: 0, totalBaixado: 0, qtdContas: 0 };
    }

    resumoDias[dataVenc].totalOriginal += valorOriginal;
    resumoDias[dataVenc].totalBaixado += valorBaixado;
    resumoDias[dataVenc].qtdContas += 1;
  });

  let respostaFormatada = "📅 *CRONOGRAMA DE VENCIMENTOS DO PERÍODO*\n";
  respostaFormatada += "_Confira o resumo financeiro agrupado por dia:_\n\n";

  const datasOrdenadas = Object.keys(resumoDias).sort((a, b) => {
    const [diaA, mesA, anoA] = a.split('/');
    const [diaB, mesB, anoB] = b.split('/');
    return new Date(anoA, mesA - 1, diaA) - new Date(anoB, mesB - 1, diaB);
  });

  datasOrdenadas.forEach(data => {
    const infoDia = resumoDias[data];
    respostaFormatada += `📆 *Dia ${data}*\n`;
    respostaFormatada += `• Qtd. de lançamentos: ${infoDia.qtdContas}\n`;
    respostaFormatada += `• Total Original: ${formatarMoeda(infoDia.totalOriginal)}\n`;
    respostaFormatada += `• Total Baixado: *${formatarMoeda(infoDia.totalBaixado)}*\n`;
    respostaFormatada += `────────────────────\n`;
  });

  const qtdLancamentosGeral = dadosConvertidos.length;
  const totalOriginalGeral = dadosConvertidos.reduce((sum, mov) => sum + (parseFloat(mov.VALORORIGINAL) || 0), 0);
  const totalBaixadoGeral = dadosConvertidos.reduce((sum, mov) => sum + (parseFloat(mov.VALORBAIXADO) || 0), 0);

  respostaFormatada += `\n📊 *RESUMO ACUMULADO DO PERÍODO*\n`;
  respostaFormatada += `• *Total geral de lançamentos:* ${qtdLancamentosGeral}\n`;
  respostaFormatada += `• *Acumulado Original:* ${formatarMoeda(totalOriginalGeral)}\n`;
  respostaFormatada += `💰 *TOTAL GERAL BAIXADO:* ${formatarMoeda(totalBaixadoGeral)}`;

  return respostaFormatada;
}
