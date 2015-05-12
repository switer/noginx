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

function noginx(rules, opts) {

    var _conf = opts || {}
    var _caches = new Cache({
        max: 1000,
        maxAge: 3*1000,
        freePercent: 0.4
    })
    var _penddings = {}
    var _requestQueue = {}

    var MAX_AGE = _conf.maxAge || 3*1000
    var MAX_QUEUE_SIZE = _conf.maxQueueSize || 5000
    var TIMEOUT = _conf.timeout || 100

    var debug = _conf.debug ? Log : NOOP
    rules = rules.map(function (r) {
        if (r instanceof RegExp) {
            return {
                rule: r
            }
        } else if (Object.prototype.toString.call(r) == '[object Object]' && r.rule instanceof RegExp) {
            return r
        } else {
            throw new Error('Unvalid rule of path')
        }
    })

    return function(req, res, next) {
        var cacheKey = req.url
        var urlPath = cacheKey.split('?')[0]
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
                debug('[Noginx] Match: Path=', urlPath, ' CacheKey=', cacheKey, ' Timeout=', timeout)
                return true
            }
        })) {
            return next()
        }
        var hitedCache = _caches.get(cacheKey)
        // if hit
        if (hitedCache) {
            debug('[Noginx] Hit: Path=' + urlPath + ' CacheKey=' + cacheKey)
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
        res.setHeader('X-Noginx', 'through')

        var _render = res.render
        var _send = res.send
        var _json = res.json
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
                debug('[Noginx] Render: Path=' + urlPath + ' CacheKey=' + cacheKey  + ' Timeout=' + timeout
                    + ' Queue=' + (_requestQueue[cacheKey] ? _requestQueue[cacheKey].length : 0)+ ' Time=' + (+new Date - start) )

                clearTimeout(timer)
                // 已超时就丢弃
                if (isTimeout || requestEnd) return
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
                    + ' Queue=' + (_requestQueue[cacheKey] ? _requestQueue[cacheKey].length : 0)+ ' Time=' + (+new Date - start) )

            clearTimeout(timer)
            // 已超时就丢弃
            if (isTimeout || requestEnd) return
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
            debug('[Noginx] Json: Path=' + urlPath + ' CacheKey=' + cacheKey  + ' Timeout=' + timeout
                + ' Queue=' + (_requestQueue[cacheKey] ? _requestQueue[cacheKey].length : 0)+ ' Time=' + (+new Date - start) )
            clearTimeout(timer)

            // 已超时就丢弃
            if (isTimeout || requestEnd) return
            // 避免逻辑层调用了render后还调用send引起的异常
            requestEnd = true
            
            var body = JSON.stringify(obj)
            // content-type
            if (!this.get('Content-Type')) {
                this.set('Content-Type', 'application/json');
            }
            requestHandler(null, body, 200)
        }

        timer = setTimeout(function() {
            debug('[Noginx] Timeout: Path=' + urlPath + ' CacheKey=' + cacheKey  + ' Timeout=' + timeout
                + ' Queue=' + (_requestQueue[cacheKey] ? _requestQueue[cacheKey].length : 0)+ ' Time=' + (+new Date - start) )

            isTimeout = true
            requestHandler('Request timeout.', null, 504)
        }, timeout)

        next()
    }
}


module.exports = noginx