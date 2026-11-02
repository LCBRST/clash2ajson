// 在真实浏览器里加载生成的单文件页面，验证 UI 接线与渲染结果。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.join(import.meta.dirname, '..');
const html = fs.readFileSync(path.join(root, 'clash2ajson.html'), 'utf8');
const inject = fs.readFileSync(path.join(import.meta.dirname, 'inject.js'), 'utf8');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clash2ajson-'));
const page = path.join(tmpDir, 'check.html');
fs.writeFileSync(page, html.replace('</body>', '<script>' + inject + '</script></body>'));

const candidates = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];
const browser = candidates.find((p) => fs.existsSync(p));
if (!browser) {
  console.log('未找到 Chromium/Edge，跳过浏览器测试。');
  process.exit(0);
}

let out;
try {
  out = execFileSync(
    browser,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--user-data-dir=' + path.join(tmpDir, 'profile'),
      '--virtual-time-budget=4000',
      '--dump-dom',
      'file:///' + page.replace(/\\/g, '/'),
    ],
    { encoding: 'utf8', maxBuffer: 48 * 1024 * 1024, timeout: 60000, stdio: ['ignore', 'pipe', 'ignore'] }
  );
} finally {
  // 浏览器可能在写完 DOM 后仍持有文件句柄，失败也无所谓
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
}

const match = out.match(/<title>BROWSERTEST::([\s\S]*?)<\/title>/);
if (!match) {
  console.error('未从页面拿到测试结果（页面可能报错）。');
  process.exit(1);
}

const report = JSON.parse(match[1]);
const failures = [];
const check = (cond, label) => { if (!cond) failures.push(label); };

check(report.error === '', '不应出现输入错误：' + report.error);
check(report.proxies === 2, '应转换出 2 个节点，实际 ' + report.proxies);
check(report.protocols.includes('shadowsocks'), '应包含 shadowsocks');
check(report.protocols.includes('vless'), '应包含 vless');
check(report.idType === 'string', '应生成稳定 id');
check(report.security && report.security.type === 'tls' && report.security.sni === 'cdn.example.com', 'TLS sni 映射错误');
check(report.transport && report.transport.type === 'ws' && report.transport.path === '/ray', 'ws transport 映射错误');
check(report.warningsVisible && /VMess/.test(report.warningText), '应展示 VMess 跳过原因');
check(/共 3 个节点/.test(report.stats) && /跳过 1/.test(report.stats), '统计信息错误：' + report.stats);
check(/\.ajson$/.test(report.download), '下载文件名应以 .ajson 结尾，实际 ' + report.download);

if (failures.length) {
  console.error('浏览器测试失败：');
  failures.forEach((f) => console.error(' - ' + f));
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}

console.log('浏览器测试通过');
console.log('  ' + report.stats);
