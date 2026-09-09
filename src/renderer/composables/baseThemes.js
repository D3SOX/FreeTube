import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { BUILTIN_BASE_THEME_TRANSLATION_KEYS } from '../../constants'

export function useBaseThemeNames(includeSystem = true) {
  const { tm } = useI18n()
  const keys = includeSystem ? BUILTIN_BASE_THEME_TRANSLATION_KEYS : BUILTIN_BASE_THEME_TRANSLATION_KEYS.slice(1)

  return computed(() => {
    const translations = tm('Settings.Theme Settings.Base Theme')
    return keys.map(key => translations[key] ?? key)
  })
}
