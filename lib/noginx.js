'use strict';

var Cache = require('./cache')
/**
 *  @usage 
 *      app.use(noginx([
 *          <RegExp>,
 *          {
 *              rule: <RegExp>, // RegExp
 *              maxAge: <Number>, // ms, default is "defaultMaxAge"
 *              keyQueries: [<String>, <String>] //
 *          }
 *      ]), {
 *          defaultMaxAge: 3*1000, // ms, default 3000
 *          maxQueueSize: 5000, // default 5000
 *          timeout: 100 // ms, default 100
 *      })
 *
 */

function nogix(rules, opts) {

    var _conf = opts || {}
    var _caches = new Cache({
        max: 1000,
        maxAge: 3*1000,
        freePercent: 0.4
    })
    var _penddings = {}
    var _requestQueue = {}

    var DEFAULT_MAX_AGE = _conf.defaultMaxAge || 3*1000
    var MAX_QUEUE_SIZE = _conf.maxQueueSize || 5000
    var TIMEOUT = _conf.timeout || 100

    function getKey (req) {
        return req.url
    }
    rules = rules.map(function (r) {
        if (r instanceof RegExp) {
            return {
                rule: RegExp
            }
        } else if (Object.prototype.toString.call(r) == 'object' && r.rule instanceof RegExp) {
            return r
        } else {
            throw new Error('Unvalid rule of path')
        }
    })

    return function(req, res, next) {

        var cacheKey = req.url
        var urlPath = cacheKey.split('?')[0]
        var maxAge
        // rule match
        if ( (req.method || '').toUpperCase() != 'GET' || !rules.some(function(r) {
            if (r.rule.test(urlPath)) {
                maxAge = r.maxAge || DEFAULT_MAX_AGE
                // 只使用部分配置的参数作为key
                if (r.keyQueries) {
                    cacheKey = urlPath + '?' + r.keyQueries.map(function (k) {
                        return k + '=' + req.query[k]
                    }).join('&')
                }
                return true
            }
        })) {
            return next()
        }

        var hitedCache = _caches.get(cacheKey)
        
        // if hit
        if (hitedCache) {
            return res.send(hitedCache)
        } else if (_penddings[cacheKey]) {
            // allot
            var queue = _requestQueue[cacheKey] || []

            // 过载保护，服务器无法处理请求
            if (queue.length >= MAX_QUEUE_SIZE) return res.status(503).send('Server is busy.')

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

        var _render = res.render
        var _send = res.send
        var _setHeader = res.setHeader
        var requestEnd
        var isTimeout
        var timer // 定时器，检验请求超时

        function requestHandler (err, str, statusCode) {
            _penddings[cacheKey] = false
            
            // 混存内容存在且 truly 时存进缓存中
            !err && str && _caches.set(cacheKey, str)

            var queue = _requestQueue[cacheKey]
            // 释放请求队列
            _requestQueue[cacheKey] = null

            if (queue && queue.length) {
                if (err) {
                    queue.forEach(function(item) {
                        item.req.next(err)
                    })
                } else {
                    queue.forEach(function(item) {
                        item.res.status(statusCode || 200).send(str)
                    })
                }
            }
            if (err) return req.next(err)

            res.status(statusCode || 200)
            _send.call(res, str)
        }
        res.render = function(tpl, data, fn) {
            _render.call(res, tpl, data, function(err, str) {
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
        res.send = function ([statuCode, ]body) {
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
            }
            // 带上状态码
            requestHandler(null, body, statusCode)
        }

        res.setHeader = function (key, value) {
            var queue = _requestQueue[cacheKey]
            if (queue && queue.length) {
                queue.forEach(function (item) {
                    item.res.setHeader(key, value)
                })
            }
            _setHeader.call(res, key, value)
        }

        timer = setTimeout(function() {
            isTimeout = true
            requestHandler('Request timeout.')
        }, TIMEOUT)

        next()
    }
}


module.exports = nogix