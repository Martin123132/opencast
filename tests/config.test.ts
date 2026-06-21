import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isDDrivePath, resolveDataRoot } from '../server/config.ts'

test('accepts D-drive data roots', () => {
  assert.equal(isDDrivePath('D:\\open-source\\opencast-data'), true)
  assert.equal(resolveDataRoot('D:\\open-source\\opencast-data'), 'D:\\open-source\\opencast-data')
})

test('rejects C-drive data roots', () => {
  assert.equal(isDDrivePath('C:\\Users\\ollet\\opencast-data'), false)
  assert.throws(
    () => resolveDataRoot('C:\\Users\\ollet\\opencast-data'),
    /OPENCAST_DATA_ROOT must stay on D:/,
  )
})
