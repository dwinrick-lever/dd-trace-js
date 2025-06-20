'use strict'

const request = require('../common/request')
const { startupLog } = require('../../startup-log')
const runtimeMetrics = require('../../runtime_metrics')
const log = require('../../log')
const tracerVersion = require('../../../../../package.json').version
const BaseWriter = require('../common/writer')

const METRIC_PREFIX = 'datadog.tracer.node.exporter.agent'

class Writer extends BaseWriter {
  constructor ({ prioritySampler, lookup, protocolVersion, headers, config = {} }) {
    super(...arguments)
    const AgentEncoder = getEncoder(protocolVersion)

    this._prioritySampler = prioritySampler
    this._lookup = lookup
    this._protocolVersion = protocolVersion
    this._headers = headers
    this._config = config
    this._encoder = new AgentEncoder(this)
  }

  _sendPayload (data, count, done) {
    runtimeMetrics.increment(`${METRIC_PREFIX}.requests`, true)

    const { _headers, _lookup, _protocolVersion, _url } = this
    makeRequest(_protocolVersion, data, count, _url, _headers, _lookup, true, (err, res, status) => {
      if (status) {
        runtimeMetrics.increment(`${METRIC_PREFIX}.responses`, true)
        runtimeMetrics.increment(`${METRIC_PREFIX}.responses.by.status`, `status:${status}`, true)
      } else if (err) {
        runtimeMetrics.increment(`${METRIC_PREFIX}.errors`, true)
        runtimeMetrics.increment(`${METRIC_PREFIX}.errors.by.name`, `name:${err.name}`, true)

        if (err.code) {
          runtimeMetrics.increment(`${METRIC_PREFIX}.errors.by.code`, `code:${err.code}`, true)
        }
      }

      startupLog({ agentError: err })

      if (err) {
        log.error('Error sending payload to the agent (status code: %s)', err.status, err)
        done()
        return
      }

      log.debug('Response from the agent: %s', res)

      try {
        this._prioritySampler.update(JSON.parse(res).rate_by_service)
      } catch (e) {
        log.error('Error updating prioritySampler rates', e)

        runtimeMetrics.increment(`${METRIC_PREFIX}.errors`, true)
        runtimeMetrics.increment(`${METRIC_PREFIX}.errors.by.name`, `name:${e.name}`, true)
      }
      done()
    })
  }
}

function setHeader (headers, key, value) {
  if (value) {
    headers[key] = value
  }
}

function getEncoder (protocolVersion) {
  return protocolVersion === '0.5'
    ? require('../../encode/0.5').AgentEncoder
    : require('../../encode/0.4').AgentEncoder
}

function makeRequest (version, data, count, url, headers, lookup, needsStartupLog, cb) {
  const options = {
    path: `/v${version}/traces`,
    method: 'PUT',
    headers: {
      ...headers,
      'Content-Type': 'application/msgpack',
      'Datadog-Meta-Tracer-Version': tracerVersion,
      'X-Datadog-Trace-Count': String(count)
    },
    lookup,
    url
  }

  setHeader(options.headers, 'Datadog-Meta-Lang', 'nodejs')
  setHeader(options.headers, 'Datadog-Meta-Lang-Version', process.version)
  setHeader(options.headers, 'Datadog-Meta-Lang-Interpreter', process.jsEngine || 'v8')

  log.debug(() => `Request to the agent: ${JSON.stringify(options)}`)

  request(data, options, (err, res, status) => {
    if (needsStartupLog) {
      // Note that logging will only happen once, regardless of how many times this is called.
      startupLog({
        agentError: status !== 404 && status !== 200 ? err : undefined
      })
    }
    cb(err, res, status)
  })
}

module.exports = Writer
