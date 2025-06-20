'use strict'
const { truncateSpan, normalizeSpan } = require('./tags-processors')
const { AgentEncoder } = require('./0.4')
const { version: ddTraceVersion } = require('../../../../package.json')
const { ITR_CORRELATION_ID } = require('../../src/plugins/util/test')
const id = require('../../src/id')
const {
  distributionMetric,
  TELEMETRY_ENDPOINT_PAYLOAD_SERIALIZATION_MS,
  TELEMETRY_ENDPOINT_PAYLOAD_EVENTS_COUNT
} = require('../ci-visibility/telemetry')

const ENCODING_VERSION = 1
const ALLOWED_CONTENT_TYPES = new Set(['test_session_end', 'test_module_end', 'test_suite_end', 'test'])

const TEST_SUITE_KEYS_LENGTH = 12
const TEST_MODULE_KEYS_LENGTH = 11
const TEST_SESSION_KEYS_LENGTH = 10
const TEST_AND_SPAN_KEYS_LENGTH = 11

const INTAKE_SOFT_LIMIT = 2 * 1024 * 1024 // 2MB

function formatSpan (span) {
  let encodingVersion = ENCODING_VERSION
  if (span.type === 'test' && span.meta && span.meta.test_session_id) {
    encodingVersion = 2
  }
  return {
    type: ALLOWED_CONTENT_TYPES.has(span.type) ? span.type : 'span',
    version: encodingVersion,
    content: normalizeSpan(truncateSpan(span))
  }
}

class AgentlessCiVisibilityEncoder extends AgentEncoder {
  constructor (writer, { runtimeId, service, env }) {
    super(writer, INTAKE_SOFT_LIMIT)
    this.runtimeId = runtimeId
    this.service = service
    this.env = env

    // Used to keep track of the number of encoded events to update the
    // length of `payload.events` when calling `makePayload`
    this._eventCount = 0

    this.metadataTags = {}

    this.reset()
  }

  addMetadataTags (tags) {
    ALLOWED_CONTENT_TYPES.forEach(type => {
      if (tags[type]) {
        this.metadataTags[type] = {
          ...this.metadataTags[type],
          ...tags[type]
        }
      }
    })
  }

  _encodeTestSuite (bytes, content) {
    let keysLength = TEST_SUITE_KEYS_LENGTH
    const itrCorrelationId = content.meta[ITR_CORRELATION_ID]
    if (itrCorrelationId) {
      keysLength++
    }

    this._encodeMapPrefix(bytes, keysLength)
    this._encodeString(bytes, 'type')
    this._encodeString(bytes, content.type)

    this._encodeString(bytes, 'test_session_id')
    this._encodeId(bytes, content.trace_id)

    this._encodeString(bytes, 'test_module_id')
    this._encodeId(bytes, content.parent_id)

    this._encodeString(bytes, 'test_suite_id')
    this._encodeId(bytes, content.span_id)

    if (itrCorrelationId) {
      this._encodeString(bytes, ITR_CORRELATION_ID)
      this._encodeString(bytes, itrCorrelationId)
      delete content.meta[ITR_CORRELATION_ID]
    }

    this._encodeString(bytes, 'error')
    this._encodeNumber(bytes, content.error)
    this._encodeString(bytes, 'name')
    this._encodeString(bytes, content.name)
    this._encodeString(bytes, 'service')
    this._encodeString(bytes, content.service)
    this._encodeString(bytes, 'resource')
    this._encodeString(bytes, content.resource)
    this._encodeString(bytes, 'start')
    this._encodeNumber(bytes, content.start)
    this._encodeString(bytes, 'duration')
    this._encodeNumber(bytes, content.duration)
    this._encodeString(bytes, 'meta')
    this._encodeMap(bytes, content.meta)
    this._encodeString(bytes, 'metrics')
    this._encodeMap(bytes, content.metrics)
  }

  _encodeTestModule (bytes, content) {
    this._encodeMapPrefix(bytes, TEST_MODULE_KEYS_LENGTH)
    this._encodeString(bytes, 'type')
    this._encodeString(bytes, content.type)

    this._encodeString(bytes, 'test_session_id')
    this._encodeId(bytes, content.trace_id)

    this._encodeString(bytes, 'test_module_id')
    this._encodeId(bytes, content.span_id)

    this._encodeString(bytes, 'error')
    this._encodeNumber(bytes, content.error)
    this._encodeString(bytes, 'name')
    this._encodeString(bytes, content.name)
    this._encodeString(bytes, 'service')
    this._encodeString(bytes, content.service)
    this._encodeString(bytes, 'resource')
    this._encodeString(bytes, content.resource)
    this._encodeString(bytes, 'start')
    this._encodeNumber(bytes, content.start)
    this._encodeString(bytes, 'duration')
    this._encodeNumber(bytes, content.duration)
    this._encodeString(bytes, 'meta')
    this._encodeMap(bytes, content.meta)
    this._encodeString(bytes, 'metrics')
    this._encodeMap(bytes, content.metrics)
  }

  _encodeTestSession (bytes, content) {
    this._encodeMapPrefix(bytes, TEST_SESSION_KEYS_LENGTH)
    this._encodeString(bytes, 'type')
    this._encodeString(bytes, content.type)

    this._encodeString(bytes, 'test_session_id')
    this._encodeId(bytes, content.trace_id)

    this._encodeString(bytes, 'error')
    this._encodeNumber(bytes, content.error)
    this._encodeString(bytes, 'name')
    this._encodeString(bytes, content.name)
    this._encodeString(bytes, 'service')
    this._encodeString(bytes, content.service)
    this._encodeString(bytes, 'resource')
    this._encodeString(bytes, content.resource)
    this._encodeString(bytes, 'start')
    this._encodeNumber(bytes, content.start)
    this._encodeString(bytes, 'duration')
    this._encodeNumber(bytes, content.duration)
    this._encodeString(bytes, 'meta')
    this._encodeMap(bytes, content.meta)
    this._encodeString(bytes, 'metrics')
    this._encodeMap(bytes, content.metrics)
  }

  _encodeEventContent (bytes, content) {
    let totalKeysLength = TEST_AND_SPAN_KEYS_LENGTH
    if (content.meta.test_session_id) {
      totalKeysLength += 1
    }
    if (content.meta.test_module_id) {
      totalKeysLength += 1
    }
    if (content.meta.test_suite_id) {
      totalKeysLength += 1
    }
    const itrCorrelationId = content.meta[ITR_CORRELATION_ID]
    if (itrCorrelationId) {
      totalKeysLength += 1
    }
    if (content.type) {
      totalKeysLength += 1
    }
    this._encodeMapPrefix(bytes, totalKeysLength)
    if (content.type) {
      this._encodeString(bytes, 'type')
      this._encodeString(bytes, content.type)
    }
    this._encodeString(bytes, 'trace_id')
    this._encodeId(bytes, content.trace_id)
    this._encodeString(bytes, 'span_id')
    this._encodeId(bytes, content.span_id)
    this._encodeString(bytes, 'parent_id')
    this._encodeId(bytes, content.parent_id)
    this._encodeString(bytes, 'name')
    this._encodeString(bytes, content.name)
    this._encodeString(bytes, 'resource')
    this._encodeString(bytes, content.resource)
    this._encodeString(bytes, 'service')
    this._encodeString(bytes, content.service)
    this._encodeString(bytes, 'error')
    this._encodeNumber(bytes, content.error)
    this._encodeString(bytes, 'start')
    this._encodeNumber(bytes, content.start)
    this._encodeString(bytes, 'duration')
    this._encodeNumber(bytes, content.duration)
    /**
     * We include `test_session_id` and `test_suite_id`
     * in the root of the event by passing them via the `meta` dict.
     * This is to avoid changing the span format in packages/dd-trace/src/format.js,
     * which can have undesired side effects in other products.
     * But `test_session_id` and `test_suite_id` are *not* supposed to be in `meta`,
     * so we delete them before enconding the dictionary.
     * TODO: find a better way to do this.
     */
    if (content.meta.test_session_id) {
      this._encodeString(bytes, 'test_session_id')
      this._encodeId(bytes, id(content.meta.test_session_id, 10))
      delete content.meta.test_session_id
    }

    if (content.meta.test_module_id) {
      this._encodeString(bytes, 'test_module_id')
      this._encodeId(bytes, id(content.meta.test_module_id, 10))
      delete content.meta.test_module_id
    }

    if (content.meta.test_suite_id) {
      this._encodeString(bytes, 'test_suite_id')
      this._encodeId(bytes, id(content.meta.test_suite_id, 10))
      delete content.meta.test_suite_id
    }

    if (itrCorrelationId) {
      this._encodeString(bytes, ITR_CORRELATION_ID)
      this._encodeString(bytes, itrCorrelationId)
      delete content.meta[ITR_CORRELATION_ID]
    }

    this._encodeString(bytes, 'meta')
    this._encodeMap(bytes, content.meta)
    this._encodeString(bytes, 'metrics')
    this._encodeMap(bytes, content.metrics)
  }

  _encodeEvent (bytes, event) {
    this._encodeMapPrefix(bytes, Object.keys(event).length)
    this._encodeString(bytes, 'type')
    this._encodeString(bytes, event.type)

    this._encodeString(bytes, 'version')
    this._encodeNumber(bytes, event.version)

    this._encodeString(bytes, 'content')
    if (event.type === 'span' || event.type === 'test') {
      this._encodeEventContent(bytes, event.content)
    } else if (event.type === 'test_suite_end') {
      this._encodeTestSuite(bytes, event.content)
    } else if (event.type === 'test_module_end') {
      this._encodeTestModule(bytes, event.content)
    } else if (event.type === 'test_session_end') {
      this._encodeTestSession(bytes, event.content)
    }
  }

  _encode (bytes, trace) {
    if (this._isReset) {
      this._encodePayloadStart(bytes)
      this._isReset = false
    }
    const startTime = Date.now()

    const rawEvents = trace.map(formatSpan)

    const testSessionEvents = rawEvents.filter(
      event => event.type === 'test_session_end' || event.type === 'test_suite_end' || event.type === 'test_module_end'
    )

    const isTestSessionTrace = !!testSessionEvents.length
    const events = isTestSessionTrace ? testSessionEvents : rawEvents

    this._eventCount += events.length

    for (const event of events) {
      this._encodeEvent(bytes, event)
    }
    distributionMetric(
      TELEMETRY_ENDPOINT_PAYLOAD_SERIALIZATION_MS,
      { endpoint: 'test_cycle' },
      Date.now() - startTime
    )
  }

  makePayload () {
    distributionMetric(TELEMETRY_ENDPOINT_PAYLOAD_EVENTS_COUNT, { endpoint: 'test_cycle' }, this._eventCount)
    const bytes = this._traceBytes
    const eventsOffset = this._eventsOffset
    const eventsCount = this._eventCount

    bytes.buffer[eventsOffset] = 0xDD
    bytes.buffer[eventsOffset + 1] = eventsCount >> 24
    bytes.buffer[eventsOffset + 2] = eventsCount >> 16
    bytes.buffer[eventsOffset + 3] = eventsCount >> 8
    bytes.buffer[eventsOffset + 4] = eventsCount

    const traceSize = bytes.length
    const buffer = Buffer.allocUnsafe(traceSize)

    bytes.buffer.copy(buffer, 0, 0, traceSize)

    this.reset()

    return buffer
  }

  _encodePayloadStart (bytes) {
    // encodes the payload up to `events`. `events` will be encoded via _encode
    const payload = {
      version: ENCODING_VERSION,
      metadata: {
        '*': {
          language: 'javascript',
          library_version: ddTraceVersion
        },
        ...this.metadataTags
      },
      events: []
    }

    if (this.env) {
      payload.metadata['*'].env = this.env
    }
    if (this.runtimeId) {
      payload.metadata['*']['runtime-id'] = this.runtimeId
    }

    this._encodeMapPrefix(bytes, Object.keys(payload).length)
    this._encodeString(bytes, 'version')
    this._encodeNumber(bytes, payload.version)
    this._encodeString(bytes, 'metadata')
    this._encodeMapPrefix(bytes, Object.keys(payload.metadata).length)
    this._encodeString(bytes, '*')
    this._encodeMap(bytes, payload.metadata['*'])
    if (payload.metadata.test) {
      this._encodeString(bytes, 'test')
      this._encodeMap(bytes, payload.metadata.test)
    }
    if (payload.metadata.test_suite_end) {
      this._encodeString(bytes, 'test_suite_end')
      this._encodeMap(bytes, payload.metadata.test_suite_end)
    }
    if (payload.metadata.test_module_end) {
      this._encodeString(bytes, 'test_module_end')
      this._encodeMap(bytes, payload.metadata.test_module_end)
    }
    if (payload.metadata.test_session_end) {
      this._encodeString(bytes, 'test_session_end')
      this._encodeMap(bytes, payload.metadata.test_session_end)
    }
    this._encodeString(bytes, 'events')
    // Get offset of the events list to update the length of the array when calling `makePayload`
    this._eventsOffset = bytes.length
    bytes.reserve(5)
  }

  reset () {
    this._reset()
    this._eventCount = 0
    this._isReset = true
  }
}

module.exports = { AgentlessCiVisibilityEncoder }
