/*
 * Clash / Clash Meta  ->  Anywhere AJSON v1 转换核心
 * 纯逻辑，不依赖 DOM，可在 Node 中直接测试。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ClashToAjson = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ---------- 基础工具 ----------

  const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const str = (v) => (v === undefined || v === null ? '' : String(v));

  const firstStr = (...vals) => {
    for (const v of vals) {
      if (typeof v === 'string' && v.trim() !== '') return v.trim();
      if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    }
    return '';
  };

  const toInt = (v) => {
    if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
    if (typeof v === 'string' && /^\s*[+-]?\d+\s*$/.test(v)) return parseInt(v, 10);
    return undefined;
  };

  const toNum = (v) => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
      const m = v.trim().match(/^[+-]?\d+(?:\.\d+)?/);
      if (m) return Number(m[0]);
    }
    return undefined;
  };

  const truthy = (v) => v === true || v === 'true' || v === 'True' || v === 1;
  const falsy = (v) => v === false || v === 'false' || v === 'False' || v === 0;

  const toStrArray = (v) => {
    if (Array.isArray(v)) return v.filter((x) => x !== null && x !== undefined).map(String);
    if (typeof v === 'string' && v.trim() !== '') return v.split(',').map((s) => s.trim()).filter(Boolean);
    return [];
  };

  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

  // 单个节点不可转换时抛出，外层捕获后记录为“跳过”。
  class SkipError extends Error {
    constructor(message) {
      super(message);
      this.name = 'SkipError';
    }
  }

  // ---------- 协议用到的常量 ----------

  // AJSON 支持的 Shadowsocks 加密方法
  const SS_METHODS = new Set([
    'aes-128-gcm',
    'aes-256-gcm',
    'chacha20-ietf-poly1305',
    '2022-blake3-aes-128-gcm',
    '2022-blake3-aes-256-gcm',
    '2022-blake3-chacha20-poly1305',
    'none',
  ]);

  // AJSON 接受的指纹值
  const FINGERPRINTS = new Set([
    'chrome', 'chrome_106', 'chrome_120', 'chrome_133',
    'firefox', 'firefox_120', 'firefox_148',
    'safari', 'safari_26',
    'edge', 'edge_106',
    'non_browser',
  ]);

  const XHTTP_MODES = new Set(['auto', 'stream-one', 'stream-up', 'packet-up']);

  function mapFingerprint(v) {
    if (!v) return '';
    const s = String(v).trim().toLowerCase();
    if (!FINGERPRINTS.has(s)) return ''; // random / randomized / 未知值 -> 用 AJSON 默认
    return s;
  }

  // ---------- security / transport ----------

  function buildTls(c, serverName, allowReality) {
    const reality = c['reality-opts'];

    if (allowReality && isObject(reality) && firstStr(reality['public-key'])) {
      const sec = {
        type: 'reality',
        sni: firstStr(c.servername, c.sni, serverName),
        publicKey: firstStr(reality['public-key']),
      };
      const sid = firstStr(reality['short-id']);
      if (sid) sec.shortId = sid;
      const fp = mapFingerprint(c['client-fingerprint']);
      if (fp) sec.fingerprint = fp;
      return sec;
    }

    if (!truthy(c.tls)) return 'none';

    const sec = { type: 'tls' };
    const sni = firstStr(c.servername, c.sni);
    if (sni && sni !== serverName) sec.sni = sni; // 默认值就是 server，相同则省略
    const alpn = toStrArray(c.alpn);
    if (alpn.length) sec.alpn = alpn;
    const fp = mapFingerprint(c['client-fingerprint']);
    if (fp) sec.fingerprint = fp;
    if (truthy(c['skip-cert-verify'])) sec.insecure = true;
    return sec;
  }

  function buildTransport(c) {
    const net = str(c.network || c.net || 'tcp').trim().toLowerCase();
    if (net === '' || net === 'tcp' || net === 'raw') return 'raw';

    if (net === 'ws') {
      const o = isObject(c['ws-opts']) ? c['ws-opts'] : {};
      const headers = isObject(o.headers) ? o.headers : {};
      const t = { type: 'ws' };
      const host = firstStr(o.host, headers.Host, headers.host);
      if (host) t.host = host;
      if (typeof o.path === 'string' && o.path !== '') t.path = o.path;
      const extra = {};
      for (const k of Object.keys(headers)) {
        if (k.toLowerCase() === 'host') continue;
        if (headers[k] !== null && headers[k] !== undefined) extra[k] = String(headers[k]);
      }
      if (Object.keys(extra).length) t.headers = extra;
      const med = toInt(o['max-early-data']);
      if (med !== undefined && med > 0) t.maxEarlyData = med;
      const eh = firstStr(o['early-data-header-name']);
      if (eh) t.earlyDataHeaderName = eh;
      return t;
    }

    if (net === 'grpc') {
      const o = isObject(c['grpc-opts']) ? c['grpc-opts'] : {};
      const t = { type: 'grpc' };
      const svc = firstStr(o['grpc-service-name'], o.serviceName);
      if (svc) t.serviceName = svc;
      const authority = firstStr(o.authority);
      if (authority) t.authority = authority;
      return t;
    }

    if (net === 'httpupgrade') {
      const o = isObject(c['httpupgrade-opts']) ? c['httpupgrade-opts'] : {};
      const headers = isObject(o.headers) ? o.headers : {};
      const t = { type: 'httpupgrade' };
      const host = firstStr(o.host, headers.Host, headers.host);
      if (host) t.host = host;
      if (typeof o.path === 'string' && o.path !== '') t.path = o.path;
      return t;
    }

    if (net === 'xhttp' || net === 'splithttp') {
      const o = Object.assign({}, c['splithttp-opts'], c['xhttp-opts']);
      const headers = isObject(o.headers) ? o.headers : {};
      const t = { type: 'xhttp' };
      const host = firstStr(o.host, headers.Host, headers.host);
      if (host) t.host = host;
      if (typeof o.path === 'string' && o.path !== '') t.path = o.path;
      const mode = firstStr(o.mode).toLowerCase();
      if (XHTTP_MODES.has(mode)) t.mode = mode;
      return t;
    }

    throw new SkipError('传输方式 network=' + net + ' 在 AJSON 中不受支持');
  }

  // ---------- 各协议 ----------

  function convertShadowsocks(c, head) {
    let method = firstStr(c.cipher, c.method);
    if (!method) throw new SkipError('缺少 cipher');
    // 同一种加密方法在 Clash 里可能省略 ietf 后缀
    if (method === 'chacha20-poly1305') method = 'chacha20-ietf-poly1305';
    if (!SS_METHODS.has(method)) throw new SkipError('不支持的 Shadowsocks 加密方法 ' + method);
    if (c.plugin) throw new SkipError('Shadowsocks 插件 ' + str(c.plugin) + ' 在 AJSON 中不受支持');

    const password = str(c.password);
    if (password === '' && method.indexOf('2022-') === 0) {
      throw new SkipError('2022 加密方法需要 password');
    }

    const p = Object.assign({}, head, { protocol: 'shadowsocks', method });
    if (password !== '') p.password = password;
    return { proxy: p, notes: [] };
  }

  function convertVless(c, head) {
    const uuid = firstStr(c.uuid);
    if (!uuid) throw new SkipError('缺少 uuid');

    const transport = buildTransport(c);
    const security = buildTls(c, head.server, true);

    const p = Object.assign({}, head, { protocol: 'vless', uuid });
    if (security !== 'none') p.security = security;
    if (transport !== 'raw') p.transport = transport;

    const encryption = firstStr(c.encryption);
    if (encryption && encryption !== 'none') p.encryption = encryption;
    const flow = firstStr(c.flow);
    if (flow) p.flow = flow;

    return { proxy: p, notes: [] };
  }

  function convertTrojan(c, head) {
    const password = str(c.password);
    if (!password) throw new SkipError('缺少 password');

    const net = str(c.network || 'tcp').trim().toLowerCase();
    if (net !== '' && net !== 'tcp' && net !== 'raw') {
      throw new SkipError('Trojan 的 ' + net + ' 传输在 AJSON 中不受支持');
    }
    if (isObject(c['reality-opts'])) {
      throw new SkipError('AJSON 的 Reality 仅支持 VLESS');
    }

    const p = Object.assign({}, head, { protocol: 'trojan', password });
    // AJSON 中 trojan 默认就是 tls
    p.security = falsy(c.tls) ? 'none' : buildTls(Object.assign({}, c, { tls: true }), head.server, false);
    return { proxy: p, notes: [] };
  }

  function convertAnytls(c, head) {
    const password = str(c.password);
    if (!password) throw new SkipError('缺少 password');

    const p = Object.assign({}, head, { protocol: 'anytls', password });

    const check = toInt(c['idle-session-check-interval']);
    if (check !== undefined && check >= 0) p.idleCheckInterval = check;
    const idle = toInt(c['idle-session-timeout']);
    if (idle !== undefined && idle >= 0) p.idleTimeout = idle;
    const minIdle = toInt(c['min-idle-session']);
    if (minIdle !== undefined) p.minIdleSession = minIdle;

    p.security = falsy(c.tls) ? 'none' : buildTls(Object.assign({}, c, { tls: true }), head.server, false);
    return { proxy: p, notes: [] };
  }

  function convertHysteria2(c, head) {
    const password = firstStr(c.password, c.auth);
    if (!password) throw new SkipError('缺少 password');

    const p = Object.assign({}, head, { protocol: 'hysteria', password });

    const sni = firstStr(c.sni, c.servername);
    if (sni) p.sni = sni;

    const up = toNum(c.up);
    if (up !== undefined) p.upMbps = clamp(Math.round(up), 0, 1000);
    const down = toNum(c.down);
    if (down !== undefined) p.downMbps = clamp(Math.round(down), 0, 1000);

    if (c.obfs) {
      const obfs = { type: str(c.obfs) };
      obfs.password = str(c['obfs-password']);
      p.obfs = obfs;
    }

    // AJSON hysteria 固定走 TLS，无法表达这些 Clash 选项
    const notes = [];
    if (truthy(c['skip-cert-verify'])) {
      notes.push('AJSON hysteria 固定校验证书，skip-cert-verify 无法生效');
    }
    if (toStrArray(c.alpn).length) notes.push('AJSON hysteria 不支持自定义 alpn');
    if (c.ports) notes.push('AJSON hysteria 不支持端口跳跃（ports）');

    return { proxy: p, notes };
  }

  function convertSocks5(c, head) {
    if (truthy(c.tls)) throw new SkipError('AJSON socks5 不支持 TLS');

    const p = Object.assign({}, head, { protocol: 'socks5' });
    const username = str(c.username);
    if (username) p.username = username;
    const password = str(c.password);
    if (password) p.password = password;
    return { proxy: p, notes: [] };
  }

  function convertHttp(c, head) {
    const username = str(c.username);
    if (username.indexOf(':') !== -1) throw new SkipError('AJSON rfc 的 username 不能包含冒号');

    const p = Object.assign({}, head, { protocol: 'rfc' });
    if (username) p.username = username;
    const password = str(c.password);
    if (password) p.password = password;
    p.security = truthy(c.tls)
      ? buildTls(Object.assign({}, c, { tls: true }), head.server, false)
      : 'none';
    return { proxy: p, notes: [] };
  }

  // ---------- 单个节点入口 ----------

  function convertProxy(c) {
    if (!isObject(c)) throw new SkipError('节点不是对象');

    const name = firstStr(c.name);
    if (!name) throw new SkipError('缺少 name');

    const type = str(c.type).trim().toLowerCase();
    if (!type) throw new SkipError('缺少 type');

    if (type === 'direct') {
      return { proxy: { name: name, protocol: 'direct' }, notes: [] };
    }

    const server = str(c.server).trim().replace(/^\[(.*)\]$/, '$1');
    if (!server) throw new SkipError('缺少 server');

    const port = toInt(c.port);
    if (port === undefined || port < 1 || port > 65535) {
      throw new SkipError('port 无效：' + str(c.port));
    }

    const head = { name: name, server: server, port: port };

    switch (type) {
      case 'ss':
      case 'shadowsocks':
        return convertShadowsocks(c, head);
      case 'vless':
        return convertVless(c, head);
      case 'trojan':
        return convertTrojan(c, head);
      case 'anytls':
        return convertAnytls(c, head);
      case 'hysteria2':
      case 'hy2':
        return convertHysteria2(c, head);
      case 'socks5':
      case 'socks':
        return convertSocks5(c, head);
      case 'http':
        return convertHttp(c, head);
      case 'vmess':
        throw new SkipError('AJSON 不支持 VMess');
      case 'ssr':
        throw new SkipError('AJSON 不支持 ShadowsocksR');
      case 'hysteria':
        throw new SkipError('AJSON 只支持 Hysteria 2（hysteria2）');
      case 'tuic':
        throw new SkipError('AJSON 不支持 TUIC');
      case 'snell':
        throw new SkipError('AJSON 不支持 Snell');
      case 'wireguard':
      case 'wg':
        throw new SkipError('AJSON 不支持 WireGuard');
      case 'ssh':
        throw new SkipError('AJSON 不支持 SSH');
      case 'mieru':
        throw new SkipError('AJSON 不支持 Mieru');
      default:
        throw new SkipError('未知节点类型 ' + type);
    }
  }

  // ---------- 稳定 id ----------

  function stableId(p) {
    const secret = p.uuid || p.password || p.method || '';
    const raw = p.protocol + '|' + p.server + '|' + p.port + '|' + secret;
    let h = 0x811c9dc5;
    for (let i = 0; i < raw.length; i++) {
      h ^= raw.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return p.protocol + '-' + h.toString(16).padStart(8, '0');
  }

  // ---------- 文档入口 ----------

  function convertDocument(doc, options) {
    const opts = Object.assign({ withId: false, name: '' }, options || {});

    if (!isObject(doc)) throw new Error('配置根节点不是 YAML 映射');

    let list = doc.proxies;
    if (!Array.isArray(list) && isObject(doc['proxy-providers'])) {
      // 兼容内联在 proxy-providers 里的节点
      list = [];
      for (const key of Object.keys(doc['proxy-providers'])) {
        const provider = doc['proxy-providers'][key];
        if (isObject(provider) && Array.isArray(provider.proxies)) {
          list = list.concat(provider.proxies);
        }
      }
    }
    if (!Array.isArray(list)) {
      throw new Error('未找到 proxies 列表，这不是 Clash 配置文件');
    }

    const warnings = [];
    const counts = Object.create(null);
    const proxies = [];
    const usedIds = new Set();
    const seenNames = new Set();

    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      const label = (isObject(item) && firstStr(item.name)) || '#' + (i + 1);

      let result;
      try {
        result = convertProxy(item);
      } catch (e) {
        if (e instanceof SkipError) {
          warnings.push({ name: label, level: 'error', reason: e.message });
          continue;
        }
        throw e;
      }

      const proxy = result.proxy;

      if (seenNames.has(proxy.name)) {
        warnings.push({ name: proxy.name, level: 'warn', reason: '节点名重复，Anywhere 中可能难以区分' });
      }
      seenNames.add(proxy.name);

      for (const note of result.notes) {
        warnings.push({ name: proxy.name, level: 'warn', reason: note });
      }

      counts[proxy.protocol] = (counts[proxy.protocol] || 0) + 1;

      if (opts.withId) {
        const base = stableId(proxy);
        let id = base;
        let n = 1;
        while (usedIds.has(id)) id = base + '-' + (++n);
        usedIds.add(id);
        proxies.push(Object.assign({ id: id }, proxy));
      } else {
        proxies.push(proxy);
      }
    }

    const out = { anywhere: 1 };
    if (opts.name && opts.name.trim()) out.name = opts.name.trim();
    out.proxies = proxies;

    return {
      document: out,
      warnings: warnings,
      counts: counts,
      total: list.length,
      converted: proxies.length,
    };
  }

  return {
    convertDocument: convertDocument,
    convertProxy: convertProxy,
    stableId: stableId,
    SkipError: SkipError,
  };
});
