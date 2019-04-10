export const decimalConverter = (decimalPlaces: number) => {
  if (!Number.isInteger(decimalPlaces) || decimalPlaces <= 0) {
    throw new Error(
      'Number of decimal places must be integer greater than zero',
    )
  }
  return () => ({
    fromDB(v: string) {
      return Number.parseFloat(v)
    },
    toDB(v: number) {
      if (!Number.isFinite(v)) {
        throw new Error('Decimal value must be finite')
      }
      return v.toFixed(decimalPlaces)
    },
    jsType: 'number',
  })
}
