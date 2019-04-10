import { decimalConverter } from './decimal-converter'

declare var describe: any
declare var it: any
declare var expect: any

describe('decimal-converter', () => {
  it('should convert correctly', () => {
    const conv = decimalConverter(2)()
    expect(conv.toDB(1.020005)).toBe('1.02')
    expect(conv.toDB(1)).toBe('1.00')
    expect(conv.toDB(1.05)).toBe('1.05')
  })
})
