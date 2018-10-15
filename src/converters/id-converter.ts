import { ConverterInfo } from '../make-loader-maker'

export type IDType<T> = { id: number; type: T }

export const idConverter = <T extends {}>(info: ConverterInfo<T>) => ({
  fromDB: (id: number) => ({ id, type: info.table }),
  toDB: (v: { id: number; type: T }) => v.id,
})
