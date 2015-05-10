function Noop () {}

function Request (method, url) {
    this.next = Noop
    this.method = method
    this.url = url
}

function Response (send, render) {
    this.render = render || Noop
    this.send = send || Noop
    this.setHeader = function (k, v) {
        this.headers[k] = v
        return this
    }
    this.status = function (code) {
        this.statusCode = code
        return this
    }
    this.headers = {}
}

module.exports = function (assert, noginx) {
    describe('Noginx', function () {
        var tpls = {
            'index.tpl': '<body>index</body>'
        }
        var middleware = noginx([
                /^\/$/,
                {
                    rule: /^\/chatting\/?$/,
                    keyQueries: ['tab', 'type']
                }
            ])
        describe('# Rule and tpl render', function (done) {
            it('Simple RegExp rule match witch 10 concurrences', function (done) {
                var through
                var requests = []
                var c = 10
                var n = c
                var t = 0
                while(n --) {
                    var req = new Request('get', '/')
                    var res = new Response(function (body) {
                            t ++
                            // send
                            assert.equal(this.statusCode, 200)
                            assert.equal(body, tpls['index.tpl'])
                            t == c && done()
                        }, function (tpl, data, fn) {
                            // render
                            if (fn) return fn(null, tpls[tpl])
                            this.send(tpls[tpl])
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
                        // next
                        if (through) return assert(false)
                        through = true
                        res.render('index.tpl', {})
                    })
                })
            })

        })
    })
}