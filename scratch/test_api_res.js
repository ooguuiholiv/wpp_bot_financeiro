import axios from 'axios';

async function test() {
  const API_HEADERS = {
    'Origin': 'https://app.bubble.io',
    'Accept': 'application/json'
  };

  const queries = [
    '%38157834000269%',
    '38157834000269',
    '%38.157.834/0002-69%',
    '38.157.834/0002-69',
    '%CASA_DO_CONSTRUTOR%',
    'CASA DO CONSTRUTOR'
  ];

  for (const q of queries) {
    try {
      console.log(`\n--- QUERYING: "${q}" ---`);
      const res = await axios.get('http://api.francosys.com.br/vr-aberto', {
        params: { nomefantasia: q },
        headers: API_HEADERS
      });
      console.log("Status:", res.status);
      console.log("Type of data:", typeof res.data, Array.isArray(res.data) ? "Array" : "Not Array");
      console.log("Keys / Preview:", JSON.stringify(res.data).substring(0, 300));
    } catch (err) {
      console.error("Error:", err.message);
      if (err.response) {
        console.error("Response:", err.response.data);
      }
    }
  }
}

test();
