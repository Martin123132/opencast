import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assertDDrivePath, isDDrivePath } from '../scripts/path-guards'

test('accepts D-drive paths', () => {
  assert.equal(isDDrivePath('D:\\open-source\\opencast-data'), true)
  assert.equal(assertDDrivePath('D:\\open-source\\opencast-e2e-data'), 'D:\\open-source\\opencast-e2e-data')
})

test('rejects non-D drive paths', () => {
  assert.equal(isDDrivePath('C:\\Users\\ollet\\opencast-data'), false)
  assert.throws(
    () => assertDDrivePath('C:\\Users\\ollet\\opencast-e2e-data'),
    /must stay on D:/,
  )
})
