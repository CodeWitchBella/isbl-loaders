import Knex from 'knex'
import { PickExcept } from '@codewitchbella/ts-utils'
import mapValues from 'lodash.mapvalues'
import TableLoader, { InitLoader } from './table-loader'

type Args<FilterArg> = FilterArg extends undefined
  ? { knex: Knex; filterArg?: FilterArg }
  : { knex: Knex; filterArg: FilterArg }

type IDType<T> = { id: number; type: T }

export type Converter<Table, JS> = {
  fromDB: (v: Table) => JS
  toDB: (v: JS) => Table
  jsType: string
  imports?: string[]
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

export const convertersSymbol = Symbol('converters')
export const tableLoaderSymbol = Symbol('tableLoader')

export const makeLoaderMaker = <
  Definitions extends {
    table: {}
    js: { [tab in keyof Definitions['table']]: any }
    insert: { [tab in keyof Definitions['table']]: any }
  },
  FilterArg = undefined
>() => <Table extends keyof Definitions['table']>(opts: {
  table: Table
  converters?: {
    [key in keyof Definitions['table'][Table]]?: key extends keyof Definitions['js'][Table]
      ? ConverterFactory<
          Definitions['table'][Table][key],
          Definitions['js'][Table][key],
          Table
        >
      : ConverterFactory<
          Definitions['table'][Table][key],
          Definitions['table'][Table][key],
          Table
        >
  }
  onInsert?: (id: IDType<Table>[], args: Args<FilterArg>) => void
  onUpdate?: (id: IDType<Table>[], args: Args<FilterArg>) => void
}) => <T extends {}>(
  definition: (
    tableLoader: TableLoader<
      {
        js: Definitions['js'][Table]
        table: Definitions['table'][Table]
        insert: Definitions['insert'][Table]
      },
      Table
    >,
  ) => T = () => ({} as T),
  {
    filter,
  }: {
    filter?: (v: Definitions['js'][Table], a: FilterArg) => boolean
  } = {},
) => (args: Args<FilterArg>) => {
  const { onUpdate, onInsert } = opts
  const converters = mapValues(opts.converters, c =>
    c ? c({ table: opts.table }) : null,
  )
  const loader = new TableLoader<
    {
      js: Definitions['js'][Table]
      table: Definitions['table'][Table]
      insert: Definitions['insert'][Table]
    },
    Table
  >({
    toDB: mapValues(converters, v => (v ? v.toDB : null)) as any,
    fromDB: mapValues(converters, v => (v ? v.fromDB : null)) as any,
    table: opts.table as string,
    knex: args.knex,
    filter: filter ? v => filter(v, args.filterArg!) : undefined,
    onInsert: (ids: number[]) => {
      if (onInsert)
        setImmediate(() => {
          onInsert(ids.map(id => ({ type: opts.table, id })), args)
        })
    },
    onUpdate: (ids: number[]) => {
      if (onUpdate)
        setImmediate(() => {
          onUpdate(ids.map(id => ({ type: opts.table, id })), args)
        })
    },
  })

  const custom = definition(loader)
  const ret = Object.assign(loader.initLoader(), definition(loader))

  return Object.assign(ret, {
    [convertersSymbol]: converters,
    [tableLoaderSymbol]: loader,
  }) as (InitLoader<
    {
      js: Definitions['js'][Table]
      table: Definitions['table'][Table]
      insert: Definitions['insert'][Table]
    },
    Table
  > &
    typeof custom)
}
