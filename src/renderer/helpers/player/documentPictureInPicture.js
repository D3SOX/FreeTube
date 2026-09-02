export function shouldEnableDocumentPictureInPicture(isElectron, isLinuxWayland) {
  // Chromium ignores z-order requests for BrowserWindow on native Wayland.
  // Video PiP still receives the compositor's dedicated PiP treatment there.
  // https://issues.chromium.org/issues/374244479
  return !isElectron || !isLinuxWayland
}
