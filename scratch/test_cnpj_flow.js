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

  console.log("--- TESTANDO FLUXO COMPLETO VIA CNPJ DO FORNECEDOR ---");
  // Vamos consultar com o CNPJ que sabemos que existe: '00000000000000'
  // Frase: "quanto devo para o CNPJ 00.000.000/0000-00"
  await processMessage(phone, "quanto devo para o CNPJ 00.000.000/0000-00");

  const session = await getSession(phone);
  console.log(`Estado final da sessão: ${session.state}`);
  process.exit(0);
}

testCnpjFlow().catch(err => {
  console.error("Erro no teste de fluxo CNPJ:", err);
  process.exit(1);
});
