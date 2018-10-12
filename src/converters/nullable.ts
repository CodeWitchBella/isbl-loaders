import { ConverterFactory, ConverterInfo } from '../make-loader-maker'

export const nullableConverter = <Table, JS, TableName>(
  converter: ConverterFactory<Table, JS, TableName>,
) => (info: ConverterInfo<TableName>) => {
  const c = converter(info)
  return {
    fromDB: (v: Table | null) => (v === null ? null : c.fromDB(v)),
    toDB: (v: JS | null) => (v === null ? null : c.toDB(v)),
  }
}
