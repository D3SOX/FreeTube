import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { colors } from '../helpers/colors'

export function useColorTranslations() {
  const { tm } = useI18n()

  return computed(() => {
    const translations = tm('Settings.Theme Settings.Main Color Theme')
    return colors.map(({ name }) => {
      const translationKey = name.replaceAll(/([a-z])([A-Z])/g, '$1 $2')
      return translations[translationKey] ?? translationKey
    })
  })
}
