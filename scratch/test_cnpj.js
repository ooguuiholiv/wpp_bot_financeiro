import axios from 'axios';

async function checkCnpj() {
  const API_HEADERS = {
    'Origin': 'https://app.bubble.io',
    'Accept': 'application/json'
  };

  try {
    // Vamos testar com um valor vazio ou qualquer coisa para ver se a API responde
    const response = await axios.get('http://api.francosys.com.br/fornecedores', {
      params: { cpf_cnpj: '00000000000000' },
      headers: API_HEADERS
    });
    console.log("Status da API:", response.status);
    console.log("Dados da API:", response.data);
  } catch (err) {
    console.error("Erro na API:", err.message);
    if (err.response) {
      console.error("Response data:", err.response.data);
    }
  }
}

checkCnpj();
