const mkAPI = require('./api')
const groupBy = require('lodash/groupBy')
const partition = require('lodash/partition')

const DOCTYPE_BILLS = 'io.cozy.bills'
const DOCTYPE_FILES = 'io.cozy.files'
const DOCTYPE_ACCOUNTS = 'io.cozy.accounts'

let client

module.exports = {
  getDoctypes: function() {
    return [DOCTYPE_BILLS, DOCTYPE_FILES, DOCTYPE_ACCOUNTS]
  },
  run: async function(ach, dryRun, argv) {
    // arguments: slug, filename termination
    const [slug, vendor] = argv
    if (slug == null || vendor == null) {
      console.log(`wrong arguments : ${argv}`)
      process.exit()
    }

    const instance = ach.url.replace('https://', '')

    console.log('Instance ' + instance + '...')

    client = ach.client
    const api = mkAPI(client)

    // fetch the list of accounts with correct vendor
    const accounts = (await api.fetchAll(DOCTYPE_ACCOUNTS)).filter(
      account => account.account_type === slug
    )

    // get the list of file ids for all accounts
    const fileIds = []
    for (const account of accounts) {
      if (account && account.auth && account.auth.folderPath) {
        try {
          const files = await client.files.statByPath(account.auth.folderPath)
          fileIds.push.apply(
            fileIds,
            files.relationships.contents.data.map(doc => doc.id)
          )
        } catch (err) {
          console.log(`${account.auth.folderPath} does not exist`)
        }
      }
    }

    // get the list of bills and filter them by filename and vendor null
    const bills = (await api.fetchAll(DOCTYPE_BILLS)).filter(
      bill => bill.vendor === vendor
    )

    // find duplicates
    let toKeep, toRemove
    try {
      const result = partition(
        bills,
        bill =>
          bill &&
          bill.invoice &&
          fileIds.includes(bill.invoice.split(':').pop())
      )
      toKeep = result[0]
      toRemove = result[1]
    } catch (err) {
      console.log(err.message, 'keeping all bills')
      toKeep = bills
      toRemove = []
    }

    console.log(`Found ${toRemove.length} bills with files which do not exist`)
    console.log(`Now finding duplicates...`)
    const todo = findDuplicates(toKeep, {
      keys: ['date', 'amount', 'vendor']
    })

    todo.toRemove.push.apply(todo.toRemove, toRemove)

    // update and delete if not dryRun
    console.log(
      `Will delete ${todo.toRemove.length} bills / ${bills.length} total`
    )

    if (!dryRun) {
      if (todo.toRemove.length) {
        console.log('before ' + new Date())
        await api.deleteAll(DOCTYPE_BILLS, todo.toRemove)
        console.log('after ' + new Date())
      }
    }
  }
}

function findDuplicates(documents, options) {
  let hash = null
  if (options.keys) {
    hash = doc =>
      options.keys
        .map(key => {
          let result = doc[key]
          if (key === 'date') result = new Date(result)
          return result
        })
        .join(',')
  } else if (options.hash) {
    hash = options.hash
  } else {
    throw new Error('findDuplicates: you must specify keys or hash option')
  }

  const groups = groupBy(documents, hash)
  const toKeep = []
  const toRemove = []
  for (let key in groups) {
    const group = groups[key]
    toKeep.push(group[0])
    toRemove.push.apply(
      toRemove,
      group.slice(1).map(doc => ({
        ...doc,
        original: group[0]._id
      }))
    )
  }

  return { toKeep, toRemove }
}
