'use strict';

var Cache = require('./cache')
/**
 *  @usage 
 *      app.use(noginx([
 *          <RegExp>,
 *          {
 *              rule: <RegExp>, // route match rule
 *              maxAge: <Number>, // ms, the cache data expired time
 *              keyQueries: [<String>, <String>], // picking params of query as cache-key
 *              timeout: <Number> // ms, max waitting time when cache unhit
 *          }
 *      ]), {
 *          maxAge: 3*1000, // ms, default 3000
 *          maxQueueSize: 5000, // default 5000
 *          timeout: 100 // ms, default 100
 *      })
 *
 */
function NOOP () {}
function Log () {
    console.log.apply(console, arguments)
}
function _type (r) {
    return Object.prototype.toString.call(r).match(/\[object ([\w]+)\]/)[1].toLowerCase()
}
function _formatNumber (num, div) {
    return parseInt(num/div) + '~' + num
}
function noginx(rules, opts) {

    var _conf = opts || {}
    var MAX_AGE = _conf.maxAge || 3*1000 // 全局默认的3秒缓存
    var MAX_QUEUE_SIZE = _conf.maxQueueSize || 5000 // 队列默认最大5000的排队数
    var TIMEOUT = _conf.timeout || 500

    var _caches = new Cache({
        max: _conf.maxCache || 5000,
        maxAge: MAX_AGE,
        freePercent: _conf.cacheFreePercent || 0.4
    })
    var _penddings = {}
    var _requestQueue = {}


    var debug = Log

    if (_conf.logger && _type(_conf.logger) == 'function') {
        debug = _conf.logger
    } else if (_conf.logger) {
        console.error('[Noginx] Error: logger type is unvalid.')
    }
    debug = _conf.debug ? debug : NOOP

    _caches.setLogger(debug)

    rules = rules.map(function (r) {
        if (r instanceof RegExp) {
            return {
                rule: r
            }
        } else if (_type(r) == 'object' && r.rule instanceof RegExp) {
            return r
        } else {
            throw new Error('Unvalid rule of path')
        }
    })

    return function(req, res, next) {
        var cacheKey = req.url
        var urlPath = (cacheKey || '').split('?')[0]
        var maxAge
        var timeout

        // rule match
        if ( (req.method || '').toUpperCase() != 'GET' || !rules.some(function(r) {
            if (r.rule.test(urlPath)) {
                maxAge = r.maxAge || MAX_AGE
                timeout = r.timeout || TIMEOUT
                // 只使用部分配置的参数作为key
                if (r.keyQueries) {
                    cacheKey = urlPath + '?' + r.keyQueries.map(function (k) {
                        return k + '=' + req.query[k]
                    }).join('&')
                }
                // debug('[Noginx] Match: Path=' + urlPath + ' CacheKey=' + cacheKey + ' URL=' + req.url)
                return true
            }
        })) {
            return next()
        }
        var hitedCache = _caches.get(cacheKey)
        // if hit
        if (hitedCache) {
            // debug('[Noginx] Hit: Path=' + urlPath + ' CacheKey=' + cacheKey)
            res.setHeader('X-Noginx', 'hit')
            return res.status(200).send(hitedCache)
        } else if (_penddings[cacheKey]) {
            // allot
            var queue = _requestQueue[cacheKey] || []

            // 过载保护，服务器无法处理请求
            if (queue.length >= MAX_QUEUE_SIZE) {
                debug('[Noginx] Refuse: Path=' + urlPath + ' CacheKey=' + cacheKey)
                res.setHeader('X-Noginx', 'refuse')
                return res.status(503).send('Server is busy.')
            }

            // debug('[Noginx] Queue: Path=' + urlPath + ' CacheKey=' + cacheKey)
            res.setHeader('X-Noginx', 'queue')
            queue.push({
                res: res
            })
            _requestQueue[cacheKey] = queue
            return
        } else {
            // request for api
            _penddings[cacheKey] = true
        }
        debug('[Noginx] Through: Path=' + urlPath + ' CacheKey=' + cacheKey + 'URL=' + req.url)
        res.setHeader('X-Noginx', 'through')

        var _render = res.render
        var _send = res.send
        var _json = res.json
        var _redirect = res.redirect
        var requestEnd
        var isTimeout
        var timer // 定时器，检验请求超时

        
        function requestHandler (err, str, statusCode) {

            _penddings[cacheKey] = false
            
            // 缓存内容存在且 truly 时存进缓存中
            !err && str && _caches.set(cacheKey, str, maxAge)

            var queue = _requestQueue[cacheKey]
            // 释放请求队列
            _requestQueue[cacheKey] = null

            var contentType = res.getHeader('Content-Type')
            var cacheControl = res.getHeader('Cache-Control')

            if (queue && queue.length) {
                if (err) {
                    queue.forEach(function(item) {
                        item.res.status(statusCode || 500).send(err)
                    })
                } else {
                    queue.forEach(function(item) {
                        contentType && item.res.setHeader('Content-Type', contentType)
                        cacheControl && item.res.setHeader('Cache-Control', cacheControl)
                        item.res.status(statusCode || 200).send(str)
                    })
                }
            }

            if (err) {
                res.status(statusCode || 500)
                _send.call(res, err)
                // 会出现逻辑层在调用send之后再调用setHeader的情况，此处容错
                // res.setHeader = NOOP
                return
            }
            res.status(statusCode || 200)
            _send.call(res, str)
            // res.setHeader = NOOP
        }
        
        var start = +new Date
        res.render = function(tpl, data, fn) {
            if (isTimeout || requestEnd) return

            _render.call(res, tpl, data, function(err, str) {
                // 已超时就丢弃
                if (isTimeout || requestEnd) return
                clearTimeout(timer)

                debug('[Noginx] Render: Path=' + urlPath + ' CacheKey=' + cacheKey  + ' Timeout=' + timeout
                    + ' Queue=' + _formatNumber(_requestQueue[cacheKey] ? _requestQueue[cacheKey].length : 0, 10) 
                    + ' Time=' + _formatNumber(+new Date - start, 100)
                )

                // 避免逻辑层调用了render后还调用send引起的异常
                requestEnd = true
                requestHandler(err, str)
            })
        }
        /**
         *  混存的接口应避免使用这个方法，提供这个方法的原因只是为了容错
         *  因为使用Send接口，HTTP StatusCode 的获取存在不确定性
         */
        res.send = function (/*[statuCode, ]*/body) {
            // 一调用就，已超时就丢弃
            if (isTimeout || requestEnd) return

            debug('[Noginx] Send: Path=' + urlPath + ' CacheKey=' + cacheKey  + ' Timeout=' + timeout
                    + ' Queue=' + _formatNumber(_requestQueue[cacheKey] ? _requestQueue[cacheKey].length : 0, 10) 
                    + ' Time=' + _formatNumber(+new Date - start, 100)
            )

            clearTimeout(timer)
            // 已超时就丢弃
            // 避免逻辑层调用了render后还调用send引起的异常
            requestEnd = true

            var statusCode = this.statusCode
            if (arguments.length === 2 && typeof arguments[0] === 'number') {
                // 执行到这，方法的参数列表为 res.send(status, body)
                statusCode = body
                body = arguments[1]
            } else if (arguments.length === 1 && typeof arguments[0] === 'number') {
                // 执行到这，方法的参数列表为 res.send(status)
                statusCode = body
                body = ''
            }
            // 带上状态码
            requestHandler(null, body, statusCode)
        }

        res.json = function (obj) {
            // 已超时就丢弃
            if (isTimeout || requestEnd) return
            clearTimeout(timer)

            debug('[Noginx] Json: Path=' + urlPath + ' CacheKey=' + cacheKey  + ' Timeout=' + timeout
                + ' Queue=' + _formatNumber(_requestQueue[cacheKey] ? _requestQueue[cacheKey].length : 0, 10) 
                + ' Time=' + _formatNumber(+new Date - start, 100)
            )

            // 避免逻辑层调用了render后还调用send引起的异常
            requestEnd = true
            
            var body = JSON.stringify(obj)
            // content-type
            if (!this.get('Content-Type')) {
                this.set('Content-Type', 'application/json');
            }
            requestHandler(null, body, 200)
        }

        res.redirect = function (url) {
            if (isTimeout || requestEnd) return
            clearTimeout(timer)

            debug('[Noginx] Redirect: Path=' + urlPath + ' CacheKey=' + cacheKey  + ' Redirect=' + url 
                + ' Queue=' + _formatNumber(_requestQueue[cacheKey] ? _requestQueue[cacheKey].length : 0, 10)
            )

            requestEnd = true
            _penddings[cacheKey] = false

            var args = arguments
            var queue = _requestQueue[cacheKey]
            // 释放请求队列
            _requestQueue[cacheKey] = null

            if (queue && queue.length) {
                queue.forEach(function(item) {
                    item.res.redirect.call(item.res, url)
                })
            }
            _redirect.call(res, url)
        }

        timer = setTimeout(function() {
            if (requestEnd) return
            
            debug('[Noginx] Timeout: Path=' + urlPath + ' CacheKey=' + cacheKey  + ' Timeout=' + timeout
                + ' Queue=' + _formatNumber(_requestQueue[cacheKey] ? _requestQueue[cacheKey].length : 0, 10) 
                + ' Time=' + _formatNumber(+new Date - start, 100)
            )

            isTimeout = true
            requestHandler('Request timeout.', null, 504)
        }, timeout)

        next()
    }
}


module.exports = noginx