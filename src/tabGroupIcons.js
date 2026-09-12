export const TAB_GROUP_ICONS = ['layer-group', 'folder-open', 'bookmark', 'heart', 'film', 'gamepad', 'flask', 'palette', 'globe']

export function normalizeTabGroupIcon(value) {
  return TAB_GROUP_ICONS.includes(value) ? value : 'layer-group'
}
