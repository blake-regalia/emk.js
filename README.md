# emk 🎂
[![NPM version][npmv-image]][npmv-url] [![Build Status][travis-image]][travis-url] [![Dependency Status][david-image]][david-url] [![dependencies Status][david-dev-image]][david-dev-url]

[npmv-image]: https://img.shields.io/npm/v/emk.svg
[npmv-url]: https://www.npmjs.com/package/emk
[travis-image]: https://travis-ci.org/blake-regalia/emk.js.svg?branch=master
[travis-url]: https://travis-ci.org/blake-regalia/emk.js
[david-image]: https://david-dm.org/blake-regalia/emk.js.svg
[david-url]: https://david-dm.org/blake-regalia/emk.js
[david-dev-image]: https://david-dm.org/blake-regalia/emk.js/dev-status.svg
[david-dev-url]: https://david-dm.org/blake-regalia/emk.js?type=dev

## ECMAScript Make
For intricate projects, build tasks tend to grow messy. At times, a build tool's functionality will even get in your way (e.g., lack of support for string manipulation, pattern matching, dynamic dependencies, etc.). The beauty to GNU Make is in its imperative file dependencies (i.e., this is the path of an output file I want to make, here's how to make it).

This project, `emk`, aims to bring the powers of modern ECMAScript into a dynamic build process based on imperative file dependencies and shell commands. Your custom build script exports a build config object, making for an intuitive build system design that supports reusable recipes and allows for concise, expressive build tasks.

Tasks are scripted in `emk.js` files, which leverages the shell (`bash` by default) to execute run commands. When a set of tasks are invoked, a dependency graph is made, checked for cycles, topologically sorted, and then scheduled in stages to run tasks with high concurrency.

## Example: Build this library (dogfooding)
`emk.js`:
```js
const fs = require('fs');

module.exports = {
   defs: {
      // grab list of *.js files under 'src/main/'
      main_js: fs.readdirSync('./src/main')
         .filter(s => s.endsWith('.js')),

      // grab list of *.js files under 'src/fragment/'
      fragment_js: fs.readdirSync('./src/fragment')
         .filter(s => s.endsWith('.js')),
   },

   tasks: {
      // the default `all` task: depends on all enumerable output tasks under 'build/'
      all: 'build/**',
   },

   // every leaf node in this tree describes how to make a file, or class of files
   outputs: {
      // mkdir 'build/'
      build: {
         // mkdir 'build/main'
         main: {
            // copy files listed in `main_js` enumeration from 'src/main/' to 'build/main/''
            ':main_js': h => ({copy:`src/main/${h.main_js}`}),

            /*  // for demonstration: the 'copy' key used above is shorthand for:
            ':main_js': h => ({
               deps: [`src/${h.static_js}`],
               run: 'cp $1 $@',
            }),  */
         },

         // mkdir 'build/fragment'
         fragment: {
            // copy files listed in `main_js` enumeration from 'src/main/' to 'build/main/''
            ':fragment_js': h => ({copy:`src/fragment/${h.fragment_js}`}),

            // build 'parser.js' file
            'parser.js': () => ({
               // source files are *.jison and *.jisonlex files under src/fragment/
               deps: ['src/fragment/*.{jison,jisonlex}'],

               // arg numbers in shell script correspond to `deps`
               //   ($1="src/fragment/*.jison" and $2="src/fragment/*.jisonlex")
               run: /* syntax: bash */ `
                  # compile grammar and lex
                  jison $1 $2 -o $@
               `,
            }),
         },
      },
   },
};

```

Then we can simply run the default `all` target and watch dependency files for updates:
```bash
$ emk -w
```

Now, in this example, a change to any file under `src/` will automatically trigger only its dependent targets to be made.

The console output looks like this on my machine:
![emk-output](https://github.com/blake-regalia/emk.js/raw/master/examples/emk-output.png)


## Install:
Best to save it as a devDependency with your project:
```bash
$ npm install --save-dev emk

# also nice to have the binary linked
$ npm i -g emk
```

## Usage
```
$ emk --help
# ...OR...
$ npx emk --help

Usage: emk [EMK_OPTIONS] [TARGET(S)...]

TARGET Options:
  -g, --config  pass a js config object to the specific task            [string]

Options:
  -n, --dry-run  show the targets and commands without executing them  [boolean]
  -f, --force    force run all tasks (ignore modified time)            [boolean]
  -q, --quiet    do not print the commands themselves                  [boolean]
  -s, --silent   do not echo stdout from commands and do not print the commands
                 themselves                                            [boolean]
  -w, --watch    watch dependency files and re-emk targets             [boolean]
  -u, --use      use specified emk file                                 [string]
  -t, --timeout  specify how long to wait for an emkfile to export in ms
                                                        [number] [default: 5000]
  -x, --offline  assume all URL dependents are up-to-date              [boolean]
  -h, --help     Show help                                             [boolean]
  -v, --version  Show version number                                   [boolean]

Examples:
  emk -w                                    run the default `all` task
                                            indefinitely by watching
                                            dependencies for changes
  emk --dry-run 'build/*'                   do a dry run on the output tasks
  '-g={env:"prod"}'                         matching the target `build/*` and
                                            pass in the config object
                                            `{env:'prod'} to the task

```


## License

ISC © [Blake Regalia]()

