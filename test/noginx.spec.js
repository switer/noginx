function Noop () {}

function Request (method, url) {
    this.next = Noop
    this.method = method
    this.url = url
    this.query = (function (s) {
        var qs = {}
        var ps = s.split('&')
        ps.forEach(function (kv) {
            qs[kv.split('=')[0]] = kv.split('=')[1]
        })
        return qs
    })(this.url.split('?')[1] || '')
}

function Response (send, render) {
    this.render = render || Noop
    this.send = send || Noop
    this.setHeader = function (k, v) {
        this.headers[k] = v
        return this
    }
    this.getHeader = function (k) {
        return this.headers[k]
    }
    this.status = function (code) {
        this.statusCode = code
        return this
    }
    this.type = function (t) {
        if (t == 'json') this.headers['Content-Type'] = ['application/json']
        return this
    }
    this.headers = {}
}

module.exports = function (assert, noginx) {
    describe('Noginx', function () {
        var tpls = {
            'index.tpl': '<body>index</body>',
            'chatting.tpl': '<body>chatting</body>'
        }
        var middleware = noginx([
                /^\/$/,
                {
                    rule: /^\/chatting\/?$/,
                    keyQueries: ['tab'],
                    timeout: 100,
                    maxAge: 200
                }
            ], {
                maxQueueSize: 10
            })
        describe('# Rule and tpl render', function (done) {
            it('Simple RegExp rule match which 20 concurrences', function (done) {
                var through
                var requests = []
                var c = 20
                var n = c
                var t = 0

                var queueCount = 0
                var throughCount = 0
                var refuseCount = 0
                while(n --) {
                    var req = new Request('get', '/')
                    var res = new Response(function (body) {
                            // send
                            t ++
                            var type = this.headers['X-Noginx']

                            switch (type) {
                                case 'queue': queueCount ++;
                                    break;
                                case 'through': throughCount ++;
                                    break;
                                case 'refuse': refuseCount ++;
                                    break;
                            }
                            if (type == 'refuse') {
                                assert.equal(this.statusCode, 503)
                            } else {
                                assert.equal(this.headers['Content-Type'], 'application/json')
                                assert.equal(this.headers['Cache-Control'], 'no-cache')
                                assert.equal(this.statusCode, 200)
                                assert.equal(body, tpls['index.tpl'])
                            }
                            if (t == c) {
                                assert.equal(refuseCount, 9)
                                assert.equal(queueCount, 10)
                                assert.equal(throughCount, 1)
                                done()
                            }
                        }, function (tpl, data, fn) {
                            // render
                            setTimeout( function() {
                                if (fn) return fn(null, tpls[tpl])
                                this.send(tpls[tpl])
                            });
                        })
                    requests.push({
                        req: req,
                        res: res
                    })
                }

                requests.forEach(function (item) {
                    var req = item.req
                    var res = item.res

                    middleware(req, res, function () {
                        // next --> do logic
                        if (through) return assert(false)
                        through = true
                        // type test
                        res.type('json')
                        res.setHeader('Cache-Control', 'no-cache')
                        res.render('index.tpl', {})
                    })
                })
            })

            it('Timout will responce 504', function (done) {
                var c = 10
                var n = c
                var t = 0

                var through
                var requests = []
                var queueCount = 0
                var throughCount = 0
                var refuseCount = 0

                while(n --) {
                    var req = new Request('get', '/chatting?tab=a&uc_params=xxx')
                    var res = new Response(function (body) {
                        t ++
                        var type = this.headers['X-Noginx']
                        switch (type) {
                            case 'queue': queueCount ++;
                                break;
                            case 'through': throughCount ++;
                                break;
                            case 'refuse': refuseCount ++;
                                break;
                        }
                        if (t == c) {
                            assert.equal(this.statusCode, 504)
                            assert.equal(queueCount, 9)
                            assert.equal(through, 1)
                            done()
                        }
                    }, function (tpl, data, fn) {
                        setTimeout( function() {
                            if (fn) return fn(null, tpls[tpl])
                            this.send(tpls[tpl])
                        }.bind(this), 200);
                    })
                    requests.push({
                        req: req,
                        res: res
                    })
                }

                requests.forEach(function (item) {
                    var req = item.req
                    var res = item.res

                    middleware(req, res, function () {
                        // next --> do logic
                        if (through) return assert(false)
                        through = true
                        res.render('chatting.tpl', {})
                    })
                })
            })

            it('Set max-age', function (done) {
                function render(tpl, data, fn) {
                    setTimeout(function() {
                        if (fn) return fn(null, tpls[tpl])
                        this.send(tpls[tpl])
                    }.bind(this));
                }
                function request (req, res) {
                    var through
                    middleware(req, res, function () {
                        // next --> do logic
                        if (through) return assert(false)
                        through = true
                        res.render('chatting.tpl', {})
                    })
                }
                var req = new Request('get', '/chatting?tab=b&uc_params=xxx')
                var res = new Response(function (body) {
                    var type = this.headers['X-Noginx']
                    assert.equal(type, 'through')
                    assert.equal(this.statusCode, 200)

                    setTimeout(function () {
                        // last cache will be expired
                        var req2 = new Request('get', '/chatting?tab=b&uc_params=xxx')   
                        var res2 = new Response(function (body) {
                            var type = this.headers['X-Noginx']
                            assert.equal(type, 'through')
                            assert.equal(this.statusCode, 200)
                            done()
                        }, function () {
                            render.apply(this, arguments)
                        })
                        request(req2, res2)
                    }, 300)

                }, function () {
                    render.apply(this, arguments)
                })

                request(req, res)
            })

        })
    })
}