// @ts-nocheck
function isScriptNode(node) {
  return node.nodeType === 1 && node.tagName === 'SCRIPT'
}

function appendExecutableScript(parent, source) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')

    for (const attr of source.attributes) {
      script.setAttribute(attr.name, attr.value)
    }

    script.async = false
    script.text = source.textContent || ''

    if (script.src) {
      script.onload = () => resolve()
      script.onerror = () => reject(new Error(`Failed to load script: ${script.src}`))
    }

    try {
      parent.appendChild(script)
    } catch (error) {
      reject(error)
      return
    }

    if (!script.src) {
      resolve()
    }
  })
}

async function appendPrepNode(parent, node) {
  if (isScriptNode(node)) {
    await appendExecutableScript(parent, node)
    return
  }

  const clone = node.cloneNode(false)
  parent.appendChild(clone)

  for (const child of Array.from(node.childNodes || [])) {
    await appendPrepNode(clone, child)
  }
}

export async function renderPrepHTML(container, html = '') {
  if (!container) return

  container.textContent = ''
  if (!html) return

  const template = document.createElement('template')
  template.innerHTML = html

  for (const node of Array.from(template.content.childNodes)) {
    await appendPrepNode(container, node)
  }
}
