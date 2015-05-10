var assert = require('chai').assert
var Cache = require('../lib/cache')
var noginx = require('../lib/noginx')

require('./cache.spec.js')(assert, Cache)
require('./noginx.spec.js')(assert, noginx)