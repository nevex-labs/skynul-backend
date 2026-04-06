import { getPool } from '../src/services/database/layer';

const addr = (process.argv[2] ?? '0x48eb005e48313f878493d134a4b1abdf8622bc9e').toLowerCase();

async function main() {
  const pool = getPool();
  const userRows = (
    await pool.query(
      'SELECT u.id AS user_id, w.address, w.chain FROM users u JOIN wallets w ON w.user_id = u.id WHERE lower(w.address) = $1',
      [addr],
    )
  ).rows;
  console.log('WALLET -> USUARIO:', JSON.stringify(userRows, null, 2));
  const uid = userRows[0]?.user_id as number | undefined;
  if (uid == null) {
    console.log('No hay fila en wallets para esa dirección.');
    await pool.end();
    return;
  }

  const appSecrets = (
    await pool.query(
      `SELECT user_id, namespace, key_name, octet_length(encrypted_value) AS enc_bytes, updated_at
       FROM secrets WHERE user_id = $1 AND namespace = 'app' ORDER BY key_name`,
      [uid],
    )
  ).rows;
  console.log(`\nSecrets namespace app (Settings) user_id=${uid}:`, JSON.stringify(appSecrets, null, 2));

  const provForUser = (
    await pool.query(
      `SELECT user_id, namespace, key_name, octet_length(encrypted_value) AS enc_bytes
       FROM secrets WHERE user_id = $1 AND namespace = 'provider' ORDER BY key_name`,
      [uid],
    )
  ).rows;
  console.log(`\nSecrets namespace provider mismo user_id=${uid}:`, JSON.stringify(provForUser, null, 2));

  const provSystem = (
    await pool.query(
      `SELECT user_id, namespace, key_name
       FROM secrets WHERE user_id = 1 AND namespace = 'provider' AND key_name LIKE 'gemini%' ORDER BY key_name`,
    )
  ).rows;
  console.log('\nSecrets provider user_id=1 gemini* (lectura legacy del agente):', JSON.stringify(provSystem, null, 2));

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
