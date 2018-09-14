# rss-to-json-feed

The of this project is to convert RSS or ATOM feeds to the [json-feed format](https://jsonfeed.org/version/1).

## Installation
```bash
npm install --save rss-parser
```

## Usage
You can parse RSS from a URL, local file (NodeJS only), or a string.
* `parseString(xml, [options,],  callback)`
* `parseFile(filename, [options,], callback)`
* `parseURL(url, [options,] callback)`

### NodeJS
```js
var parser = require('rss-parser');

parser.parseURL('https://www.reddit.com/.rss', function(err, parsed) {
  console.log(parsed.feed.title);
  parsed.feed.entries.forEach(function(entry) {
    console.log(entry.title + ':' + entry.link);
  })
})
```

## Output
Check out output examples in [test/output/reddit.json](test/output/reddit.json)

## Options

### Redirects
By default, `parseURL` will follow up to one redirect. You can change this
with `options.maxRedirects`.

```js
parser.parseURL('https://reddit.com/.rss', {maxRedirects: 3}, function(err, parsed) {
  console.log(parsed.feed.title);
});
```

## Contributing
Contributions welcome!

### Running Tests
The tests run the RSS parser for several sample RSS feeds in `test/input` and outputs the resulting JSON into `test/output`. If there are any changes to the output files the tests will fail.

To check if your changes affect the output of any test cases, run

`npm test`

To update the output files with your changes, run

`WRITE_GOLDEN=true npm test`

## Fork of rss-parser

This project was originally forked from [bobby-brennan/rss-parser](https://github.com/bobby-brennan/rss-parser). It's mostly his work, I've just changed the output to match the JSON-Feed spec.
