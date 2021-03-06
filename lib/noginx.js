'use strict';

var Cache = require('./cache')
var Zlib = require('zlib')
/**
 *  @usage 
 *      app.use(noginx([
 *          <RegExp>,
 *          {
 *              rule: <RegExp>, // route match rule
 *              maxAge: <Number>, // ms, the cache data expired time
 *              keyQueries: [<String>, <String>], // picking params of query as cache-key
 *              timeout: <Number>, // ms, max waitting time when cache unhit
 *              gzip: <Boolean> // default is false, will auto detect compress by headers with "Accept-Encoding: gzip"
 *          }
 *      ]), {
 *          maxAge: 3*1000, // ms, default 3000
 *          maxQueueSize: 5000, // default 5000
 *          timeout: 100 // ms, default 100,
 *          debug: <Boolean> // default is false,
 *          logger: <Function> // Optional, log function
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
function _isLiteral (obj) {
    var t = _type(obj)
    return t == 'string' || t == 'number' || t == 'null' || t == 'boolean'
}
function _formatNumber (num, div) {
    num = parseInt(num/div)*div
    return num + '~' + (num + div)
}
function _checkGzipHead (req) {
    var ecoding = req.headers['Accept-Encoding'] || req.headers['accept-encoding']
    return ecoding && ~ecoding.indexOf('gzip')
}

function _stringGzip (str, callback) {
    var buf = new Buffer(str, 'utf-8')
    return Zlib.gzip(buf, callback)
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
        var useGzip = false

        // rule match
        if ( (req.method || '').toUpperCase() != 'GET' || !rules.some(function(r) {
            if (r.rule.test(urlPath)) {
                maxAge = r.maxAge || MAX_AGE
                timeout = r.timeout || TIMEOUT
                useGzip = !!r.gzip
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
            var headers = hitedCache.headers
            res.setHeader('X-Noginx', 'hit')
            headers['Content-Type'] && res.setHeader('Content-Type', headers['Content-Type'])
            headers['Cache-Control'] && res.setHeader('Cache-Control', headers['Cache-Control'])
            res.status(200)
            if (useGzip && _checkGzipHead(req)) {
                res.setHeader('Content-Encoding', 'gzip')
                return res.send(hitedCache.buf)
            }
            return res.send(hitedCache.str)
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
                req: req,
                res: res
            })
            _requestQueue[cacheKey] = queue
            return
        } else {
            // request for api
            _penddings[cacheKey] = true
        }
        debug('[Noginx] Through: Path=' + urlPath + ' CacheKey=' + cacheKey + ' Gzip=' + useGzip + ' URL=' + req.url)
        res.setHeader('X-Noginx', 'through')

        var _render = res.render
        var _send = res.send
        var _json = res.json
        var _redirect = res.redirect
        var requestEnd
        var isTimeout
        var timer // 定时器，检验请求超时

        
        function requestHandler (err, str, statusCode, buf) {

            _penddings[cacheKey] = false

            var queue = _requestQueue[cacheKey]
            // 释放请求队列
            _requestQueue[cacheKey] = null

            var contentType = res.getHeader('Content-Type')
            var cacheControl = res.getHeader('Cache-Control')
            var btype = _type(str)
            var isJSON = btype == 'object' || btype == 'array'
            var isText = btype == 'string'

            if (!contentType) {
                if (isJSON) {
                    contentType = 'application/json; charset=utf-8'
                } else if (isText) {
                    contentType = 'text/html; charset=utf-8'
                }
            }

            // 缓存内容存在且 truly 时存进缓存中
            if (!err && str) {
                _caches.set(cacheKey, {
                    str: str,
                    buf: buf,
                    headers: {
                        'Content-Type': contentType,
                        'Cache-Control': cacheControl
                    }
                }, maxAge)
            }
            // flush request queue
            if (queue && queue.length) {
                if (err) {
                    queue.forEach(function(item) {
                        item.res.status(statusCode || 500).send(err)
                    })
                } else {
                    queue.forEach(function(item) {
                        var ires = item.res
                        var ireq = item.req

                        cacheControl && ires.setHeader('Cache-Control', cacheControl)
                        ires.setHeader('Content-Type', contentType)
                        ires.status(statusCode || 200)

                        if (buf && _checkGzipHead(ireq)) {
                            ires.setHeader('Content-Encoding', 'gzip')
                            return ires.send(buf)
                        }
                        return ires.send(str)
                    })
                }
            }

            if (err) {
                res.status(statusCode || 500)
                // 会出现逻辑层在调用send之后再调用setHeader的情况，此处容错
                return _send.call(res, err)
            }
            res.setHeader('Content-Type', contentType)
            res.status(statusCode || 200)

            if (buf && _checkGzipHead(req)) {
                res.setHeader('Content-Encoding', 'gzip')
                return _send.call(res, buf)
            }
            return _send.call(res, str)
        }
        
        var start = +new Date
        res.render = function(tpl, data, fn) {
            if (isTimeout) {
                var firstUsedTime = +new Date - start
                debug('[Noginx] Discard_before_render: Path=' + urlPath + ' CacheKey=' + cacheKey
                    + ' Time=' + _formatNumber(firstUsedTime, 100)
                    + ' Time_Actual=' + firstUsedTime
                )
                return
            }
            if (requestEnd) return

            return _render.call(res, tpl, data, function(err, str) {
                // 已超时就丢弃
                if (isTimeout || requestEnd) return
                clearTimeout(timer)

                var queueLen = _requestQueue[cacheKey] ? _requestQueue[cacheKey].length : 0
                var usedTime = +new Date - start
                debug('[Noginx] Render: Path=' + urlPath + ' CacheKey=' + cacheKey + ' Gzip=' + useGzip 
                    + ' Queue=' + _formatNumber(queueLen, 10) 
                    + ' Time=' + _formatNumber(usedTime, 100)
                    + ' Queue_Actual=' + queueLen
                    + ' Time_Actual=' + usedTime
                )

                // 避免逻辑层调用了render后还调用send引起的异常
                requestEnd = true
                // 由于gzip是异步接口（node 10.x不支持同步gzip），所以在此处进行gzip
                if (!err && useGzip && str) {
                    var oralStr = str
                    if (typeof str == 'object') {
                        str = JSON.stringify(str)
                    }
                    _stringGzip(str, function (error, buf) {
                        //            (error, chunk, statusCode, zipBuffer)
                        requestHandler(null, oralStr, null, !error ? buf : null)
                    })
                } else {
                    requestHandler(err, str)
                }
            })
        }
        /**
         *  混存的接口应避免使用这个方法，提供这个方法的原因只是为了容错
         *  因为使用Send接口，HTTP StatusCode 的获取存在不确定性
         */
        res.send = function (/*[statuCode, ]*/body) {
            var usedTime = +new Date - start
            if (isTimeout) {
                debug('[Noginx] Discard_before_send: Path=' + urlPath + ' CacheKey=' + cacheKey
                    + ' Time=' + _formatNumber(usedTime, 100),
                    + ' Time_Actual=' + usedTime
                )
                return
            }
            // 一调用就，已超时就丢弃
            if (requestEnd) return

            var queueLen = _requestQueue[cacheKey] ? _requestQueue[cacheKey].length : 0
            debug('[Noginx] Send: Path=' + urlPath + ' CacheKey=' + cacheKey  + ' Gzip=' + useGzip
                + ' Queue=' + _formatNumber(queueLen, 10) 
                + ' Time=' + _formatNumber(usedTime, 100)
                + ' Queue_Actual=' + queueLen
                + ' Time_Actual=' + usedTime
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
            var btype = _type(body)
            if (useGzip && body && (btype == 'object' || btype == 'array' || btype == 'string')) {
                var oralBody = body
                if (btype == 'object' || btype == 'array') {
                    body = JSON.stringify(body)
                }
                _stringGzip(body, function (error, buf) {
                    requestHandler(null, oralBody, statusCode, !error ? buf : null)
                })
            } else {
                // 带上状态码
                requestHandler(null, body, statusCode)
            }
        }

        res.json = function (obj) {
            var usedTime = +new Date - start
            if (isTimeout) {
                debug('[Noginx] Discard_before_json: Path=' + urlPath + ' CacheKey=' + cacheKey
                    + ' Time=' + _formatNumber(+new Date - start, 100)
                    + ' Time_Actual=' + usedTime
                )
                return
            }
            // 已超时就丢弃
            if (requestEnd) return
            clearTimeout(timer)

            var queueLen = _requestQueue[cacheKey] ? _requestQueue[cacheKey].length : 0
            debug('[Noginx] Json: Path=' + urlPath + ' CacheKey=' + cacheKey  + ' Gzip=' + useGzip
                + ' Queue=' + _formatNumber(queueLen, 10) 
                + ' Queue_Actual=' + queueLen
                + ' Time=' + _formatNumber(usedTime, 100)
                + ' Time_Actual=' + usedTime

            )

            // 避免逻辑层调用了render后还调用send引起的异常
            requestEnd = true
            
            var body = JSON.stringify(obj)
            // content-type
            if (!this.get('Content-Type')) {
                this.set('Content-Type', 'application/json')
            }
            if (useGzip && body) {
                _stringGzip(body, function (error, buf) {
                    requestHandler(null, body, 200, !error ? buf : null)
                })
            } else {
                requestHandler(null, body, 200)
            }
        }

        res.redirect = function (url) {
            var usedTime = +new Date - start
            if (isTimeout) {
                debug('[Noginx] Discard_before_redirect: Path=' + urlPath + ' CacheKey=' + cacheKey
                    + ' Time=' + _formatNumber(+new Date - start, 100)
                    + ' Time_Actual=' + usedTime
                )
                return
            }
            if (requestEnd) return
            clearTimeout(timer)

            var queueLen = _requestQueue[cacheKey] ? _requestQueue[cacheKey].length : 0
            debug('[Noginx] Redirect: Path=' + urlPath + ' CacheKey=' + cacheKey  + ' Redirect=' + url 
                + ' Queue=' + _formatNumber(queueLen, 10)
                + ' Queue_Actual=' + queueLen
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
            return _redirect.call(res, url)
        }

        timer = setTimeout(function() {
            if (requestEnd) return
            
            debug('[Noginx] Timeout: Path=' + urlPath + ' CacheKey=' + cacheKey + ' Gzip=' + useGzip + ' Timeout=' + timeout
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