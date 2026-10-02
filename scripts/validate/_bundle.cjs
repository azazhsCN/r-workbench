'use strict'
/*
 * 按需把**当前源码**打包成 CJS，供 verify.cjs / verify_ipc.cjs 调用真实的主进程逻辑。
 *
 * 为什么不直接提交 mainprocess 生成的 savImport.cjs / ipc.cjs：
 *   仓库里放一份编译产物 = 又一个「看起来是证据、实际可能过期」的陷阱
 *   （原 run_validation.R 的同义反复就是同一类失效模式）。
 *   运行时用 esbuild 从 src/main/**.ts 现打包，保证 harness 验证的永远是当前源码。
 *
 * 产物写到 scripts/validate/generated/（已在 .gitignore 中）。
 */
const fs = require('fs')
const path = require('path')

const VALIDATE_DIR = __dirname
const ROOT = path.resolve(VALIDATE_DIR, '..', '..')

/**
 * @param {string} entryRel 相对仓库根目录的入口文件（如 'src/main/ipc.ts'）
 * @param {string} outName   输出文件名（写到 scripts/validate/generated/）
 * @returns {string} 打包产物的绝对路径（可直接 require）
 */
function ensureBundle(entryRel, outName) {
  const entry = path.join(ROOT, entryRel)
  if (!fs.existsSync(entry)) {
    throw new Error(`ensureBundle: 找不到入口 ${entry}`)
  }
  const outfile = path.join(VALIDATE_DIR, 'generated', outName)
  fs.mkdirSync(path.dirname(outfile), { recursive: true })
  // 延迟 require：没有 esbuild（未 npm ci）时给出可读的错误
  let buildSync
  try {
    ;({ buildSync } = require('esbuild'))
  } catch {
    throw new Error('ensureBundle: 未找到 esbuild，请先运行 npm ci')
  }
  buildSync({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    outfile,
    logLevel: 'silent',
    // electron 必须保持 external：harness 用 Module._load 注入 stub
    // sav-reader 由 node_modules 提供，与 electron-vite 的真实构建保持一致
    external: ['electron', 'sav-reader'],
    alias: {
      '@shared': path.join(ROOT, 'src', 'shared'),
      '@preload': path.join(ROOT, 'src', 'preload'),
      '@renderer': path.join(ROOT, 'src', 'renderer', 'src')
    }
  })
  return outfile
}

module.exports = { ensureBundle, ROOT }
