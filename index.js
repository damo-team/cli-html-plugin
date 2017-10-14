'use strict';
var path = require('path');
var urlModule = require('url');
var _ = require('lodash');
var HtmlWebpackPlugin = require('html-webpack-plugin');

HtmlWebpackPlugin.prototype.htmlWebpackPluginAssets = function(compilation, webpackStatsJson, includedChunks, excludedChunks) {
  var self = this;

  // Use the configured public path or build a relative path
  var publicPath = typeof compilation.options.output.publicPath !== 'undefined' ?
      compilation.mainTemplate.getPublicPath({hash: webpackStatsJson.hash}) :
      path.relative(path.dirname(self.options.filename), '.');

  if (publicPath.length && publicPath.substr(-1, 1) !== '/') {
    publicPath = path.join(urlModule.resolve(publicPath + '/', '.'), '/');
  }
  var assets = {
    // Will contain all js & css files by chunk
    chunks: {},
    // Will contain all js files
    js: [],
    // Will contain all css files
    css: [],
    // Will contain all l20n files
    l20n: [],
    // Will contain the path to the favicon if it exists
    favicon: self.options.favicon ? publicPath + path.basename(self.options.favicon): undefined,
    // Will contain the html5 appcache manifest files if it exists
    manifest: Object.keys(compilation.assets).filter(function(assetFile){
      return path.extname(assetFile) === '.appcache';
    })[0]
  };

  // Append a hash for cache busting
  if (this.options.hash) {
    assets.manifest = self.appendHash(assets.manifest, webpackStatsJson.hash);
    assets.favicon = self.appendHash(assets.favicon, webpackStatsJson.hash);
  }

  var chunks = webpackStatsJson.chunks.sort(function orderEntryLast(a, b) {
    if (a.entry !== b.entry) {
      return b.entry ? 1 : -1;
    } else {
      return b.id - a.id;
    }
  });

  for (var i = 0; i < chunks.length; i++) {
    var chunk = chunks[i];
    var chunkName = chunk.names[0];

    // This chunk doesn't have a name. This script can't handled it.
    if(chunkName === undefined) {
      continue;
    }

    // Skip if the chunks should be filtered and the given chunk was not added explicity
    if (Array.isArray(includedChunks) && includedChunks.indexOf(chunkName) === -1) {
      continue;
    }
    // Skip if the chunks should be filtered and the given chunk was excluded explicity
    if (Array.isArray(excludedChunks) && excludedChunks.indexOf(chunkName) !== -1) {
      continue;
    }

    assets.chunks[chunkName] = {};

    // Prepend the public path to all chunk files
    var chunkFiles = [].concat(chunk.files).map(function(chunkFile) {
      return publicPath + chunkFile;
    });

    // Append a hash for cache busting
    if (this.options.hash) {
      chunkFiles = chunkFiles.map(function(chunkFile) {
        return self.appendHash(chunkFile, webpackStatsJson.hash);
      });
    }

    // Webpack outputs an array for each chunk when using sourcemaps
    // But we need only the entry file
    var entry = chunkFiles[0];
    assets.chunks[chunkName].size = chunk.size;
    assets.chunks[chunkName].entry = entry;
    assets.js.push(entry);
    // Gather all css files
    var css = chunkFiles.filter(function(chunkFile){
      // Some chunks may contain content hash in their names, for ex. 'main.css?1e7cac4e4d8b52fd5ccd2541146ef03f'.
      // We must proper handle such cases, so we use regexp testing here
      return /^.css($|\?)/.test(path.extname(chunkFile));
    });
    assets.chunks[chunkName].css = css;
    assets.css = assets.css.concat(css);
    // Gather all css files
    var l20n = [];
    chunkFiles.forEach(function(chunkFile){
      if(/^.json($|\?)/.test(path.extname(chunkFile)) || chunkFile.indexOf('l20n!') === 0){
        l20n.push(chunkFile);
      }
    })
    assets.chunks[chunkName].l20n = l20n;
    assets.l20n = assets.l20n.concat(l20n);
  }
  // Duplicate css assets can occur on occasion if more than one chunk
  // requires the same css.
  assets.css = _.uniq(assets.css);
  assets.l20n = _.uniq(assets.l20n);

  return assets;
};

/**
 * Injects the assets into the given html string
 */
HtmlWebpackPlugin.prototype.injectAssetsIntoHtml = function(html, templateParams) {
  var assets = templateParams.htmlWebpackPlugin.files;
  var files = {};
  if(this.options.files){
    files = JSON.parse(JSON.stringify(this.options.files));
  }
  var chunks = Object.keys(assets.chunks);
  // Gather all css and script files
  var styles = files.css || [];
  var scripts = files.js || [];
  var l20ns = files.l20n || [];
  chunks.forEach(function(chunkName) {
    l20ns = l20ns.concat(assets.chunks[chunkName].l20n);
    styles = styles.concat(assets.chunks[chunkName].css);
    scripts.push(assets.chunks[chunkName].entry);
  });
  // Turn l20n files into link tags
  l20ns = l20ns.map(function(l20nPath) {
    if(l20nPath.indexOf('l20n!')  === 0){
      var tmp = l20nPath.slice(5).split('=');
      return '<meta name="' + tmp[0] + '" content="' + tmp[1] + '">';
    }else{
      return '<link rel="localization" href="' + l20nPath + '">';
    }
  });
  // Turn script files into script tags
  scripts = scripts.map(function(scriptPath) {
    return '<script src="' + scriptPath + '"></script>';
  });
  // Turn css files into link tags
  styles = styles.map(function(stylePath) {
    return '<link href="' + stylePath + '" rel="stylesheet">';
  });
  // Injections
  var head = [];
  var body = [];

  // If there is a favicon present, add it to the head
  if (assets.favicon) {
    head.push('<link rel="shortcut icon" href="' + assets.favicon + '">');
  }
  // Add l20ns to the head
  head = head.concat(l20ns);
  // Add styles to the head
  head = head.concat(styles);
  // Add scripts to body or head
  if (this.options.inject === 'head') {
    head = head.concat(scripts);
  } else {
    body = body.concat(scripts);
  }
  // Append assets to head element
  html = html.replace(/(<\/head>)/i, function (match) {
    return head.join('') + match;
  });
  // Append assets to body element
    html = html.replace(/(<\/body>)/i, function (match) {
      return body.join('') + match;
    });
  // Inject manifest into the opening html tag
  if (assets.manifest) {
    html = html.replace(/(<html[^>]*)(>)/i, function (match, start, end) {
      // Append the manifest only if no manifest was specified
      if (/\smanifest\s*=/.test(match)) {
        return match;
      }
      return start + ' manifest="' + assets.manifest + '"' + end;
    });
  }
  return html;
};

module.exports = HtmlWebpackPlugin;