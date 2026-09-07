import { ytDlp } from './ytDlp'
import {
  DefaultKeyboardShortcuts,
  getConfiguredKeyboardShortcuts,
  KeyboardShortcuts,
} from '../../constants'
import { createSettingsSearchIndex } from './settingsSearch'
import { isMostPopularAvailable, isTrendingAvailable } from '../../navigationAvailability'
import { getTabAvatarUrl, getTabPageIcon } from '../tabs/tabPreview'
import { switchActiveProfile, translateProfileName } from './profileSwitching'
import { getFirstCharacter } from './strings'
import { shouldShowKeyboardShortcutCommand } from './commandPalette'

const SETTINGS_SECTIONS = [
  ['general', 'Settings.General Settings.General Settings', 'Settings.Categories.General Description', ['preferences', 'options']],
  ['appearance', 'Settings.Categories.Appearance', 'Settings.Categories.Appearance Description', ['theme', 'display']],
  ['playback', 'Settings.Quick Settings.Playback', 'Settings.Categories.Playback Description', ['player', 'video']],
  ['add-ons', 'Settings.Categories.Add-ons', 'Settings.Categories.Add-ons Description', ['addons', 'extensions', 'sponsorblock']],
  ['subscriptions', 'Subscriptions.Subscriptions', 'Settings.Categories.Subscriptions Description', ['feeds', 'channels']],
  ['download', 'Settings.Download Settings.Download Settings', 'Settings.Categories.Downloads Description', ['yt-dlp', 'files']],
  ['focus', 'Settings.Distraction Free Settings.Distraction Free Settings', 'Settings.Categories.Distraction Free Description', ['distraction free', 'hide']],
  ['privacy', 'Settings.Privacy Settings.Privacy Settings', 'Settings.Categories.Privacy Description', ['history', 'security']],
  ['data', 'Settings.Data Settings.Data Settings', 'Settings.Categories.Data Description', ['import', 'export', 'backup']],
  ['sync', 'Settings.Sync Settings.Sync Settings', 'Settings.Categories.Sync Description', ['account', 'server']],
  ['advanced', 'Settings.Categories.Advanced', 'Settings.Categories.Advanced Description', ['proxy', 'experimental', 'external player']],
]

const PLAYBACK_COMMANDS = [
  ['playback.play', 'PLAYBACK', 'PLAY', 'KeyboardShortcutPrompt.Play', ['fas', 'play'], ['pause', 'resume']],
  ['playback.mute', 'GENERAL', 'MUTE', 'KeyboardShortcutPrompt.Mute', ['fas', 'volume-high'], ['audio', 'sound']],
  ['playback.captions', 'GENERAL', 'CAPTIONS', 'KeyboardShortcutPrompt.Captions', ['fas', 'closed-captioning'], ['subtitles', 'cc']],
  ['playback.fullscreen', 'GENERAL', 'FULLSCREEN', 'KeyboardShortcutPrompt.Fullscreen', ['fas', 'expand'], ['full screen']],
  ['playback.theatre', 'GENERAL', 'THEATRE_MODE', 'KeyboardShortcutPrompt.Theatre Mode', ['fas', 'display'], ['theater']],
  ['playback.fullwindow', 'GENERAL', 'FULLWINDOW', 'KeyboardShortcutPrompt.Full Window', ['fas', 'expand'], ['full window']],
  ['playback.pip', 'GENERAL', 'PICTURE_IN_PICTURE', 'KeyboardShortcutPrompt.Picture in Picture', ['fas', 'clone'], ['pip', 'picture-in-picture']],
  ['playback.rewind', 'PLAYBACK', 'LARGE_REWIND', 'KeyboardShortcutPrompt.Large Rewind', ['fas', 'step-backward'], ['back', '10 seconds']],
  ['playback.forward', 'PLAYBACK', 'LARGE_FAST_FORWARD', 'KeyboardShortcutPrompt.Large Fast Forward', ['fas', 'forward'], ['skip', '10 seconds']],
  ['playback.previous', 'PLAYBACK', 'SKIP_TO_PREV', 'KeyboardShortcutPrompt.Skip to Previous Video', ['fas', 'step-backward'], ['previous video']],
  ['playback.next', 'PLAYBACK', 'SKIP_TO_NEXT', 'KeyboardShortcutPrompt.Skip to Next Video', ['fas', 'step-forward'], ['next video']],
  ['playback.screenshot', 'GENERAL', 'TAKE_SCREENSHOT', 'KeyboardShortcutPrompt.Take Screenshot', ['fas', 'file-image'], ['capture']],
]

/**
 * Creates the live registry for the current tab. Actions remain small wrappers
 * around the app's existing navigation, store, and shortcut handlers.
 * @param {object} context
 * @returns {Array<object>}
 */
export function createCommandPaletteRegistry(context) {
  const {
    t,
    tm,
    locale,
    routePath,
    store,
    isElectron,
    isCapacitor,
    hardwareKeyboardAttached,
    navigate,
    openSettingsSection,
    openSettingsSearchResult,
    openSettingsView,
    goHistory,
    openFindbar,
    focusSearch,
    showKeyboardShortcuts,
    createTab,
    closeTabs,
    reloadTabs,
    runShortcut,
    createWindow,
    routeAvailable,
    supportsLocalApi,
    isMac,
    isLinuxWayland,
    systemUsesDarkTheme,
  } = context

  const groups = {
    app: t('CommandPalette.Groups.App'),
    navigation: t('CommandPalette.Groups.Navigation'),
    settings: t('Settings.Settings'),
    tabs: t('CommandPalette.Groups.Tabs'),
    profiles: t('Settings.Sync Settings.Profiles'),
    playlists: t('Playlists'),
    downloads: t('Settings.Download Settings.Download Settings'),
    playback: t('Settings.Quick Settings.Playback'),
  }
  const commands = []
  const configuredShortcuts = getConfiguredKeyboardShortcuts(store.getters.getKeyboardShortcuts)
  const appShortcuts = configuredShortcuts.APP.GENERAL
  const videoShortcuts = configuredShortcuts.VIDEO_PLAYER

  if (shouldShowKeyboardShortcutCommand({ isCapacitor, hardwareKeyboardAttached })) {
    commands.push(command('app.shortcuts', t('KeyboardShortcutPrompt.Show Keyboard Shortcuts'), groups.app, {
      aliases: ['hotkeys', 'key bindings'],
      icon: ['fas', 'keyboard'],
      shortcut: appShortcuts.SHOW_SHORTCUTS,
      run: showKeyboardShortcuts,
    }))
  }

  commands.push(
    command('app.find', t('KeyboardShortcutPrompt.Find in Page'), groups.app, {
      aliases: ['search page', 'text'],
      icon: ['fas', 'magnifying-glass'],
      shortcut: appShortcuts.FIND_IN_PAGE,
      run: openFindbar,
    }),
    command('app.focus-search', t('KeyboardShortcutPrompt.Focus Search'), groups.app, {
      aliases: ['search videos', 'address bar'],
      icon: ['fas', 'magnifying-glass'],
      shortcut: appShortcuts.FOCUS_SEARCH,
      run: focusSearch,
    })
  )

  if (!isCapacitor) {
    commands.push(command('app.new-window', t('KeyboardShortcutPrompt.New Window'), groups.app, {
      aliases: ['open window'],
      icon: ['fas', 'clone'],
      shortcut: appShortcuts.NEW_WINDOW,
      run: createWindow,
    }))
  }

  addNavigationCommands(commands, {
    t,
    groups,
    navigate,
    routePath,
    goHistory,
    store,
    isElectron,
    routeAvailable,
    supportsLocalApi,
  })

  commands.push(command('settings.root', t('Settings.Settings'), groups.settings, {
    aliases: ['preferences', 'options'],
    icon: ['fas', 'cog'],
    shortcut: appShortcuts.NAVIGATE_TO_SETTINGS,
    run: () => openSettingsView(null),
  }))

  for (const [section, labelKey, , aliases] of SETTINGS_SECTIONS) {
    const desktopOnly = section === 'download' && !isElectron && !isCapacitor
    // eslint-disable-next-line @intlify/vue-i18n/no-dynamic-keys
    commands.push(command(`settings.${section}`, t(labelKey), groups.settings, {
      aliases,
      icon: settingsSectionIcon(section),
      disabledReason: desktopOnly ? t('CommandPalette.Unavailable.Desktop') : '',
      run: () => openSettingsSection(section),
    }))
  }

  addSettingsSearchCommands(commands, {
    tm,
    t,
    groups,
    store,
    isElectron,
    isCapacitor,
    openSettingsSearchResult,
    supportsLocalApi,
    isMac,
    isLinuxWayland,
    systemUsesDarkTheme,
  })

  commands.push(
    command('playlists.create', t('User Playlists.Create New Playlist'), groups.playlists, {
      aliases: ['new playlist', 'add playlist'],
      icon: ['fas', 'playlist-add'],
      run: () => store.dispatch('showCreatePlaylistPrompt', { title: '' }),
    }),
    command('settings.profiles', t('Profile.Profile Manager'), groups.settings, {
      aliases: ['manage profiles', 'users'],
      icon: ['fas', 'circle-user'],
      run: () => openSettingsView('profile'),
    }),
    command('app.about', t('About.About'), groups.navigation, {
      aliases: ['version', 'license'],
      icon: ['fas', 'info-circle'],
      run: () => openSettingsView('about'),
    }),
    command('downloads.open', t('Settings.Download Settings.Download Settings'), groups.downloads, {
      aliases: ['files', 'yt-dlp'],
      icon: ['fas', 'download'],
      disabledReason: !isElectron && !process.env.IS_CAPACITOR ? t('CommandPalette.Unavailable.Desktop') : '',
      run: () => openSettingsView('downloads'),
    })
  )

  addTabCommands(commands, {
    t,
    groups,
    store,
    isElectron,
    appShortcuts,
    createTab,
    closeTabs,
    reloadTabs,
  })
  addProfileCommands(commands, { t, locale, groups, store, navigate })
  addPlaylistCommands(commands, { t, groups, store, navigate })
  addDownloadCommands(commands, { t, groups, store, isElectron })
  addPlaybackCommands(commands, {
    t,
    groups,
    routePath,
    videoShortcuts,
    runShortcut,
  })

  return commands
}

function addNavigationCommands(commands, context) {
  const { t, groups, navigate, routePath, goHistory, store, isElectron, routeAvailable, supportsLocalApi } = context
  const navigationCommands = [
    ['subscriptions', '/subscriptions', 'Subscriptions.Subscriptions', ['home', 'feed'], ['fas', 'rss']],
    ['channels', '/subscribedchannels', 'Channels.Channels', ['subscriptions', 'channel list'], ['fas', 'user-check']],
    ['trending', '/trending', 'Trending.Trending', ['discover'], ['fas', 'fire']],
    ['popular', '/popular', 'Most Popular', ['popular videos'], ['fas', 'users']],
    ['playlists', '/userplaylists', 'Playlists', ['saved videos'], ['fas', 'bookmark']],
    ['history', '/history', 'History.History', ['watched videos'], ['fas', 'history']],
    ['stats', '/stats', 'Stats.Stats', ['watch statistics'], ['fas', 'chart-line']],
  ]
  const providerOptions = {
    supportsLocalApi,
    backendPreference: store.getters.getBackendPreference,
    backendFallback: store.getters.getBackendFallback,
  }
  const providerAvailability = new Map([
    ['trending', isTrendingAvailable(providerOptions)],
    ['popular', isMostPopularAvailable(providerOptions)],
  ])

  for (const [id, path, labelKey, aliases, icon] of navigationCommands) {
    if (providerAvailability.get(id) === false) continue
    // eslint-disable-next-line @intlify/vue-i18n/no-dynamic-keys
    commands.push(command(`navigate.${id}`, t(labelKey), groups.navigation, {
      aliases,
      icon,
      shortcut: id === 'history'
        ? (process.platform === 'darwin'
            ? KeyboardShortcuts.APP.GENERAL.NAVIGATE_TO_HISTORY_MAC
            : KeyboardShortcuts.APP.GENERAL.NAVIGATE_TO_HISTORY)
        : '',
      disabledReason: !routeAvailable(path)
        ? t('CommandPalette.Unavailable.Build')
        : routePath === path ? t('CommandPalette.Unavailable.Current Page') : '',
      run: () => navigate(path),
    }))
  }

  const historyState = isElectron
    ? context.store.getters.getTabHistoryState(context.store.getters.getPresentedTabId)
    : { canGoBack: true, canGoForward: true }
  commands.push(
    command('navigate.back', t('KeyboardShortcutPrompt.History Backward'), groups.navigation, {
      aliases: ['previous page'],
      icon: ['fas', 'arrow-left'],
      shortcut: KeyboardShortcuts.APP.GENERAL.HISTORY_BACKWARD,
      disabledReason: historyState.canGoBack ? '' : t('CommandPalette.Unavailable.No History'),
      run: () => goHistory(-1),
    }),
    command('navigate.forward', t('KeyboardShortcutPrompt.History Forward'), groups.navigation, {
      aliases: ['next page'],
      icon: ['fas', 'arrow-right'],
      shortcut: KeyboardShortcuts.APP.GENERAL.HISTORY_FORWARD,
      disabledReason: historyState.canGoForward ? '' : t('CommandPalette.Unavailable.No History'),
      run: () => goHistory(1),
    })
  )
}

function addSettingsSearchCommands(commands, context) {
  const {
    tm,
    t,
    groups,
    store,
    isElectron,
    isCapacitor,
    openSettingsSearchResult,
    supportsLocalApi,
    isMac,
    isLinuxWayland,
    systemUsesDarkTheme,
  } = context
  const sections = SETTINGS_SECTIONS
    .filter(([section]) => section !== 'download' || isElectron || isCapacitor)
    .map(([type, labelKey, descriptionKey]) => ({
      type,
      // eslint-disable-next-line @intlify/vue-i18n/no-dynamic-keys
      title: t(labelKey),
      // eslint-disable-next-line @intlify/vue-i18n/no-dynamic-keys
      description: t(descriptionKey),
    }))
  const searchIndex = createSettingsSearchIndex({
    sections,
    tm,
    store,
    usingElectron: isElectron,
    isCapacitor,
    supportsLocalApi,
    isMac,
    isLinuxWayland,
    systemUsesDarkTheme,
  })

  for (const section of sections) {
    const values = searchIndex.get(section.type) ?? []
    const settingValues = values.filter(match => (
      match.label !== section.title && match.label !== section.description
    ))
    settingValues.forEach((match, index) => {
      commands.push(command(`settings.search.${section.type}.${index}`, match.label, groups.settings, {
        detail: section.title,
        icon: settingsSectionIcon(section.type),
        run: () => openSettingsSearchResult(section.type, match),
        searchOnly: true,
      }))
    })
  }
}

function addTabCommands(commands, context) {
  const { t, groups, store, isElectron, appShortcuts, createTab, closeTabs, reloadTabs } = context
  const desktopReason = isElectron ? '' : t('CommandPalette.Unavailable.Desktop')
  const tabs = store.getters.getTabs

  commands.push(
    command('tabs.new', t('KeyboardShortcutPrompt.New Tab'), groups.tabs, {
      aliases: ['open tab'],
      icon: ['fas', 'plus'],
      shortcut: appShortcuts.NEW_TAB,
      disabledReason: desktopReason,
      run: createTab,
    }),
    command('tabs.close', t('KeyboardShortcutPrompt.Close Tab'), groups.tabs, {
      aliases: ['remove tab'],
      icon: ['fas', 'xmark'],
      shortcut: appShortcuts.CLOSE_TAB,
      disabledReason: desktopReason,
      run: closeTabs,
    }),
    command('tabs.reload', t('KeyboardShortcutPrompt.Reload Tab'), groups.tabs, {
      aliases: ['refresh tab'],
      icon: ['fas', 'sync'],
      shortcut: appShortcuts.RELOAD_TAB,
      disabledReason: desktopReason,
      run: reloadTabs,
    }),
    command('tabs.restore', t('KeyboardShortcutPrompt.Reopen Closed Tab'), groups.tabs, {
      aliases: ['undo close tab'],
      icon: ['fas', 'clock-rotate-left'],
      shortcut: appShortcuts.RESTORE_CLOSED_TAB,
      disabledReason: desktopReason,
      run: () => store.dispatch('restoreClosedTab'),
    }),
    command('tabs.next', t('KeyboardShortcutPrompt.Next Tab'), groups.tabs, {
      icon: ['fas', 'arrow-right'],
      shortcut: appShortcuts.NEXT_TAB,
      disabledReason: desktopReason || (tabs.length < 2 ? t('CommandPalette.Unavailable.One Tab') : ''),
      run: () => store.dispatch('nextTab'),
    }),
    command('tabs.previous', t('KeyboardShortcutPrompt.Previous Tab'), groups.tabs, {
      icon: ['fas', 'arrow-left'],
      shortcut: appShortcuts.PREV_TAB,
      disabledReason: desktopReason || (tabs.length < 2 ? t('CommandPalette.Unavailable.One Tab') : ''),
      run: () => store.dispatch('prevTab'),
    })
  )

  for (const [index, tab] of tabs.entries()) {
    commands.push(command(`tabs.switch.${tab.id}`, t('CommandPalette.Switch to Tab', {
      title: tab.contentTitle || tab.title || tab.route?.fullPath
    }), groups.tabs, {
      aliases: ['activate tab', `tab ${index + 1}`],
      icon: getTabPageIcon(tab),
      iconUrl: getTabAvatarUrl(tab),
      shortcut: index < 9 ? appShortcuts.SWITCH_TO_TAB.replace(/1(?:\.\.|-)9$/, String(index + 1)) : '',
      disabledReason: tab.id === store.getters.getActiveTabId
        ? t('CommandPalette.Unavailable.Active Tab')
        : '',
      run: () => store.dispatch('activateTab', tab.id),
    }))
  }
}

function addProfileCommands(commands, { t, locale, groups, store, navigate }) {
  const activeProfileId = store.getters.getActiveProfile?._id
  for (const profile of store.getters.getProfileList) {
    const name = translateProfileName(profile, t)
    commands.push(command(`profiles.switch.${profile._id}`, t('CommandPalette.Switch Profile', { name }), groups.profiles, {
      aliases: ['change profile', 'user'],
      profile,
      profileFallback: getFirstCharacter(name, locale),
      disabledReason: profile._id === activeProfileId ? t('CommandPalette.Unavailable.Active Profile') : '',
      run: () => {
        switchActiveProfile(store, profile, t)
        navigate('/subscriptions')
      },
    }))
  }
}

function addPlaylistCommands(commands, { t, groups, store, navigate }) {
  for (const playlist of store.getters.getAllPlaylists) {
    commands.push(command(`playlists.open.${playlist._id}`, t('CommandPalette.Open Playlist', {
      name: playlist.playlistName
    }), groups.playlists, {
      aliases: ['saved videos', 'watch list'],
      icon: ['fas', 'bookmark'],
      run: () => navigate({
        path: `/playlist/${encodeURIComponent(playlist._id)}`,
        query: { playlistType: 'user' },
      }),
    }))
  }
}

function addDownloadCommands(commands, { t, groups, store, isElectron }) {
  if (!isElectron && !process.env.IS_CAPACITOR) return
  const activeStatuses = new Set(['downloading', 'processing'])
  for (const download of Object.values(store.getters.getYtDlpDownloads)) {
    commands.push(command(`downloads.cancel.${download.id}`, t('CommandPalette.Cancel Download', {
      title: download.title || download.id
    }), groups.downloads, {
      aliases: ['stop download', 'abort'],
      icon: ['fas', 'xmark'],
      disabledReason: activeStatuses.has(download.status)
        ? ''
        : t('CommandPalette.Unavailable.Download Finished'),
      run: () => ytDlp.ytDlpCancelDownload(download.id),
      contextual: true,
    }))
  }
}

function addPlaybackCommands(commands, context) {
  const { t, groups, routePath, videoShortcuts, runShortcut } = context
  const onVideo = routePath.startsWith('/watch/')

  for (const [id, section, code, labelKey, icon, aliases] of PLAYBACK_COMMANDS) {
    const configuredShortcut = videoShortcuts[section][code]
    const executionShortcut = configuredShortcut || DefaultKeyboardShortcuts.VIDEO_PLAYER[section][code]
    // eslint-disable-next-line @intlify/vue-i18n/no-dynamic-keys
    commands.push(command(id, t(labelKey), groups.playback, {
      aliases,
      icon,
      shortcut: configuredShortcut,
      disabledReason: onVideo ? '' : t('CommandPalette.Unavailable.Video'),
      run: () => runShortcut(executionShortcut),
      contextual: true,
    }))
  }
}

function command(id, label, group, options) {
  return {
    id,
    label,
    group,
    aliases: [],
    icon: null,
    iconUrl: '',
    profile: null,
    profileFallback: '',
    shortcut: '',
    disabledReason: '',
    contextual: false,
    detail: '',
    searchOnly: false,
    ...options,
  }
}

function settingsSectionIcon(section) {
  return {
    general: ['fas', 'border-all'],
    appearance: ['fas', 'display'],
    playback: ['fas', 'circle-play'],
    'add-ons': ['fas', 'puzzle-piece'],
    subscriptions: ['fas', 'users'],
    download: ['fas', 'download'],
    focus: ['fas', 'eye-slash'],
    privacy: ['fas', 'lock'],
    data: ['fas', 'database'],
    sync: ['fas', 'sync'],
    advanced: ['fas', 'flask'],
  }[section]
}
