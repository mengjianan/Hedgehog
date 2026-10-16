#!/usr/bin/env node
/* 词库加解密小工具
 * 用法:
 *   node tools/encrypt.js <密码>            合并 src/words-*.json 加密为 data/words.enc
 *   node tools/encrypt.js <密码> --verify   解密验证一次（检查密码/数据完整性）
 * 算法: PBKDF2-SHA256(200k) -> AES-GCM-256
 * data/salt 只生成一次，之后复用（换密码不用重生成 salt）
 * 明文源 src/ 整个目录被 gitignore，只上传密文
 */
const fs = require('node:fs');
const path = require('node:path');
const { webcrypto } = require('node:crypto');
const crypto = webcrypto;

const ROOT = path.join(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');
const OUT = path.join(ROOT, 'data', 'words.enc');
const SALT = path.join(ROOT, 'data', 'salt');
const ITER = 200000;

function bufToB64(buf) {
  const a = Buffer.from(buf);
  return a.toString('base64');
}

async function deriveKey(password, salt) {
  const base = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function main() {
  const password = process.argv[2];
  const verify = process.argv.includes('--verify');
  if (!password) {
    console.error('用法: node tools/encrypt.js <密码> [--verify]');
    process.exit(1);
  }

  // salt：复用已有的，没有就生成 16 字节
  let salt;
  if (fs.existsSync(SALT)) {
    salt = new Uint8Array(fs.readFileSync(SALT));
  } else {
    salt = crypto.getRandomValues(new Uint8Array(16));
    fs.writeFileSync(SALT, Buffer.from(salt));
    console.log('salt 已生成: data/salt');
  }

  const key = await deriveKey(password, salt);

  if (verify) {
    if (!fs.existsSync(OUT)) {
      console.error('data/words.enc 不存在，请先加密');
      process.exit(1);
    }
    const blob = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    try {
      const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(Buffer.from(blob.iv, 'base64')) },
        key,
        new Uint8Array(Buffer.from(blob.data, 'base64'))
      );
      const data = JSON.parse(new TextDecoder().decode(plain));
      const parts = data.lists.map((l) => `${l.id}=${l.words.length}词`);
      (data.tables || []).forEach((t) =>
        parts.push(`${t.id}=${(t.sections || []).length}节`)
      );
      console.log('verify OK: ' + parts.join(', '));
    } catch (e) {
      console.error('verify FAILED: 密码不对或数据损坏');
      process.exit(1);
    }
    return;
  }

  const files = fs.existsSync(SRC_DIR)
    ? fs.readdirSync(SRC_DIR).filter((f) => f.endsWith('.json')).sort()
    : [];
  const wordFiles = files.filter((f) => f.startsWith('words-'));
  const tableFiles = files.filter((f) => f.startsWith('tables-'));
  if (!wordFiles.length) {
    console.error('src/ 下没有 words-*.json 词库源文件');
    process.exit(1);
  }
  const lists = wordFiles.map((f) =>
    JSON.parse(fs.readFileSync(path.join(SRC_DIR, f), 'utf8'))
  );
  const tables = tableFiles.map((f) =>
    JSON.parse(fs.readFileSync(path.join(SRC_DIR, f), 'utf8'))
  );
  const json = JSON.stringify({
    version: 3,
    updated: new Date().toISOString().slice(0, 10),
    lists,
    tables,
  });
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(json)
  );
  const blob = {
    v: 1,
    iter: ITER,
    iv: bufToB64(iv),
    data: bufToB64(ct),
  };
  fs.writeFileSync(OUT, JSON.stringify(blob));
  console.log(
    `encrypted: ${Buffer.byteLength(json)} B -> ${fs.statSync(OUT).size} B (words.enc)`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
