// 把 js-yaml + 转换器 + UI 内联进一个单文件 HTML
import fs from 'node:fs';
import path from 'node:path';

const root = import.meta.dirname;
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const template = read('src/template.html');
const parts = {
  '/*__JS_YAML__*/': read('js-yaml.min.js'),
  '/*__CONVERTER__*/': read('src/converter.js'),
  '/*__APP__*/': read('src/app.js'),
};

let html = template;
for (const [marker, code] of Object.entries(parts)) {
  if (!html.includes(marker)) throw new Error('模板缺少标记 ' + marker);
  // 避免内联脚本被 </script> 提前截断
  const safe = code.replace(/<\/script/gi, '<\\/script');
  html = html.replace(marker, () => safe);
}

// index.html 供 GitHub Pages 根目录直接访问，内容与离线版完全一致
const outputs = ['clash2ajson.html', 'index.html'];
for (const file of outputs) {
  fs.writeFileSync(path.join(root, file), html, 'utf8');
}
console.log('已生成 ' + outputs.join(' / ') + '（' + (Buffer.byteLength(html) / 1024).toFixed(1) + ' KB）');
