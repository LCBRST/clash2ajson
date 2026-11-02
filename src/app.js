/* UI 逻辑：读取输入、调用转换器、渲染结果 */
(() => {
  'use strict';

  const CT = window.ClashToAjson;
  const YAML = window.jsyaml;
  const $ = (id) => document.getElementById(id);

  const el = {
    input: $('input'),
    output: $('output'),
    stats: $('stats'),
    warnings: $('warnings'),
    error: $('inputError'),
    subName: $('subName'),
    withId: $('withId'),
    fileInput: $('fileInput'),
    fileName: $('fileName'),
    urlInput: $('urlInput'),
    fetchBtn: $('fetchBtn'),
    convertBtn: $('convertBtn'),
    clearBtn: $('clearBtn'),
    copyBtn: $('copyBtn'),
    downloadBtn: $('downloadBtn'),
    toast: $('toast'),
  };

  let lastJson = '';
  let fetchedUsage = null;
  let timer = null;
  let toastTimer = null;

  // ---------- 小工具 ----------

  const escapeHtml = (s) =>
    String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  const highlightJson = (text) => {
    const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return esc.replace(
      /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
      (m, str, colon, lit) => {
        if (str) {
          return colon
            ? '<span class="j-key">' + str + '</span>' + colon
            : '<span class="j-str">' + str + '</span>';
        }
        if (lit) return '<span class="j-lit">' + lit + '</span>';
        return '<span class="j-num">' + m + '</span>';
      }
    );
  };

  const formatBytes = (n) => {
    if (!n) return '0 B';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
  };

  const showError = (msg) => {
    el.error.textContent = msg;
    el.error.hidden = false;
  };

  const hideError = () => {
    el.error.hidden = true;
    el.error.textContent = '';
  };

  const toast = (msg) => {
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('show'), 1900);
  };

  // ---------- 订阅元数据 ----------

  const parseUserInfo = (value) => {
    if (!value) return null;
    const raw = {};
    value.split(';').forEach((part) => {
      const m = part.trim().match(/^([a-zA-Z]+)\s*=\s*(\d+)$/);
      if (m) raw[m[1].toLowerCase()] = parseInt(m[2], 10);
    });
    const usage = {};
    if (raw.upload !== undefined) usage.upload = raw.upload;
    if (raw.download !== undefined) usage.download = raw.download;
    if (raw.total !== undefined) usage.total = raw.total;
    if (raw.expire !== undefined && raw.expire > 0) usage.expire = raw.expire;
    return Object.keys(usage).length ? usage : null;
  };

  const decodeTitle = (value) => {
    if (!value) return '';
    let s = String(value).trim();
    if (s.toLowerCase().indexOf('base64:') === 0) {
      try {
        const bin = atob(s.slice(7));
        const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
        s = new TextDecoder('utf-8').decode(bytes);
      } catch {
        return '';
      }
    }
    return s;
  };

  // ---------- 转换 ----------

  const buildFinalDocument = (doc) => {
    const out = { anywhere: 1 };
    if (doc.name) out.name = doc.name;
    if (fetchedUsage) out.usage = fetchedUsage;
    out.proxies = doc.proxies || [];
    return out;
  };

  const convert = () => {
    hideError();

    const raw = el.input.value.replace(/^\uFEFF/, '');
    if (!raw.trim()) {
      resetOutput();
      return;
    }

    if (!YAML) {
      showError('YAML 解析器未加载，请确认使用完整的单文件版本。');
      return;
    }

    let doc;
    try {
      doc = YAML.load(raw);
    } catch (e) {
      const reason = (e && (e.reason || e.message)) || '未知错误';
      const where = e && e.mark ? '（第 ' + (e.mark.line + 1) + ' 行）' : '';
      showError('YAML 解析失败：' + reason + where);
      return;
    }

    if (typeof doc === 'string') {
      showError('这段内容不是 Clash YAML：解析结果是一段文本，可能是 base64 节点列表。请改用 Clash 格式的配置。');
      return;
    }
    if (doc === null || typeof doc !== 'object') {
      showError('这段内容不是 Clash 配置（根节点不是对象）。');
      return;
    }

    let result;
    try {
      result = CT.convertDocument(doc, {
        withId: el.withId.checked,
        name: el.subName.value,
      });
    } catch (e) {
      showError(e.message);
      return;
    }

    lastJson = JSON.stringify(buildFinalDocument(result.document), null, 2);
    render(result);

    if (result.converted === 0) {
      showError('没有可转换的节点，原因见右侧列表。');
    }
  };

  const render = (result) => {
    const chips = [];
    chips.push('<span class="chip">共 ' + result.total + ' 个节点</span>');
    chips.push('<span class="chip chip-ok">转换 ' + result.converted + '</span>');
    const skipped = result.total - result.converted;
    if (skipped > 0) chips.push('<span class="chip chip-skip">跳过 ' + skipped + '</span>');
    Object.keys(result.counts).forEach((p) => {
      chips.push('<span class="chip">' + escapeHtml(p) + ' · ' + result.counts[p] + '</span>');
    });
    el.stats.innerHTML = chips.join('');

    renderWarnings(result.warnings);

    const top = el.output.scrollTop;
    el.output.innerHTML = highlightJson(lastJson);
    el.output.scrollTop = top;
  };

  const renderWarnings = (warnings) => {
    if (!warnings.length) {
      el.warnings.hidden = true;
      el.warnings.innerHTML = '';
      return;
    }

    const groups = {};
    warnings.forEach((w) => {
      const key = w.level + '|' + w.reason;
      if (!groups[key]) groups[key] = { level: w.level, reason: w.reason, names: [] };
      groups[key].names.push(w.name);
    });

    const list = Object.keys(groups).map((k) => groups[k]);
    list.sort((a, b) => {
      if (a.level !== b.level) return a.level === 'error' ? -1 : 1;
      return b.names.length - a.names.length;
    });

    el.warnings.innerHTML = list
      .map((g) => {
        const shown = g.names.slice(0, 3).join('、');
        const more = g.names.length > 3 ? ' 等' : '';
        const count = g.names.length > 1 ? '<span class="count">×' + g.names.length + '</span>' : '';
        return (
          '<div class="warn-row">' +
          '<span class="dot dot-' + (g.level === 'error' ? 'error' : 'warn') + '"></span>' +
          '<div class="warn-text">' + escapeHtml(g.reason) + count +
          '<div class="warn-names">' + escapeHtml(shown) + more + '</div></div></div>'
        );
      })
      .join('');

    el.warnings.hidden = false;
  };

  const resetOutput = () => {
    lastJson = '';
    el.output.innerHTML = '<span class="placeholder">等待输入…</span>';
    el.stats.innerHTML = '';
    el.warnings.hidden = true;
    el.warnings.innerHTML = '';
  };

  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(convert, 450);
  };

  // ---------- 文件 / URL 输入 ----------

  const loadFile = async (file) => {
    try {
      const text = await file.text();
      el.input.value = text;
      el.fileName.textContent = file.name + ' · ' + formatBytes(file.size);
      fetchedUsage = null;
      convert();
    } catch (e) {
      showError('读取文件失败：' + e.message);
    }
  };

  el.fileInput.addEventListener('change', () => {
    const f = el.fileInput.files && el.fileInput.files[0];
    if (f) loadFile(f);
    el.fileInput.value = '';
  });

  ['dragenter', 'dragover'].forEach((type) => {
    el.input.addEventListener(type, (e) => {
      e.preventDefault();
      el.input.classList.add('dragover');
    });
  });
  ['dragleave', 'drop'].forEach((type) => {
    el.input.addEventListener(type, (e) => {
      e.preventDefault();
      el.input.classList.remove('dragover');
    });
  });
  el.input.addEventListener('drop', (e) => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) loadFile(f);
  });

  const fetchUrl = async () => {
    const url = el.urlInput.value.trim();
    if (!url) {
      showError('请先填写订阅 URL。');
      return;
    }

    hideError();
    el.fetchBtn.disabled = true;
    const oldLabel = el.fetchBtn.textContent;
    el.fetchBtn.textContent = '获取中…';

    try {
      const res = await fetch(url, { headers: { Accept: 'text/yaml, text/plain, */*' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);

      let usageHeader = null;
      let titleHeader = null;
      try { usageHeader = res.headers.get('subscription-userinfo'); } catch { /* CORS */ }
      try { titleHeader = res.headers.get('profile-title'); } catch { /* CORS */ }

      const text = await res.text();
      el.input.value = text;
      el.fileName.textContent = '已从 URL 获取 · ' + formatBytes(new Blob([text]).size);
      fetchedUsage = parseUserInfo(usageHeader);
      const title = decodeTitle(titleHeader);
      if (title && !el.subName.value.trim()) el.subName.value = title;
      convert();
    } catch (e) {
      showError('获取失败：' + e.message + '。浏览器直连订阅常被 CORS 拦截，可先下载配置文件再拖入左侧。');
    } finally {
      el.fetchBtn.disabled = false;
      el.fetchBtn.textContent = oldLabel;
    }
  };

  // ---------- 复制 / 下载 ----------

  const copyOutput = async () => {
    if (!lastJson) {
      toast('没有可复制的内容');
      return;
    }

    const done = () => toast('已复制到剪贴板');

    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = lastJson;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        done();
      } catch {
        toast('复制失败，请手动选择');
      }
      ta.remove();
    };

    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(lastJson);
        done();
      } catch {
        fallback();
      }
    } else {
      fallback();
    }
  };

  const downloadOutput = () => {
    if (!lastJson) {
      toast('没有可下载的内容');
      return;
    }

    const name = el.subName.value.trim();
    const safe = name ? name.replace(/[\\/:*?"<>|\s]+/g, '_') : 'anywhere';
    const blob = new Blob([lastJson], { type: 'application/json;charset=utf-8' });
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = safe + '.ajson';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 0);
    toast('已下载 ' + safe + '.ajson');
  };

  // ---------- 事件绑定 ----------

  el.input.addEventListener('input', schedule);
  el.subName.addEventListener('input', schedule);
  el.withId.addEventListener('change', schedule);
  el.convertBtn.addEventListener('click', convert);
  el.fetchBtn.addEventListener('click', fetchUrl);
  el.copyBtn.addEventListener('click', copyOutput);
  el.downloadBtn.addEventListener('click', downloadOutput);

  el.clearBtn.addEventListener('click', () => {
    el.input.value = '';
    el.fileName.textContent = '';
    el.urlInput.value = '';
    fetchedUsage = null;
    hideError();
    resetOutput();
    el.input.focus();
  });

  el.urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      fetchUrl();
    }
  });

  el.input.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      convert();
    }
  });

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      downloadOutput();
    }
  });

  if (!CT || !YAML) {
    showError('页面组件未完整加载，请使用完整的单文件 HTML。');
  }
})();
