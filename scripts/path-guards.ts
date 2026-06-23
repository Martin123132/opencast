import path from 'node:path'

const requiredStorageDrive = 'D:'

export function isDDrivePath(value: string) {
  return path.win32.parse(path.win32.resolve(value)).root.toUpperCase() === `${requiredStorageDrive}\\`
}

export function assertDDrivePath(value: string, label = 'Path') {
  const resolved = path.win32.resolve(value)

  if (!isDDrivePath(resolved)) {
    throw new Error(`${label} must stay on ${requiredStorageDrive}:. Refusing to use ${resolved}`)
  }

  return resolved
}
