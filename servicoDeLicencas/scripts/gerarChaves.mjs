// Gera o par Ed25519 da licenca. Imprime no terminal; nunca grava arquivo.
// A publica vai embutida no app; a privada vai para o secret CHAVE_PRIVADA_DA_LICENCA:
//   wrangler secret put CHAVE_PRIVADA_DA_LICENCA
import { generateKeyPairSync } from 'node:crypto';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');

console.log('=== CHAVE PUBLICA (SPKI PEM) - vai no app ===');
console.log(publicKey.export({ type: 'spki', format: 'pem' }).toString().trim());
console.log('');
console.log('=== CHAVE PRIVADA (PKCS8 PEM) - SEGREDO, so no secret do Worker ===');
console.log(privateKey.export({ type: 'pkcs8', format: 'pem' }).toString().trim());