import DataLoader from 'dataloader'
import { Knex } from 'knex'
import isEqualWith from 'lodash.isequalwith'
import snakeCase from 'lodash.snakecase'
import camelCase from 'lodash.camelcase'
import { PickExcept, notNull, NullToOptional } from '@codewitchbella/ts-utils'

const production = process.env['NODE_ENV'] === 'production'

const transformKey = (transformer: (key: string) => string) => (obj: any) => {
  const ret = {} as any
  for (const [k, v] of Object.entries(obj)) {
    ret[transformer(k)] = v
  }
  return ret
}

type OrArray<T> = T | readonly T[]
type IDType<Table> = { id: number; type: Table }

export type InitLoader<
  Defs extends {
    table: {}
    js: {}
    insert: {}
  },
  Table
> = {
  byId: <Assert extends true | false = false>(
    id: IDType<Table>,
    opts?: { assertNull: Assert },
  ) => Promise<Defs['js'] | (Assert extends false ? null : never)>
  insert: (v: Defs['insert']) => Promise<Defs['js']>
  update: (
    id: IDType<Table>,
    value: Partial<PickExcept<Defs['js'], 'id'>>,
  ) => Promise<void>
  updateWhere: (
    value: Partial<PickExcept<Defs['js'], 'id'>>,
    where: OrArray<IDType<Table>>,
  ) => Promise<void>
  raw: (
    doQuery: (q: Knex.QueryBuilder) => Knex.QueryBuilder,
  ) => Promise<Defs['js'][]>
  all: (arg?: { orderBy?: keyof Defs['js'] }) => Promise<Defs['js'][]>
  delete: (ids: OrArray<IDType<Table>>) => Promise<void>
  count: (
    doQuery?: (a: Knex.QueryBuilder) => Knex.QueryBuilder,
  ) => Promise<number>
  convertToDb: (v: Partial<Defs['js']>) => Defs['table']
  info: { table: Table }
}

export const unique = <T extends Object>(el: T, i: number, arr: readonly T[]) =>
  arr.findIndex((a) => a === el) === i

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
  onInsert: (id: number[]) => void
  onUpdate: (id: number[]) => void
}

function captureStack() {
  return production ? null : new Error()
}

function getError(captured: ReturnType<typeof captureStack>) {
  return (message: string) => {
    const err = new Error(message)
    if (captured && err.stack && captured.stack) {
      err.stack =
        err.stack.split('\n')[0] +
        '\n' +
        captured.stack.split('\n').slice(1).join('\n')
    }
    return err
  }
}

function caser(t: (v: string) => string): (v: string) => string {
  const cache: { [key: string]: string } = {}
  return (v) => {
    if (cache[v] !== undefined) return cache[v]
    const res = t(v)
    cache[v] = res
    return res
  }
}

export default class TableLoader<
  Defs extends {
    table: {}
    js: {}
    insert: {}
  },
  Table
> {
  private table: string

  private knex: Knex

  private clearers: (() => void)[]

  private options: Options<Defs['table'], Defs['js']>

  private cameler = caser(camelCase)

  private fieldToDB = caser(snakeCase)

  constructor(options: Options<Defs['table'], Defs['js']>) {
    this.table = options.table
    this.knex = options.knex
    this.options = options
    this.clearers = []
  }

  private fromDB(o: Defs['table']): Defs['js'] {
    const object = transformKey(this.cameler)(o)
    const r = { ...object, id: { type: this.table, id: object.id } }
    if (this.options.fromDB) {
      for (const [key, resolver] of Object.entries(this.options.fromDB)) {
        if (key in object && resolver) {
          try {
            r[key] = (resolver as any)(object[key])
          } catch (e) {
            const err = new Error(
              `Error occured while converting field ${key} of table ${
                this.table
              } from db${object.id ? ` (id: ${object.id})` : ''}`,
            )
            err.stack += `\nOriginal error:\n${e.stack}`
            throw err
          }
        }
      }
    }

    return r
  }

  private toDB(
    object: any,
    { ignoreUndefined = false }: { ignoreUndefined?: boolean } = {},
  ) {
    const r = { ...object }
    if (this.options.toDB) {
      for (const [key, resolver] of Object.entries(this.options.toDB)) {
        if (key in object && resolver) {
          if (ignoreUndefined && object[key] === undefined) continue

          try {
            r[key] = (resolver as any)(object[key])
          } catch (e) {
            const err = new Error(
              `Error occured while converting field ${key} of table ${
                this.table
              } to db${object.id ? ` (id: ${object.id.id})` : ''}`,
            )
            err.stack += `\nOriginal error:\n${e.stack}`
            throw err
          }
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
    return transformKey(this.fieldToDB)(r)
  }

  /**
   * Runs select query specified using doQuery function and maps resulting
   * objects to Defs['js']ype
   */
  private async query(
    doQuery: (q: Knex.QueryBuilder) => Knex.QueryBuilder,
    { convert = false }: { convert?: boolean } = {},
  ): Promise<Defs['js'][]> {
    const res: any[] = await doQuery(this.knex.table(this.table).select())
    const filtered = res.filter((a) => a)
    if (!convert) return filtered
    return filtered.map((a) => this.fromDB(a)).filter(notNull)
  }

  /**
   * Returns function which takes field value and loads array of elements from
   * table which have field equal to value specified
   *
   * SELECT * FROM ${table} WHERE ${field} = ${value};
   */
  byFieldValueMultiple<
    Key extends Defs['js'][Field],
    Field extends keyof Defs['js']
  >(field: Field) {
    const loaders = new Map<
      Function | undefined,
      { args: any; f: DataLoader<[any, any], Defs['table'][]> }[]
    >()
    const queryList: string[] = []

    const dbField = this.fieldToDB(field as any)
    const valueToDB = (v: Defs['js']) => this.toDB({ [field]: v })[dbField]
    return <T extends Object | undefined = undefined>(
      key: OrArray<Key>,
      b?: {
        query: (q: Knex.QueryBuilder, args: T) => Knex.QueryBuilder
        args: T
        comparator?: (a: T, b: T) => boolean
      },
    ) => {
      if (!production && b && !loaders.has(b.query)) {
        const queryString = b.query.toString()
        if (queryList.some((q) => q === queryString)) {
          console.warn(
            'Warning: found two query functions with same source code but different reference',
          )
          console.warn('This prevents batching - is going to be slow')
          console.warn('This check is disabled if NODE_ENV is production')
          console.warn('Offending function')
          console.warn(queryString)
        }
        queryList.push(queryString)
      }

      const idx = b ? b.query : undefined
      if (!loaders.has(idx)) loaders.set(idx, [])
      const list = loaders.get(idx)!
      let loader = b
        ? list.find((el) =>
            b.comparator ? b.comparator(el.args, b.args) : el.args === b.args,
          )
        : list[0]
      if (!loader) {
        loader = {
          args: b ? b.args : undefined,
          f: new DataLoader<any, Defs['js'][]>(async (ids) => {
            const rows = await this.query(
              (q) =>
                b
                  ? b
                      .query(
                        q.whereIn(dbField, ids.filter(unique) as any),
                        b.args,
                      )
                      .select()
                  : q.whereIn(dbField, ids.filter(unique) as any).select(),
              { convert: false },
            )
            return ids.map(
              (id) => rows.filter((x: any) => x[dbField] === id) || [],
            )
          }),
        }
        list.push(loader)
        this.clearers.push(() => {
          loader!.f.clearAll()
        })
      }

      if (Array.isArray(key)) {
        return loader.f
          .loadMany(key.map(valueToDB))
          .then((v) =>
            v
              .flat()
              .map((el) => this.fromDB(el))
              .filter(notNull),
          )
          .then((ret) => {
            for (const el of ret) if (el instanceof Error) throw el
            return ret
          })
      } else {
        return loader.f
          .load(valueToDB(key))
          .then((v) => v.map((el) => this.fromDB(el)).filter(notNull))
      }
    }
  }

  /**
   * Returns function which takes field value and loads first element from
   * table which have field equal to value specified
   *
   * exec(`SELECT * FROM ${table} WHERE ${field} = ${value};`)[0]
   */
  byFieldValueSingle<
    Key extends Defs['js'][Field],
    Field extends keyof Defs['js']
  >(field: Field) {
    const loader = this.byFieldValueMultiple(field)
    return <Assert extends true | false = false>(
      a: Key,
      { assertNull }: { assertNull?: Assert } = {},
    ) =>
      loader(a).then((v: Defs['js'][]):
        | (Assert extends false ? null : never)
        | Defs['js'] => {
        if (v.length === 0) {
          if (assertNull)
            throw new Error(
              `Did not find item for field ${JSON.stringify(
                field,
              )} value ${JSON.stringify(a)} in table "${this.table}"`,
            )
          return null!
        }
        if (v.length === 1) return v[0]
        throw new Error(
          `Found more than one item for field "${field}" value "${a}" in table "${this.table}"`,
        )
      })
  }

  /**
   * Returns function which takes values of fieldA and fieldB and loads first
   * element which have those fields equal to values specified
   *
   * exec(`SELECT * from ${table} WHERE ${fieldA} = ${valueA} AND ${FIELDB} = ${valueB}`)[0]
   */
  byPair<FieldA extends keyof Defs['js'], FieldB extends keyof Defs['js']>(
    fieldA: FieldA,
    fieldB: FieldB,
  ) {
    const loader = new DataLoader<
      [Defs['js'][FieldA], Defs['js'][FieldB]],
      Defs['js'] | null
    >((ids) =>
      Promise.all(
        ids.map(async (id) => {
          const a = this.toDB({ [fieldA]: id[0] })
          const b = this.toDB({ [fieldB]: id[1] })
          const rows = await this.query((q) => q.where(a).andWhere(b))
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
    return (v1: Defs['js'][FieldA], v2: Defs['js'][FieldB]) =>
      loader.load([v1, v2]).then((v) => (v ? this.fromDB(v) : v))
  }

  /**
   * Returns function which takes value of id and loads element which has given
   * id
   */
  byId(): InitLoader<Defs, Table>['byId'] {
    // this any is needed because specifying Defs['js']ype extends { id: number } did not work
    return this.byFieldValueSingle('id' as any) as any
  }

  /**
   * Deletes values
   */
  delete(): InitLoader<Defs, Table>['delete'] {
    const toArray = <T extends {}>(v: OrArray<T>): readonly T[] =>
      Array.isArray(v) ? v : [v]
    return async (ids) =>
      this.knex
        .table(this.table)
        .delete()
        .whereIn(
          'id',
          toArray(ids).map((id) => this.toDB({ id }).id),
        )
        .then(() => {
          this.clearers.forEach((c) => c())
        })
  }

  all(): InitLoader<Defs, Table>['all'] {
    return ({ orderBy = 'id' }: { orderBy?: any } = {}) =>
      this.knex
        .table(this.table)
        .select()
        .orderBy(this.fieldToDB(orderBy as any))
        .then((l) => l.map((a: any) => this.fromDB(a)).filter(notNull)) as any
  }

  /**
   * Inserts element into database and clears cache. Returns inserted element
   */
  insert(): InitLoader<Defs, Table>['insert'] {
    type Item = {
      value: NullToOptional<PickExcept<Defs['js'], 'id'>>
      getError: (message: string) => Error
    }
    const insertSlice = async (
      trx: Knex.Transaction,
      list: readonly Item[],
    ) => {
      const values = list.map((v) => v.value)
      const insert = (v: any) => {
        const q = trx.table(this.table).insert(v)
        return trx
          .raw('? on conflict do nothing returning *', q)
          .then((v) => (v as any).rows)
      }
      try {
        const batchedValues = values.filter((v) => Object.keys(v).length > 0)
        let returning: any[] =
          batchedValues.length > 0 ? await insert(batchedValues) : []
        this.clearers.forEach((c) => c())
        this.options.onInsert(returning.map((r) => r.id))

        returning = returning.concat(
          await Promise.all(
            values
              .filter((v) => Object.keys(v).length === 0)
              .map((v) => insert(v).then((l) => l[0])),
          ),
        )

        /*
         * Returns ret element which matches inEl AND removes it from ret array
         * kind of like splice
         */
        const inToReturning = (inEl: any) => {
          const index = returning.findIndex((el) => {
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
          .map((v) => (v ? this.fromDB(v) : new Error('Insert failed')))
        if (returning.length > 0) {
          // eslint-disable-next-line no-console
          console.log({ values, returning })
          throw new Error(
            'Returning contains elements. Something went horribly wrong!',
          )
        }
        return ret
      } catch (e) {
        return list.map((v) => v.getError(e.message))
      }
    }

    const sliceIt = (list: readonly Item[]) => {
      if (list.length <= 0) return []
      let maxFields = list.reduce((a, b) => {
        const count = Object.keys(b.value).length
        return a > count ? a : count
      }, 0)
      if (maxFields < 1) maxFields = 1

      const MAX_BINDS = 65535 // https://github.com/knex/knex/issues/3929

      const itemsPerSlice = Math.floor(MAX_BINDS / maxFields)
      const sliceCount = Math.ceil(list.length / itemsPerSlice)
      const sliced = Array.from({ length: sliceCount }).map((_, sliceId) => {
        const start = sliceId * itemsPerSlice
        return list.slice(start, start + itemsPerSlice)
      })

      const sanityCheck = sliced.reduce((a, b) => a.concat(b), [])
      sanityCheck.forEach((v, i) => {
        if (list[i] !== v) throw new Error('Split sanity check failed')
      })

      return sliced
    }
    const loader = new DataLoader<Item, Defs['js']>(
      async (list) => {
        const sliced = sliceIt(list)
        const result = await this.knex.transaction((trx) =>
          Promise.all(sliced.map((slice) => insertSlice(trx, slice))),
        )
        return result.reduce((a, b) => a.concat(b), [])
      },
      { cache: false },
    )
    return (value) =>
      loader.load({
        value: this.toDB(value, { ignoreUndefined: true }),
        getError: getError(captureStack()),
      })
  }

  /**
   * Updates values of all elements whose id matches where argument
   */
  updateWhere(): InitLoader<Defs, Table>['updateWhere'] {
    return async (value, where) => {
      let q = this.knex
        .table(this.table)
        .update(this.toDB(value, { ignoreUndefined: true }))

      const ids = (Array.isArray(where) ? where : [where]).map(
        (id) => this.toDB({ id }).id,
      )

      if (ids.length === 0) {
        // do nothing
      } else if (ids.length > 1) {
        q = q.whereIn('id', ids)
      } else {
        q = q.where('id', ids[0])
      }
      await q

      this.clearers.forEach((c) => c())
      this.options.onUpdate(ids)
    }
  }

  /**
   * Updates element in database. It finds element which it updates by id.
   * Also clears cache
   */
  update(): InitLoader<Defs, Table>['update'] {
    return async (id, value) => {
      const dbId = this.toDB({ id })
      await this.knex
        .table(this.table)
        .where(dbId)
        .update(this.toDB(value, { ignoreUndefined: true }))
      this.clearers.forEach((c) => c())
      this.options.onUpdate([dbId.id])
    }
  }

  /**
   * Runs select query and transforms result to Defs['js']ype
   */
  raw(): InitLoader<Defs, Table>['raw'] {
    return async (doQuery) =>
      this.query(doQuery).then((v) =>
        v.map((el) => this.fromDB(el)).filter(notNull),
      )
  }

  /**
   * Returns number of records matching q
   */
  count(): InitLoader<Defs, Table>['count'] {
    return async (doQuery = (a) => a) =>
      doQuery(this.knex.table(this.table).count()).then((v: any) =>
        Number.parseInt(v[0].count, 10),
      )
  }

  /**
   * Runs select query and transforms result to Defs['js']ype.
   * Does NOT have any performance benefits.
   */
  preparedRaw(doQuery: (q: Knex.QueryBuilder) => Knex.QueryBuilder) {
    return () =>
      this.query(doQuery).then((v) =>
        v.map((el) => this.fromDB(el)).filter(notNull),
      )
  }

  /**
   * Initializes methods which every table loader should have
   */
  initLoader(): InitLoader<Defs, Table> {
    return {
      byId: this.byId(),
      insert: this.insert(),
      update: this.update(),
      updateWhere: this.updateWhere(),
      raw: this.raw(),
      all: this.all(),
      delete: this.delete(),
      count: this.count(),
      convertToDb: (v: Partial<Defs['js']>) => this.toDB(v),
      info: { table: this.table as any },
    }
  }
}
