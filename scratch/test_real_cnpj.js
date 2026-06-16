import { processMessage, botEvents } from '../botLogic.js';
import { initDb, clearSession, getSession } from '../db.js';

async function testCnpjFlow() {
  await initDb();
  const phone = '553497674564'; // Guilherme Franco
  
  // Limpa sessão anterior
  await clearSession(phone);
  
  // Event listener para monitorar o bot
  botEvents.on('message', (msg) => {
    if (msg.direction === 'outgoing') {
      console.log(`\n🤖 BOT RESPONDEU:\n${msg.message}\n`);
    }
  });

  console.log("=================================================");
  console.log("TESTE 1: BUSCANDO POR CNPJ FORMATADO (Opção 4)");
  console.log("=================================================");
  
  // Simula o usuário mandando mensagem inicial para abrir o menu
  await processMessage(phone, "olá");
  
  // Simula selecionando a opção 4
  await processMessage(phone, "4");
  
  // Simula informando o CNPJ do fornecedor
  await processMessage(phone, "38.157.834/0002-69");

  let session = await getSession(phone);
  console.log(`Estado da sessão após receber dados: ${session.state}`);
  
  // Volta para o menu ou limpa
  await clearSession(phone);
  
  console.log("\n=================================================");
  console.log("TESTE 2: BUSCANDO POR NOME COM ESPAÇOS (Opção 4)");
  console.log("=================================================");
  
  // Simula o usuário mandando mensagem direta
  await processMessage(phone, "olá");
  await processMessage(phone, "4");
  await processMessage(phone, "CASA DO CONSTRUTOR");
  
  session = await getSession(phone);
  console.log(`Estado da sessão após receber dados: ${session.state}`);

  process.exit(0);
}

testCnpjFlow().catch(err => {
  console.error("Erro no teste de fluxo CNPJ:", err);
  process.exit(1);
});
