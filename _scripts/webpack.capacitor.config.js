process.env.IS_CAPACITOR = 'true'

const path = require('path')
const config = require('./webpack.web.config')
const botGuardConfig = require('./webpack.botGuardScript.config')

config.name = 'capacitor'
// These document-wide selectors must not invalidate desktop playback layout.
config.entry.web = [config.entry.web, path.join(__dirname, '../src/renderer/helpers/player/androidNativeScreen.css')]
botGuardConfig.name = 'capacitorBotGuardScript'
botGuardConfig.output.path = path.join(__dirname, '../dist/capacitor')

module.exports = [config, botGuardConfig]
