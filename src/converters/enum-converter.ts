import { Converter } from '../make-loader-maker'

export const enumConverter = <T extends string>(
  map: { [key in T]: number },
) => (): Converter<number, T> => {
  const inverseMap: { [k: number]: T } = {}
  for (const key of Object.keys(map)) {
    inverseMap[map[key as T]] = key
  }
  return {
    fromDB: num => {
      const ret = inverseMap[num]
      if (ret === undefined)
        throw new Error('Database contains invalid enum value')
      return ret
    },
    toDB: key => {
      const ret = map[key]
      if (ret === undefined) throw new Error('Inserting invalid enum value')
      return ret
    },
    jsType: Object.keys(map)
      .map(k => `'${k}'`)
      .join(' | '),
  }
}
