# mk.js 🎂
[![NPM version][npm-image]][npm-url] [![Dependency Status][daviddm-image]][daviddm-url] 

Yet another JavaScript build tool -- designed to mimic GNU Make using scriptable 'mk.js' files.

**Make** had it pretty well figured out. However, intricate build tasks can quickly exceed the capabilities of the Makefile language.  On the other hand, modern ECMAScript allows for very expressive and concise scripting.

This build tool reimagines **Make** in an ECMAScript context by using `mk.js` files, which leverages `bash` to execute build commands.

Install:
```bash
$ npm install mk.js
```

Command line using `npx`:
```
$ npx mk.js
```

Command line if installed globally
```bash
$ npm i -g mk.js

$ mk.js
# ...OR...
$ mk
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

`mk.js`:
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

With `mk`, any recipe that does not have a `.run` property is assumed to be phony. We only need to make phony-ness explicit when there is a `.run` property on a phony target. For example, 
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

##### Word capture
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

##### Regular Expression Capture
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
A target

<!-- While some have turned to config-based build tools like Grunt, or stream-based build tools like Gulp, the happy config/stream hybrid approach -->

## License

ISC © [Blake Regalia]()


[npm-image]: https://badge.fury.io/js/jmk.svg
[npm-url]: https://npmjs.org/package/jmk
[daviddm-image]: https://david-dm.org/blake-regalia/jmk.js.svg?theme=shields.io
[daviddm-url]: https://david-dm.org/blake-regalia/jmk.js

