# Clash → AJSON

把 Clash / Clash Meta 配置转换为 [Anywhere](https://github.com/NodePassProject/Anywhere) 的 AJSON v1 订阅。

> 在线使用：<https://lcbrst.github.io/clash2ajson/>  
> 开源仓库：<https://github.com/LCBRST/clash2ajson>

**`clash2ajson.html` 是完整的单文件工具**：YAML 解析器和全部逻辑都已内联，双击即可离线使用，配置不会离开本机。页面右上角提供 GitHub 仓库入口。

## 使用方法

1. 用浏览器打开 `index.html` 或 `clash2ajson.html`，也可以直接访问上面的在线地址
2. 选择 / 拖入 `.yaml` 配置文件，或把内容粘贴进左侧
3. 可选：填写订阅名称、勾选「生成稳定 id」
4. 点「转换」，复制结果或下载 `.ajson` 文件（内容即 AJSON v1 文档）

把得到的 JSON 作为订阅内容返回给客户端即可。Anywhere 通过「首个非空白字符是 `{`」识别 AJSON，也可以显式设置响应头：

```
Content-Type: application/json
X-Anywhere-Format: ajson/1
```

## 协议映射

| Clash 类型 | AJSON 协议 | 说明 |
| --- | --- | --- |
| `ss` | `shadowsocks` | 仅支持 AJSON 列出的加密方法；带 `plugin` 的节点跳过 |
| `vless` | `vless` | 支持 `raw` / `ws` / `grpc` / `httpupgrade` / `xhttp`，TLS 与 Reality |
| `trojan` | `trojan` | 仅纯 TCP（AJSON 的 trojan 没有传输层） |
| `hysteria2` | `hysteria` | Hysteria 2；`up`/`down` → `upMbps`/`downMbps`，`obfs` → `obfs` |
| `anytls` | `anytls` | 空闲参数一并映射 |
| `socks5` | `socks5` | 不支持 TLS |
| `http` | `rfc` | HTTP CONNECT 代理，TLS 自动映射 |
| `vmess` / `ssr` / `tuic` / `snell` / `wireguard` / `ssh` / `mieru` | — | AJSON 无对应协议，跳过并说明原因 |

字段细节：

- `servername` / `sni` → `security.sni`（与 `server` 相同时省略）
- `skip-cert-verify` → `security.insecure`
- `client-fingerprint: chrome` → `security.fingerprint: "chrome"`（`random` 等未知值使用 AJSON 默认）
- `reality-opts.public-key` / `short-id` → `security.publicKey` / `shortId`
- `ws-opts.path` / `headers.Host` → `transport.path` / `transport.host`
- `grpc-opts.grpc-service-name` → `transport.serviceName`
- 空节点、非法端口、未知类型等会被跳过，并在结果面板中按原因归类列出

「生成稳定 id」会基于 `协议 + server + port + 凭据` 生成哈希 id，节点改名或调换顺序后，Anywhere 仍能保留选中状态和测速记录。

## 已知限制

- AJSON 只支持 Hysteria 2，Clash 的 `hysteria`（v1）会被跳过
- AJSON 的 trojan 没有传输层，`trojan + ws/grpc` 会被跳过
- AJSON 不支持 `h2` / `http` 传输、Shadowsocks 插件、SOCKS5 over TLS
- AJSON 的 hysteria 固定校验证书，`skip-cert-verify` 在 Hysteria2 节点上无法生效（会提示）
- 页面里的「获取 URL」受浏览器 CORS 限制，多数订阅站无法直连；下载配置后再拖入即可

## 开发

只需要 Node.js，无第三方依赖：

```bash
npm run build          # 由 src/ 生成单文件 clash2ajson.html
npm test               # 转换逻辑单元测试（18 项）
npm run test:browser   # 用本机 Edge/Chrome 打开成品页面做冒烟测试
```

项目结构：

```
clash2ajson.html   构建产物，可直接分发 / 离线打开
index.html         同上的构建产物，供 GitHub Pages 根目录直接访问
src/converter.js   转换核心（纯逻辑，可在 Node 中直接使用）
src/app.js         页面交互
src/template.html  页面结构与样式
js-yaml.min.js     YAML 解析器（js-yaml 4.1.0，MIT），构建时内联
build.mjs          把三部分拼成 clash2ajson.html
test/              单元测试与浏览器冒烟测试
```

AJSON 字段依据 Anywhere 仓库的 `Documentations/AJSON.md`。
