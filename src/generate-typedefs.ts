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

type Column = {
  key: string
  type: string
  hasDefault: boolean
  nullable: boolean
}

function generateJsTypes({
  loaders,
  tables,
}: {
  loaders: Loaders
  tables: {
    name: string
    columns: Column[]
  }[]
}) {
  const tablesMap = new Map<string, Column[]>()
  tables.forEach(t => {
    tablesMap.set(t.name, t.columns)
  })

  const importSet = new Set<string>()
  let jsTypes = ''
  let insertTypes = ''
  function append(jst: string, insertt?: string | boolean) {
    if (typeof insertt === 'string') {
      insertTypes += insertt
      jsTypes += jst
    } else {
      insertTypes += jst
      jsTypes += jst
    }
  }
  for (const [name, loader] of Object.entries(loaders)) {
    const tableName = loader[tableLoaderSymbol].table
    const tableColumns = tablesMap.get(tableName)
    if (!tableColumns) continue
    append(
      `interface Loader${firstToUpperCase(name)} {\n`,
      `interface Insert${firstToUpperCase(name)} {\n`,
    )
    for (const { key, type: tableType, hasDefault, nullable } of tableColumns) {
      const insertOptional = hasDefault || nullable
      const conv = loader[convertersSymbol][key]
      if (key === 'id') {
        append(`  id: { type: '${tableName}', id: number }\n`, '')
      } else if (!conv) {
        append(
          `  ${key}: ${tableType}\n`,
          insertOptional && `  ${key}?: ${tableType}\n`,
        )
      } else {
        const { imports, jsType } = conv as Converter<any, any>
        append(
          `  ${key}: ${jsType}\n`,
          insertOptional && `  ${key}?: ${jsType}\n`,
        )
        if (imports) imports.forEach(i => importSet.add(i))
      }
    }
    append(`}\n\n`)
  }
  let imports = ''
  for (const theImport of importSet.values()) {
    imports += theImport + '\n'
  }

  let map = ''
  let insertMap = ''
  map += 'type TableToJsTypeMap = {\n'
  insertMap += 'type TableToInsertTypeMap = {\n'
  map += Object.entries(loaders)
    .map(
      ([name, loader]) =>
        `  ${loader[tableLoaderSymbol].table}: Loader${firstToUpperCase(name)}`,
    )
    .join('\n')
  insertMap += Object.entries(loaders)
    .map(
      ([name, loader]) =>
        `  ${loader[tableLoaderSymbol].table}: Insert${firstToUpperCase(name)}`,
    )
    .join('\n')
  map += '\n}\n'
  insertMap += '\n}\n'

  return { types: jsTypes + insertTypes, imports, map: map + insertMap }
}

function safeJSONParse(json: string) {
  try {
    return JSON.parse(json)
  } catch {
    return false
  }
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
      columns: t.columns
        .sort((a, b) => {
          if (a.name === b.name) return 0
          if (a.name === 'id') return -1
          if (b.name === 'id') return 1
          return a.name.localeCompare(b.name, 'en')
        })
        .map(c => ({
          key: transformKey(c.name),
          type: `${typeForColumn(c)}${referencesComment(c.references)}`,
          hasDefault: c.hasDefault,
          nullable: c.nullable,
        })),
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
      .map(
        c => `  ${c.key}: ${c.type}${c.hasDefault ? ' // with default' : ''}`,
      )
      .join('\n')}\n}\n\n`
  }
  types += jsTypes.map + '\n'

  types += 'type TableToTypeMap = {'
  types += tables
    .map(t => t.name)
    .reduce((a, b) => `${a}\n  ${b}: Table_${b}`, '')
  types += '\n}\n\n'

  types += 'export type Definitions = {\n'
  types += '  table: TableToTypeMap\n'
  types += '  js: TableToJsTypeMap\n'
  types += '  insert: TableToInsertTypeMap\n'
  types += '}\n'

  types += 'export const Codegen = {\n'
  types += '  converters: {\n'
  const filteredTables = schema.tables
    .map(t => ({
      ...t,
      columns: t.columns
        .map(c => ({
          ...c,
          parsedComment:
            c.comment && c.comment.startsWith('{') && safeJSONParse(c.comment),
        }))
        .filter(c => !!c.parsedComment),
    }))
    .filter(t => t.columns.length > 0)

  if (filteredTables.length > 0) {
    types += filteredTables
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(table => {
        let ret = `    ${table.name}: {\n      `
        ret += table.columns
          .map(
            column =>
              `${transformKey(column.name)}: ${JSON.stringify(
                column.parsedComment,
              )}`,
          )
          .join(',\n      ')
        return ret
      })
      .join(',\n    },\n')
    types += '\n    },\n'
  }
  types += '  },\n'
  types += '}\n'

  const content = await readFile(output)
  if (content !== types) {
    await promisify(fs.writeFile)(output, types)
  }
}
