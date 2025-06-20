'use strict'

const { globMatch } = require('../src/util')
const RateLimiter = require('./rate_limiter')
const Sampler = require('./sampler')
const log = require('./log')

class AlwaysMatcher {
  match () {
    return true
  }
}

class GlobMatcher {
  constructor (pattern, locator) {
    this.pattern = pattern
    this.locator = locator
  }

  match (span) {
    const subject = this.locator(span)
    if (!subject) return false
    return globMatch(this.pattern, subject)
  }
}

class RegExpMatcher {
  constructor (pattern, locator) {
    this.pattern = pattern
    this.locator = locator
  }

  match (span) {
    const subject = this.locator(span)
    if (!subject) return false
    return this.pattern.test(subject)
  }
}

function matcher (pattern, locator) {
  if (pattern instanceof RegExp) {
    return new RegExpMatcher(pattern, locator)
  }

  if (typeof pattern === 'string' && pattern !== '*' && pattern !== '**' && pattern !== '***') {
    return new GlobMatcher(pattern, locator)
  }
  return new AlwaysMatcher()
}

function makeTagLocator (tag) {
  return (span) => span.context()._tags[tag]
}

function nameLocator (span) {
  return span.context()._name
}

function serviceLocator (span) {
  const { _tags: tags } = span.context()
  return tags.service ||
    tags['service.name'] ||
    span.tracer()._service
}

function resourceLocator (span) {
  const { _tags: tags } = span.context()
  return tags.resource ||
    tags['resource.name']
}

class SamplingRule {
  constructor ({ name, service, resource, tags, sampleRate = 1, provenance, maxPerSecond } = {}) {
    this.matchers = []

    if (name) {
      this.matchers.push(matcher(name, nameLocator))
    }
    if (service) {
      this.matchers.push(matcher(service, serviceLocator))
    }
    if (resource) {
      this.matchers.push(matcher(resource, resourceLocator))
    }
    for (const [key, value] of Object.entries(tags || {})) {
      this.matchers.push(matcher(value, makeTagLocator(key)))
    }

    this._sampler = new Sampler(sampleRate)
    this._limiter = undefined
    this.provenance = provenance

    if (Number.isFinite(maxPerSecond)) {
      this._limiter = new RateLimiter(maxPerSecond)
    }
  }

  static from (config) {
    return new SamplingRule(config)
  }

  get sampleRate () {
    return this._sampler.rate()
  }

  get effectiveRate () {
    return this._limiter && this._limiter.effectiveRate()
  }

  get maxPerSecond () {
    return this._limiter && this._limiter._rateLimit
  }

  match (span) {
    const context = span.context()
    const spanResource = context._tags.resource || context._tags['resource.name']
    const spanName = context._name
    const spanService = context._tags.service || context._tags['service.name'] || span.tracer()._service

    log.info(`[SAMPLING RULE DEBUG ${spanResource}] Checking rule match for span: name=${spanName}, resource=${spanResource}, service=${spanService}`)

    for (const matcher of this.matchers) {
      // Rule is a special object with a .match() property.
      // It has nothing to do with a regular expression.
      // eslint-disable-next-line unicorn/prefer-regexp-test
      const matchResult = matcher.match(span)
      log.info(`[SAMPLING RULE DEBUG ${spanResource}] Matcher result: ${matchResult}, pattern: ${matcher.pattern || 'always'}, locator: ${matcher.locator ? matcher.locator.name : 'unknown'}`)
      if (!matchResult) {
        return false
      }
    }

    log.info(`[SAMPLING RULE DEBUG ${spanResource}] Rule matched! sampleRate=${this.sampleRate}`)
    return true
  }

  /**
   * Determines whether a span should be sampled based on the configured sampling rule.
   *
   * @param {Span|SpanContext} span - The span or span context to evaluate.
   * @returns {boolean} `true` if the span should be sampled, otherwise `false`.
   */
  sample (span) {
    const samplerResult = this._sampler.isSampled(span)
    // span is actually a SpanContext, not a Span object
    const spanResource = span._tags.resource || span._tags['resource.name']
    log.info(`[SAMPLING RULE DEBUG ${spanResource}] Sampler result: ${samplerResult}, rate: ${this._sampler.rate()}`)

    if (!samplerResult) {
      return false
    }

    if (this._limiter) {
      const limiterResult = this._limiter.isAllowed()
      log.info(`[SAMPLING RULE DEBUG ${spanResource}] Rate limiter result: ${limiterResult}, effectiveRate: ${this._limiter.effectiveRate()}`)
      return limiterResult
    }

    return true
  }
}

module.exports = SamplingRule
