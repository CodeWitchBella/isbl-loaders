import Knex from 'knex'
import { promisify } from 'util'
import * as fs from 'fs'
import camelCase from 'lodash.camelcase'

function ignoreTable(table: string) {
  return table === 'migration'
}

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
  } as { [key: string]: string })[type]
  if (!ret) {
    throw new Error(`Unknown type ${type}`)
  }
  return ret
}

function typeForColumn(column: any, elementTypes: any[]) {
  const type = column.data_type
  let ret = ''
  if (type === 'ARRAY') {
    const t = elementTypes.find(
      et =>
        et.object_name === column.table_name &&
        et.object_type === 'TABLE' &&
        et.collection_type_identifier === column.dtd_identifier,
    )
    ret = `${convertType(t.data_type)}[]`
  } else {
    ret = convertType(type)
  }
  if (column.is_nullable === 'YES') return `${ret} | null`
  return ret
}

function defForTable(table: string, columns: any, elementTypes: any[]) {
  return `interface ${table} {\n${columns
    .map(
      (c: any) =>
        `  ${transformKey(c.column_name)}: ${typeForColumn(c, elementTypes)}`,
    )
    .join('\n')}\n}`
}

export const generateTypedefs = async ({ knex, output }: { knex: Knex, output: string }) => {
  const columns = await knex('information_schema.columns').where(
    'table_schema',
    'public',
  )
  const elementTypes = await knex('information_schema.element_types').where(
    'object_schema',
    'public',
  )
  const tables: any = {}
  for (const col of columns) {
    if (ignoreTable(col.table_name)) continue
    if (!tables[col.table_name]) tables[col.table_name] = []
    tables[col.table_name].push(col)
  }
  let types =
    '/* eslint-disable */\n' +
    '// This is automatically generated file. \n' +
    '// Do not edit, it WILL be overwritten.\n\n'
  for (const [table, cols] of Object.entries(tables)) {
    types += `${defForTable(table, cols, elementTypes)}\n\n`
  }
  types += 'export type TableToTypeMap = {'
  types += Object.keys(tables).reduce((a, b) => `${a}\n  ${b}: ${b}`, '')
  types += '\n}\n'
  const content = await promisify(fs.readFile)(output, 'utf-8')
  if (content !== types) {
    await promisify(fs.writeFile)(output, types)
  }
}
