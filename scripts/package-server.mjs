// 打包桌面应用的 Node 后端运行包：
//  1) 下载与系统一致版本的 node.exe → 重命名 sidecar（src-tauri/binaries/wewrite-server-<triple>.exe）
//  2) 组装 src-tauri/resources/server-runtime/（dist + node_modules + config.json）
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const SIDE_DIR = path.join(root, 'src-tauri', 'binaries');
const RUNTIME_DIR = path.join(root, 'src-tauri', 'resources', 'server-runtime');
const CACHE_DIR = path.join(root, '.cache', 'node-dist');

const NODE_VERSION = process.env.WEWRITE_NODE_VERSION ?? (() => {
  const v = execSync('node --version', { encoding: 'utf8' }).trim(); // e.g. v24.13.0
  return v.replace(/^v/, '');
})();

const TRIPLE = process.env.WEWRITE_SIDECAR_TRIPLE ?? 'x86_64-pc-windows-msvc';
const SIDECAR_NAME = `wewrite-server-${TRIPLE}.exe`;

function log(msg) {
  console.log(`[package-server] ${msg}`);
}

const MIN_ZIP_BYTES = 20 * 1024 * 1024; // node win-x64 zip 至少 ~28MB，用于识别截断下载

function findLocalNode() {
  try {
    const line = execSync('where node', { encoding: 'utf8' }).trim().split(/\r?\n/)[0];
    const p = line.trim();
    if (p && fs.existsSync(p) && /node\.exe$/i.test(p)) return p;
  } catch {
    // 未找到，走下载
  }
  return null;
}

function downloadZip(url, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (fs.existsSync(dest)) fs.rmSync(dest, { force: true });
    log(`下载 ${url}（第 ${attempt} 次）`);
    execSync(`curl -L --fail --silent --show-error -o "${dest}" "${url}"`, { stdio: 'inherit' });
    const size = fs.existsSync(dest) ? fs.statSync(dest).size : 0;
    if (size > MIN_ZIP_BYTES) {
      log(`下载完成 (${(size / 1048576).toFixed(1)} MB)`);
      return dest;
    }
    log(`警告: 文件过小 (${size} B)，疑似截断，重试`);
  }
  throw new Error(`下载失败: ${url}`);
}

function extractZip(zipPath, extractDir) {
  if (fs.existsSync(path.join(extractDir, 'node.exe'))) return;
  log(`解压 ${path.basename(zipPath)}`);
  if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true, force: true });
  fs.mkdirSync(extractDir, { recursive: true });
  // git-bash 自带 unzip，比 Windows PowerShell Expand-Archive 快一个数量级
  execSync(`unzip -q -o "${zipPath}" -d "${extractDir}"`, { stdio: 'inherit' });
  if (!fs.existsSync(path.join(extractDir, 'node.exe'))) {
    throw new Error(`解压后未找到 node.exe: ${zipPath}`);
  }
}

function ensureSidecar() {
  const dest = path.join(SIDE_DIR, SIDECAR_NAME);
  if (fs.existsSync(dest)) {
    log(`sidecar 已存在: ${SIDECAR_NAME}`);
    return dest;
  }
  fs.mkdirSync(SIDE_DIR, { recursive: true });

  // 优先复用本机已装的 node.exe（ABI 与 better-sqlite3 完全一致，且无需联网）
  const localNode = findLocalNode();
  if (localNode) {
    fs.copyFileSync(localNode, dest);
    log(`sidecar 就绪: 复用本机 ${localNode} → ${SIDECAR_NAME} (${(fs.statSync(dest).size / 1048576).toFixed(1)} MB)`);
    return dest;
  }

  // 兜底：从镜像下载（官方 nodejs.org 在国内不稳，优先 npmmirror）
  const zipUrl =
    process.env.NODE_DIST_MIRROR ??
    `https://npmmirror.com/mirrors/node/v${NODE_VERSION}/node-v${NODE_VERSION}-win-x64.zip`;
  const zipPath = path.join(CACHE_DIR, `node-v${NODE_VERSION}-win-x64.zip`);
  const extractDir = path.join(CACHE_DIR, `node-v${NODE_VERSION}-win-x64`);
  if (!fs.existsSync(zipPath) || fs.statSync(zipPath).size <= MIN_ZIP_BYTES) {
    downloadZip(zipUrl, zipPath);
  } else {
    log(`zip 已缓存: ${path.basename(zipPath)}`);
  }
  extractZip(zipPath, extractDir);
  fs.copyFileSync(path.join(extractDir, 'node.exe'), dest);
  log(`sidecar 就绪: ${SIDECAR_NAME} (${(fs.statSync(dest).size / 1048576).toFixed(1)} MB)`);
  return dest;
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) throw new Error(`源目录不存在: ${src}`);
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else if (!fs.existsSync(d) || fs.statSync(s).mtimeMs > fs.statSync(d).mtimeMs) {
      fs.copyFileSync(s, d);
    }
  }
}

function assembleRuntime() {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  const serverDist = path.join(root, 'server', 'dist');
  copyDir(serverDist, path.join(RUNTIME_DIR, 'dist'));

  // 生成独立 package.json 并安装生产依赖（workspaces 会把依赖提升到根 node_modules，
  // 这里在运行包内重新 install，得到自带 node_modules 的自包含运行包）
  const serverPkg = JSON.parse(fs.readFileSync(path.join(root, 'server', 'package.json'), 'utf8'));
  const runtimePkg = {
    name: 'wewrite-server-runtime',
    private: true,
    version: serverPkg.version,
    type: 'module',
    dependencies: serverPkg.dependencies,
  };
  fs.writeFileSync(path.join(RUNTIME_DIR, 'package.json'), JSON.stringify(runtimePkg, null, 2));
  log('安装运行包生产依赖（含 better-sqlite3 原生绑定）…');
  execSync('npm install --omit=dev --no-audit --no-fund --loglevel=error', {
    cwd: RUNTIME_DIR,
    stdio: 'inherit',
  });
  fs.rmSync(path.join(RUNTIME_DIR, 'package-lock.json'), { force: true });

  const configSrc = path.join(root, 'server', 'config.json');
  if (fs.existsSync(configSrc)) {
    fs.copyFileSync(configSrc, path.join(RUNTIME_DIR, 'config.json'));
  }
  log(`运行包组装完成: ${RUNTIME_DIR}`);
}

ensureSidecar();
assembleRuntime();
log('打包完成');
