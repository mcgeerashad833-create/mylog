/**
 * 生成 UUID。crypto.randomUUID 只在 HTTPS 和 localhost 下才有；
 * 通过 http://IP 访问时没有它，就用到处可用的 crypto.getRandomValues 拼一个标准的 v4 UUID。
 */
export function uid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40 // 版本 4
  b[8] = (b[8] & 0x3f) | 0x80 // RFC 4122 变体
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
