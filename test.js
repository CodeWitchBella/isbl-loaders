const { generateTypedefs } = require('./dist/index')
const path = require('path')

const knex = require('knex')({
  client: 'pg',
  connection: {
    host: 'localhost',
    user: 'postgres',
    password: 'password',
    database: 'rest',
  },
})

generateTypedefs({
  knex,
  output: path.join(__dirname, 'test-output.ts'),
})
  .then(v => {
    knex.destroy()
  })
  .catch(() => {
    knex.destroy()
  })
