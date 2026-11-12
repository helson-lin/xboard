const STATUS_URL = /^https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/[^/]+\/status\/\d+/i

const serverInput = document.querySelector('#server-url')
const tokenInput = document.querySelector('#api-token')
const urlsInput = document.querySelector('#urls')
const status = document.querySelector('#status')
const submitButton = document.querySelector('#submit')

function setStatus(message, kind = '') {
  status.textContent = message
  status.className = kind
}

function parseUrls() {
  return urlsInput.value
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter((value) => STATUS_URL.test(value))
}

async function saveConfig() {
  const serverUrl = serverInput.value.trim().replace(/\/+$/, '')
  const apiToken = tokenInput.value.trim()
  await chrome.storage.sync.set({ serverUrl, apiToken })
  setStatus('配置已保存', 'success')
}

async function useCurrentPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (tab?.url && STATUS_URL.test(tab.url)) {
    urlsInput.value = tab.url
    setStatus('已识别当前推文', 'success')
  } else {
    setStatus('当前页面不是 X 推文详情页', 'error')
  }
}

document.querySelector('#save-config').addEventListener('click', () => {
  void saveConfig()
})

document.querySelector('#use-current').addEventListener('click', () => {
  void useCurrentPage()
})

submitButton.addEventListener('click', async () => {
  const urls = parseUrls()
  if (!serverInput.value.trim() || !tokenInput.value.trim()) {
    setStatus('请先填写并保存服务器地址和 API Token', 'error')
    return
  }
  if (!urls.length) {
    setStatus('请提供至少一个有效的 X 推文链接', 'error')
    return
  }

  submitButton.disabled = true
  setStatus('正在提交…')
  try {
    await saveConfig()
    const response = await chrome.runtime.sendMessage({ type: 'submit-urls', urls })
    if (!response?.ok) throw new Error(response?.error || '提交失败')
    setStatus(`已加入 ${response.result.queued} 条任务`, 'success')
    urlsInput.value = ''
  } catch (error) {
    setStatus(error.message || '提交失败', 'error')
  } finally {
    submitButton.disabled = false
  }
})

document.addEventListener('DOMContentLoaded', async () => {
  const config = await chrome.storage.sync.get(['serverUrl', 'apiToken'])
  serverInput.value = config.serverUrl || 'http://127.0.0.1:8765'
  tokenInput.value = config.apiToken || ''
  await useCurrentPage()
})
