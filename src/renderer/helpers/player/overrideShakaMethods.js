/** Override exported methods and their compiled aliases on one Shaka instance. */
export function overrideShakaMethods(instance, methods) {
  const originals = new Map()
  const prototype = Object.getPrototypeOf(instance)
  const names = Object.getOwnPropertyNames(prototype)
  for (const [name, replacement] of Object.entries(methods)) {
    const original = instance[name]
    for (const alias of new Set([name, ...names.filter(alias => (
      typeof original === 'function' && Object.getOwnPropertyDescriptor(prototype, alias)?.value === original
    ))])) {
      if (!originals.has(alias)) originals.set(alias, Object.getOwnPropertyDescriptor(instance, alias))
      instance[alias] = replacement
    }
  }
  return () => {
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(instance, name, descriptor)
      else delete instance[name]
    }
  }
}
