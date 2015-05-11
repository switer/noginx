# noginx
It's a cache proxy middleware like logical nginx of node.js.

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
    timeout: 100 // ms, default 100
})
```

## Test

```bash
npm test
```

## License

MIT