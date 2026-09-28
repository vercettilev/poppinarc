export const requestPermissions = async () => {
  return chrome.permissions.request({
    permissions: ["scripting"],
    origins: ["<all_urls>"],
  })
}

export const checkPermissions = async () => {
  return chrome.permissions.contains({
    permissions: ["scripting"],
    origins: ["<all_urls>"],
  })
}
