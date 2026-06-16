import axios from 'axios';
import { initDb, getSession, dbGet, dbAll } from '../db.js';
import { processMessage, botEvents } from '../botLogic.js';

// Mock do axios para evitar dependência de rede durante o teste
const originalGet = axios.get;
axios.get = async function (url, config) {
  console.log(`[Mock API Call] GET para ${url} com params:`, config?.params);
  
  if (url.includes('/statuslan')) {
    // Retorna lançamentos simulados
    return {
      data: [
        {
          NOME: 'FORNECEDOR TESTE',
          NUMERODOCUMENTO: config.params.numerodocumento,
          TIPO: 'NF',
          VALORORIGINAL: 1500.50,
          DATAVENCIMENTO: '2026-06-30T00:00:00.000Z',
          STATUSLAN: 'A'
        }
      ]
    };
  } else if (url.includes('/vr-aberto')) {
    // Retorna valores simulados em aberto
    return {
      data: [
        {
          NOMEFANTASIA: 'FORNECEDOR TESTE',
          NUMERODOCUMENTO: '000123456',
          VALORORIGINAL: 3200.00,
          DATAVENCIMENTO: '2026-07-15T00:00:00.000Z'
        }
      ]
    };
  }
  
  return originalGet.apply(this, arguments);
};

async function runTests() {
  console.log("=== INICIANDO TESTES DO CHATBOT ===");
  
  // 1. Inicializa o banco de dados
  await initDb();
  
  const testPhoneAuth = '553499375206'; // Número pré-autorizado padrão
  const testPhoneUnauth = '5511999999999'; // Número não autorizado
  
  // Monitorar respostas emitidas pelo bot
  botEvents.on('message', (msg) => {
    if (msg.direction === 'outgoing') {
      console.log(`\n🤖 BOT RESPONDEU para ${msg.phone}:\n${msg.message}\n`);
    }
  });

  // --- TESTE 1: USUÁRIO NÃO AUTORIZADO ---
  console.log(`\n--- Teste 1: Enviando mensagem de número NÃO autorizado (${testPhoneUnauth}) ---`);
  await processMessage(testPhoneUnauth, 'Olá');
  
  // Verifica se a sessão permaneceu em START e se não foi gerada resposta
  const unauthSession = await getSession(testPhoneUnauth);
  console.log(`Estado da sessão do não autorizado: ${unauthSession.state} (Esperado: START)`);
  
  // --- TESTE 2: FLUXO DE SAUDAÇÃO E OPÇÃO INVÁLIDA ---
  console.log(`\n--- Teste 2: Enviando 'Olá' de número autorizado (${testPhoneAuth}) ---`);
  await processMessage(testPhoneAuth, 'Olá');
  
  let session = await getSession(testPhoneAuth);
  console.log(`Estado atual da sessão: ${session.state} (Esperado: AWAIT_MENU_OPTION)`);
  
  console.log(`\n--- Teste 2.1: Digitando opção inválida '9' ---`);
  await processMessage(testPhoneAuth, '9');
  session = await getSession(testPhoneAuth);
  console.log(`Estado atual da sessão: ${session.state} (Esperado: AWAIT_MENU_OPTION)`);

  // --- TESTE 3: FLUXO DE CONSULTA STATUS DE LANÇAMENTO (OPÇÃO 3) ---
  console.log(`\n--- Teste 3: Escolhendo Opção 3 ---`);
  await processMessage(testPhoneAuth, '3');
  session = await getSession(testPhoneAuth);
  console.log(`Estado atual da sessão: ${session.state} (Esperado: AWAIT_NF)`);

  console.log(`\n--- Teste 3.1: Enviando nota fiscal inválida (não numérica) 'abc12' ---`);
  await processMessage(testPhoneAuth, 'abc12');
  session = await getSession(testPhoneAuth);
  console.log(`Estado atual da sessão: ${session.state} (Esperado: AWAIT_NF)`);

  console.log(`\n--- Teste 3.2: Enviando nota fiscal válida '123' ---`);
  await processMessage(testPhoneAuth, '123');
  session = await getSession(testPhoneAuth);
  console.log(`Estado atual da sessão: ${session.state} (Esperado: AWAIT_SUPPLIER_NAME)`);
  console.log(`Nota fiscal armazenada temporariamente: ${session.temp_data.nf} (Esperado: 000000123)`);

  console.log(`\n--- Teste 3.3: Enviando nome do fornecedor e finalizando fluxo ---`);
  await processMessage(testPhoneAuth, 'Teste Fornecedor');
  session = await getSession(testPhoneAuth);
  console.log(`Estado atual da sessão após conclusão: ${session.state} (Esperado: START)`);

  // --- TESTE 4: FLUXO DE CONTAS EM ABERTO (OPÇÃO 4) ---
  console.log(`\n--- Teste 4: Iniciando fluxo novamente e escolhendo Opção 4 ---`);
  await processMessage(testPhoneAuth, 'Olá'); // Abre o menu
  await processMessage(testPhoneAuth, '4');   // Seleciona opção 4
  session = await getSession(testPhoneAuth);
  console.log(`Estado atual da sessão: ${session.state} (Esperado: AWAIT_VR_SUPPLIER_NAME)`);

  console.log(`\n--- Teste 4.1: Enviando nome do fornecedor e finalizando fluxo ---`);
  await processMessage(testPhoneAuth, 'Teste Fornecedor');
  session = await getSession(testPhoneAuth);
  console.log(`Estado atual da sessão após conclusão: ${session.state} (Esperado: START)`);

  // --- TESTE 5: VERIFICAÇÃO DE REGISTROS NO BANCO ---
  console.log(`\n--- Teste 5: Verificando interações salvas no SQLite ---`);
  const interactions = await dbAll(`SELECT * FROM interactions WHERE phone = ?`, [testPhoneAuth]);
  console.log(`Total de interações gravadas para o número de teste: ${interactions.length}`);
  console.log(`Últimas 2 interações gravadas:`);
  console.log(interactions.slice(-2).map(i => `[${i.direction}] ${i.message}`).join('\n'));

  console.log("\n=== TESTES CONCLUÍDOS COM SUCESSO! ===");
  process.exit(0);
}

runTests().catch(err => {
  console.error("Falha ao rodar testes:", err);
  process.exit(1);
});
