/**
 * DASH/SABR use the main role; HLS uses the primary flag from DEFAULT=YES.
 * @param {shaka.extern.Track[]} variants
 * @returns {shaka.extern.Track[]}
 */
export function getDefaultAudioVariants(variants) {
  const main = variants.filter(variant => variant.audioRoles.includes('main'))
  if (main.length > 0) return main

  const primary = variants.filter(variant => variant.primary)
  return primary.length > 0 ? primary : variants
}
