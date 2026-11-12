const STATUS_URL = /^https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/[^/]+\/status\/\d+/i

function normalizeServer(value) {
  return String(value || '').trim().replace(/\/+$/, '')
}

async function submitUrls(urls) {
  const { serverUrl, apiToken } = await chrome.storage.sync.get([
    'serverUrl',
    'apiToken',
  ])
  const server = normalizeServer(serverUrl)
  const token = String(apiToken || '').trim()
  if (!server || !token) throw new Error('请先在插件弹窗中配置服务器地址和 API Token')

  const response = await fetch(`${server}/api/download`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ urls }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.detail || `提交失败 (${response.status})`)
  return body
}

async function flashBadge(text, color) {
  await chrome.action.setBadgeBackgroundColor({ color })
  await chrome.action.setBadgeText({ text })
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), 1800)
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'xboard-save',
      title: '保存到 XBoard',
      contexts: ['page', 'link'],
      documentUrlPatterns: ['https://x.com/*', 'https://twitter.com/*'],
    })
  })
})

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'xboard-save') return
  const url = info.linkUrl || tab?.url || ''
  if (!STATUS_URL.test(url)) {
    await flashBadge('!', '#dc2626')
    return
  }
  try {
    await submitUrls([url])
    await flashBadge('✓', '#16a34a')
  } catch {
    await flashBadge('!', '#dc2626')
  }
})

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'submit-urls') return false
  submitUrls(message.urls)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: error.message }))
  return true
})
