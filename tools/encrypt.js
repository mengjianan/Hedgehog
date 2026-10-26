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
const zlib = require('node:zlib');
const { webcrypto } = require('node:crypto');
const crypto = webcrypto;

const ROOT = path.join(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');
// words.enc.gz：预 gzip（GitHub Pages 对 octet-stream 不压缩，裸传 10.5MB 太慢；
// gzip 后 ~3.5MB，且 gzip 字节与 Content-Length 同单位，进度条不再超 100%）
const OUT = path.join(ROOT, 'data', 'words.enc.gz');
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
      console.error('data/words.enc.gz 不存在，请先加密');
      process.exit(1);
    }
    const blob = JSON.parse(zlib.gunzipSync(fs.readFileSync(OUT)).toString('utf8'));
    try {
      const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(Buffer.from(blob.iv, 'base64')) },
        key,
        new Uint8Array(Buffer.from(blob.data, 'base64'))
      );
      // z:1 = 明文在加密前做过 gzip
      const plainBuf = blob.z ? zlib.gunzipSync(Buffer.from(plain)) : Buffer.from(plain);
      const data = JSON.parse(plainBuf.toString('utf8'));
      const parts = data.lists.map((l) => `${l.id}=${l.words.length}词`);
      (data.tables || []).forEach((t) =>
        parts.push(`${t.id}=${(t.sections || []).length}节`)
      );
      (data.grammars || []).forEach((g) =>
        parts.push(`${g.id}=${(g.rooms || []).length}室`)
      );
      const scenes = data.lists.filter((l) => l.group === 'scene').length;
      const hookN = Object.keys(data.hooks || {}).length;
      console.log(
        `verify OK (v${data.version}, 场景厅${scenes}, 钩子${hookN}): ` +
          parts.join(', ')
      );
    } catch (e) {
      console.error('verify FAILED: 密码不对或数据损坏');
      process.exit(1);
    }
    return;
  }

  const files = fs.existsSync(SRC_DIR)
    ? fs.readdirSync(SRC_DIR).filter((f) => f.endsWith('.json')).sort()
    : [];
  const dataFiles = files.filter(
    (f) => f.startsWith('words-') || f.startsWith('scenes-')
  );
  const tableFiles = files.filter((f) => f.startsWith('tables-'));
  if (!dataFiles.length) {
    console.error('src/ 下没有 words-/scenes- 词库源文件');
    process.exit(1);
  }
  // 一个文件可以是一张词表，也可以是 {lists:[...]} 装多张（场景文件用）
  // 同 id 的词表自动合并（考试词库分批文件拼成一张表：words-en-awl-01/02… 都声明 id:ielts-core）
  const raw = [];
  dataFiles.forEach((f) => {
    const parsed = JSON.parse(fs.readFileSync(path.join(SRC_DIR, f), 'utf8'));
    if (Array.isArray(parsed.lists)) raw.push(...parsed.lists);
    else raw.push(parsed);
  });
  const byId = new Map();
  raw.forEach((l) => {
    if (byId.has(l.id)) {
      const seen = new Set(byId.get(l.id).words.map((w) => w.w));
      l.words.forEach((w) => {
        if (!seen.has(w.w)) byId.get(l.id).words.push(w);
      });
    } else {
      byId.set(l.id, l);
    }
  });
  const lists = [...byId.values()];
  const tables = tableFiles.map((f) =>
    JSON.parse(fs.readFileSync(path.join(SRC_DIR, f), 'utf8'))
  );
  const grammars = files
    .filter((f) => f.startsWith('grammar-'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(SRC_DIR, f), 'utf8')));
  let hooks = {};
  files.filter((f) => f.startsWith('hooks')).forEach((f) => {
    Object.assign(hooks, JSON.parse(fs.readFileSync(path.join(SRC_DIR, f), 'utf8')).hooks || {});
  });
  const json = JSON.stringify({
    version: 6,
    updated: new Date().toISOString().slice(0, 10),
    lists,
    tables,
    grammars,
    hooks,
  });
  // 明文先 gzip 再加密（JSON 结构高度可压，密文因此缩小 ~60-70%）
  const plainZ = zlib.gzipSync(Buffer.from(json, 'utf8'));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plainZ
  );
  const blob = {
    v: 1,
    z: 1,
    iter: ITER,
    iv: bufToB64(iv),
    data: bufToB64(ct),
  };
  fs.writeFileSync(OUT, zlib.gzipSync(JSON.stringify(blob)));
  const legacy = path.join(ROOT, 'data', 'words.enc');
  if (fs.existsSync(legacy)) fs.rmSync(legacy); // 旧裸文件退役
  console.log(
    `encrypted: ${Buffer.byteLength(json)} B -> ${fs.statSync(OUT).size} B (words.enc.gz)`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
