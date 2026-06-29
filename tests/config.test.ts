import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  getRecordingSizeStatus,
  isDDrivePath,
  recordingGuardrails,
  resolveDataRoot,
} from '../server/config.ts'
import { getDiskStatus } from '../server/storageHealth.ts'

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

test('classifies low storage before long recordings are attempted', () => {
  assert.equal(getDiskStatus(1024, 2048), 'low-space')
  assert.equal(getDiskStatus(4096, 2048), 'ready')
})

test('publishes recording size guardrails before upload', () => {
  assert.equal(recordingGuardrails.maxRecordingBytes, 2 * 1024 * 1024 * 1024)
  assert.equal(recordingGuardrails.storageWarningThresholdBytes, 5 * 1024 * 1024 * 1024)
  assert.equal(recordingGuardrails.longRecordingWarningMs, 60 * 60 * 1000)
  assert.equal(getRecordingSizeStatus(recordingGuardrails.maxRecordingBytes), 'ready')
  assert.equal(getRecordingSizeStatus(recordingGuardrails.maxRecordingBytes + 1), 'too-large')
})
