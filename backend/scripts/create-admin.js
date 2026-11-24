const readline = require('node:readline/promises');
const { stdin: input, stdout: output } = require('node:process');
const { store } = require('../lib/store');
const { hashPassword } = require('../lib/auth');

async function main() {
  const rl = readline.createInterface({ input, output });
  try {
    const email = (await rl.question('Email del administrador: ')).trim().toLowerCase();
    const name = (await rl.question('Nombre y apellido: ')).trim();
    const password = await rl.question('Contraseña (mínimo 10 caracteres): ');
    if (!/^\S+@\S+\.\S+$/.test(email) || !name || password.length < 10) throw new Error('Email, nombre o contraseña no válidos.');
    await store.update(async db => {
      if (db.users.some(user => user.email === email)) throw new Error('Ese email ya está registrado.');
      const [firstName, ...last] = name.split(/\s+/);
      db.users.push({ id: require('node:crypto').randomUUID(), firstName, lastName: last.join(' '), name, email, role: 'ADMIN', active: true, passwordHash: await hashPassword(password), createdAt: new Date().toISOString() });
    });
    console.log(`Administrador creado: ${email}`);
  } finally { rl.close(); }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
