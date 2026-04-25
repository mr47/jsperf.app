import { describe, expect, it } from 'vitest'
import { renderPrepHTML } from '../../utils/prepHTML'

describe('renderPrepHTML', () => {
  it('renders prep markup and clears previous content', async () => {
    const container = document.createElement('div')
    container.innerHTML = '<p>old</p>'

    await renderPrepHTML(container, '<section><p>new</p></section>')

    expect(container.innerHTML).toBe('<section><p>new</p></section>')
  })

  it('waits for external scripts before appending later markup', async () => {
    const container = document.createElement('div')
    const pending = renderPrepHTML(
      container,
      '<span>before</span><script src="/dep.js" integrity="sha256-test" crossorigin="anonymous"></script><span>after</span>'
    )
    await new Promise((resolve) => setTimeout(resolve, 0))

    const script = container.querySelector('script')

    expect(script).toBeTruthy()
    expect(script.getAttribute('integrity')).toBe('sha256-test')
    expect(script.getAttribute('crossorigin')).toBe('anonymous')
    expect(container.textContent).toBe('before')

    script.dispatchEvent(new Event('load'))
    await pending

    expect(container.textContent).toBe('beforeafter')
  })
})
