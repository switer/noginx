# noginx
[![Build Status](https://travis-ci.org/switer/noginx.svg?branch=master)](https://travis-ci.org/switer/noginx)

It's a cache proxy middleware like logical nginx of node.js with expressjs.

## Install

```bash
npm install node-noginx --save
```

## Usage

```js
app.use(noginx([ < RegExp > , {
    rule: < RegExp > , // route match rule
    maxAge: < Number > , // ms, the cache data expired time
    keyQueries: [ < String > , < String > ], // picking params of query as cache-key
    timeout: < Number > //  ms, max waitting time when cache unhit
}]), {
    maxAge: 3 * 1000, // ms, default 3000
    maxQueueSize: 5000, // max request watting queue size, default 5000, it will responce 503 when queue is full 
    timeout: 100, // ms, default 100
    debug: < Boolean > // whether log debug info
})
```

## Test

```bash
npm test
```

## Doc

### Proxy method

* **res.render**
* **res.send**

### Proxy headers

* **Content-Type**
* **Cache-Control**

## License

MIT