/**
 * YouTube can mark every HLS audio rendition DEFAULT=NO. Its content IDs
 * still identify the original track with suffix .4, as in the local API.
 * @param {string} manifest
 * @returns {string}
 */
export function preferOriginalHlsAudio(manifest) {
  const lines = manifest.split('\n')
  const audioTags = new Map()
  const originalGroups = new Set()

  for (const [index, line] of lines.entries()) {
    if (!line.startsWith('#EXT-X-MEDIA:')) continue

    // Quoted names and URIs can contain commas.
    const attributes = new Map([...line.slice(13).trimEnd().matchAll(/(?:^|,)([\w-]+)=("[^"]*"|[^,]*)/g)]
      .map(([, key, value]) => [key, value]))
    if (attributes.get('TYPE') !== 'AUDIO') continue

    const group = attributes.get('GROUP-ID')
    if (!group) continue

    const original = attributes.get('YT-EXT-AUDIO-CONTENT-ID')?.endsWith('.4"') ?? false
    audioTags.set(index, { attributes, group, original })
    if (original) originalGroups.add(group)
  }

  for (const [index, { attributes, group, original }] of audioTags) {
    if (!originalGroups.has(group)) continue

    attributes.set('DEFAULT', original ? 'YES' : 'NO')
    if (original) attributes.set('AUTOSELECT', 'YES')
    lines[index] = '#EXT-X-MEDIA:' + [...attributes].map(([key, value]) => `${key}=${value}`).join(',')
  }

  return lines.join('\n')
}
