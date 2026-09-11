import { onBeforeUnmount, ref } from 'vue'

// Use compact controls when either dimension leaves little room for popups.
export const PHONE_LAYOUT_QUERY = '(max-width: 600px), (max-height: 600px)'

export function usePhoneLayout(mediaQuery = PHONE_LAYOUT_QUERY) {
  const query = window.matchMedia(mediaQuery)
  const phoneLayout = ref(query.matches)
  const update = () => { phoneLayout.value = query.matches }
  query.addEventListener('change', update)
  onBeforeUnmount(() => query.removeEventListener('change', update))
  return phoneLayout
}
