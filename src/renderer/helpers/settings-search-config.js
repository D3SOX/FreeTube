const GENERAL_EVERYDAY_KEYS = new Set([
  'Avoid translation',
  'Auto Load Next Page',
  'General Settings',
  'Check for Updates',
  'Comment Translation',
  'Confirm Before',
  'Confirmation Options',
  'Default Landing Page',
  'Extra Thumbnail Action Button',
  'Locale Preference',
  'Minimize to system tray',
  'New Tab Position',
  'Open Deep Links In New Window',
  'Reduced Motion',
  'Region for Trending',
  'Startup Behavior',
  'Swipe to refresh',
  'System Default',
  'Tab Close Focus',
  'Update Relative Timestamps',
  'Use AI Translation Completions'
])

const GENERAL_APPEARANCE_KEYS = new Set([
  'Mobile Layout',
  'Navigation',
  'Playlist View Type',
  'Show Thumbnail Previews',
  'Thumbnail Preference',
  'Video View Type'
])

const GENERAL_PRIVACY_KEYS = new Set([
  'Enable Search Suggestions',
  'External Link Handling',
  'Remember Tab Navigation History'
])

const GENERAL_PROVIDER_KEYS = new Set([
  'Clear Default Instance',
  'Current instance will be randomized on startup',
  'Current Invidious Instance',
  'Fallback to Non-Preferred Backend on Failure',
  'No default instance has been set',
  'Preferred API Backend',
  'Set Current Instance as Default',
  'Stream Extraction Method',
  'The currently set default instance is {instance}',
  'View all Invidious instance information'
])

const PRIVACY_STORAGE_KEYS = new Set([
  'Automatic History Retention',
  'Automatic History Retention Placeholder',
  'Automatic History Retention Tooltip',
  'Cache Video Metadata',
  'Cache Video Metadata Tooltip',
  'Clear Search History and Cache',
  'Clear Video Metadata Cache',
  'Remove Watch History',
  'Remove All Subscriptions / Profiles',
  'Remove All Playlists'
])

const DATA_STORAGE_KEYS = new Set([
  'Profile Directory',
  'Open Profile Directory'
])

export const SETTINGS_SEARCH_SOURCES = {
  general: [{
    type: 'general',
    key: 'Settings.General Settings',
    include: GENERAL_EVERYDAY_KEYS
  }, {
    type: 'context-menu-search',
    key: 'Settings.Context Menu Search Settings',
    electronOnly: true
  }],
  appearance: [{
    type: 'theme',
    key: 'Settings.Theme Settings'
  }, {
    type: 'general',
    key: 'Settings.General Settings',
    include: GENERAL_APPEARANCE_KEYS
  }],
  playback: [{
    type: 'player',
    key: 'Settings.Player Settings',
    exclude: new Set(['Proxy Videos Through Invidious', 'Voice-over Translation'])
  }, {
    type: 'caption-appearance',
    key: 'Settings.Player Settings.Caption Appearance'
  }, {
    type: 'channel',
    key: 'Settings.Channel Settings'
  }],
  subscriptions: [{
    type: 'subscription',
    key: 'Settings.Subscription Settings'
  }],
  download: [{
    type: 'download',
    key: 'Settings.Download Settings'
  }],
  focus: [{
    type: 'distraction',
    key: 'Settings.Distraction Free Settings',
    exclude: new Set([
      'Hide Home',
      'Hide Popular Videos',
      'Hide Trending Videos',
    ])
  }, {
    type: 'parental-control',
    key: 'Settings.Parental Control Settings'
  }],
  'add-ons': [{
    type: 'sponsor-block',
    key: 'Settings.SponsorBlock Settings'
  }, {
    type: 'return-youtube-dislike',
    key: 'Settings.Return YouTube Dislike Settings'
  }, {
    type: 'player',
    key: 'Settings.Player Settings',
    include: new Set(['Voice-over Translation']),
    electronOnly: true,
    capacitorSupported: true
  }],
  privacy: [{
    type: 'privacy',
    key: 'Settings.Privacy Settings',
    exclude: PRIVACY_STORAGE_KEYS
  }, {
    type: 'general',
    key: 'Settings.General Settings',
    include: GENERAL_PRIVACY_KEYS
  }],
  data: [{
    type: 'data',
    key: 'Settings.Data Settings',
    exclude: DATA_STORAGE_KEYS,
    tab: 'data'
  }, {
    type: 'storage',
    key: 'Settings.Storage Settings',
    tab: 'storage'
  }, {
    type: 'privacy',
    key: 'Settings.Privacy Settings',
    include: PRIVACY_STORAGE_KEYS,
    tab: 'storage'
  }, {
    type: 'data',
    key: 'Settings.Data Settings',
    include: DATA_STORAGE_KEYS,
    electronOnly: true,
    tab: 'storage'
  }],
  sync: [{
    type: 'sync',
    key: 'Settings.Sync Settings'
  }],
  advanced: [{
    type: 'general',
    key: 'Settings.General Settings',
    include: GENERAL_PROVIDER_KEYS
  }, {
    type: 'player',
    key: 'Settings.Player Settings',
    include: new Set(['Proxy Videos Through Invidious'])
  }, {
    type: 'external-player',
    key: 'Settings.External Player Settings',
    electronOnly: true
  }, {
    type: 'external-software',
    key: 'Settings.External Software Settings',
    electronOnly: true
  }, {
    type: 'proxy',
    key: 'Settings.Proxy Settings',
    capacitorSupported: true,
    electronOnly: true
  }, {
    type: 'experimental',
    key: 'Settings.Experimental Settings',
    electronOnly: true
  }]
}

export const SETTINGS_SEARCH_SELECT_GROUP_LABELS = {
  general: {
    'Stream Extraction Method': ['Stream Extraction Method'],
    'Mobile Layout': ['Mobile Layout'],
    'New Tab Position': ['New Tab Position'],
    'Tab Close Focus': ['Tab Close Focus'],
    'Startup Behavior': ['Startup Behavior'],
    'Reduced Motion': ['Reduced Motion'],
    'Avoid translation': ['Avoid translation'],
    'Comment Translation': ['Title', 'Enable', 'Never Translate'],
    'Preferred API Backend': ['Preferred API Backend'],
    'Playlist View Type': ['Playlist View Type'],
    'Video View Type': ['Video View Type'],
    'Thumbnail Preference': ['Thumbnail Preference'],
    'Extra Thumbnail Action Button': ['Extra Thumbnail Action Button'],
    'External Link Handling': ['External Link Handling']
  },
  theme: {
    'Tab Layout': ['Tab Layout'],
    'Toast Position': ['Toast Position'],
    'Base Theme': ['Base Theme'],
    'Icon Pack': ['Icon Pack'],
    Font: ['App Font'],
    'Main Color Theme': ['Main Color Theme'],
    'Custom Theme': ['Create Custom Theme', 'Edit Custom Theme']
  },
  player: {
    'Caption Appearance': [],
    'Default Viewing Mode': ['Default Viewing Mode', 'Tooltip'],
    'Auto Picture in Picture': ['Auto Picture in Picture'],
    'Swipe Gestures': ['Left', 'Right', 'Fullscreen Brightness'],
    'Default Video Format': ['Default Video Format'],
    'Default Quality': ['Default Quality'],
    'Screenshot.Modes': []
  },
  channel: {
    '': [
      'Channel Settings',
      'Enable Playback Speed',
      'Enable Video Quality',
      'Enable Subtitles State',
      'Enable Volume',
      'Auto Update',
      'Auto Update Subtitles',
      'Auto Update Volume'
    ]
  },
  download: {
    '': [
      'Download Settings',
      'Enable Downloads',
      'Download Folder',
      'Global Additional yt-dlp Arguments'
    ]
  },
  data: {
    '': [
      'Data Settings',
      'Import Subscriptions',
      'Export Subscriptions',
      'Import History',
      'Export History',
      'Import Playlists',
      'Export Playlists',
      'Search history',
      'Import search history',
      'Export search history',
      'Import Settings',
      'Export Settings',
      'Import subscriptions formats',
      'Import history formats',
      'Import playlists formats',
      'Import search history formats',
      'Manage Subscriptions'
    ]
  },
  'caption-appearance': {
    Anchor: ['Anchor'],
    'Edge Style': ['Edge Style']
  },
  'external-player': { Players: [] },
  'external-software': {
    Sources: [],
    'Update Modes': [],
    'Cookie Sources': []
  },
  privacy: { 'Watched Progress Saving Mode.Modes': [] },
  'sponsor-block': { 'Skip Options': ['Skip Option'] }
}

export const SETTINGS_SEARCH_EXCLUDED_MESSAGE_PATHS = {
  general: new Set(['System Default']),
  'context-menu-search': new Set(['Engine Name', 'Search URL']),
  player: new Set(['Skip Silence']),
  'sponsor-block': new Set(['Generated SponsorBlock User ID Copy Button']),
  subscription: new Set(['Auto Refresh Interval']),
  'caption-appearance': new Set(['Application Language']),
  'external-software': new Set([
    'Download yt-dlp',
    'Update yt-dlp',
    'Downloading yt-dlp',
    'Download FFmpeg',
    'Update FFmpeg',
    'Downloading FFmpeg',
    'Download FFmpeg and FFprobe',
    'Update FFmpeg and FFprobe',
    'Downloading FFmpeg and FFprobe',
    'Select Browser'
  ])
}
