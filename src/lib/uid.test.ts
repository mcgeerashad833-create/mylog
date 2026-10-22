import { afterEach, describe, expect, it, vi } from 'vitest'
import { uid } from './uid'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('uid', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('有 crypto.randomUUID 时直接用', () => {
    expect(uid()).toMatch(UUID_V4)
  })

  it('通过 http://IP 访问、没有 crypto.randomUUID 时也能生成', () => {
    // 模拟非安全上下文：只有 getRandomValues，没有 randomUUID
    const real = globalThis.crypto
    vi.stubGlobal('crypto', { getRandomValues: real.getRandomValues.bind(real) })
    const ids = new Set(Array.from({ length: 1000 }, () => uid()))
    expect(ids.size).toBe(1000)
    for (const id of ids) expect(id).toMatch(UUID_V4)
  })
})
