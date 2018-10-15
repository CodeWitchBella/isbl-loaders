import Knex from 'knex'
import { AllPropertiesExcept, PickExcept } from '@s-isabella/ts-utils'
import mapValues from 'lodash.mapvalues'
import TableLoader from './table-loader'
import { IDType } from './converters/id-converter'

type Args = { knex: Knex }

type JSType<
  TableToTypeMap,
  Table extends keyof TableToTypeMap,
  JSTypePatch extends {}
> = Pick<
  TableToTypeMap[Table],
  AllPropertiesExcept<TableToTypeMap[Table], keyof JSTypePatch>
> &
  JSTypePatch

export type Converter<Table, JS> = {
  fromDB: (v: Table) => JS
  toDB: (v: JS) => Table
}

export type ConverterInfo<T> = {
  table: T
}

export type ConverterFactory<Table, JS, TableName> = (
  info: ConverterInfo<TableName>,
) => Converter<Table, JS>

type JSTypeWithID<JSType, TableName> = PickExcept<JSType, 'id'> & {
  id: IDType<TableName>
}

export const makeLoaderMaker = <TableToTypeMap extends {}>() => <
  Table extends keyof TableToTypeMap,
  JSTypePatch extends {} = {}
>(opts: {
  table: Table
  converters?: {
    [key in keyof TableToTypeMap[Table]]?: key extends keyof JSType<
      TableToTypeMap,
      Table,
      JSTypePatch
    >
      ? ConverterFactory<
          TableToTypeMap[Table][key],
          JSType<TableToTypeMap, Table, JSTypePatch>[key],
          Table
        >
      : ConverterFactory<
          TableToTypeMap[Table][key],
          TableToTypeMap[Table][key],
          Table
        >
  }
}) => <T extends {}>(
  definition: (
    tableLoader: TableLoader<
      TableToTypeMap[Table],
      JSTypeWithID<JSType<TableToTypeMap, Table, JSTypePatch>, Table>
    >,
  ) => T = () => ({} as T),
) => (args: Args) => {
  const converters = mapValues(
    opts.converters,
    c => (c ? c({ table: opts.table }) : null),
  )
  const loader = new TableLoader<
    TableToTypeMap[Table],
    JSTypeWithID<JSType<TableToTypeMap, Table, JSTypePatch>, Table>
  >({
    toDB: mapValues(converters, v => (v ? v.toDB : null)),
    fromDB: mapValues(converters, v => (v ? v.fromDB : null)),
    table: opts.table,
    knex: args.knex,
  } as any)
  return Object.assign(loader.initLoader(), definition(loader))
}
