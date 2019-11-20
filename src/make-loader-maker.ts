import Knex from 'knex'
import { PickExcept, notNull } from '@codewitchbella/ts-utils'
import mapValues from 'lodash.mapvalues'
import TableLoader, { InitLoader } from './table-loader'
import { enumConverter } from './converters/enum-converter'

type Args = { knex: Knex }

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

function fromEntries(iterable: any) {
  return [...iterable].reduce(
    (obj, { 0: key, 1: val }) => Object.assign(obj, { [key]: val }),
    {},
  )
}

type Codegen = {
  converters: {
    [key: string]: { [key: string]: any } | undefined
  }
}
export const makeLoaderMaker = <
  Definitions extends {
    table: {}
    js: { [tab in keyof Definitions['table']]: any }
    insert: { [tab in keyof Definitions['table']]: any }
  }
>(
  codegen: Codegen,
  settings: {
    converters: {
      [key: string]: (definition: any) => ConverterFactory<any, any, any>
    }
  },
) => <Table extends keyof Definitions['table']>(opts: {
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
  onInsert?: (id: IDType<Table>[], args: Args) => void
  onUpdate?: (id: IDType<Table>[], args: Args) => void
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
) => {
  const { onUpdate, onInsert } = opts

  const automaticConverters = (() => {
    const src = codegen.converters[opts.table as string]
    if (!src) return {}
    return fromEntries(
      Object.entries(src)
        .map(([column, definition]) => {
          if (
            typeof definition !== 'object' ||
            !definition ||
            !definition.autoConvert
          )
            return null
          const getConverter = settings.converters[definition.type]
          if (getConverter) {
            return [column, getConverter(definition)]
          }
          if (definition.type === 'enum') {
            return [column, enumConverter(definition.values)]
          }
          throw new Error(
            `Unknown automatic converter type ${JSON.stringify(
              definition.type,
            )}`,
          )
        })
        .filter(notNull),
    )
  })()
  const converters = mapValues(
    { ...opts.converters, ...automaticConverters },
    c => (c ? c({ table: opts.table }) : null),
  )
  return (args: Args) => {
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
      onInsert: (ids: number[]) => {
        if (onInsert)
          setImmediate(() => {
            onInsert(
              ids.map(id => ({ type: opts.table, id })),
              args,
            )
          })
      },
      onUpdate: (ids: number[]) => {
        if (onUpdate)
          setImmediate(() => {
            onUpdate(
              ids.map(id => ({ type: opts.table, id })),
              args,
            )
          })
      },
    })

    const custom = definition(loader)
    const ret = Object.assign(loader.initLoader(), definition(loader))

    return Object.assign(ret, {
      [convertersSymbol]: converters,
      [tableLoaderSymbol]: loader,
    }) as InitLoader<
      {
        js: Definitions['js'][Table]
        table: Definitions['table'][Table]
        insert: Definitions['insert'][Table]
      },
      Table
    > &
      typeof custom
  }
}
