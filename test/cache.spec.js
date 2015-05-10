/**
 *  Unit testing for the cache module
 */
module.exports = function (assert, Cache) {
    describe('Cache', function () {
        describe('# Instance', function () {
            it('Instance with default options', function () {
                var c = new Cache()
                assert.equal(c._settings.max, 1000)
                assert.equal(c._settings.maxAge, 3000)
                assert.equal(c._settings.freePercent, 0.4)
            })
            it('Instance with specified options', function () {
                var c = new Cache({
                    max: 10,
                    maxAge: 100,
                    freePercent: 0.5
                })
                assert.equal(c._settings.max, 10)
                assert.equal(c._settings.maxAge, 100)
                assert.equal(c._settings.freePercent, 0.5)
            })
        })

        describe('# Getter and setter', function () {
            it('Check data type from getter', function () {
                var c = new Cache({
                    max: 1000
                })
                c.set('string', '123')
                c.set('number', 123)
                c.set('object', {value: 123})
                c.set('array', [1,2,3])

                assert.isString(c.get('string'))
                assert.isNumber(c.get('number'))
                assert.isObject(c.get('object'))
                assert.isArray(c.get('array'))
                assert.equal(c.get('object').value, 123)
                assert.equal(c.get('array')[2], 3)
                assert.isUndefined(c.get('unknow'))
            })

            it('Cache with max-age', function (done) {
                var c = new Cache()
                c.set('index', 'index', 100)
                assert.equal(c.get('index'), 'index')
                setTimeout(function () {
                    assert.equal(c.get('index'), undefined)
                    done()
                }, 150)
            })
        })

        describe('# Free', function () {
            it('Call free manual', function () {
                var c = new Cache({
                    max: 6,
                    freePercent: 0.5
                })
                c.set('c-1', 1)
                 .set('c-2', 2)
                 .set('c-3', 3)
                 .set('c-4', 4)
                 .set('c-5', 5)
                 .set('c-6', 6)

                c.free()
                assert.equal(c.get('c-3'), 3)
                assert.equal(c.get('c-4'), undefined)
            })

            it('Free when cache is overflow', function () {
                var c = new Cache({
                    max: 6,
                    freePercent: 0.5
                })
                c.set('c-1', 1)
                 .set('c-2', 2)
                 .set('c-3', 3)
                 .set('c-4', 4)
                 .set('c-5', 5)
                 .set('c-6', 6)
                 .set('c-7', 7)

                assert.equal(c.get('c-3'), 3)
                assert.equal(c.get('c-4'), undefined)
                assert.equal(c.get('c-7'), 7)
            })

            it('Free and removeExpire when cache is overflow', function (done) {
                var c = new Cache({
                    max: 6,
                    freePercent: 0.5
                })
                c.set('c-1', 1, 100)
                 .set('c-2', 2, 100)
                 .set('c-3', 3)
                 .set('c-4', 4)
                 .set('c-5', 5)
                 .set('c-6', 6)

                setTimeout(function () {
                    c.set('c-7', 7)
                    assert.equal(c.get('c-1'), undefined)
                    assert.equal(c.get('c-2'), undefined)
                    assert.equal(c.get('c-3'), 3)
                    assert.equal(c.get('c-4'), 4)
                    assert.equal(c.get('c-5'), 5)
                    assert.equal(c.get('c-6'), undefined)
                    assert.equal(c.get('c-7'), 7)
                    done()
                }, 150)
            })
        })
    })
}