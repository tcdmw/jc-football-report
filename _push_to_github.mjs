// 本地 -> 自己 GitHub fork 的全量推送（无需 git/浏览器），走 GitHub Contents API。
// token 从环境变量 GITHUB_TOKEN 读取；用户账号由 /user 自动获取。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOKEN = process.env.GITHUB_TOKEN;
const UPSTREAM = 'laoyangnb666/jc-football-report';
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PROGRESS_FILE = path.join(ROOT, '_push_progress.json');
const API = 'https://api.github.com';
const EXCLUDE_DIRS = new Set(['node_modules', '.runtime', '.git']);

if (!TOKEN) {
  console.error('缺少 GITHUB_TOKEN 环境变量');
  process.exit(1);
}

async function gh(method, urlPath, body) {
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'local-football-sync',
    },
  };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const url = urlPath.startsWith('http') ? urlPath : `${API}${urlPath}`;
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      const res = await fetch(url, opts);
      const text = await res.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
      if (res.status === 403 && (res.headers.get('retry-after') || (json && json.message && json.message.includes('secondary rate limit')))) {
        const wait = Number(res.headers.get('retry-after')) || 30;
        console.log(`触发二级限流，等待 ${wait}s`);
        await new Promise(r => setTimeout(r, wait * 1000));
        continue;
      }
      if (res.status >= 500 && attempt <= 4) {
        await new Promise(r => setTimeout(r, 2000 * attempt));
        continue;
      }
      return { status: res.status, json, headers: res.headers };
    } catch (e) {
      if (attempt > 4) throw e;
      await new Promise(r => setTimeout(r, 2000 * attempt));
    }
  }
}

function listFiles(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) continue;
      out.push(...listFiles(path.join(dir, entry.name), base));
    } else if (entry.isFile()) {
      if (entry.name === '_push_to_github.mjs' || entry.name === '_push_progress.json') continue;
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

async function main() {
  // 1. 确认用户
  const me = await gh('GET', '/user');
  if (me.status !== 200) throw new Error('token 无效或无法获取用户: ' + JSON.stringify(me.json));
  const login = me.json.login;
  const forkRepo = `${login}/jc-football-report`;
  console.log('登录用户:', login);

  // 2. 确认 fork 是否存在，不存在则创建
  const check = await gh('GET', `/repos/${forkRepo}`);
  if (check.status === 404) {
    console.log('创建 fork ...');
    const f = await gh('POST', `/repos/${UPSTREAM}/forks`, { default_branch_only: true });
    if (f.status !== 202) throw new Error('fork 失败: ' + JSON.stringify(f.json));
    // 等待 fork 就绪
    for (let i = 0; i < 30; i += 1) {
      await new Promise(r => setTimeout(r, 3000));
      const r = await gh('GET', `/repos/${forkRepo}`);
      if (r.status === 200) break;
      process.stdout.write('.');
    }
    console.log(' fork 已就绪');
  } else if (check.status === 200) {
    console.log('fork 已存在，直接推送');
  } else {
    throw new Error('检查 fork 异常: ' + JSON.stringify(check.json));
  }

  // 3. 断点续传
  const done = new Set();
  if (fs.existsSync(PROGRESS_FILE)) {
    JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8')).forEach(p => done.add(p));
  }
  const files = listFiles(ROOT);
  console.log('待处理文件总数:', files.length, '已完成:', done.size);

  let ok = 0;
  let fail = 0;
  for (const abs of files) {
    const rel = path.relative(ROOT, abs).split(path.sep).join('/');
    if (done.has(rel)) { ok += 1; continue; }
    const content = fs.readFileSync(abs).toString('base64');
    const encPath = rel.split('/').map(encodeURIComponent).join('/');
    // 已存在则取 sha
    let sha = null;
    const existing = await gh('GET', `/repos/${forkRepo}/contents/${encPath}`);
    if (existing.status === 200) sha = existing.json.sha;
    const put = await gh('PUT', `/repos/${forkRepo}/contents/${encPath}`, {
      message: `local sync: ${rel}`,
      content,
      ...(sha ? { sha } : {}),
    });
    if (put.status === 200 || put.status === 201) {
      done.add(rel);
      ok += 1;
      fs.writeFileSync(PROGRESS_FILE, JSON.stringify([...done], null, 0));
      if (ok % 25 === 0) console.log(`进度 ${ok}/${files.length}`);
    } else {
      fail += 1;
      console.error('上传失败:', rel, put.status, JSON.stringify(put.json).slice(0, 200));
      if (fail > 10) break;
    }
  }
  console.log(`完成。成功 ${ok}/${files.length}，失败 ${fail}`);
  if (fail === 0 && fs.existsSync(PROGRESS_FILE)) fs.unlinkSync(PROGRESS_FILE);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
