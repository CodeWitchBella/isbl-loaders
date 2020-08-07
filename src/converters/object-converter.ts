import {
  ConverterFactory,
  ConverterInfo,
  Converter,
} from '../make-loader-maker'

export const objectConverter = <JS extends Object>() => (
  converters: { [key in keyof JS]: ConverterFactory<any, JS[key], any> },
) => (info: ConverterInfo<any>): Converter<any, JS> => ({
  fromDB: (v: any) => {
    const acc: any = {}
    for (const key of Object.keys(v)) {
      const conv = (converters as any)[key]
      if (conv) acc[key] = conv(info).fromDB(v[key])
      else acc[key] = v[key]
    }
    return acc
  },
  toDB: (v: any) => {
    const acc: any = {}
    for (const key of Object.keys(v)) {
      const conv = (converters as any)[key]
      if (conv) acc[key] = conv(info).toDB(v[key])
      else acc[key] = v[key]
    }
    return acc
  },
  jsType: `{
      ${Object.entries(converters)
        .map(
          ([key, value]: [string, ConverterFactory<any, any, any>]) =>
            `${key}: ${value(info).jsType}`,
        )
        .join('\n')}
    }`,
  imports: Object.values(converters)
    .map((v) => v(info).imports || [])
    .reduce((a, b) => a.concat(b)),
})
export default objectConverter
