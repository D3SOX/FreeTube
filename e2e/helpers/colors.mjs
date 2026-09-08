export async function sampleColors(app, region, points) {
  const { page } = app
  await region.scrollIntoViewIfNeeded()
  await page.evaluate(async () => {
    document.getAnimations().forEach(animation => {
      if (animation.effect.getComputedTiming().iterations !== Infinity) animation.finish()
    })
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
  const origin = await region.evaluate(element => { const { x, y } = element.getBoundingClientRect(); return { x, y } })
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  // Capture Electron's actual zoomed framebuffer; Playwright's screenshot
  // viewport emulation changes the pixel mapping at non-default UI scales.
  const base64 = await app.electronApp.evaluate(async ({ BrowserWindow }) =>
    (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'))
  return page.evaluate(async ({ base64, points, origin, viewport }) => {
    const bitmap = await createImageBitmap(new Blob([
      Uint8Array.from(atob(base64), character => character.charCodeAt(0))
    ], { type: 'image/png' }))
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const context = canvas.getContext('2d')
    context.drawImage(bitmap, 0, 0)
    const colors = points.map(([x, y]) =>
      [...context.getImageData(Math.floor((x + origin.x) * bitmap.width / viewport.width), Math.floor((y + origin.y) * bitmap.height / viewport.height), 1, 1).data].slice(0, 3))
    bitmap.close()
    return colors
  }, { base64, points, origin, viewport })
}
