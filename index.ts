"use strict";

import * as FS from "fs";
import HTTP from "http";
import HTTPS from "https";

import Entities from "entities";
import url from "url";
import XML2JS from "xml2js";
import _get from "lodash.get";

interface ParseOptions {
  customFields?: {
    item?: (string | string[])[];
    feed?: (string | string[])[];
  };
  maxRedirects?: number;
  __redirectCount?: number;
}

type ParseCallback = (err: Error | null, result?: any) => void;

interface IParser {
  parseString(xml: string, callback: ParseCallback): void;
  parseString(
    xml: string,
    options: ParseOptions,
    callback: ParseCallback
  ): void;
  parseURL(feedUrl: string, callback: ParseCallback): void;
  parseURL(
    feedUrl: string,
    options: ParseOptions,
    callback: ParseCallback
  ): void;
  parseFile(file: string, callback: ParseCallback): void;
  parseFile(file: string, options: ParseOptions, callback: ParseCallback): void;
}

const FEED_FIELDS = [
  ["author", "creator"],
  ["dc:publisher", "publisher"],
  ["dc:creator", "creator"],
  ["dc:source", "source"],
  ["dc:title", "title"],
  ["dc:type", "type"],
  "title",
  "description",
  "author",
  "pubDate",
  "webMaster",
  "managingEditor",
  "generator",
  "link",
];

const ITEM_FIELDS = [
  ["author", "creator"],
  ["dc:creator", "creator"],
  ["dc:date", "date"],
  ["dc:language", "language"],
  ["dc:rights", "rights"],
  ["dc:source", "source"],
  ["dc:title", "title"],
  "title",
  "link",
  "pubDate",
  "author",
  "content:encoded",
  "enclosure",
  "dc:creator",
  "dc:date",
];

const mapItunesField = function (f: string) {
  return ["itunes:" + f, f];
};

const PODCAST_FEED_FIELDS = ["author", "subtitle", "summary", "explicit"].map(
  mapItunesField
);

const PODCAST_ITEM_FIELDS = [
  "author",
  "subtitle",
  "summary",
  "explicit",
  "duration",
  "image",
].map(mapItunesField);

const stripHtml = function (str: string): string {
  return str.replace(/<(?:.\n)*?>/gm, "");
};

const getSnippet = function (str: string): string {
  return Entities.decode(stripHtml(str)).trim();
};

var getContent = function (content: any): string {
  if (typeof content._ === "string") {
    return content._;
  } else if (typeof content === "object") {
    var builder = new XML2JS.Builder({
      headless: true,
      rootName: "div",
      renderOpts: { pretty: false },
    });
    return builder.buildObject(content);
  } else {
    return content;
  }
};

var parseAtomFeed = function (
  xmlObj: any,
  _: any,
  callback: ParseCallback
): void {
  var feed: any = xmlObj.feed;
  var json: Record<string, any> = { version: "1.0.0", items: [] };
  if (feed.link) {
    if (feed.link[0] && feed.link[0].$.href)
      json.home_page_url = feed.link[0].$.href;
    if (feed.link[1] && feed.link[1].$.href)
      json.feed_url = feed.link[1].$.href;
  }
  if (feed.title) {
    var title: any = feed.title[0] || "";
    if (title._) title = title._;
    if (title) json.title = title;
  }
  var entries: any[] = feed.entry;
  (entries || []).forEach(function (entry: any) {
    var item: Record<string, any> = {};
    if (entry.title) {
      var title: any = entry.title[0] || "";
      if (title._) title = title._;
      if (title) item.title = title;
    }
    if (entry.link && entry.link.length) item.url = entry.link[0].$.href;
    if (entry.updated && entry.updated.length)
      item.date_published = entry.updated[0];
    if (entry.author && entry.author.length)
      item.author = { name: entry.author[0].name[0] };
    if (entry.content && entry.content.length) {
      item.content_html = getContent(entry.content[0]);
    }
    if (entry.id) {
      item.id = entry.id[0];
    }
    json.items.push(item);
  });
  callback(null, json);
};

var parseRSS1 = function (
  xmlObj: any,
  options: ParseOptions,
  callback: ParseCallback
): void {
  xmlObj = xmlObj["rdf:RDF"];
  var channel: any = xmlObj.channel[0];
  var items: any[] = xmlObj.item;
  return parseRSS(channel, items, options, callback);
};

var parseRSS2 = function (
  xmlObj: any,
  options: ParseOptions,
  callback: ParseCallback
): void {
  var channel: any = xmlObj.rss.channel[0];
  var items: any[] = channel.item;
  return parseRSS(
    channel,
    items,
    options,
    function (err: Error | null, data: any) {
      if (err) return callback(err);
      if (xmlObj.rss.$["xmlns:itunes"]) {
        decorateItunes(data, channel);
      }
      callback(null, data);
    }
  );
};

var parseRSS = function (
  channel: any,
  items: any[],
  options: ParseOptions,
  callback: ParseCallback
): void {
  items = items || [];
  options.customFields = options.customFields || {};
  var itemFields: (string | string[])[] = ITEM_FIELDS.concat(
    options.customFields.item || []
  );
  var feedFields: (string | string[])[] = FEED_FIELDS.concat(
    options.customFields.feed || []
  );

  const feed_url: any =
    _get(channel, "atom:link.$.href", null) ||
    _get(channel, "$.rdf:about", null);

  var json: Record<string, any> = {
    version: "1.0.0",
    title: channel["title"][0],
    home_page_url: channel["link"][0],
    feed_url,
    items: [],
  };

  if (channel["atom:link"]) json.feed_url = channel["atom:link"][0].$.href;
  items.forEach(function (item: any) {
    var jsonItem: Record<string, any> = {};
    if (item.description) {
      jsonItem.content_html = getContent(item.description[0]);
      jsonItem.summary = getSnippet(jsonItem.content_html);
    }
    if (item.title) {
      jsonItem.title = item.title[0];
    }
    if (item.link) {
      jsonItem.url = item.link[0];
    }
    if (item.guid) {
      jsonItem.id =
        _get(item, "guid[0]._", null) || _get(item, "guid[0]", null);
    }
    if (item.category) {
      jsonItem.tags = item.category;
    }

    const date: string | null =
      _get(item, "dc:date[0]", null) ||
      _get(item, "dcterms:issued[0]", null) ||
      _get(item, "pubDate[0]", null);
    if (date) {
      try {
        jsonItem.date_published = date;
      } catch (e: any) {
        // Ignore bad date format
      }
    }
    json.items.push(jsonItem);
  });
  callback(null, json);
};

var copyFromXML = function (
  xml: any,
  dest: Record<string, any>,
  fields: (string | string[])[]
): void {
  fields.forEach(function (f: string | string[]) {
    var from: string = f as string;
    var to: string = f as string;
    if (Array.isArray(f)) {
      from = f[0];
      to = f[1];
    }
    if (xml[from] !== undefined) dest[to] = xml[from][0];
  });
};

/**
 * Add iTunes specific fields from XML to extracted JSON
 *
 * @access public
 * @param {object} json extracted
 * @param {object} channel parsed XML
 */
var decorateItunes = function decorateItunes(
  json: Record<string, any>,
  channel: any
): void {
  var items: any[] = channel.item || [],
    entry: Record<string, any> = {};
  json.feed.itunes = {};

  if (channel["itunes:owner"]) {
    var owner: Record<string, any> = {},
      image: any;

    if (channel["itunes:owner"][0]["itunes:name"]) {
      owner.name = channel["itunes:owner"][0]["itunes:name"][0];
    }
    if (channel["itunes:owner"][0]["itunes:email"]) {
      owner.email = channel["itunes:owner"][0]["itunes:email"][0];
    }
    if (channel["itunes:image"]) {
      image = channel["itunes:image"][0].$.href;
    }

    if (image) {
      json.feed.itunes.image = image;
    }
    json.feed.itunes.owner = owner;
  }

  copyFromXML(channel, json.feed.itunes, PODCAST_FEED_FIELDS);
  items.forEach(function (item: any, index: number) {
    var entry: any = json.feed.entries[index];
    entry.itunes = {};
    copyFromXML(item, entry.itunes, PODCAST_ITEM_FIELDS);
    var image: any = item["itunes:image"];
    if (image && image[0] && image[0].$ && image[0].$.href) {
      entry.itunes.image = image[0].$.href;
    }
  });
};

const parseString = function (
  xml: string,
  options?: ParseOptions | ParseCallback,
  callback?: ParseCallback
): void {
  if (!callback) {
    callback = options as ParseCallback;
    options = {};
  }
  XML2JS.parseString(xml, function (err: Error | null, result: any) {
    if (err) return callback!(err);
    if (result.feed) {
      return parseAtomFeed(result, options, callback!);
    } else if (
      result.rss &&
      result.rss.$.version &&
      result.rss.$.version.indexOf("2") === 0
    ) {
      return parseRSS2(result, options as ParseOptions, callback!);
    } else if (result["rdf:RDF"]) {
      return parseRSS1(result, options as ParseOptions, callback!);
    } else {
      return callback!(new Error("Feed not recognized as RSS 1 or 2."));
    }
  });
};

const parseURL = function (
  feedUrl: string,
  options?: ParseOptions | ParseCallback,
  callback?: ParseCallback
): void {
  if (!callback) {
    callback = options as ParseCallback;
    options = {};
  }
  const opts = options as ParseOptions;
  let redirectCount: number = opts.__redirectCount || 0;
  if (opts.maxRedirects === undefined) opts.maxRedirects = 1;

  var xml: string = "";
  var get = feedUrl.indexOf("https") === 0 ? HTTPS.get : HTTP.get;
  var parsedUrl: any = url.parse(feedUrl);
  var req = get(
    {
      auth: parsedUrl.auth,
      protocol: parsedUrl.protocol,
      hostname: parsedUrl.hostname,
      path: parsedUrl.path,
      headers: { "User-Agent": "rss-parser" },
    },
    function (res: any) {
      if (
        res.statusCode >= 300 &&
        res.statusCode < 400 &&
        res.headers["location"]
      ) {
        if (opts.maxRedirects === 0)
          return callback!(new Error("Status code " + res.statusCode));
        if (opts.__redirectCount === opts.maxRedirects)
          return callback!(new Error("Too many redirects"));
        redirectCount++;
        return Parser.parseURL(res.headers["location"], opts, callback!);
      }
      res.setEncoding("utf8");
      res.on("data", function (chunk: string) {
        xml += chunk;
      });
      res.on("end", function () {
        return Parser.parseString(xml, opts, callback!);
      });
    }
  );
  req.on("error", (error: Error) => callback!(error));
};

const parseFile = function (
  file: string,
  options?: ParseOptions | ParseCallback,
  callback?: ParseCallback
): void {
  if (!callback) {
    callback = options as ParseCallback;
    options = {};
  }
  FS.readFile(
    file,
    "utf8",
    function (err: NodeJS.ErrnoException | null, contents: string) {
      if (err) {
        return callback!(err);
      }
      return Parser.parseString(contents, options as ParseOptions, callback);
    }
  );
};

const Parser: IParser = {
  parseFile,
  parseString,
  parseURL,
};

export default Parser;
