const fs = require('fs');

module.exports = {
	defs: {
		// grab list of *.js files under 'src/main/'
		main_js: fs.readdirSync('./src/main')
			.filter(s => s.endsWith('.js')),

		// grab list of *.js files under 'src/fragment/'
		fragment_js: fs.readdirSync('./src/fragment')
			.filter(s => s.endsWith('.js')),

		// main: {'src/main':'*.js'},
		// fragment: {'src/fragment':'*.js'},
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
						npx jison $1 $2 -o $@
					`,
				}),
			},
		},
	},
};
