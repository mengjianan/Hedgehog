#!/usr/bin/env node
/* 明文源一键备份：把 src/ 与 encrypt.js 同步到备份仓库并推送
 * 用法: node tools/backup-src.js
 * 备份仓库默认 D:/Projects/hedgehog-src-backup（可用环境变量 HEDGEHOG_BACKUP 覆盖）
 * 无变更时自动跳过提交
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const BK = process.env.HEDGEHOG_BACKUP || 'D:/Projects/hedgehog-src-backup';

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    const s = path.join(src, f);
    const d = path.join(dst, f);
    if (fs.statSync(s).isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

if (!fs.existsSync(path.join(ROOT, 'src'))) {
  console.error('主项目 src/ 不存在');
  process.exit(1);
}
fs.mkdirSync(BK, { recursive: true });

// 清掉旧 src 再整目录拷贝（被删除的文件不残留）
fs.rmSync(path.join(BK, 'src'), { recursive: true, force: true });
copyDir(path.join(ROOT, 'src'), path.join(BK, 'src'));
fs.copyFileSync(path.join(ROOT, 'tools', 'encrypt.js'), path.join(BK, 'encrypt.js'));

execFileSync('git', ['-C', BK, 'add', '-A'], { stdio: ['ignore', 'ignore', 'inherit'] });
const st = execFileSync('git', ['-C', BK, 'status', '--porcelain']).toString().trim();
if (!st) {
  console.log('无变更，跳过提交。备份目录:', BK);
  process.exit(0);
}
const msg = 'backup: ' + new Date().toISOString().slice(0, 19).replace('T', ' ');
execFileSync('git', ['-C', BK, 'commit', '-m', msg], { stdio: ['ignore', 'inherit', 'inherit'] });
execFileSync('git', ['-C', BK, 'push', '-u', 'origin', 'main'], { stdio: ['ignore', 'inherit', 'inherit'] });
console.log('备份完成 →', BK);
