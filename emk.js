const fs = require('fs');

module.exports = {
	defs: {
		fragment_js: fs.readdirSync('./src/fragment')
			.filter(s => s.endsWith('.js')),

		main_js: fs.readdirSync('./src/main')
			.filter(s => s.endsWith('.js')),

		// main: {'src/main':'*.js'},
		// fragment: {'src/fragment':'*.js'},

		// fragment_js: 'src/fragment/*.js',
		// fragment_js: {
		// 	'src/fragment': '*.js',
		// },
	},

	tasks: {
		all: 'build/**',
	},

	outputs: {
		build: {
			main: {
				':main_js': h => ({copy:`src/main/${h.main_js}`}),
			},

			fragment: {
				':fragment_js': h => ({copy:`src/fragment/${h.fragment_js}`}),

				'parser.js': () => ({
					deps: [
						'src/fragment/*.{jison,jisonlex}',
						// ...['*.jison', '*.jisonlex']
						// 	.map(s => `src/fragment/${s}`),
					],
					run: /* syntax: bash */ `
						# compile grammar and lex
						jison $1 $2 -o $@
					`,
				}),

			},
		},
	},
};
