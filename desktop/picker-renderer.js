const sourceGroups = document.querySelector('#source-groups')
const sourceSummary = document.querySelector('#source-summary')
const cancelButtons = [document.querySelector('#cancel-top'), document.querySelector('#cancel-bottom')]

for (const button of cancelButtons) {
  button.addEventListener('click', () => window.shareFramePicker.cancel())
}

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    window.shareFramePicker.cancel()
  }
})

window.shareFramePicker.onSources((sources) => {
  sourceGroups.replaceChildren()

  if (!sources.length) {
    sourceSummary.textContent = 'No recordable screens or windows were found.'
    const emptyState = document.createElement('div')
    emptyState.className = 'empty-state'
    emptyState.textContent = 'Close apps that block capture, then return to ShareFrame and try again.'
    sourceGroups.append(emptyState)
    return
  }

  const screens = sources.filter((source) => source.kind === 'screen')
  const windows = sources.filter((source) => source.kind === 'window')
  sourceSummary.textContent = `${sources.length} available ${sources.length === 1 ? 'source' : 'sources'}`

  appendSection('Screens', screens)
  appendSection('Windows', windows)
})

function appendSection(title, sources) {
  if (!sources.length) {
    return
  }

  const section = document.createElement('section')
  section.className = 'source-section'
  const heading = document.createElement('h2')
  heading.textContent = title
  const grid = document.createElement('div')
  grid.className = 'source-grid'

  for (const source of sources) {
    const button = document.createElement('button')
    button.className = 'source-card'
    button.type = 'button'
    button.title = `Record ${source.name}`
    button.addEventListener('click', () => window.shareFramePicker.select(source.id))

    const thumbnail = document.createElement('img')
    thumbnail.className = 'source-thumbnail'
    thumbnail.alt = ''
    thumbnail.src = source.thumbnail

    const name = document.createElement('div')
    name.className = 'source-name'

    if (source.appIcon) {
      const appIcon = document.createElement('img')
      appIcon.alt = ''
      appIcon.src = source.appIcon
      name.append(appIcon)
    }

    const label = document.createElement('span')
    label.textContent = source.name
    name.append(label)
    button.append(thumbnail, name)
    grid.append(button)
  }

  section.append(heading, grid)
  sourceGroups.append(section)
}
