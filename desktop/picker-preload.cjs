const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('shareFramePicker', {
  cancel() {
    ipcRenderer.send('shareframe:picker-cancel')
  },
  onSources(listener) {
    const handler = (_event, sources) => listener(sources)
    ipcRenderer.on('shareframe:picker-sources', handler)
    return () => ipcRenderer.removeListener('shareframe:picker-sources', handler)
  },
  select(sourceId) {
    ipcRenderer.send('shareframe:picker-select', sourceId)
  },
})
