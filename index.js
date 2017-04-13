const fs = require('fs')
const appPackage = require('./package.json')

const lib = require('./lib')

// the CLI interface
let program = require('commander')
program
.version(appPackage.version)
.option('-t --token', 'Generate a new token.')
.option('-u --url <url>', 'URL of the cozy to use. Defaults to "http://cozy.tools:8080".')

// import command
program.command('import [dataFile] [helpersFile]')
.description('The file containing the JSON data to import. Defaults to "example-data.json". Then the dummy helpers JS file (optional).')
.action((dataFile, helpersFile) => {
  if (!dataFile) dataFile = 'example-data.json'
  // dummy helpers
  let helpers = null
  if (helpersFile) helpers = require(`./${helpersFile}`)

  const dummyjson = require('dummy-json')

  // get the url of the cozy
  const cozyUrl = program.url ? program.url.toString() : 'http://cozy.tools:8080'

  // collect the doctypes that we're going to import
  let docTypes = []
  let template = fs.readFileSync(dataFile, {encoding: 'utf8'})

  let data = helpersFile
    ? JSON.parse(dummyjson.parse(template, helpers))
    : JSON.parse(dummyjson.parse(template))

  for (let docType in data) {
    docTypes.push(docType)
  }

  // get a client
  lib.getClient(!!program.token, cozyUrl, docTypes)
  .then(client => {
    lib.importData(client, data)
  })
})

// import directories command
// All the root folder content is imported, not the root folder itself (DirectoriesToInject by default)
program.command('importDir [directoryPath]')
.description('The path to the directory content to import. Defaults to "./DirectoriesToInject".')
.action(directoryPath => {
  if (!directoryPath) directoryPath = './DirectoriesToInject'

  // get directories tree in JSON format
  const dirTree = require('directory-tree')
  const JSONtree = dirTree(directoryPath, {})

  // get the url of the cozy
  const cozyUrl = program.url ? program.url.toString() : 'http://cozy.tools:8080'

  // get a client
  lib.getClient(!!program.token, cozyUrl, ['io.cozy.files'])
  .then(client => {
    lib.importFolderContent(client, JSONtree)
  })
})

// is this a good idea?
program.command('drop <doctypes...>')
.description('Deletes all documents of the provided doctypes. For real.')
.action(docTypes => {
  const readline = require('readline')

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })

  rl.question('Are you sure? EVERY document of type ' + docTypes.join(', ') + ' will be removed. Type yes to confirm.\n', (answer) => {
    rl.close()

    if (answer === 'yes') {
      console.log('Okay, hang tight.')
      // get the url of the cozy
      const cozyUrl = program.url ? program.url.toString() : 'http://cozy.tools:8080'

      lib.getClient(!!program.token, cozyUrl, docTypes)
      .then(client => {
        lib.dropCollections(client, docTypes)
      })
    } else {
      console.log('Thought so.')
    }
  })
})

program.parse(process.argv)

if (!process.argv.slice(2).length) {
  program.help()
}
