import DataLoader from 'dataloader'
import Knex from 'knex'
import isEqualWith from 'lodash.isequalwith'
import snakeCase from 'lodash.snakecase'
import camelCase from 'lodash.camelcase'
import { PickExcept } from '@s-isabella/ts-utils'

const transformKey = (transformer: (key: string) => string) => (obj: any) => {
  const ret = {} as any
  for (const [k, v] of Object.entries(obj)) {
    ret[transformer(k)] = v
  }
  return ret
}

function fieldToDB(field: string) {
  return snakeCase(field)
}

type NonIDProperties<T> = PickExcept<T, 'id'>

export const unique = <T extends Object>(el: T, i: number, arr: T[]) =>
  arr.findIndex(a => a === el) === i

/**
 * Raw queries cannot be cached or batch, so avoid them if caching or
 * batching is needed
 */
export type RawQuery<JSType> = (
  doQuery: (q: Knex.QueryBuilder) => Knex.QueryBuilder,
) => Promise<JSType[]>

type Options<TableType /* extends { id: number } */, JSType> = {
  knex: Knex
  table: string
  fromDB?: {
    [key in keyof TableType]?: key extends keyof JSType
      ? (t: TableType[key]) => JSType[key]
      : never
  }
  toDB?: {
    [key in keyof JSType]?: key extends keyof TableType
      ? (t: JSType[key]) => TableType[key]
      : never
  }
}

export default class TableLoader<
  TableType /* extends { id: number }, */,
  JSType /* extends { id: number }*/
> {
  private table: string

  private knex: Knex

  private clearers: (() => void)[]

  private options: Options<TableType, JSType>

  constructor(options: Options<TableType, JSType>) {
    this.table = options.table
    this.knex = options.knex
    this.options = options
    this.clearers = []
  }

  private fromDB(o: any): JSType {
    const object = transformKey(camelCase)(o)
    const r = { ...object, id: { type: this.table, value: object.id } }
    if (this.options.fromDB) {
      for (const [key, resolver] of Object.entries(this.options.fromDB)) {
        if (key in object && resolver) {
          r[key] = resolver(object[key])
        }
      }
    }

    return r
  }

  private toDB(object: any) {
    const r = { ...object }
    if (this.options.toDB) {
      for (const [key, resolver] of Object.entries(this.options.toDB)) {
        if (key in object && resolver) {
          r[key] = resolver(object[key])
        }
      }
    }
    if (r.id) {
      if (r.id.type !== this.table) {
        throw new Error(
          `Used id for table "${r.id.type}" when working with "${this.table}"`,
        )
      }
      r.id = r.id.id
      if (typeof r.id !== 'number') {
        throw new Error('ID must be number')
      }
    }
    return transformKey(snakeCase)(r)
  }

  /**
   * Runs select query specified using doQuery function and maps resulting
   * objects to JSType
   */
  private async query(
    doQuery: (q: Knex.QueryBuilder) => Knex.QueryBuilder,
  ): Promise<JSType[]> {
    const res: any[] = await doQuery(this.knex.table(this.table).select())

    return res.filter(a => a).map(a => this.fromDB(a))
  }

  /**
   * Returns function which takes field value and loads array of elements from
   * table which have field equal to value specified
   *
   * SELECT * FROM ${table} WHERE ${field} = ${value};
   */
  byFieldValueMultiple<Key extends JSType[Field], Field extends keyof JSType>(
    field: Field,
  ) {
    const loader = new DataLoader<Key, JSType[]>(async ids => {
      const dbField = fieldToDB(field as any)
      const valueToDB = (v: any) => this.toDB({ [field]: v })[dbField]
      const rows = await this.query(q =>
        q.whereIn(dbField, ids.filter(unique).map(valueToDB).filter(unique) as any).select(),
      )
      return ids.map(id => rows.filter((x: any) => x[field] === id) || [])
    })
    this.clearers.push(() => {
      loader.clearAll()
    })
    return (a: Key) => loader.load(a)
  }

  /**
   * Returns function which takes field value and loads first element from
   * table which have field equal to value specified
   *
   * exec(`SELECT * FROM ${table} WHERE ${field} = ${value};`)[0]
   */
  byFieldValueSingle<Key extends JSType[Field], Field extends keyof JSType>(
    field: Field,
    type: 'string' | 'number' | 'object',
  ) {
    const loader = new DataLoader<Key, JSType | null>(async ids => {
      const dbField = fieldToDB(field as any)
      const valueToDB = (v: any) => this.toDB({[field]: v})[dbField]
      const rows: any[] = await this.query(q =>
        q.whereIn(dbField, ids.filter(unique).map(valueToDB).filter(unique) as any),
      )
      return ids.map(id => {
        const items = rows.filter((x: any) => x[field] === id)
        if (items.length === 0) return null
        if (items.length === 1) return items[0]
        return new Error(
          `Found more than one item for field "${field}" value "${id}" in table "${
            this.table
          }"`,
        )
      })
    })
    this.clearers.push(() => {
      loader.clearAll()
    })
    return (a: Key) => {
      // eslint-disable-next-line valid-typeof
      if (typeof a !== type)
        throw new Error(`Value for ${field} must be ${type}`)
      return loader.load(a)
    }
  }

  /**
   * Returns function which takes values of fieldA and fieldB and loads first
   * element which have those fields equal to values specified
   *
   * exec(`SELECT * from ${table} WHERE ${fieldA} = ${valueA} AND ${FIELDB} = ${valueB}`)[0]
   */
  byPair<FieldA extends keyof JSType, FieldB extends keyof JSType>(
    fieldA: FieldA,
    fieldB: FieldB,
  ) {
    const loader = new DataLoader<
      [JSType[FieldA], JSType[FieldB]],
      JSType | null
    >(ids =>
      Promise.all(
        ids.map(async id => {
          const a = this.toDB({ [fieldA]: id[0] })
          const b = this.toDB({ [fieldB]: id[1] })
          const rows = await this.query(q => q.where(a).andWhere(b))
          if (rows.length > 1) {
            return new Error(
              `Found more than one item for query ${JSON.stringify(
                a,
              )} and ${JSON.stringify(b)} on table ${this.table}`,
            )
          }
          return rows[0] || null
        }),
      ),
    )
    this.clearers.push(() => {
      loader.clearAll()
    })
    return (v1: JSType[FieldA], v2: JSType[FieldB]) => loader.load([v1, v2])
  }

  /**
   * Returns function which takes value of id and loads element which has given
   * id
   */
  byId() {
    // this any is needed because specifying JSType extends { id: number } did not work
    return this.byFieldValueSingle('id' as any, 'number')
  }

  /**
   * Deletes values
   */
  delete() {
    return async (ids: number[]) =>
      this.knex
        .table(this.table)
        .delete()
        .whereIn('id', ids)
  }

  all() {
    return (): Promise<JSType[]> =>
      this.knex
        .table(this.table)
        .select()
        .then(l => l.map((a: any) => this.fromDB(a as any))) as any
  }

  /**
   * Inserts element into database and clears cache. Returns inserted element
   */
  insert() {
    const loader = new DataLoader<NonIDProperties<JSType>, JSType>(
      async values => {
        const q = this.knex.table(this.table).insert(values)
        const returning: any[] = (await this.knex.raw(
          '? on conflict do nothing returning *',
          q,
        )).rows
        this.clearers.forEach(c => c())

        /*
         * Returns ret element which matches inEl AND removes it from ret array
         * kind of like splice
         */
        const inToReturning = (inEl: any) => {
          const index = returning.findIndex(el => {
            // the undefined comparison is here because of default values
            const weakCompare = (a: any, b: any) =>
              // eslint-disable-next-line eqeqeq
              a === undefined || a == b ? true : undefined
            for (const key of Object.keys(inEl)) {
              if (!isEqualWith(inEl[key], (el as any)[key], weakCompare))
                return false
            }
            return true
          })
          return index >= 0 ? returning.splice(index, 1)[0] : null
        }

        const ret = values
          .map(inToReturning)
          .map(v => (v ? this.fromDB(v) : new Error('Insert failed')))
        if (returning.length > 0) {
          // eslint-disable-next-line no-console
          console.log({ values, returning })
          throw new Error(
            'Returning contains elements. Something went horribly wrong!',
          )
        }
        return ret
      },
      { cache: false },
    )
    return (value: NonIDProperties<JSType>) => loader.load(this.toDB(value))
  }

  /**
   * Updates values of all elements whose id matches where argument
   */
  updateWhere() {
    return async (
      value: Partial<NonIDProperties<JSType>>,
      where: number[] | number,
    ): Promise<void> => {
      let q = this.knex.table(this.table).update(this.toDB(value))
      if (typeof where === 'number') {
        q = q.where('id', where)
      } else {
        q = q.whereIn('id', where)
      }
      await q

      this.clearers.forEach(c => c())
    }
  }

  /**
   * Updates element in database. It finds element which it updates by id.
   * Also clears cache
   */
  update() {
    return async (value: NonIDProperties<JSType>): Promise<void> => {
      await this.knex
        .table(this.table)
        .where({ id: value.id })
        .update({ ...this.toDB(value) })
      this.clearers.forEach(c => c())
    }
  }

  /**
   * Runs select query and transforms result to JSType
   */
  raw(): RawQuery<JSType> {
    return async doQuery => this.query(doQuery)
  }

  /**
   * Runs select query and transforms result to JSType.
   * Does NOT have any performance benefits.
   */
  preparedRaw(doQuery: (q: Knex.QueryBuilder) => Knex.QueryBuilder) {
    return () => this.query(doQuery)
  }

  /**
   * Initializes methods which every table loader should have
   */
  initLoader() {
    return {
      byId: this.byId(),
      insert: this.insert(),
      update: this.update(),
      updateWhere: this.updateWhere(),
      raw: this.raw(),
      all: this.all(),
      delete: this.delete(),
    }
  }
}
