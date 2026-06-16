import axios from 'axios';

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function test() {
  const API_HEADERS = {
    'Origin': 'https://app.bubble.io',
    'Accept': 'application/json'
  };

  const testCases = [
    { label: "1. Raw CNPJ (38157834000269)", value: "38157834000269" },
    { label: "2. Formatted CNPJ (38.157.834/0002-69)", value: "38.157.834/0002-69" },
    { label: "3. Raw CNPJ again (38157834000269)", value: "38157834000269" },
    { label: "4. Formatted CNPJ again (38.157.834/0002-69)", value: "38.157.834/0002-69" },
    { label: "5. Casa do Construtor", value: "CASA DO CONSTRUTOR" },
    { label: "6. Casa do Construtor with underscores", value: "CASA_DO_CONSTRUTOR" }
  ];

  for (const tc of testCases) {
    try {
      console.log(`\nExecuting: ${tc.label}`);
      const res = await axios.get('http://api.francosys.com.br/vr-aberto', {
        params: { nomefantasia: tc.value },
        headers: API_HEADERS
      });
      console.log(`Success: Status ${res.status}, Records found: ${Array.isArray(res.data) ? res.data.length : 'Not an array'}`);
    } catch (err) {
      console.log(`Failed: ${err.message}`);
      if (err.response) {
        console.log(`Response body:`, err.response.data);
      }
    }
    await delay(1000); // Wait 1 second between queries
  }
}

test();
