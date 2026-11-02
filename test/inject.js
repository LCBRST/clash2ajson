(function () {
  // 拦截下载，记录文件名而不真正触发保存
  var lastDownloadName = '';
  HTMLAnchorElement.prototype.click = function () {
    lastDownloadName = this.download;
  };

  var sample = [
    'proxies:',
    '  - {name: "香港 SS", type: ss, server: hk.example.com, port: 8388, cipher: aes-128-gcm, password: pw}',
    '  - name: "日本 VLESS"',
    '    type: vless',
    '    server: jp.example.com',
    '    port: 443',
    '    uuid: 11111111-1111-1111-1111-111111111111',
    '    network: ws',
    '    tls: true',
    '    servername: cdn.example.com',
    '    ws-opts:',
    '      path: /ray',
    '      headers:',
    '        Host: cdn.example.com',
    '  - {name: "VMess", type: vmess, server: vm.example.com, port: 443, uuid: x}',
  ].join('\n');

  setTimeout(function () {
    var ta = document.getElementById('input');
    ta.value = sample;
    ta.dispatchEvent(new Event('input'));
  }, 50);

  setTimeout(function () {
    var outEl = document.getElementById('output');
    var statsEl = document.getElementById('stats');
    var errEl = document.getElementById('inputError');
    var warnEl = document.getElementById('warnings');
    var parsed = null;
    try { parsed = JSON.parse(outEl.textContent); } catch (e) {}

    document.getElementById('downloadBtn').click();

    document.title = 'BROWSERTEST::' + JSON.stringify({
      stats: statsEl.textContent.trim().replace(/\s+/g, ' '),
      error: errEl.hidden ? '' : errEl.textContent,
      warningsVisible: !warnEl.hidden,
      warningText: warnEl.textContent.trim().replace(/\s+/g, ' ').slice(0, 120),
      proxies: parsed && parsed.proxies ? parsed.proxies.length : -1,
      protocols: parsed && parsed.proxies ? parsed.proxies.map(function (p) { return p.protocol; }) : [],
      idType: parsed && parsed.proxies && parsed.proxies[0] ? typeof parsed.proxies[0].id : 'none',
      security: parsed && parsed.proxies && parsed.proxies[1] ? parsed.proxies[1].security : null,
      transport: parsed && parsed.proxies && parsed.proxies[1] ? parsed.proxies[1].transport : null,
      download: lastDownloadName,
    });
  }, 1600);
})();
