import axios from 'axios';

async function testQuery() {
  const API_HEADERS = {
    'Origin': 'https://app.bubble.io',
    'Accept': 'application/json'
  };

  // Test 1: CNPJ Formatado
  try {
    console.log("--- TESTANDO COM CNPJ FORMATADO '%38.157.834/0002-69%' ---");
    const res = await axios.get('http://api.francosys.com.br/vr-aberto', {
      params: { nomefantasia: '%38.157.834/0002-69%' },
      headers: API_HEADERS
    });
    console.log("Status:", res.status);
    console.log("Data (primeiros 2 itens):", res.data.slice(0, 2));
  } catch (err) {
    console.error("Erro no teste 1:", err.message);
    if (err.response) {
      console.error("Response data:", err.response.data);
    }
  }

  // Test 2: CNPJ Limpo com %
  try {
    console.log("\n--- TESTANDO COM CNPJ LIMPO COM % '%38157834000269%' ---");
    const res = await axios.get('http://api.francosys.com.br/vr-aberto', {
      params: { nomefantasia: '%38157834000269%' },
      headers: API_HEADERS
    });
    console.log("Status:", res.status);
    console.log("Data (primeiros 2 itens):", res.data.slice(0, 2));
  } catch (err) {
    console.error("Erro no teste 2:", err.message);
    if (err.response) {
      console.error("Response data:", err.response.data);
    }
  }

  // Test 3: CNPJ Limpo sem %
  try {
    console.log("\n--- TESTANDO COM CNPJ LIMPO SEM % '38157834000269' ---");
    const res = await axios.get('http://api.francosys.com.br/vr-aberto', {
      params: { nomefantasia: '38157834000269' },
      headers: API_HEADERS
    });
    console.log("Status:", res.status);
    console.log("Data (primeiros 2 itens):", res.data.slice(0, 2));
  } catch (err) {
    console.error("Erro no teste 3:", err.message);
    if (err.response) {
      console.error("Response data:", err.response.data);
    }
  }

  // Test 4: CNPJ Formatado sem %
  try {
    console.log("\n--- TESTANDO COM CNPJ FORMATADO SEM % '38.157.834/0002-69' ---");
    const res = await axios.get('http://api.francosys.com.br/vr-aberto', {
      params: { nomefantasia: '38.157.834/0002-69' },
      headers: API_HEADERS
    });
    console.log("Status:", res.status);
    console.log("Data (primeiros 2 itens):", res.data.slice(0, 2));
  } catch (err) {
    console.error("Erro no teste 4:", err.message);
    if (err.response) {
      console.error("Response data:", err.response.data);
    }
  }
}

testQuery();
