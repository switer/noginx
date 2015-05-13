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
    maxCache: 5000, // default 5000
    cacheFreePercent: <Float>, // free percentage of maxCache when cache is overflow 
    timeout: 100, // ms, default 500
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
	override: 
		- res.render(tpl, data)

* **res.send**
	override: 
		- res.render(statusCode, body)
		- res.render(statusCode)
		- res.render(body)

* **res.json**
	override:
		- res.json(obj)

### Proxy headers

* **Content-Type**
* **Cache-Control**

## License

MIT