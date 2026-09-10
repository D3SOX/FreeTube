import { shallowRef } from 'vue'

/** @type {import('vue').ShallowRef<Map<string, { id: string, name: string, reasons: string[], trace: string }> | null>} */
export const subscriptionRefreshErrors = shallowRef(null)
