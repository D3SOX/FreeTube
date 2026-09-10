const path = require('path')
const { readFileSync, readdirSync } = require('fs')
const webpack = require('webpack')
const HtmlWebpackPlugin = require('html-webpack-plugin')
const { VueLoaderPlugin } = require('vue-loader')
const MiniCssExtractPlugin = require('mini-css-extract-plugin')
const CssMinimizerPlugin = require('css-minimizer-webpack-plugin')
const ProcessLocalesPlugin = require('./ProcessLocalesPlugin')
const CopyWebpackPlugin = require('copy-webpack-plugin')
const {
  SHAKA_LOCALE_MAPPINGS,
  SHAKA_LOCALES_PREBUNDLED,
  SHAKA_LOCALES_TO_BE_BUNDLED
} = require('./getShakaLocales')

const isDevMode = process.env.NODE_ENV === 'development'
const rendererPlatform = process.platform

for (const [name, requestedPlatform] of [
  ['OTX_PLATFORM', process.env.OTX_PLATFORM],
  ['npm_config_platform', process.env.npm_config_platform]
]) {
  if (requestedPlatform && requestedPlatform !== rendererPlatform) {
    throw new Error(`${name}=${requestedPlatform} does not match the packager platform ${rendererPlatform}`)
  }
}

const { version: swiperVersion } = JSON.parse(readFileSync(path.join(__dirname, '../node_modules/swiper/package.json')))

const processLocalesPlugin = new ProcessLocalesPlugin({
  compress: !isDevMode,
  hotReload: isDevMode,
  inputDir: path.join(__dirname, '../static/locales'),
  outputDir: 'static/locales',
})

const processAILocalesPlugin = new ProcessLocalesPlugin({
  activeLocales: processLocalesPlugin.activeLocales,
  allowMissing: true,
  collectMetadata: false,
  compress: !isDevMode,
  hotReload: isDevMode,
  inputDir: path.join(__dirname, '../static/locales/ai'),
  localeSource: 'ai',
  outputDir: 'static/locales/ai',
})

/** @type {import('webpack').Configuration} */
const config = {
  name: 'renderer',
  mode: process.env.NODE_ENV,
  devtool: isDevMode ? 'eval-cheap-module-source-map' : false,
  entry: {
    renderer: path.join(__dirname, '../src/renderer/main.js'),
  },
  infrastructureLogging: {
    // Only warnings and errors
    // level: 'none' disable logging
    // Please read https://webpack.js.org/configuration/other-options/#infrastructurelogginglevel
    level: isDevMode ? 'info' : 'none'
  },
  output: {
    scriptType: 'text/javascript',
    path: path.join(__dirname, '../dist'),
    filename: '[name].js',
  },
  // The renderer is loaded from the local Electron package, so Webpack's
  // 250 kB web-delivery budget is not representative. Keep a realistic limit
  // so unexpected bundle growth still produces a warning.
  performance: {
    maxAssetSize: 4 * 1024 * 1024,
    maxEntrypointSize: 4 * 1024 * 1024
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        use: 'babel-loader',
        exclude: /node_modules/,
      },
      {
        test: /\.vue$/,
        loader: 'vue-loader',
        options: {
          compilerOptions: {
            isCustomElement: (tag) => tag === 'swiper-container' || tag === 'swiper-slide'
          }
        }
      },
      {
        test: /\.scss$/,
        use: [
          {
            loader: MiniCssExtractPlugin.loader,
          },
          {
            loader: 'css-loader',
            options: {
              esModule: false
            }
          },
          {
            loader: 'sass-loader',
            options: {
              implementation: require('sass')
            }
          },
        ],
      },
      {
        test: /\.css$/,
        use: [
          {
            loader: MiniCssExtractPlugin.loader
          },
          {
            loader: 'css-loader',
            options: {
              esModule: false
            }
          }
        ],
        rules: [
          {
            resource: path.resolve(__dirname, '../node_modules/shaka-player/dist/controls.css'),
            use: path.join(__dirname, 'patch-shaka-player-loader.js')
          }
        ],
      },
      {
        test: /\.(png|jpe?g|gif|tif?f|bmp|webp|svg)(\?.*)?$/,
        type: 'asset/resource',
        generator: {
          filename: 'imgs/[name][ext]'
        }
      },
      {
        test: /\.(woff2?|eot|ttf|otf)(\?.*)?$/,
        type: 'asset/resource',
        generator: {
          filename: 'fonts/[name][ext]'
        }
      },
    ],
    generator: {
      json: {
        JSONParse: false
      }
    }
  },
  // webpack defaults to only optimising the production builds, so having this here is fine
  optimization: {
    minimizer: [
      '...', // extend webpack's list instead of overwriting it
      new CssMinimizerPlugin()
    ]
  },
  node: {
    __dirname: false,
    __filename: false
  },
  plugins: [
    processLocalesPlugin,
    processAILocalesPlugin,
    new webpack.DefinePlugin({
      // build.mjs packages for the host OS, so reject mismatched target hints
      // above instead of compiling renderer behavior for a different platform.
      'process.platform': JSON.stringify(rendererPlatform),
      'process.env.IS_ELECTRON': true,
      'process.env.IS_ELECTRON_MAIN': false,
      'process.env.IS_CAPACITOR': false,
      'process.env.SUPPORTS_LOCAL_API': true,
      'process.env.BUILD_COMMIT': JSON.stringify(process.env.GITHUB_SHA ?? ''),
      __VUE_OPTIONS_API__: 'true',
      __VUE_PROD_DEVTOOLS__: 'false',
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
      __VUE_I18N_LEGACY_API__: 'false',
      __VUE_I18N_FULL_INSTALL__: 'false',
      __INTLIFY_PROD_DEVTOOLS__: 'false',
      'process.env.LOCALE_NAMES': JSON.stringify(processLocalesPlugin.localeNames),
      'process.env.LOCALE_TRANSLATION_PERCENTAGES': JSON.stringify(processLocalesPlugin.localeTranslationPercentages),
      'process.env.AI_LOCALES': JSON.stringify([...processAILocalesPlugin.locales.keys()]),
      'process.env.GEOLOCATION_NAMES': JSON.stringify(readdirSync(path.join(__dirname, '..', 'static', 'geolocations')).map(filename => filename.replace('.json', ''))),
      'process.env.SWIPER_VERSION': `'${swiperVersion}'`,
      'process.env.SHAKA_LOCALE_MAPPINGS': JSON.stringify(SHAKA_LOCALE_MAPPINGS),
      'process.env.SHAKA_LOCALES_PREBUNDLED': JSON.stringify(SHAKA_LOCALES_PREBUNDLED)
    }),
    new HtmlWebpackPlugin({
      filename: 'index.html',
      template: path.resolve(__dirname, '../src/index.ejs'),
      templateParameters: {
        startupSplash: {
          styles: readFileSync(path.join(__dirname, '../src/renderer/startup/splash.css'), 'utf8'),
          script: readFileSync(path.join(__dirname, '../src/renderer/startup/boot.js'), 'utf8'),
          logo: readFileSync(path.join(__dirname, '../_icons/iconColorSmall.svg'), 'utf8').replaceAll('#212121', 'currentColor')
        }
      }
    }),
    new VueLoaderPlugin(),
    new MiniCssExtractPlugin({
      filename: isDevMode ? '[name].css' : '[name].[contenthash].css',
      chunkFilename: isDevMode ? '[id].css' : '[id].[contenthash].css',
      // Route-level chunks can discover scoped Vue styles in different orders.
      // Their selectors cannot affect one another, so no global order is needed.
      ignoreOrder: true,
    }),
    new CopyWebpackPlugin({
      patterns: [
        {
          from: path.join(__dirname, '../node_modules/swiper/modules/{a11y,navigation,pagination}-element.css').replaceAll('\\', '/'),
          to: `swiper-${swiperVersion}.css`,
          context: path.join(__dirname, '../node_modules/swiper/modules'),
          transformAll: (assets) => {
            return Buffer.concat(assets.map(asset => asset.data))
          }
        },
        // Don't need to copy them in dev mode,
        // as we configure WebpackDevServer to serve them
        ...(isDevMode
          ? []
          : [
              {
                from: path.join(__dirname, '../node_modules/shaka-player/ui/locales', `{${SHAKA_LOCALES_TO_BE_BUNDLED.join(',')}}.json`).replaceAll('\\', '/'),
                to: 'static/shaka-player-locales',
                context: path.join(__dirname, '../node_modules/shaka-player/ui/locales'),
                transform: {
                  transformer: (input) => {
                    return JSON.stringify(JSON.parse(input.toString('utf-8')))
                  }
                }
              }
            ])
      ]
    })
  ],
  resolve: {
    fallback: {
      // @hpke/core prefers Web Crypto in supported browsers. Its old-Node
      // fallback is unreachable in Electron's renderer and must not be bundled.
      crypto: false
    },
    alias: {
      '@root': path.resolve(__dirname, '..'),
      DB_HANDLERS_ELECTRON_RENDERER_OR_WEB$: path.resolve(__dirname, '../src/datastores/handlers/electron.js'),

      'youtubei.js$': 'youtubei.js/web',

      // change to "shaka-player.ui-es2021.debug.js" to get debug logs (update jsconfig to get updated types)
      'shaka-player$': 'shaka-player/dist/shaka-player.ui-es2021.js',

      '@opentubex/icons$': path.resolve(__dirname, '../src/renderer/icons/iconComponents.js'),

      // Fix dompurify not being tree-shaking friendly
      dompurify$: path.resolve(__dirname, '_undefinedDefaultExport.mjs')
    },
    extensions: ['.js', '.vue']
  },
  target: 'web',
}

if (isDevMode) {
  // hack to pass it through to the dev-runner.js script
  // gets removed there before the config object is passed to webpack
  config.SHAKA_LOCALES_TO_BE_BUNDLED = SHAKA_LOCALES_TO_BE_BUNDLED
}

module.exports = config
