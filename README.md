# mkjs 🎂
[![NPM version][npmv-image]][npmv-url] [![Build Status][travis-image]][travis-url] [![Dependency Status][david-image]][david-url] [![dependencies Status][david-dev-image]][david-dev-url]

[npmv-image]: https://img.shields.io/npm/v/mkjs-cli.svg
[npmv-url]: https://www.npmjs.com/package/mkjs-cli
[travis-image]: https://travis-ci.org/blake-regalia/mkjs.js.svg?branch=master
[travis-url]: https://travis-ci.org/blake-regalia/mkjs.js
[david-image]: https://david-dm.org/blake-regalia/mkjs.js.svg
[david-url]: https://david-dm.org/blake-regalia/mkjs.js
[david-dev-image]: https://david-dm.org/blake-regalia/mkjs.js/dev-status.svg
[david-dev-url]: https://david-dm.org/blake-regalia/mkjs.js?type=dev

**Make** had it pretty well figured out. When it comes to node.js projects however, intricate build tasks can quickly exceed the capabilities of the Makefile language.  On the other hand, modern ECMAScript allows for very expressive and concise scripting.

This build tool reimagines **Make** in an ECMAScript context by using `mk.js` files, which leverages `bash` to execute build commands.

## Install:
Best to save it as a devDependency with your project:
```bash
$ npm install --save-dev mkjs-cli

# also nice to have the binary linked
$ npm i -g mkjs-cli
```

## Usage
```bash
$ mk --help
# ...OR...
$ mkjs --help
# ...OR...
$ npx mkjs-cli --help

  Usage: mk [options] [targets...]

  Options:

    -v, --version  output the version number
    -n, --dry-run  show the targets and commands without executing them
    -s, --silent   do not echo commands
    -w, --watch    watch dependency files and re-mk targets
    -f, --file     use specified mkfile
    -h, --help     output usage information

```


### Example: building a JISON parser

Project directory:
```
project/
├─ build/
├─ node_modules/
├─ src/
  ├─ lang.jison
  ├─ lang.jisonlex
  └─ index.js  
├─ package.json
└─ mk.js
```

Your build file is `mk.js`:
```js
module.exports = {
    all: 'index parser',
    index: 'build/index.js',
    parser: 'build/parser.js',

    // creates the output directory
    'build': {
        run: 'mkdir -p $@',
    },
    
    // copy index.js file from src/ to build/
    'build/index.js': {
        deps: [
            'src/index.js',  // source file dependency
            '$(dirname $@)',  // output directory - resolves to "build"
        ],
        run: 'cp $1 $@',  // bash interprets as `$ cp src/index.js build/index.js`
    },
    
    // build the parser file target
    'build/parser.js': {
        deps: [
            // depends on the .jison and .jisonlex files under src/
            ...['*.jison', '*.jisonlex'].map(s => `src/${s}`),
            '$(dirname $@)',  // need output directory to exist
        ],
        run: /* syntax: bash */ `
            # arg numbers correspond to 'deps' ($1="src/*.jison" and $2="src/*.jisonlex")
            npx jison $1 $2 -o $@
        `,
    },
};
```

Then we can simply run the default `all` target and watch dependency files for updates:
```bash
$ mk -w
```

Now, in this example, a change to any file under `src/` will automatically trigger its targets to be re-run.

## Reference

 - [Targets](#targets) -- a string that identifies a destination file to build, or a 'phony' name
 - [Patterns](#patterns) -- allows a single recipe to match multiple targets
 - [Recipes](#recipes) -- defines how to satisfy a given target with dependencies and/or shell commands to run

### Targets
A target is assumed to be the relative path to a destination file so that the build tool can check its 'date modified' timestamp to see if any of its dependencies are newer (so that it knows whether or not to rebuild it). Using what Make calls 'phony' targets allows recipes to specify dependencies without creating a file to satisfy the presumed target path. 

With `mkjs`, any recipe that does not have a `.run` property is assumed to be phony. We only need to make phony-ness explicit when there is a `.run` property on a phony target. For example, 
```js
{
    all: 'index',  // no `.run` property -- obviously phony
    index: 'build/index.js',  // also phony
    'build/index.js': {  // not a phony target, the target is a destination file
        deps: 'src/build/index.js',
        run: 'cp $1 $@',
    },
    clean: {  // should be phony (i.e., does not create a file called `clean`)
        phony: true,  // we need this here since we have a `.run` property
        run: 'rm -rf build/',
    },
}
```

From the command line, any one of these targets can be specified:
```bash
$ mk all
$ mk index
$ mk build/index.js
$ mk clean
```

### Patterns
A very useful feature when designing build tasks can be the use of patterns in targets. 

#### Word capture
The simplest way to embed patterns in targets is to use the colon `:` operator followed by a variable name like so:
`:{name}` -- where `name` matches `/^[A-Za-z_][A-Za-z_0-9]*$/`.

This will inject the non-greedy pattern `/([^/]*?)/` into the target's generated regular expression and create a variable that can be referenced anywhere inside the build rule.


**Example**:
Normally, a build target will be the relative path to some destination file:
```js
// before
{
    'build/syntax/html.js': {
        deps: ['src/syntax/html.js'],
    },
    'build/syntax/css.js': {
        deps: ['src/syntax/css.js'],
    },
    ...
}
```

Instead of enumerating all target paths, we can use a word pattern to generalize the rule:
```js
// after
{
    'build/syntax/:type.js': {
        deps: ['src/syntax/$type.js'],
    },
}
```

#### Regular Expression Capture
You may need more control over the patterns your targets match. The more advanced way to embed patterns in targets is by creating named regular expressions in the mk-file config:
`'&{pattern_name}': /{regex}/,`  -- where `pattern_name` matches `/^[A-Za-z_][A-Za-z_0-9]*$/`.

This creates a pattern that can be referenced in build target strings and will consequently create variables that can be referenced anywhere inside the build rule. Referencing a pattern from a build target can optionally include the name of the variable to store captures in (defaults to the name of the pattern):
`([:{name}=]&{pattern_name})` -- where `[]` denotes an optional string.

The `${name}` variable that gets created from these patterns is an array that corresponds to the capture groups of the original pattern. The variable can therefore be used as an array, accessing its capture groups like so: `${capture[n]}` -- where `{}` denotes the literal brace characters and `n` denotes the capture group index. By default, `bash` will use the first element of the array if the variable is used without an accessor like so: `$capture`, which will always be the full text that the pattern matched.

**Example:**
```js
{
    // simple reference and use
    '&language': /html|css|javascript/,
    'build/syntax/(&language).js': {
        deps: 'src/syntax/$language.js',
    },
    
    // or with capture groups...
    '&bump': /(major|minor|patch)-(.+)/,
    '(&bump)': {
        deps: ['${bump[2]}'],
        run: `
            npm version \${bump[1]}
        `,
    },
    
    // you can also name the captures group variables...
    '&person': /(john|mary|doug|jane)/,
    'relate-(:left=&person)-to-(:right=&person).sql': {
        deps: ['$left.sql', '$right.sql'],
        run: `
            node combine.js $left.sql $right.sql
        `,
    },
}
```

### Recipes
This build tool uses `bash` to execute the strings in `.run` commands, as well as resolving the values of dependency targets, because of all the nifty features it has for dealing with variables and so on. This also means you can use glob patterns to match files at runtime. Each shell is created in a child process and run from the projects cwd. All scoped variables (e.g., target path, dependencies, named pattern matches, capture groups, etc.) will be injected into the same shell process commands before the `.run` command string. This means that bash is handling all variable string substitution with a few exceptions (such as the `$@` special variable).

**Keys**
`.phony` -- a boolean used to specify that the recipe itself does not build an output file. Only necessary when recipe has a `.run` property. See [Targets](#targets) for more info.
`.deps` -- a space-delimited string of target dependencies *or* an array of them. See [Targets](#targets) for more info.
`.run` -- a string of commands to run in a `bash` shell.
`.case` -- a boolean indicating if its okay for this recipe to match the same target as another recipe. Normally the tool will throw an error to warn the user that some target matched multiple recipes, but it can be useful to have a recipe that matches *other* targets not matched by another recipe. Using the `case: true` option in both recipes signifies these recipes are intentionally part of a switch and the tool will use the first recipe (in the object's key order) when a target matches multiple recipes.

```js
{
    'build/packages/:package/README.md': {
        case: true,  // this recipe will be used for README.md files
        deps: [
            'doc/$package/*.md',  // take all *.md files
            '$(dirname $@)',  // make sure output directory exists
        ],
        run: `
            combine-and-generate-html $1 > $@
        `,
    },
    
    'build/packages/:package/:file': {
        case: true,  // these are for all non-README.md files
        deps: [
            'src/$package/$file',  // depends on source file
            'build/packages/$package/README.md',  // any documentation if it exists
            '$(dirname $@)',  // make sure output directory exists
        ],
        run: `
            do-some-js-transform $1 > $@
        `,
    },
    
}
```


## License

ISC © [Blake Regalia]()

