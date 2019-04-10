import { ConverterFactory } from '../make-loader-maker'

export const identityConverter: {
  string: ConverterFactory<string, string, any>
  number: ConverterFactory<number, number, any>
  boolean: ConverterFactory<boolean, boolean, any>
} = {
  string: () => {
    return {
      fromDB: v => v,
      toDB: v => v,
      jsType: 'string',
    }
  },
  number: () => {
    return {
      fromDB: v => v,
      toDB: v => v,
      jsType: 'number',
    }
  },
  boolean: () => {
    return {
      fromDB: v => v,
      toDB: v => v,
      jsType: 'boolean',
    }
  },
}
