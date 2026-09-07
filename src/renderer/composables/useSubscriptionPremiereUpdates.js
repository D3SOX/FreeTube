import { onActivated, onBeforeUnmount, onDeactivated, onMounted, watch } from 'vue'

import { refreshSubscriptionPremieres } from '../helpers/subscriptions'
import { useTabContext } from '../tabs/TabContext'

const POLL_INTERVAL_MS = 60_000

export function useSubscriptionPremiereUpdates() {
  const { isTabPresented } = useTabContext()
  let active = false
  let timer = null
  let generation = 0

  function stop() {
    generation++
    clearTimeout(timer)
    timer = null
  }

  function schedule() {
    stop()
    if (!active || isTabPresented?.value === false || document.hidden) return
    const currentGeneration = generation
    const isCurrent = () => active && generation === currentGeneration
    timer = setTimeout(async () => {
      timer = null
      try {
        await refreshSubscriptionPremieres(isCurrent)
      } finally {
        if (isCurrent()) schedule()
      }
    }, POLL_INTERVAL_MS)
  }

  function start() {
    active = true
    schedule()
  }

  onMounted(() => {
    document.addEventListener('visibilitychange', schedule)
    start()
  })
  onActivated(start)
  onDeactivated(() => {
    active = false
    stop()
  })
  if (isTabPresented !== null) watch(isTabPresented, schedule)
  onBeforeUnmount(() => {
    active = false
    stop()
    document.removeEventListener('visibilitychange', schedule)
  })
}
