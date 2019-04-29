import { ConverterFactory } from '../make-loader-maker'

export const enumConverter = <T extends string>(
  map: { [key in T]: number },
): ConverterFactory<number, T, any> => info => {
  const inverseMap: { [k: number]: T } = {}
  for (const key of Object.keys(map)) {
    if (map[key as T] in inverseMap)
      throw new Error(
        'Duplicate enum value ' + map[key as T] + ' on table ' + info.table,
      )
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
