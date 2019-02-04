import Knex from 'knex'
import { promisify } from 'util'
import * as fs from 'fs'
import camelCase from 'lodash.camelcase'
import getSchema from '@codewitchbella/postgres-schema'

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

export const generateTypedefs = async ({
  knex,
  output,
  filterTables = () => true,
}: {
  knex: Knex
  output: string
  filterTables?: (table: string) => boolean
}) => {
  const schema = await getSchema({ knex })
  const tables = schema.tables
    .filter(t => filterTables(t.name))
    .filter(t => t.name !== 'migration')
    .sort((a, b) => a.name.localeCompare(b.name, 'en'))
  let types =
    '/* eslint-disable */\n' +
    '// This is automatically generated file. \n' +
    '// Do not edit, it WILL be overwritten.\n\n'
  for (const { name, columns } of tables) {
    types += `interface ${name} {\n${columns
      .map(c => `  ${transformKey(c.name)}: ${typeForColumn(c)}`)
      .join('\n')}\n}\n\n`
  }
  types += 'export type TableToTypeMap = {'
  types += tables.map(t => t.name).reduce((a, b) => `${a}\n  ${b}: ${b}`, '')
  types += '\n}\n'
  const content = await readFile(output)
  if (content !== types) {
    await promisify(fs.writeFile)(output, types)
  }
}
