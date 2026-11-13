const serverInput = document.querySelector('#server-url')
const tokenInput = document.querySelector('#api-token')
const status = document.querySelector('#status')
const saveButton = document.querySelector('#save-config')
const testButton = document.querySelector('#test')

function setStatus(message, kind = '') {
  status.textContent = message
  status.className = kind
}

function normalizeServer(value) {
  return String(value || '').trim().replace(/\/+$/, '')
}

async function saveConfig() {
  const serverUrl = normalizeServer(serverInput.value)
  const apiToken = tokenInput.value.trim()
  if (!serverUrl || !apiToken) {
    setStatus('地址和 Token 都要填', 'error')
    return false
  }
  await chrome.storage.sync.set({ serverUrl, apiToken })
  setStatus('已保存，刷新 X 页面后生效', 'success')
  return true
}

async function testConnection() {
  const serverUrl = normalizeServer(serverInput.value)
  const apiToken = tokenInput.value.trim()
  if (!serverUrl || !apiToken) {
    setStatus('先填好地址和 Token', 'error')
    return
  }
  testButton.disabled = true
  setStatus('正在连接…')
  try {
    const response = await fetch(`${serverUrl}/api/jobs?limit=1`, {
      headers: { Authorization: `Bearer ${apiToken}` },
    })
    if (response.status === 401) throw new Error('Token 无效或已轮换')
    if (!response.ok) throw new Error(`服务器返回 ${response.status}`)
    setStatus('连接正常', 'success')
    await saveConfig()
  } catch (error) {
    setStatus(error.message || '连接失败', 'error')
  } finally {
    testButton.disabled = false
  }
}

saveButton.addEventListener('click', () => void saveConfig())
testButton.addEventListener('click', () => void testConnection())

document.addEventListener('DOMContentLoaded', async () => {
  const config = await chrome.storage.sync.get(['serverUrl', 'apiToken'])
  serverInput.value = config.serverUrl || 'http://127.0.0.1:8765'
  tokenInput.value = config.apiToken || ''
  if (!config.apiToken) setStatus('填好地址和 Token 后保存', '')
})
