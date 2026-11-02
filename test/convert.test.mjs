import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import CT from '../src/converter.js';

const require = createRequire(import.meta.url);
const YAML = require(path.join(import.meta.dirname, '..', 'js-yaml.min.js'));

function convertOne(proxy, opts = {}) {
  const r = CT.convertDocument({ proxies: [proxy] }, opts);
  return { result: r, proxy: r.document.proxies[0] };
}

test('Shadowsocks：字符串端口会被转成整数', () => {
  const { result, proxy } = convertOne({
    name: 'SS', type: 'ss', server: 'a.com', port: '8388', cipher: 'aes-128-gcm', password: 'pw',
  });
  assert.equal(result.converted, 1);
  assert.deepEqual(proxy, {
    name: 'SS', server: 'a.com', port: 8388, protocol: 'shadowsocks', method: 'aes-128-gcm', password: 'pw',
  });
});

test('Shadowsocks：chacha20-poly1305 归一化为 ietf 版本', () => {
  const { proxy } = convertOne({
    name: 'S', type: 'ss', server: 'a.com', port: 1, cipher: 'chacha20-poly1305', password: 'p',
  });
  assert.equal(proxy.method, 'chacha20-ietf-poly1305');
});

test('VLESS + ws + TLS：映射 sni/alpn/指纹/insecure 与 ws-opts', () => {
  const { proxy } = convertOne({
    name: 'V', type: 'vless', server: 'v.com', port: 443, uuid: 'u-1',
    network: 'ws', tls: true, servername: 'cdn.com', 'client-fingerprint': 'chrome',
    alpn: ['h2', 'http/1.1'], 'skip-cert-verify': true,
    'ws-opts': { path: '/ws', headers: { Host: 'cdn.com', 'X-Test': '1' } },
  });
  assert.deepEqual(proxy, {
    name: 'V', server: 'v.com', port: 443, protocol: 'vless', uuid: 'u-1',
    security: { type: 'tls', sni: 'cdn.com', alpn: ['h2', 'http/1.1'], fingerprint: 'chrome', insecure: true },
    transport: { type: 'ws', host: 'cdn.com', path: '/ws', headers: { 'X-Test': '1' } },
  });
});

test('VLESS + Reality', () => {
  const { proxy } = convertOne({
    name: 'R', type: 'vless', server: 'r.com', port: 443, uuid: 'u-2', tls: true,
    servername: 'www.apple.com', flow: 'xtls-rprx-vision',
    'reality-opts': { 'public-key': 'PUBKEY', 'short-id': 'ab12' },
  });
  assert.deepEqual(proxy.security, { type: 'reality', sni: 'www.apple.com', publicKey: 'PUBKEY', shortId: 'ab12' });
  assert.equal(proxy.flow, 'xtls-rprx-vision');
  assert.equal(proxy.transport, undefined); // 默认 raw 省略
});

test('VLESS 无 TLS 时不输出 security', () => {
  const { proxy } = convertOne({ name: 'V', type: 'vless', server: 'v.com', port: 80, uuid: 'u' });
  assert.equal(proxy.security, undefined);
});

test('Trojan：默认 TLS，sni 与 insecure', () => {
  const { proxy } = convertOne({
    name: 'T', type: 'trojan', server: 't.com', port: 443, password: 'p',
    sni: 't2.com', 'skip-cert-verify': true,
  });
  assert.deepEqual(proxy, {
    name: 'T', server: 't.com', port: 443, protocol: 'trojan', password: 'p',
    security: { type: 'tls', sni: 't2.com', insecure: true },
  });
});

test('Trojan：tls=false 时 security 为 none', () => {
  const { proxy } = convertOne({ name: 'T', type: 'trojan', server: 't.com', port: 443, password: 'p', tls: false });
  assert.equal(proxy.security, 'none');
});

test('AnyTLS：映射空闲参数', () => {
  const { proxy } = convertOne({
    name: 'A', type: 'anytls', server: 'a.com', port: 443, password: 'p',
    'idle-session-check-interval': 15, 'idle-session-timeout': 60, 'min-idle-session': 2,
  });
  assert.deepEqual(proxy, {
    name: 'A', server: 'a.com', port: 443, protocol: 'anytls', password: 'p',
    idleCheckInterval: 15, idleTimeout: 60, minIdleSession: 2,
    security: { type: 'tls' },
  });
});

test('Hysteria2：up/down、obfs，并给出无法映射的提示', () => {
  const { result, proxy } = convertOne({
    name: 'H', type: 'hysteria2', server: 'h.com', port: 443, password: 'p',
    up: '100', down: '200 Mbps', obfs: 'salamander', 'obfs-password': 'op',
    sni: 'x.com', 'skip-cert-verify': true, alpn: ['h3'],
  });
  assert.deepEqual(proxy, {
    name: 'H', server: 'h.com', port: 443, protocol: 'hysteria', password: 'p',
    sni: 'x.com', upMbps: 100, downMbps: 200,
    obfs: { type: 'salamander', password: 'op' },
  });
  assert.equal(result.warnings.filter((w) => w.level === 'warn').length, 2);
});

test('SOCKS5：带 TLS 时跳过', () => {
  const r = CT.convertDocument({
    proxies: [{ name: 'S', type: 'socks5', server: 's.com', port: 1080, tls: true }],
  });
  assert.equal(r.converted, 0);
  assert.match(r.warnings[0].reason, /TLS/);
});

test('HTTP → rfc', () => {
  const { proxy } = convertOne({ name: 'P', type: 'http', server: 'p.com', port: 8080, username: 'u', password: 'p' });
  assert.deepEqual(proxy, {
    name: 'P', server: 'p.com', port: 8080, protocol: 'rfc', username: 'u', password: 'p', security: 'none',
  });
});

test('HTTP + TLS → rfc + tls', () => {
  const { proxy } = convertOne({ name: 'P', type: 'http', server: 'p.com', port: 8080, tls: true, sni: 'p2.com' });
  assert.deepEqual(proxy.security, { type: 'tls', sni: 'p2.com' });
});

test('不支持的协议与配置被跳过并给出原因', () => {
  const r = CT.convertDocument({
    proxies: [
      { name: 'VM', type: 'vmess', server: 'x.com', port: 443, uuid: 'u' },
      { name: 'SS-plugin', type: 'ss', server: 's.com', port: 1, cipher: 'aes-128-gcm', password: 'p', plugin: 'obfs' },
      { name: 'SS-cipher', type: 'ss', server: 's.com', port: 1, cipher: 'rc4-md5', password: 'p' },
      { name: 'BadPort', type: 'ss', server: 's.com', port: 70000, cipher: 'aes-128-gcm', password: 'p' },
    ],
  });
  assert.equal(r.total, 4);
  assert.equal(r.converted, 0);
  assert.equal(r.warnings.length, 4);
  assert.ok(r.warnings.every((w) => w.level === 'error'));
});

test('重名节点给出提示', () => {
  const r = CT.convertDocument({
    proxies: [
      { name: '同名', type: 'ss', server: 'a.com', port: 1, cipher: 'none', password: 'p' },
      { name: '同名', type: 'ss', server: 'b.com', port: 1, cipher: 'none', password: 'p' },
    ],
  });
  assert.equal(r.converted, 2);
  assert.ok(r.warnings.some((w) => /重名|重复/.test(w.reason)));
});

test('生成稳定 id，重复键自动去重', () => {
  const items = [
    { name: 'A', type: 'ss', server: 'a.com', port: 1, cipher: 'none', password: 'p' },
    { name: 'B', type: 'ss', server: 'a.com', port: 1, cipher: 'none', password: 'p' },
  ];
  const r = CT.convertDocument({ proxies: items }, { withId: true });
  const [a, b] = r.document.proxies;
  assert.match(a.id, /^shadowsocks-[0-9a-f]{8}$/);
  assert.notEqual(a.id, b.id);
  assert.equal(Object.keys(a)[0], 'id');

  const expected = CT.stableId({ protocol: 'shadowsocks', server: 'a.com', port: 1, password: 'p' });
  assert.equal(a.id, expected);
});

test('缺少 proxies 时抛错', () => {
  assert.throws(() => CT.convertDocument({ 'mixed-port': 7890 }), /proxies/);
});

test('兼容 proxy-providers 内联节点', () => {
  const r = CT.convertDocument({
    'proxy-providers': {
      p1: { proxies: [{ name: 'P', type: 'ss', server: 'a.com', port: 1, cipher: 'none', password: 'p' }] },
    },
  });
  assert.equal(r.converted, 1);
});

test('YAML 端到端：注释、锚点、合并键', () => {
  const yaml = `
mixed-port: 7890

defaults: &defaults
  type: ss
  cipher: aes-256-gcm
  password: shared

proxies:
  # 普通 Shadowsocks
  - <<: *defaults
    name: A
    server: a.example.com
    port: 8388
  - name: V
    type: vless
    server: v.example.com
    port: 443
    uuid: 11111111-1111-1111-1111-111111111111
    network: ws
    tls: true
    servername: cdn.example.com
    ws-opts:
      path: /ray
      headers:
        Host: cdn.example.com
  - name: VM
    type: vmess
    server: vm.example.com
    port: 443
    uuid: x
`;
  const doc = YAML.load(yaml);
  const r = CT.convertDocument(doc, { withId: true, name: '测试订阅' });

  assert.equal(r.total, 3);
  assert.equal(r.converted, 2);
  assert.equal(r.document.name, '测试订阅');
  assert.equal(r.document.proxies[0].password, 'shared');
  assert.equal(r.document.proxies[0].method, 'aes-256-gcm');
  assert.equal(r.document.proxies[1].transport.type, 'ws');
  assert.equal(r.warnings.filter((w) => w.level === 'error').length, 1);
});
