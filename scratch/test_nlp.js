import { processMessage, botEvents } from '../botLogic.js';
import { initDb, clearSession, getSession } from '../db.js';
import axios from 'axios';

// Mock do axios para registrar as chamadas à API real
const originalGet = axios.get;
let apiCalls = [];

axios.get = async function (url, config) {
  apiCalls.push({ url, params: config?.params });
  console.log(`[API CALL MOCK] GET ${url} params:`, config?.params);
  
  if (url.includes('/vr-aberto')) {
    if (config?.params?.nomefantasia === '%A_LOJA_ELETRICA%') {
      return { data: [] }; // O comportamento antigo que falhava
    }
    if (config?.params?.nomefantasia === '%LOJA_ELETRICA%') {
      return {
        data: [
          {
            NOMEFANTASIA: 'LOJA ELETRICA LTDA',
            NUMERODOCUMENTO: '000407867',
            VALORORIGINAL: 474.50,
            DATAVENCIMENTO: '2026-04-01T00:00:00.000Z'
          }
        ]
      };
    }
  }
  return { data: [] };
};

async function testNLP() {
  await initDb();
  const phone = '553497674564'; // Guilherme Franco
  
  // Limpa sessão anterior
  await clearSession(phone);
  
  // Event listener
  botEvents.on('message', (msg) => {
    if (msg.direction === 'outgoing') {
      console.log(`\n🤖 BOT: ${msg.message}\n`);
    }
  });

  console.log("--- TESTANDO: quanto devo para a Loja Eletrica ---");
  await processMessage(phone, "quanto devo para a Loja Eletrica");
  
  console.log("Chamadas de API feitas:");
  console.log(JSON.stringify(apiCalls, null, 2));
  
  const session = await getSession(phone);
  console.log(`Estado final da sessão: ${session.state}`);
  
  process.exit(0);
}

testNLP().catch(err => {
  console.error(err);
  process.exit(1);
});
