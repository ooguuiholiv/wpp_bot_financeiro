import axios from 'axios';

async function testUpdate() {
  const phone = '553497674564'; // Guilherme Franco
  console.log("--- TESTANDO ENDPOINT PUT /api/users/:phone ---");
  
  // 1. Get current list
  let res = await axios.get('http://localhost:3000/api/users');
  let user = res.data.find(u => u.phone === phone);
  console.log("Nome atual do contato:", user.name);

  // 2. Update name to "Guilherme Franco Editado"
  let updateRes = await axios.put(`http://localhost:3000/api/users/${phone}`, {
    name: 'Guilherme Franco Editado',
    is_authorized: true
  });
  console.log("Resultado do PUT:", updateRes.data);

  // 3. Verify update
  res = await axios.get('http://localhost:3000/api/users');
  user = res.data.find(u => u.phone === phone);
  console.log("Nome após edição:", user.name);

  // 4. Restore original name
  updateRes = await axios.put(`http://localhost:3000/api/users/${phone}`, {
    name: 'Guilherme Franco',
    is_authorized: true
  });
  console.log("Nome restaurado para original:", updateRes.data);
}

testUpdate().catch(err => {
  console.error("Erro no teste:", err.message);
});
