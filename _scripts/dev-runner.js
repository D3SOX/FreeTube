process.env.NODE_ENV = 'development'

const electron = require('electron')
const webpack = require('webpack')
const WebpackDevServer = require('webpack-dev-server')
const kill = require('@magda/tree-kill')

const path = require('path')
const { createHash } = require('crypto')
const { spawn } = require('child_process')
const { mkdirSync, realpathSync } = require('fs')
const { tmpdir } = require('os')

const ProcessLocalesPlugin = require('./ProcessLocalesPlugin')

let electronProcess = null
let manualRestart = null
let restartTimer = null
let manualRestartResetTimer = null

const restartDebounceMs = 300
const manualRestartResetMs = 2500

const remoteDebugging = process.argv.indexOf('--remote-debug') !== -1
const web = process.argv.indexOf('--web') !== -1
const worktree = process.argv.indexOf('--worktree') !== -1

let mainConfig
let rendererConfig
let preloadConfig
let botGuardScriptConfig
let webConfig
let SHAKA_LOCALES_TO_BE_BUNDLED

if (remoteDebugging) {
  // disable dvtools open in electron
  process.env.RENDERER_REMOTE_DEBUGGING = true
}

// Define exit code for relaunch and set it in the environment
const relaunchExitCode = 69
process.env.OPENTUBEX_RELAUNCH_EXIT_CODE = relaunchExitCode

let port = 9080

function configureWorktree() {
  // Let the operating system atomically assign the port when the development
  // server starts, instead of probing a port that another process could claim.
  port = 0
  const projectPath = realpathSync(path.resolve(__dirname, '..'))
  const profileId = createHash('sha256').update(projectPath).digest('hex').slice(0, 12)
  const profilePath = path.resolve(process.env.OPENTUBEX_DEV_USER_DATA_DIR || path.join(tmpdir(), `opentubex-dev-${profileId}`))
  mkdirSync(profilePath, { recursive: true, mode: 0o700 })

  process.env.OPENTUBEX_DEV_USER_DATA_DIR = profilePath

  console.log(`Using worktree profile ${profilePath}`)
}

/** @param {WebpackDevServer} devServer */
function getListeningPort(devServer) {
  return new Promise((resolve, reject) => {
    const server = devServer.server
    if (!server) {
      reject(new Error('Development server was not created'))
      return
    }

    const onError = error => {
      server.off('listening', onListening)
      reject(error)
    }
    const onListening = () => {
      server.off('error', onError)
      const address = server.address()
      if (typeof address === 'object' && address !== null) {
        resolve(address.port)
      } else {
        reject(new Error('Unable to determine the development server port'))
      }
    }

    if (server.listening) onListening()
    else {
      server.once('error', onError)
      server.once('listening', onListening)
    }
  })
}

function loadWebpackConfigs() {
  if (!web) {
    mainConfig = require('./webpack.main.config')
    rendererConfig = require('./webpack.renderer.config')
    preloadConfig = require('./webpack.preload.config.js')
    botGuardScriptConfig = require('./webpack.botGuardScript.config')

    SHAKA_LOCALES_TO_BE_BUNDLED = rendererConfig.SHAKA_LOCALES_TO_BE_BUNDLED
    delete rendererConfig.SHAKA_LOCALES_TO_BE_BUNDLED
  } else {
    webConfig = require('./webpack.web.config')
  }
}

async function killElectron(pid) {
  return new Promise((resolve, reject) => {
    if (pid) {
      kill(pid, err => {
        if (err) reject(err)

        resolve()
      })
    } else {
      resolve()
    }
  })
}

async function restartElectron() {
  console.log('\nStarting electron...')

  const { pid } = electronProcess || {}
  await killElectron(pid)

  electronProcess = spawn(electron, [
    path.join(__dirname, '../dist/main.js'),
    // '--enable-logging', // Enable to show logs from all electron processes
    remoteDebugging ? '--inspect=9222' : '',
    remoteDebugging ? '--remote-debugging-port=9223' : ''
  ],
    // { stdio: 'inherit' } // required for logs to actually appear in the stdout
  )

  electronProcess.on('exit', (code, _) => {
    if (code === relaunchExitCode) {
      electronProcess = null
      restartElectron()
      return
    }

    if (!manualRestart) process.exit(0)
  })
}

function scheduleElectronRestart() {
  manualRestart = true

  if (restartTimer) {
    clearTimeout(restartTimer)
  }

  if (manualRestartResetTimer) {
    clearTimeout(manualRestartResetTimer)
    manualRestartResetTimer = null
  }

  restartTimer = setTimeout(async () => {
    restartTimer = null

    try {
      await restartElectron()
    } catch (err) {
      console.error(err)
    }

    manualRestartResetTimer = setTimeout(() => {
      manualRestartResetTimer = null

      if (!restartTimer) {
        manualRestart = false
      }
    }, manualRestartResetMs)
  }, restartDebounceMs)
}

/**
 * @param {import('webpack').Compiler} compiler
 * @param {WebpackDevServer} devServer
 */
function setupNotifyLocaleUpdate(compiler, devServer) {
  const notifyLocaleChange = (update) => {
    devServer.sendMessage(devServer.webSocketServer.clients, 'freetube-locale-update', update)
  }

  compiler.options.plugins
    .filter(plugin => plugin instanceof ProcessLocalesPlugin)
    .forEach((/** @type {ProcessLocalesPlugin} */plugin) => {
      plugin.notifyLocaleChange = notifyLocaleChange
    })
}

function startBotGuardScript() {
  webpack(botGuardScriptConfig, (err) => {
    if (err) console.error(err)

    console.log(`\nCompiled ${botGuardScriptConfig.name} script!`)
  })
}

function startMain() {
  const compiler = webpack(mainConfig)
  const { name } = compiler

  compiler.hooks.afterEmit.tap('afterEmit', async () => {
    console.log(`\nCompiled ${name} script!`)

    scheduleElectronRestart()

    console.log(`\nWatching file changes for ${name} script...`)
  })

  compiler.watch({
    aggregateTimeout: 500,
  },
  err => {
    if (err) console.error(err)
  })
}

function startPreload() {
  const compiler = webpack(preloadConfig)
  const { name } = compiler

  let firstTime = true

  compiler.hooks.afterEmit.tap('afterEmit', async () => {
    console.log(`\nCompiled ${name} script!`)

    if (firstTime) {
      firstTime = false
    } else {
      scheduleElectronRestart()
    }

    console.log(`\nWatching file changes for ${name} script...`)
  })

  compiler.watch({
    aggregateTimeout: 500,
  },
  err => {
    if (err) console.error(err)
  })
}

function startRenderer(callback) {
  const compiler = webpack(rendererConfig)
  const { name } = compiler

  const server = new WebpackDevServer({
    client: {
      overlay: {
        runtimeErrors: false
      }
    },
    static: [
      {
        directory: path.resolve(__dirname, '..', 'static'),
        watch: {
          ignored: [
            /(dashFiles|storyboards)\/*/,
            '**/.DS_Store',
            '**/static/locales/**'
          ]
        },
        publicPath: '/static'
      },
      {
        directory: path.resolve(__dirname, '..', 'node_modules', 'shaka-player', 'ui', 'locales'),
        publicPath: '/static/shaka-player-locales',
        watch: {
          // Ignore everything that isn't one of the locales that we would bundle in production mode
          ignored: `**/!(${SHAKA_LOCALES_TO_BE_BUNDLED.join('|')}).json`
        }
      }
    ],
    port
  })

  server.apply(compiler)

  setupNotifyLocaleUpdate(compiler, server)

  let firstTime = true

  const watching = compiler.watch({ aggregateTimeout: 250 }, (err, result) => {
    if (err) console.error(err)

    if (result) {
      console.log('\n' + result.toString({ colors: true }))
    }

    console.log(`\nCompiled ${name} script!\n\nWatching file changes for ${name} script...`)

    if (firstTime) {
      firstTime = false
      getListeningPort(server).then(callback).catch(error => {
        console.error(error)
        watching.close(() => {
          process.exitCode = 1
        })
      })
    }
  })
}

function startWeb () {
  const compiler = webpack(webConfig)
  const { name } = compiler

  const server = new WebpackDevServer({
    open: true,
    static: {
      directory: path.resolve(__dirname, '..', 'static'),
      watch: {
        ignored: [
          /(dashFiles|storyboards)\/*/,
          '**/.DS_Store',
          '**/static/locales/**'
        ]
      }
    },
    port
  })

  server.apply(compiler)

  setupNotifyLocaleUpdate(compiler, server)

  compiler.watch({ aggregateTimeout: 250 }, (err, result) => {
    if (err) console.error(err)

    if (result) {
      console.log('\n' + result.toString({ colors: true }))
    }

    console.log(`\nCompiled ${name} script!\n\nWatching file changes for ${name} script...`)
  })
}
async function start() {
  if (worktree) configureWorktree()
  loadWebpackConfigs()

  if (!web) {
    startRenderer(devServerPort => {
      if (worktree) {
        process.env.OPENTUBEX_DEV_SERVER_PORT = String(devServerPort)
        console.log(`Using development server port ${devServerPort}`)
      }
      startBotGuardScript()
      startPreload()
      startMain()
    })
  } else {
    startWeb()
  }
}

start().catch(error => {
  console.error(error)
  process.exitCode = 1
})
