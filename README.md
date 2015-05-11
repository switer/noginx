# noginx
It's a cache proxy middleware like logical nginx of node.js.

## Install

```bash
npm install node-noginx --save
```

## Usage

```js
app.use(noginx([ < RegExp > , {
    rule: < RegExp > , // RegExp
    maxAge: < Number > , // ms
    keyQueries: [ < String > , < String > ], // params of query
    timeout: < Number > // ms
}]), {
    maxAge: 3 * 1000, // ms, default 3000
    maxQueueSize: 5000, // default 5000
    timeout: 100 // ms, default 100
})
```

## Test

```bash
npm test
```

## License

MIT