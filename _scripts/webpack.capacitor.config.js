process.env.IS_CAPACITOR = 'true'

const path = require('path')
const { execFileSync } = require('node:child_process')
const CopyWebpackPlugin = require('copy-webpack-plugin')
const webpack = require('webpack')
const config = require('./webpack.web.config')
const botGuardConfig = require('./webpack.botGuardScript.config')

execFileSync(process.execPath, [path.join(__dirname, 'brand/generate-app-icon-presets.mjs')])
config.plugins.push(new CopyWebpackPlugin({
  patterns: [{ from: path.join(__dirname, '../build/generated/app-icons/previews'), to: 'static/app-icons' }]
}))

config.name = 'capacitor'
// VOT uses window.crypto in WebViews; its Node fallback must stay out of this bundle.
config.plugins.push(new webpack.IgnorePlugin({ resourceRegExp: /^node:crypto$/ }))
// These document-wide selectors must not invalidate desktop playback layout.
config.entry.web = [config.entry.web, path.join(__dirname, '../src/renderer/helpers/player/androidNativeScreen.css')]
botGuardConfig.name = 'capacitorBotGuardScript'
botGuardConfig.output.path = path.join(__dirname, '../dist/capacitor')

module.exports = [config, botGuardConfig]
