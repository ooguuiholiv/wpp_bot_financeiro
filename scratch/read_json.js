import fs from 'fs';

const data = JSON.parse(fs.readFileSync('typebot-export-chat-bot-whatsapp-w41plao (1).json', 'utf8'));

function findBlock(obj) {
  if (!obj) return;
  if (typeof obj === 'string') {
    if (obj.includes('Substitui os espaços do meio por _')) {
      console.log("=== ENCONTRADO SCRIPT EM PORTUGUÊS ===");
      console.log(obj);
      console.log("======================================\n");
    }
  } else if (Array.isArray(obj)) {
    obj.forEach(findBlock);
  } else if (typeof obj === 'object') {
    Object.values(obj).forEach(findBlock);
  }
}

findBlock(data);
