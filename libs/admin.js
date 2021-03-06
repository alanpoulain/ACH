const { spawn } = require('child_process')
const { URLSearchParams } = require('url')
const fetch = require('node-fetch')
const flatten = require('lodash/flatten')
const {
  getAdminConfigForDomain,
  loadConfig,
  getAdminConfigForEnv
} = require('./config')

// Required since we use a self signed certificate
const https = require('https')
const httpsAgent = new https.Agent({
  rejectUnauthorized: false
})

/**
 * Base fetch to talk with admin endpoints
 * Deals with base URL, authentication and headers
 */
const baseFetch = (domain, route, options) => {
  const { adminAuth, adminURL } = getAdminConfigForDomain(domain)
  const auth = Buffer.from(adminAuth).toString('base64')
  const url = `${adminURL}${route}`
  const allOptions = {
    ...options,
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-type': 'application/json',
      Accept: 'application/json',
      ...(options.headers || {})
    },
    agent: adminURL.startsWith('https') ? httpsAgent : undefined
  }
  return fetch(url, allOptions).then(async resp => {
    if (resp.status > 299 && resp.status >= 200) {
      throw resp
    } else {
      return resp
    }
  })
}

/**
 * Creates a token from the stack's admin
 */
const createToken = (domain, doctypes) => {
  const params = new URLSearchParams({
    Domain: domain,
    Audience: 'cli',
    Scope: doctypes.join(' ')
  })
  return baseFetch(domain, `/instances/token?${params}`, {
    method: 'POST'
  }).then(resp => resp.text())
}

const enableDebug = domain => {
  return baseFetch(domain, `/instances/${domain}/debug`, {
    method: 'POST'
  })
}

const disableDebug = domain => {
  return baseFetch(domain, `/instances/${domain}/debug`, {
    method: 'DELETE'
  })
}

const sleep = delay => new Promise(resolve => setTimeout(resolve, delay))

const startEnvTunnels = async envs => {
  await loadConfig()

  const tunnelConfigs = envs.map(env => {
    const config = getAdminConfigForEnv(env)
    const remoteHost = config['host']
    const remotePort = '6060'
    const localPort = config['adminURL'].split(':').slice(-1)[0]
    return { remoteHost, remotePort, localPort }
  })
  return startSSHTunnels(tunnelConfigs)
}

const withEnvTunnel = async (envs, cb) => {
  envs = typeof envs === 'string' ? [envs] : envs

  let tunnel
  try {
    tunnel = await startEnvTunnels(envs)
    return await cb()
  } finally {
    tunnel && tunnel.kill()
  }
}

const startSSHTunnels = async tunnelConfigs => {
  let killed = false
  console.log('Starting ssh tunnel')
  const tunnelArgs = flatten(
    tunnelConfigs.map(tc => {
      const { localPort, remoteHost, remotePort } = tc
      return ['-L', `${localPort}:${remoteHost}:${remotePort}`]
    })
  )
  const ssh = spawn('ssh', ['-tt', '-fN', ...tunnelArgs, `bounce2`])

  ssh.stdout.on('data', data => {
    console.log('ssh-tunnel: ', data.toString().trim())
  })

  ssh.stderr.on('data', data => {
    if (data.includes('is not a tty')) {
      // Ignore as it does not cause any problem
      return
    }
    console.log('ssh-tunnel (stderr): ', data.toString().trim())
  })

  const killTunnel = () => {
    if (killed) {
      return
    }
    console.log('Stopping ssh tunnel')
    ssh.kill()
    killed = true
  }
  process.on('exit', () => {
    killTunnel()
  })

  process.on('SIGINT', () => {
    killTunnel()
  })

  await sleep(1000)
  return {
    spawned: ssh,
    kill: killTunnel
  }
}

const getLogsFromJob = (env, jobID) =>
  new Promise(resolve => {
    const config = getAdminConfigForEnv(env)
    if (!config.logs) {
      throw new Error('Not "logs" section in ACH config for env ' + env)
    }

    // TODO should use a graylog query
    const spawned = spawn('ssh', [
      '-tt',
      '-N',
      '-f',
      `${config.logs.user}@${config.logs.host}`,
      'grep',
      jobID,
      config.logs.host
    ])

    let stdout = ''
    spawned.stdout.on('data', data => (stdout += data.toString()))
    spawned.on('exit', () => {
      resolve(stdout)
    })
  })

module.exports = {
  withEnvTunnel,
  getLogsFromJob,
  createToken,
  enableDebug,
  disableDebug
}
