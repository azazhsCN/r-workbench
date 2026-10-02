/**
 * 文本编码探测与解码（v0.2.6 / T6-C2）
 *
 * 中文 Excel 的「CSV（逗号分隔）」导出在 zh-CN Windows 上是 GBK/GB18030。
 * 旧代码在渲染进程用 `new TextDecoder()`（UTF-8）解码，中文列名会变成
 * U+FFFD 替换字符，列名在进入 R 之前就已被破坏。
 *
 * 探测顺序（与 DEVELOPMENT_PLAN_v8 T6 一致）：
 *   1. BOM 嗅探：EF BB BF → utf-8；FF FE → utf-16le；FE FF → utf-16be
 *   2. 无 BOM 的 UTF-16 启发式（按 NUL 字节的奇偶分布判断）
 *   3. 严格 UTF-8：`new TextDecoder('utf-8', { fatal: true })`
 *   4. 回退 gb18030（Chromium/Node 内置，兼容 GBK/GB2312）
 *   5. 再回退 big5
 *   6. 全部失败 → UTF-8 非严格解码（保留 ASCII 部分，替换无法解码的字节）
 *
 * 所有函数均为纯函数，便于 Vitest 直接测试（不依赖 DOM / Electron）。
 */

/** 支持的编码标签（均为 WHATWG Encoding 标准标签） */
export type SupportedEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'gb18030' | 'big5'

/** 下拉框顺序：自动探测优先，其次是中文环境最常见的两种编码 */
export const SUPPORTED_ENCODINGS: readonly SupportedEncoding[] = [
  'utf-8',
  'gb18030',
  'big5',
  'utf-16le',
  'utf-16be'
]

/** 编码来源，用于在导入摘要中说明"是自动探测还是用户指定" */
export type EncodingSource = 'bom' | 'detected' | 'override' | 'fallback'

export interface BomInfo {
  encoding: SupportedEncoding
  /** BOM 字节长度 */
  length: number
}

export interface DecodeResult {
  /** 解码后的文本（已去除开头的 U+FEFF） */
  text: string
  /** 实际使用的编码 */
  encoding: SupportedEncoding
  /** 该编码是如何确定的 */
  source: EncodingSource
  /** 无法解码的字节数（U+FFFD 个数），>0 表示结果可能含乱码 */
  replacements: number
}

/** 用于试探测的最大样本长度：256KB，避免对大文件做多次全量解码 */
const SAMPLE_SIZE = 256 * 1024

/** 多字节序列的最大长度，用于样本截断时回退边界字节 */
const MAX_SEQUENCE = 4

/** 将各种二进制输入统一成 Uint8Array（不复制已有视图） */
export function toUint8Array(
  input: ArrayBuffer | ArrayBufferView | null | undefined
): Uint8Array | null {
  if (input === null || input === undefined) return null
  if (input instanceof Uint8Array) return input
  if (typeof ArrayBuffer !== 'undefined' && input instanceof ArrayBuffer) {
    return new Uint8Array(input)
  }
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
  }
  return null
}

/** BOM 嗅探 */
export function sniffBom(bytes: Uint8Array): BomInfo | null {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { encoding: 'utf-8', length: 3 }
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { encoding: 'utf-16le', length: 2 }
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { encoding: 'utf-16be', length: 2 }
  }
  return null
}

/**
 * 无 BOM 的 UTF-16 启发式。
 *
 * UTF-16LE 的 ASCII 字符形如 `41 00`，NUL 出现在奇数位；UTF-16BE 相反。
 * 仅当一种奇偶性上出现 NUL 而另一种完全没有时才判定，避免误伤含 NUL 的
 * 二进制/异常 UTF-8 文件。纯中文的 UTF-16 文件（高字节非 0）无法用此启发式
 * 识别，此时需要用户在导入界面手动指定编码。
 */
export function sniffUtf16WithoutBom(bytes: Uint8Array): SupportedEncoding | null {
  const n = Math.min(bytes.length, 4096)
  if (n < 4) return null
  let evenNul = 0
  let oddNul = 0
  for (let i = 0; i < n; i++) {
    if (bytes[i] === 0) {
      if (i % 2 === 0) evenNul++
      else oddNul++
    }
  }
  if (oddNul >= 2 && evenNul === 0) return 'utf-16le'
  if (evenNul >= 2 && oddNul === 0) return 'utf-16be'
  return null
}

/**
 * 严格解码样本。样本尾部可能截断一个多字节序列，因此从末尾回退 0~3 字节
 * 重试，避免把"合法但被截断"误判为"非法编码"。
 */
function canDecodeStrictly(bytes: Uint8Array, encoding: SupportedEncoding): boolean {
  const limit = Math.min(bytes.length, SAMPLE_SIZE)
  for (let back = 0; back < MAX_SEQUENCE; back++) {
    const end = limit - back
    if (end <= 0) break
    try {
      new TextDecoder(encoding, { fatal: true }).decode(bytes.subarray(0, end))
      return true
    } catch {
      // 继续回退
    }
  }
  return false
}

/** 非严格解码并统计替换字符数 */
function decodeLenient(
  bytes: Uint8Array,
  encoding: SupportedEncoding
): { text: string; replacements: number } {
  const text = new TextDecoder(encoding, { fatal: false }).decode(bytes)
  return { text, replacements: countReplacements(text) }
}

/** 统计 U+FFFD 的个数 */
export function countReplacements(text: string): number {
  let count = 0
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 0xfffd) count++
  }
  return count
}

/** 去掉开头可能残留的 BOM 字符 */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/** 探测编码（不含用户覆盖） */
export function detectEncoding(bytes: Uint8Array): { encoding: SupportedEncoding; source: EncodingSource } {
  if (bytes.length === 0) return { encoding: 'utf-8', source: 'detected' }

  const bom = sniffBom(bytes)
  if (bom) return { encoding: bom.encoding, source: 'bom' }

  const utf16 = sniffUtf16WithoutBom(bytes)
  if (utf16) return { encoding: utf16, source: 'detected' }

  if (canDecodeStrictly(bytes, 'utf-8')) return { encoding: 'utf-8', source: 'detected' }
  if (canDecodeStrictly(bytes, 'gb18030')) return { encoding: 'gb18030', source: 'detected' }
  if (canDecodeStrictly(bytes, 'big5')) return { encoding: 'big5', source: 'detected' }

  return { encoding: 'utf-8', source: 'fallback' }
}

/**
 * 解码字节流。
 *
 * @param input    原始字节（Electron IPC 传来的 Uint8Array / ArrayBuffer）
 * @param override 用户在下拉框中手动指定的编码；给出后不再自动探测
 */
export function decodeBytes(
  input: ArrayBuffer | ArrayBufferView | null | undefined,
  override?: SupportedEncoding
): DecodeResult {
  const bytes = toUint8Array(input)
  if (!bytes || bytes.length === 0) {
    return { text: '', encoding: override ?? 'utf-8', source: override ? 'override' : 'detected', replacements: 0 }
  }

  const detected = override
    ? { encoding: override, source: 'override' as EncodingSource }
    : detectEncoding(bytes)

  const { text, replacements } = decodeLenient(bytes, detected.encoding)

  // 自动探测的结果若仍含大量替换字符，逐个试其余候选，取替换最少者。
  // （GBK 与 Big5 有交集，仅靠"能解码"无法区分，用实际替换数排序更稳。）
  if (!override && replacements > 0 && detected.source !== 'bom') {
    let best = { encoding: detected.encoding, text, replacements }
    for (const candidate of SUPPORTED_ENCODINGS) {
      if (candidate === detected.encoding) continue
      if (candidate === 'utf-16le' || candidate === 'utf-16be') continue
      const trial = decodeLenient(bytes, candidate)
      if (trial.replacements < best.replacements) {
        best = { encoding: candidate, text: trial.text, replacements: trial.replacements }
      }
    }
    return {
      text: stripBom(best.text),
      encoding: best.encoding,
      source: best.replacements === 0 ? 'detected' : 'fallback',
      replacements: best.replacements
    }
  }

  return {
    text: stripBom(text),
    encoding: detected.encoding,
    source: detected.source,
    replacements
  }
}
