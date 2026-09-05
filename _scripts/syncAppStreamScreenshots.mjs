import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const views = [
  'The main OpenTubeX window',
  'Watching a video',
  'Settings',
]
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

/** Replace only the screenshot gallery, preserving the package's other metadata. */
export async function syncAppStreamScreenshots(metainfo, revision) {
  if (revision !== 'development' && !/^v[0-9]+\.[0-9]+\.[0-9]+-beta$/.test(revision)) {
    throw new Error('Screenshot reference must be development or a beta release tag')
  }
  const blocks = [...metainfo.matchAll(/<screenshots>[^]*?<\/screenshots>/g)]
  if (blocks.length !== 1) {
    throw new Error('Expected exactly one AppStream screenshots block')
  }

  const screenshots = []
  for (const [index, caption] of views.entries()) {
    for (const theme of ['dark', 'light']) {
      const filename = `OpenTubeX${index + 1}-${theme}.png`
      const png = await readFile(new URL(`../docs/screenshots/${filename}`, import.meta.url))
      if (png.length < 24 || !png.subarray(0, 8).equals(pngSignature) ||
        png.toString('ascii', 12, 16) !== 'IHDR') {
        throw new Error(`Invalid PNG screenshot: ${filename}`)
      }
      const width = png.readUInt32BE(16)
      const height = png.readUInt32BE(20)
      if (width === 0 || height === 0) {
        throw new Error(`Invalid PNG dimensions: ${filename}`)
      }
      const type = screenshots.length === 0 ? ' type="default"' : ''
      const url = `https://raw.githubusercontent.com/OpenTubeX/OpenTubeX/${revision}/docs/screenshots/${filename}`
      screenshots.push(`    <screenshot${type}>
      <caption>${caption} (${theme} theme)</caption>
      <image type="source" width="${width}" height="${height}">${url}</image>
    </screenshot>`)
    }
  }

  return metainfo.replace(blocks[0][0], `<screenshots>\n${screenshots.join('\n')}\n  </screenshots>`)
}

async function main() {
  const [metainfoPath, revision, ...extra] = process.argv.slice(2)
  if (!metainfoPath || !revision || extra.length > 0) {
    throw new Error('Usage: syncAppStreamScreenshots.mjs METAINFO_XML SCREENSHOT_REF')
  }
  const metainfo = await readFile(metainfoPath, 'utf8')
  const updated = await syncAppStreamScreenshots(metainfo, revision)
  if (updated !== metainfo) {
    await writeFile(metainfoPath, updated)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
