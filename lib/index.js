var fs = require('fs');
var path = require('path');
var htmlUtil = require('html-util');
var resolve = require('resolve');
var browserify = require('browserify');

var derbyTemplates = require('derby-templates');
var templates = derbyTemplates.templates;
var expressions = derbyTemplates.expressions;

var serializeObject = require('serialize-object');

require('derby-parsing');

module.exports = function(filenames, options, cb){
  options = options || {};
  options.moduleName  = options.moduleName || 'views';
  options.compilers   = options.compilers  || {};

  var app = {
    viewExtensions: ['.html'],
    compilers: {
      '.html': htmlCompiler
    }
  };

  for (var ext in options.compilers){
    if (app.viewExtensions.indexOf(ext) === -1){
      app.viewExtensions.push(ext);
    }

    app.compilers[ext] = options.compilers[ext];
  }

  if (typeof filenames === 'string') {
    filenames = [filenames];
  }

  var views = [];
  var files = [];

  filenames.forEach(function(filename){
    var data = loadViewsSync(app, filename);
    views = views.concat(data.views);
    files = files.concat(data.files);
  });


  var viewsList = new templates.Views();

  for (var i = 0, len = views.length; i < len; i++) {
    var item = views[i];
    viewsList.register(item.name, item.source, item.options);
  }

  var viewsSource = viewsList.serialize(options.minify);

  bundleIt(viewsSource, {
    name: options.moduleName,
    minify: options.minify
  }, cb);
};

function bundleIt(viewsSource, options, cb){
  options = options || {};
  options.name = options.name || 'views';


  var Readable = require('stream').Readable;

  var rs = new Readable;
  rs.push(viewsSource);
  rs.push(null);

  var b = browserify();

  b.require(rs, {expose: options.name, basedir: __dirname});
  b.external('derby-templates');

  if (options.minify) {
    b.plugin('minifyify');
  }

  b.bundle(function(err, res){
    cb(err, res.toString());
  });
}


templates.Views.prototype.serialize = function(minify) {
  var out = "module.exports = function(views) {\n" +
      "  var derbyTemplates = require('derby-templates');\n" +
      "  var expressions = derbyTemplates.expressions;\n" +
      "  var templates = derbyTemplates.templates;\n\n";
  for (var name in this.nameMap) {
    var view = this.nameMap[name];
    var template = view.template || view.parse();
    out += '  views.register(' + serializeObject.args([
      view.name
      , (minify) ? null : view.source
      , (hasKeys(view.options)) ? view.options : null
    ]) + ').template = ' + template.serialize() + ';\n';
  }

  return out + '}\n';
};


function loadViewsSync(app, sourceFilename, namespace) {
  var views = [];
  var files = [];
  var resolved = resolve.sync(sourceFilename, {extensions: app.viewExtensions, packageFilter: deleteMain});
  if (!resolved) {
    throw new Error('View template file not found: ' + sourceFilename);
  }

  var file = fs.readFileSync(resolved, 'utf8');

  var extension = path.extname(resolved);
  var compiler = app.compilers[extension];
  if (!compiler) {
    throw new Error('Unable to find compiler for: ' + extension);
  }

  var htmlFile = compiler(file, resolved);

  var parsed = parseViews(namespace, htmlFile, resolved, app.viewExtensions);
  for (var i = 0, len = parsed.imports.length; i < len; i++) {
    var item = parsed.imports[i];
    var imported = loadViewsSync(app, item.filename, item.namespace);
    views = views.concat(imported.views);
    files = files.concat(imported.files);
  }
  return {
    views: views.concat(parsed.views)
    , files: files.concat(resolved)
  };
}

function htmlCompiler(file, filename) {
  return file;
}

function parseViews(namespace, file, filename, extensions) {
  var imports = [];
  var views = [];
  var prefix = (namespace) ? namespace + ':' : '';

  htmlUtil.parse(file + '\n', {
    // Force view tags to be treated as raw tags,
    // meaning their contents are not parsed as HTML
    rawTags: /^(?:[^\s=\/!>]+:|style|script)$/i
    , matchEnd: matchEnd
    , start: onStart
    , text: onText
  });

  function matchEnd(tagName) {
    if (tagName.slice(-1) === ':') {
      return /<\/?[^\s=\/!>]+:[\s>]/i;
    }
    return new RegExp('</' + tagName, 'i');
  }

  // These variables pass state from attributes in the start tag to the
  // following view template text
  var name, attrs;

  function onStart(tag, tagName, tagAttrs) {
    var lastChar = tagName.charAt(tagName.length - 1);
    if (lastChar !== ':') {
      throw new Error('Expected tag ending in colon (:) instead of ' + tag);
    }
    name = tagName.slice(0, -1);
    attrs = tagAttrs;
    if (name === 'import') {
      var dir = path.dirname(filename);
      var resolved = resolve.sync(attrs.src, {basedir: dir, extensions: extensions, packageFilter: deleteMain});
      var extension = path.extname(resolved);
      var importNamespace = (attrs.ns == null) ?
          path.basename(attrs.src, extension) : attrs.ns;
      imports.push({
        filename: resolved
        , namespace: (!importNamespace) ? namespace : prefix + importNamespace
      });
    }
  }

  function onText(text, isRawText) {
    if (!name || name === 'import') return;
    views.push({
      name: prefix + name
      , source: text
      , options: attrs
      , filename: filename
    });
  }

  return {
    imports: imports
    , views: views
  };
}

// Resolve will use a main path from a package.json if found. Main is the
// entry point for javascript in a module, so this will mistakenly cause us to
// load the JS file instead of a view or style file in some cases. This package
// filter deletes the main property so that the normal file name lookup happens
function deleteMain(package) {
  delete package.main;
}

function hasKeys(value) {
  if (!value) return false;
  for (var key in value) {
    return true;
  }
  return false;
}
