import Knex from 'knex'
import { promisify } from 'util'
import * as fs from 'fs'
import camelCase from 'lodash.camelcase'
import getSchema from '@codewitchbella/postgres-schema'
import {
  convertersSymbol,
  tableLoaderSymbol,
  Converter,
} from './make-loader-maker'

function transformKey(key: string) {
  return camelCase(key)
}

function convertType(type: string) {
  const ret = ({
    jsonb: 'any',
    integer: 'number',
    text: 'string',
    boolean: 'boolean',
    'double precision': 'number',
    bigint: 'string',
    numeric: 'string',
    json: 'any',
  } as { [key: string]: string })[type]
  if (!ret) {
    throw new Error(`Unknown type ${type}`)
  }
  return ret
}

function typeForColumn(column: {
  name: string
  nullable: boolean
  references: {
    table: string
    column: string
  } | null
  isArray: boolean
  type: string
}) {
  let type = convertType(column.type)
  if (column.isArray) type = `${type}[]`
  if (column.nullable) type = `${type} | null`
  return type
}

async function readFile(output: string) {
  try {
    return await promisify(fs.readFile)(output, 'utf-8')
  } catch (e) {
    if (e.code === 'ENOENT') return ''
    throw e
  }
}

function referencesComment(ref: { table: string; column: string } | null) {
  if (!ref) return ''
  return ` // references ${ref.table}.${ref.column}`
}

type Loaders = { [name: string]: any }

function firstToUpperCase(word: string) {
  return word[0].toUpperCase() + word.substring(1)
}

function generateJsTypes({
  loaders,
  tables,
}: {
  loaders: Loaders
  tables: { name: string; columns: [string, string][] }[]
}) {
  const tablesMap = new Map<string, [string, string][]>()
  tables.forEach(t => {
    tablesMap.set(t.name, t.columns)
  })

  const importSet = new Set<string>()
  let jsTypes = ''
  for (const [name, loader] of Object.entries(loaders)) {
    const tableName = loader[tableLoaderSymbol].table
    const tableColumns = tablesMap.get(tableName)
    if (!tableColumns) continue
    jsTypes += `interface Loader${firstToUpperCase(name)} {\n`
    for (const [k, tableType] of tableColumns) {
      const conv = loader[convertersSymbol][k]
      if (k === 'id') {
        jsTypes += `  id: { type: '${tableName}', id: number }\n`
      } else if (!conv) {
        jsTypes += `  ${k}: ${tableType}\n`
      } else {
        const { imports, jsType } = conv as Converter<any, any>
        jsTypes += `  ${k}: ${jsType}\n`
        if (imports) imports.forEach(i => importSet.add(i))
      }
    }
    jsTypes += '}\n\n'
  }
  let imports = ''
  for (const theImport of importSet.values()) {
    imports += theImport + '\n'
  }

  let map = ''
  map += 'export type TableToJsTypeMap = {\n'
  map += Object.entries(loaders)
    .map(
      ([name, loader]) =>
        `  ${loader[tableLoaderSymbol].table}: Loader${firstToUpperCase(name)}`,
    )
    .join('\n')
  map += '\n}\n'

  return { types: jsTypes, imports, map }
}

export const generateTypedefs = async ({
  knex,
  output,
  filterTables = () => true,
  loaders,
}: {
  knex: Knex
  output: string
  filterTables?: (table: string) => boolean
  loaders: Loaders
}) => {
  const schema = await getSchema({ knex })
  const tables = schema.tables
    .filter(t => filterTables(t.name))
    .filter(t => t.name !== 'migration')
    .sort((a, b) => a.name.localeCompare(b.name, 'en'))
    .map(t => ({
      name: t.name,
      columns: t.columns.map(
        c =>
          [
            transformKey(c.name),
            `${typeForColumn(c)}${referencesComment(c.references)}`,
          ] as [string, string],
      ),
    }))

  let types =
    '/* eslint-disable */\n' +
    '// This is automatically generated file. \n' +
    '// Do not edit, it WILL be overwritten.\n\n'

  const jsTypes = generateJsTypes({ loaders, tables })
  types += jsTypes.imports
  types += jsTypes.types

  for (const { name, columns } of tables) {
    types += `interface Table_${name} {\n${columns
      .map(c => `  ${c[0]}: ${c[1]}`)
      .join('\n')}\n}\n\n`
  }
  types += jsTypes.map + '\n'

  types += 'export type TableToTypeMap = {'
  types += tables
    .map(t => t.name)
    .reduce((a, b) => `${a}\n  ${b}: Table_${b}`, '')
  types += '\n}\n'

  const content = await readFile(output)
  if (content !== types) {
    await promisify(fs.writeFile)(output, types)
  }
}
