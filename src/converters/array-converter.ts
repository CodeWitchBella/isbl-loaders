import { ConverterFactory, ConverterInfo } from '../make-loader-maker'

export const arrayConverter = <Table, JS, TableName>(
  converter: ConverterFactory<Table, JS, TableName>,
) => (info: ConverterInfo<TableName>) => {
  const c = converter(info)
  return {
    fromDB: (v: Table[]) => v.map(value => c.fromDB(value)),
    toDB: (v: JS[]) => v.map(value => c.toDB(value)),
    jsType: `(${c.jsType})[]`,
    imports: c.imports,
  }
}
