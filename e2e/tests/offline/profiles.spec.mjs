import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { test, expect, goToSettingsSection } from '../../helpers/app.mjs'

// The main profile ('allChannels') must exist in any seeded profiles.db,
// otherwise the app would recreate the store with only the default profile.
const mainProfile = {
  _id: 'allChannels',
  name: 'All Channels',
  bgColor: '#d50000',
  textColor: '#FFFFFF',
  subscriptions: []
}

const secondProfile = {
  _id: 'e2eprofile',
  name: 'Second profile',
  bgColor: '#558B2F',
  textColor: '#FFFFFF',
  subscriptions: []
}

const profileIcon = (page) => page.locator('.topNav .profileTrigger')
const profileIconInitial = (page) => profileIcon(page).locator('.profileInitial')

async function openProfileList(page) {
  await profileIcon(page).click()
  await page.locator('.profileSummary').click()
  await expect(page.locator('.profileList')).toBeVisible()
}

test.describe('profile selector', () => {
  test.use({ seed: { profiles: [mainProfile, secondProfile] } })

  test('ignores stale profile deletion events from another window', async ({ page }) => {
    await openProfileList(page)
    await expect(page.locator('.profileList .profileOption')).toHaveCount(2)

    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('removeProfileFromList', 'missing-profile')
    })

    await expect(page.locator('.profileList .profileOption')).toHaveCount(2)
    await expect(page.locator('.profileList .profileOption').filter({ hasText: 'Second profile' })).toBeVisible()
  })

  test('ignores channel updates for profiles removed in another window', async ({ page }) => {
    const profileIds = await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const payload = {
        channel: { id: 'channel', name: 'Channel', thumbnail: '' },
        profileIds: ['missing-profile']
      }

      store.commit('addChannelToProfiles', payload)
      store.commit('removeChannelFromProfiles', {
        channelId: payload.channel.id,
        profileIds: payload.profileIds
      })

      return store.getters.getProfileList.map(profile => profile._id)
    })

    expect(profileIds).toEqual(['allChannels', 'e2eprofile'])
  })

  test('opens directly from the profile button context menu', async ({ page }) => {
    await profileIcon(page).click()
    await expect(page.locator('.profileSummaryText')).toContainText('You can also right-click the profile icon to switch profiles')
    await profileIcon(page).click()

    await profileIcon(page).click({ button: 'right' })

    await expect(page.locator('.profileList')).toBeVisible()

    await profileIcon(page).click({ button: 'right' })
    await page.locator('.topNav .logo').click()
    await expect(page.locator('.quickSettingsMenu')).toBeHidden()
  })

  test('lists seeded profiles and switches the active profile', async ({ page }) => {
    await expect(profileIconInitial(page)).toHaveText('A')

    await openProfileList(page)
    const entries = page.locator('.profileList .profileOption')
    await expect(entries).toHaveCount(2)
    await expect(entries.filter({ hasText: 'Second profile' })).toBeVisible()

    await entries.filter({ hasText: 'Second profile' }).click()
    await expect(page.locator('.quickSettingsMenu')).toHaveClass(/quick-settings-menu-leave-active/)
    await expect(page.locator('.menuSection')).toHaveCount(0)
    await expect(page.locator('.quickSettingsMenu')).toBeHidden()
    await expect(profileIconInitial(page)).toHaveText('S')
  })
})

test.describe('profile selector with a custom image', () => {
  test.use({
    seed: {
      profiles: [{
        ...mainProfile,
        icon: {
          type: 'image',
          value: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+Xw4AAAAASUVORK5CYII='
        }
      }]
    }
  })

  test('keeps the profile button centered in the top navigation', async ({ page }) => {
    await expect(profileIconInitial(page).locator('img')).toBeVisible()

    const navigationBox = await page.locator('.topNav').boundingBox()
    const profileButtonBox = await profileIcon(page).boundingBox()

    expect(profileButtonBox.y + profileButtonBox.height / 2)
      .toBeCloseTo(navigationBox.y + navigationBox.height / 2, 0)
  })
})

test.describe('default profile setting', () => {
  test.use({
    seed: {
      settings: { defaultProfile: 'e2eprofile' },
      profiles: [mainProfile, secondProfile]
    }
  })

  test('the configured default profile is active on startup', async ({ page }) => {
    await expect(profileIconInitial(page)).toHaveText('S')
  })
})

test.describe('profile channel thumbnails', () => {
  test.use({
    seed: {
      settings: { hideUnsubscribeButton: true, uiRoundness: 200 },
      profiles: [{
        ...mainProfile,
        subscriptions: [{
          id: 'UCaaaaaaaaaaaaaaaaaaaaaa',
          name: 'Deleted Channel',
          thumbnail: 'data:image/png;base64,invalid'
        }]
      }]
    }
  })

  test('uses the default avatar when a channel thumbnail fails to load', async ({ page }) => {
    await openProfileList(page)
    await page.locator('.profilePanelHeader button').last().click()
    await page.locator('.card .profileList').getByText('All Channels').click()

    const channel = page.locator('#subscriptionsPanel').getByRole('link', { name: 'Deleted Channel' })
    await expect(channel).toHaveCSS('border-radius', '16px')
    await expect(channel.locator('img.bubble')).toHaveCount(0)
    const fallbackAvatar = channel.locator('.bubble:not(img)')
    await expect(fallbackAvatar).toBeVisible()
    await expect(fallbackAvatar).toHaveCSS('font-size', '50px')
  })
})

test.describe('profile manager', () => {
  test.describe('scroll position', () => {
    test.use({
      seed: {
        profiles: [
          mainProfile,
          {
            ...secondProfile,
            subscriptions: Array.from({ length: 30 }, (_, index) => ({
              id: `channel-${index}`,
              name: `Channel ${index}`,
              thumbnail: ''
            }))
          }
        ]
      }
    })

    test('clamps the scroll position after deleting an open profile', async ({ page }) => {
      await openProfileList(page)
      await page.locator('.profilePanelHeader button').last().click()
      await page.locator('.card .profileList').getByText('Second profile').click()

      const scroller = page.locator('.settingsSubpageScroll')
      await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)

      await page.getByRole('button', { name: 'Delete Profile' }).click()
      await page.getByRole('button', { name: 'Yes, Delete' }).click()
      await expect(page.locator('.card .profileList').getByText('Second profile')).toHaveCount(0)

      await expect.poll(() => scroller.evaluate(element => {
        const content = element.firstElementChild
        const contentEnd = content.getBoundingClientRect().bottom -
          element.getBoundingClientRect().top + element.scrollTop +
          Number.parseFloat(getComputedStyle(element).paddingBottom)
        const maximumScrollTop = Math.max(0, contentEnd - element.clientHeight)
        return element.scrollTop - maximumScrollTop
      })).toBeLessThanOrEqual(1)
    })
  })

  test('a profile can be created through the UI and persists', async ({ app, page }) => {
    await openProfileList(page)
    await page.locator('.profilePanelHeader button').last().click()
    await expect(page.locator('.settingsWindow')).toBeVisible()
    await expect(page.locator('.settingsBreadcrumb')).toContainText('Profile Manager')

    await page.getByRole('button', { name: 'Create New Profile' }).click()
    await page.locator('.profileName input').fill('Created via UI')
    await page.getByRole('button', { name: 'Create Profile', exact: true }).click()

    // Both the settings page and the top-nav selector render a .profileList,
    // so scope to the settings page's profile bubbles.
    await expect(page.locator('.card .profileList').getByText('Created via UI')).toBeVisible()

    await expect.poll(async () => {
      const contents = await readFile(path.join(app.userDataDir, 'profiles.db'), 'utf8')
      const records = contents.trim().split('\n').map((line) => JSON.parse(line))
      return records.some((record) => record.name === 'Created via UI')
    }).toBe(true)

    ;({ page } = await app.relaunch())
    await openProfileList(page)
    await expect(page.locator('.profileList .profileOption').filter({ hasText: 'Created via UI' })).toBeVisible()
  })

  test.describe('theme color profiles', () => {
    test.use({ seed: { settings: { mainColor: 'Green' } } })

    test('keeps a keyboard-selected swatch when the custom picker was open', async ({ app, page }) => {
      await openProfileList(page)
      await page.locator('.profilePanelHeader button').last().click()
      await page.locator('.card .profileList').getByText('All Channels').click()
      await page.locator('.themeColorOption').click()
      await page.locator('.profileColorPicker .colorFieldTrigger').click()

      const redSwatch = page.locator('.colorOptions .colorOption').nth(1)
      await redSwatch.focus()
      await redSwatch.press('Enter')
      await expect(page.locator('.colorPickerPopover')).toHaveCount(0)
      await expect(page.locator('.profilePreviewIcon')).toHaveCSS('background-color', 'rgb(213, 0, 0)')

      await page.getByRole('button', { name: 'Update Profile' }).click()
      await expect.poll(async () => {
        const contents = await readFile(path.join(app.userDataDir, 'profiles.db'), 'utf8')
        const records = contents.trim().split('\n').map(line => JSON.parse(line))
        const profile = records.findLast(record => record._id === 'allChannels' && !record.$$deleted)
        return profile?.bgColor
      }).toBe('#d50000')
    })

    test('follows the theme color when the theme color option is picked', async ({ app, page }) => {
      await openProfileList(page)
      await page.locator('.profilePanelHeader button').last().click()
      await page.locator('.card .profileList').getByText('All Channels').click()

      await page.locator('.themeColorOption').click()

      // 'Green' is the seeded main color theme
      const preview = page.locator('.profilePreviewIcon')
      await expect(preview).toHaveCSS('background-color', 'rgb(76, 175, 80)')

      await page.locator('.profileColorPicker .colorFieldTrigger').click()
      const colorPicker = page.locator('.colorPickerPopover')
      await colorPicker.locator('input[type="text"]').fill('#123456')
      await colorPicker.locator('input[type="text"]').press('Enter')
      await page.getByRole('heading', { name: 'Profile Preview' }).click()
      await expect(preview).toHaveCSS('background-color', 'rgb(76, 175, 80)')

      await page.locator('.profileColorPicker .colorFieldTrigger').click()
      await page.evaluate(() => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        return store.dispatch('updateMainColor', 'Orange')
      })
      await expect(preview).toHaveCSS('background-color', 'rgb(255, 152, 0)')
      await page.getByRole('heading', { name: 'Profile Preview' }).click()
      await expect(preview).toHaveCSS('background-color', 'rgb(255, 152, 0)')

      await page.getByRole('button', { name: 'Update Profile' }).click()

      await expect.poll(async () => {
        const contents = await readFile(path.join(app.userDataDir, 'profiles.db'), 'utf8')
        const records = contents.trim().split('\n').map(line => JSON.parse(line))
        const profile = records.findLast(record => record._id === 'allChannels' && !record.$$deleted)
        return profile?.bgColor
      }).toBe('var(--primary-color)')

      ;({ page } = await app.relaunch())
      // the profile keeps the resolved theme color after restart
      await expect(profileIconInitial(page)).toHaveCSS('background-color', 'rgb(255, 152, 0)')
      // switching the theme color has to repaint the profile, without touching the profile itself
      await goToSettingsSection(page, 'theme')

      // the labels are translated, so find the main color select and its 'Blue'
      // option through the values of the hidden native select instead
      const mainColorSelect = page.locator('.settingsContent .select')
        .filter({ has: page.locator('select option[value="Blue"]') })
        .first()
      const blueIndex = await mainColorSelect.locator('option[value="Blue"]').evaluate(option => option.index)
      await mainColorSelect.getByRole('combobox').click()
      await page.locator('.selectDropdown .selectOption').nth(blueIndex).click()
      await expect(profileIconInitial(page)).toHaveCSS('background-color', 'rgb(33, 150, 243)')
    })
  })

  test.describe('shorthand theme color profiles', () => {
    test.use({ seed: { settings: { baseTheme: 'hotPink' } } })

    test('preserves the theme color when cancelling picker changes', async ({ app, page }) => {
      await openProfileList(page)
      await page.locator('.profilePanelHeader button').last().click()
      await page.locator('.card .profileList').getByText('All Channels').click()
      await page.locator('.themeColorOption').click()

      const preview = page.locator('.profilePreviewIcon')
      await expect(preview).toHaveCSS('background-color', 'rgb(0, 0, 0)')

      await page.locator('.profileColorPicker .colorFieldTrigger').click()
      const colorPicker = page.locator('.colorPickerPopover')
      await colorPicker.locator('input[type="text"]').fill('#123456')
      await colorPicker.locator('input[type="text"]').press('Enter')
      await page.getByRole('heading', { name: 'Profile Preview' }).click()
      await page.getByRole('button', { name: 'Update Profile' }).click()

      await expect.poll(async () => {
        const contents = await readFile(path.join(app.userDataDir, 'profiles.db'), 'utf8')
        const records = contents.trim().split('\n').map(line => JSON.parse(line))
        const profile = records.findLast(record => record._id === 'allChannels' && !record.$$deleted)
        return profile?.bgColor
      }).toBe('var(--primary-color)')
    })
  })

  test('applies opaque black to an image profile that was transparent', async ({ app, page }) => {
    await openProfileList(page)
    await page.locator('.profilePanelHeader button').last().click()
    await page.locator('.card .profileList').getByText('All Channels').click()

    await page.locator('.imageInput').setInputFiles({
      name: 'globe.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="10"/></svg>')
    })
    await page.getByRole('button', { name: 'Apply Crop' }).click()

    await page.locator('.profileColorPicker .colorFieldTrigger').click()
    const colorPicker = page.locator('.colorPickerPopover')
    await colorPicker.locator('input[type="text"]').fill('#000000')
    await colorPicker.locator('input[type="text"]').press('Enter')
    await colorPicker.getByRole('button', { name: 'Apply' }).click()
    await expect(page.locator('.profilePreviewIcon')).toHaveCSS('background-color', 'rgb(0, 0, 0)')

    await page.getByRole('button', { name: 'Update Profile' }).click()
    await expect.poll(async () => {
      const contents = await readFile(path.join(app.userDataDir, 'profiles.db'), 'utf8')
      const records = contents.trim().split('\n').map(line => JSON.parse(line))
      return records.findLast(record => record._id === 'allChannels' && !record.$$deleted)?.bgColor
    }).toBe('#000000')
  })

  test('customizes a profile icon with a cropped SVG or emoji', async ({ app, page }) => {
    await openProfileList(page)
    await page.locator('.profilePanelHeader button').last().click()
    await page.locator('.card .profileList').getByText('All Channels').click()

    const makeDefaultButton = page.getByRole('button', { name: 'Make Default Profile' })
    await expect(makeDefaultButton).toBeDisabled()
    await expect(page.locator('.colorOption.selected')).toHaveCount(1)

    await page.locator('.imageInput').setInputFiles({
      name: 'globe.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="currentColor"/></svg>')
    })
    await expect(page.getByRole('heading', { name: 'Crop Image' })).toBeVisible()
    const zoom = page.locator('.cropZoom').getByRole('slider')
    const zoomLabel = page.locator('.cropZoom .label')
    await zoomLabel.evaluate(element => Promise.all(
      element.closest('.promptCard').getAnimations().map(animation => animation.finished)
    ))
    for (const scale of [1, 0.95]) {
      await page.evaluate(value => window.ftElectron.setZoomFactor(value), scale)
      await zoom.fill('1')
      const initialWidth = (await zoomLabel.boundingBox()).width
      for (const value of ['1.01', '2.5', '4', '1']) {
        await zoom.fill(value)
        await expect.poll(async () => (await zoomLabel.boundingBox()).width)
          .toBeCloseTo(initialWidth, 0)
        await expect(zoomLabel).toContainText(Number(value).toFixed(2))
      }
    }
    await page.evaluate(() => window.ftElectron.setZoomFactor(1))
    await page.getByRole('button', { name: 'Apply Crop' }).click()

    const preview = page.locator('.profilePreviewIcon')
    await expect(preview.locator('img')).toBeVisible()
    await expect(preview).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')

    await page.locator('.profileColorPicker .colorFieldTrigger').click()
    const colorPicker = page.locator('.colorPickerPopover')
    await colorPicker.locator('input[type="text"]').fill('#123456')
    await colorPicker.locator('input[type="text"]').press('Enter')
    await page.getByRole('heading', { name: 'Profile Preview' }).click()
    await expect(preview).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')

    await page.getByRole('button', { name: 'Update Profile' }).click()

    await expect.poll(async () => {
      const contents = await readFile(path.join(app.userDataDir, 'profiles.db'), 'utf8')
      const records = contents.trim().split('\n').map(line => JSON.parse(line))
      const profile = records.findLast(record => record._id === 'allChannels' && !record.$$deleted)
      return profile?.icon?.type === 'image' && profile.bgColor === 'transparent'
    }).toBe(true)

    const customEmoji = page.locator('#profileEmoji')
    await customEmoji.fill('A')
    await expect(customEmoji).toHaveValue('')
    await expect(preview.locator('img')).toBeVisible()

    await page.locator('.profileColorPicker .colorFieldTrigger').click()
    await colorPicker.locator('input[type="text"]').fill('#123456')
    await colorPicker.locator('input[type="text"]').press('Enter')
    await customEmoji.fill('❤')
    await expect(customEmoji).toHaveValue('❤')
    await expect(preview).toContainText('❤')
    await expect(preview).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')

    await customEmoji.fill('🌍')
    await expect(preview.locator('img')).toHaveCount(0)
    await expect(preview).toContainText('🌍')
    await expect(preview).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await page.getByRole('button', { name: 'Update Profile' }).click()

    await expect.poll(async () => {
      const contents = await readFile(path.join(app.userDataDir, 'profiles.db'), 'utf8')
      const records = contents.trim().split('\n').map(line => JSON.parse(line))
      const profile = records.findLast(record => record._id === 'allChannels' && !record.$$deleted)
      return profile?.icon?.value === '🌍' && profile.bgColor !== 'transparent'
    }).toBe(true)
  })
})
