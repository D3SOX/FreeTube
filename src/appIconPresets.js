import { BASE_THEME_BACKGROUND_COLORS, BUILTIN_BASE_THEME_VALUES, BUILTIN_BASE_THEME_TRANSLATION_KEYS } from './constants.js'

// Representative palettes. Closely related contrast variants share a preset.
const PRESET_COLORS = {
  light: '#212121',
  dark: '#ffffff',
  black: '#ffffff',
  openTubeXLight: '#007f73',
  openTubeXDark: '#52d6c4',
  nordic: '#88c0d0',
  hotPink: '#000000',
  pastelPink: '#9c4066',
  catppuccinFrappe: '#ca9ee6',
  catppuccinLatte: '#8839ef',
  catppuccinMacchiato: '#c6a0f6',
  catppuccinMocha: '#cba6f7',
  dracula: '#bd93f9',
  everforestDarkMedium: '#a7c080',
  everforestLightMedium: '#5c6a45',
  gruvboxDark: '#fabd2f',
  gruvboxLight: '#af3a03',
  solarizedDark: '#2aa198',
  solarizedLight: '#268bd2',
  tokyoNightNight: '#7aa2f7',
  tokyoNightDay: '#34548a',
  rosePine: '#ebbcba',
  rosePineDawn: '#907aa9',
  kanagawaWave: '#dca561',
  kanagawaLotus: '#624c83',
  ayuDark: '#ffb454',
  ayuMirage: '#ffcc66',
  ayuLight: '#a66a00',
  oneDark: '#61afef',
  carbonfox: '#78a9ff',
}

export const APP_ICON_PRESETS = [
  { id: 'default', translationKey: null },
  ...Object.entries(PRESET_COLORS).map(([id, foreground]) => ({
    id,
    foreground,
    background: BASE_THEME_BACKGROUND_COLORS[id],
    translationKey: BUILTIN_BASE_THEME_TRANSLATION_KEYS[BUILTIN_BASE_THEME_VALUES.indexOf(id)],
  }))
]
