#!/usr/bin/env node

const fs = require('fs');
const cp = require('child_process');
const path = require('path');
require('colors');

const targets = require('./targets/parser.js');

const debug = {
	log: (s, ...a_args) => console.log(`| ${s}`, ...a_args),
	warn: (s, ...a_args) => console.warn(`! ${s}`, ...a_args),
	error: (s, ...a_args) => console.error(`~ ${s}`, ...a_args),
};

const gobble = (s_text) => {
	let m_pad = /^(\s+)/.exec(s_text.replace(/^\n+/, ''));
	if(m_pad) {
		return s_text.replace(new RegExp(`\\n${m_pad[1]}`, 'g'), '\n\t').trim();
	}
	else {
		return s_text.trim();
	}
};


async function load(p_mkfile, g_args) {
	let z_mkfile;
	try {
		z_mkfile = require(p_mkfile);
	}
	catch(e_require) {
		throw new Error(`error while trying to load mk.js file: ${e_require.message}\n`.red+e_require.stack);
	}

	let h_mkfile;

	// descriptor is callback
	if('function' === typeof z_mkfile) {
		h_mkfile = z_mkfile(new helper_mkfile());
	}
	// descriptor is static
	else {
		h_mkfile = z_mkfile;
	}

	// make mkfile object
	let k_mkfile = new mkfile(h_mkfile);

	// mkfile mtime
	k_mkfile.mtime = fs.statSync(p_mkfile).mtime;

	// ref targets
	let a_targets = g_args.targets || [];

	// default to 'all'
	if(!a_targets.length) a_targets = ['all'];

	// invoke targets
	let hm_runners = new Map();
	let a_makes = await k_mkfile.make(a_targets, hm_runners);

	if(g_args.watch) {
		let h_listeners = {};

		for(let g_make of a_makes) {
			for(let s_file in g_make.files) {
				let a_w_targets = g_make.files[s_file];
				let f_listener = () => {
					debug.log(`updated ${s_file}`.green);
					k_mkfile.make(a_w_targets, new Map());
				};
				fs.watchFile(s_file, f_listener);
				h_listeners[s_file] = f_listener;
			}
		}

		// watch mkfile
		let f_listener_mk = () => {
			debug.log(`updated ${p_mkfile}`.green);
			// remove watch listeners
			for(let s_file in h_listeners) {
				fs.unwatchFile(s_file, h_listeners[s_file]);
			}

			// unwatch self
			fs.unwatchFile(p_mkfile, f_listener_mk);

			// rerun mk
			load(p_mkfile, g_args);
		};
		fs.watchFile(p_mkfile, f_listener_mk);

		// print
		debug.log(`watching files...`.blue);
	}
}

class helper_mkfile {
	constructor() {

	}

	paths(a_files) {
		let a_paths = [];
		for(let z_file of a_files) {
			if('string' === typeof z_file) {
				a_paths.push(z_file);
			}
			else {
				for(let s_dir in z_file) {
					a_paths.push(...this.paths(z_file[s_dir]).map(s => `${s_dir}/${s}`));
				}
			}
		}

		return a_paths;
	}
}

class bash {
	static prepare(h_variables, a_args=[]) {
		// bash variables
		return `set -- ${a_args.map(s => `"${s.replace(/"/g, '\\"')}"`).join(' ')}; `
			+Object.keys(h_variables).map((s_var) => {
				let z_value = h_variables[s_var];

				// value is string
				if('string' === typeof z_value) {
					return `${s_var}="${z_value.replace(/"/g, '\\"')}"; `;
				}
				// value is array
				else if(Array.isArray(z_value)) {
					return `${s_var}=(${z_value.map(z => `'${z}'`).join(' ')}); `;
				}
				// other
				else {
					throw new Error(`unexpected value for variable '${s_var}': ${z_value}`);
				}
			}).join('');
	}

	static spawn_sync(s_cmds, h_variables, a_args) {
		let s_exec = this.prepare(h_variables, a_args)+s_cmds.trim();
		return cp.spawnSync('/bin/bash', ['-c', s_exec], {
			encoding: 'utf8',
			timeout: 1000,
		});
	}

	static spawn(s_cmds, h_variables, a_args) {
		let s_exec = this.prepare(h_variables, a_args)+s_cmds.trim();
		return cp.spawn('/bin/bash', ['-c', s_exec], {
			encoding: 'utf8',
		});
	}
}


class err_no_target extends Error {}


class mkfile {
	constructor(h_mkfile) {
		let b_phony_pattern = false;
		let r_phony = /^[\w-]+$/;
		let a_phonies = [];
		let h_patterns = {};
		let h_recipes = {};

		// normalize mkfile
		for(let s_key in h_mkfile) {
			let z_value = h_mkfile[s_key];

			// pattern definition
			if('&' === s_key[0]) {
				let s_value;

				// already a string
				if('string' === typeof z_value) {
					s_value = z_value;
				}
				// regex
				else if(z_value instanceof RegExp) {
					s_value = z_value.toString().slice(1, -1);

					// cannot use flags
					if(z_value.flags) {
						throw new Error(`cannot use regex flags in pattern def since they are used in substitution`);
					}
				}
				// other
				else {
					throw new TypeError(`unrecognized type for pattern def '${s_key}': ${z_value}`);
				}

				// save pattern
				h_patterns[s_key.slice(1)] = s_value;
			}
			// phony override
			else if('.PHONY' === s_key) {
				// boolean; enable/disable default pattern
				if('boolean' === typeof z_value) {
					b_phony_pattern = z_value;
				}
				// regex
				else if(z_value instanceof RegExp) {
					b_phony_pattern = true;
					r_phony = z_value;
				}
				// targets in string
				else if('string' === typeof z_value) {
					a_phonies = z_value.trim().split(/\s+/g);
				}
				// list of targets
				else if(Array.isArray(z_value)) {
					a_phonies = z_value;
				}
				// invalid
				else {
					throw new TypeError('unrecognized type for .PHONY value');
				}
			}
			// otherwise it is a build recipe
			else {
				// assume phony target
				let b_phony = true;

				// normalize recipe
				let g_recipe = {deps:[]};

				// value is string
				if('string' === typeof z_value) {
					// dep targets in string
					g_recipe.deps = z_value.trim().split(/\s+/g);
				}
				// value is function
				else if('function' === typeof z_value) {
					// runtime target
					g_recipe.deps = [z_value];
				}
				// value is array
				else if(Array.isArray(z_value)) {
					// list of targets
					g_recipe.deps = z_value;
				}
				// value is simple object
				else if('object' === typeof z_value && Object === z_value.constructor) {
					// phonyness made explicit
					if('phony' in z_value) {
						b_phony = !!z_value.phony;
					}
					// implicit; phony test is pattern
					else if(b_phony_pattern) {
						// set phony as result of regex test
						b_phony = r_phony.test(s_key);
					}
					// phony test is array and this is in list; mark as phony
					else if(a_phonies.includes(s_key)) {
						b_phony = true;
					}
					// otherwise, not phony
					else {
						b_phony = false;
					}

					// copy properties from value onto recipe spec
					Object.assign(g_recipe, z_value);
				}
				// invalid value
				else {
					throw new TypeError(`unrecognized value type for recipe '${s_key}': ${z_value}`);
				}

				// phony
				if(b_phony) {
					g_recipe.phony = true;
				}
				// not phony
				else {
					// but value has no .run property
					if('string' === typeof z_value || Array.isArray(z_value) || !('run' in z_value)) {
						throw new Error(`non-phony recipe for '${s_key}' target has no '.run' property`);
					}

					// normal; not phony
					Object.assign(g_recipe, z_value, {phony:false});
				}

				// save target
				h_recipes[s_key] = Object.assign(g_recipe, {target:s_key});
			}
		}

		// save fields
		Object.assign(this, {
			patterns: h_patterns,
			recipes: h_recipes,
			bash: new bash(),
			mtime: 0,
		});
	}

	async make(a_targets, hm_runners) {
		// make distinct
		a_targets = [...new Set(a_targets)];

		// prep empty scope
		let g_scope = {
			variables: {},
			concurrent: new Map(),
			encountered: new Map(),
			runners: hm_runners,
		};

		let g_state = {};

		// run each make target
		let a_makes = await Promise.all(a_targets.map((s_target) => {
			// print
			debug.log(`mk ${s_target}`.white);

			// run
			return this.run(s_target, Object.assign(g_scope, {stack:[]}), s_target, g_state);
		}));

		// each make target
		for(let i_target=0; i_target<a_makes.length; i_target++) {
			if(!a_makes[i_target].mtimes[0]) {
				debug.warn(`nothing to make for target: ${a_targets[i_target]}`.yellow);
			}
		}

		return a_makes;
	}

	async run(s_target, g_scope, s_tag, g_state) {
		let {
			recipes: h_recipes,
		} = this;

		let hm_runners = g_scope.runners;

		// debug
		debug.log(`[${s_tag}]: run ${s_target}`.cyan);

		// already running
		if(hm_runners.has(s_target)) {
			return await hm_runners.get(s_target);
		}

		// name of recipe
		let s_recipe = s_target;

		// context for this run
		let g_context = {
			files: {},
			target: s_target,
			variables: Object.create(g_scope.variables),
		};

		// no exact matches
		if(!(h_recipes.hasOwnProperty(s_target))) {
			// the pattern to use
			let g_pattern;

			// all patterns that match target
			let a_matching_patterns = [];

			// test against all patterns
			for(let s_key in h_recipes) {
				let h_matches = this.matches(s_target, s_key);

				// positive match
				if(h_matches) {
					a_matching_patterns.push({
						key: s_key,
						matches: h_matches,
					});
				}
			}

			// number of matching patterns
			let nl_matching_patterns = a_matching_patterns.length;

			// no patterns match
			if(!nl_matching_patterns) {
				// glob for all targets
				let a_files = this.eval(/* syntax: bash */ `$(
					# remove space
					IFS="$(printf '\\n\\t')"

					# glob target
					__target="${s_target}"

					# use for-loop
					for __file in $__target; do
						echo "$__file"
					done
				)`, g_context);

				// no targets
				if(!a_files.length) {
					throw new err_no_target(`glob returned no files: '${s_target}'`);
				}

				// set file map
				let h_files = {};
				for(let s_file of a_files) {
					h_files[s_file] = [];
				}

				// each target
				return {
					files: h_files,
					mtimes: a_files.map((s_file) => {
						let g_stat;
						try {
							// stat file
							g_stat = fs.statSync(s_file);

							// directory
							if(g_stat.isDirectory()) {
								return Infinity;
							}
							// regular file
							else {
								// modification time
								let xt_mtime = g_stat.mtimeMs;

								// return dependency struct
								return xt_mtime;
							}
						}
						// no such file
						catch(e_stat) {
							throw new err_no_target(`no recipe to make target, or dependency file not exists: '${s_target}'`);
						}
					}),
				};
			}
			// multiple patterns match
			else if(nl_matching_patterns > 1) {
				// filter recipes that are not consensually a case
				let a_nonconsual = a_matching_patterns
					.filter(g => !h_recipes[g.key].case)
					.map(g => ` '${g.key}'`);

				// there exist nonconsensual cases
				if(a_nonconsual.length) {
					throw new Error(`multiple non-consensual patterns match target '${s_target}':${a_nonconsual}`
						+`\n	enable order-based matching by adding '.case' property to each candidate recipe and first matching recipe will be used`);
				}

				// okay, use first matching recipe
				g_pattern = a_matching_patterns[0];
			}
			// single match
			else {
				g_pattern = a_matching_patterns[0];
			}

			// set recipe name
			s_recipe = g_pattern.key;

			// set match variables
			Object.assign(g_context.variables, g_pattern.matches);
		}

		// ref recipe
		let g_recipe = h_recipes[s_recipe];

		// save recipe name to context
		g_context.recipe = s_recipe;

		// not phony
		if(!g_recipe.phony) {
			try {
				// stat file
				let g_stat = fs.statSync(s_target);

				// is a directory
				if(g_stat.isDirectory()) {
					// set artificial modification time
					g_context.mtime = Infinity;

					debug.log(`[${s_tag}] '${s_target}' is a directory that already exists`);
				}
				// regular file
				else {
					// fetch modification time
					g_context.mtime = g_stat.mtimeMs;

					// // save file
					// g_context.files[s_target] = [];

					debug.log(`[${s_tag}] '${s_target}' modified ${new Date(g_context.mtime)}`);
				}
			}
			// file not exists
			catch(e_stat) {
				// always run this rule
				g_context.mtime = 0;
			}
		}

		// destructue scope object
		let {
			stack: a_stack,
			concurrent: hm_concurrent,
			encountered: hm_encountered,
		} = g_scope;

		// target already encountered in stack
		if(a_stack.includes(s_target)) {
			// avoid recursion
			throw new Error(`infinite recusion detected at target '${s_target}'${s_recipe === s_target? '': ` applied to recipe pattern '${s_recipe}'`}`);
		}

		// target running concurrently
		if(hm_concurrent.has(s_target) && hm_concurrent.get(s_target).size) {
			// target does not allow for concurrency
			if(!g_recipe.concurrency) {
				throw new Error(`target '${s_target}' is already running in another task stack:`
					+'\n	'+JSON.stringify(hm_concurrent.get(s_target), null, '\t')
					+`\n	this is usually a dangerous practice since it could cause race conditions, however you can explicitly allow this recipe to be run concurrently by adding a '.concurrency' property`);
			}
		}

		// target already encountered
		if(hm_encountered.has(s_target)) {
			// target does not allow for concurrency
			if(!g_recipe.concurrency) {
				// warn
				debug.warn((`target '${s_target}' was already run in another task stack:`
					+'\n	'+JSON.stringify(hm_encountered.get(s_target), null, '\t')
					+`\n	this is usually a dangerous practice since it could cause race conditions, however you can explicitly allow this recipe to be run concurrently by adding a '.concurrency' property`).yellow);
			}
		}

		// add target to stack
		a_stack.push(s_target);

		// target is running elsewhere
		if(hm_concurrent.has(s_target)) {
			// add this stack to map
			hm_concurrent.get(s_target).add(a_stack);
		}
		// target not running elsewhere
		else {
			// put stack into map
			hm_concurrent.set(s_target, new Set([a_stack]));
		}

		// target was encountered elsewhere
		if(hm_encountered.has(s_target)) {
			// add this stack to map
			hm_encountered.get(s_target).add(a_stack);
		}
		// target not seen elsewhere
		else {
			// put stack into map
			hm_encountered.set(s_target, new Set([a_stack]));
		}


		// run recipe
		let dp_runner = new Promise(async(fk_run) => {
			// run dependencies first
			let a_deps = await Promise.all(
				g_recipe.deps.map(z_dep => Promise.all(
					// each resolved dependency target
					this.resolve(z_dep, g_context).map((s_dep_target) => {
						// create new scope
						let g_dep_scope = Object.assign({}, g_scope, {
							// stack needs to be cloned
							stack: [...g_scope.stack],
						});

						// run dependency
						return new Promise(async(fk_dep) => {
							let a_runs = await this.run(s_dep_target, g_dep_scope, s_target, g_state)
								.catch((e_run) => {
									// allow no target exceptions
									if(!(e_run instanceof err_no_target)) {
										throw e_run;
									}
								});

							let h_files = {};
							if(a_runs) {
								// debugger;
								for(let s_file in a_runs.files) {
									let a_files = a_runs.files[s_file].length? a_runs.files[s_file]: [s_target];

									if(s_file in h_files) h_files[s_file].push(...a_files);
									else h_files[s_file] = a_files;

									if(s_file in g_context.files) g_context.files[s_file].push(...a_files);
									else g_context.files[s_file] = a_files;
								}
							}

							return fk_dep(Object.assign(a_runs || {
								files: h_files,
								mtimes: [0],
							}, {target:s_dep_target}));
						});
					}))
				));


			// dependencies => variables $n (and update context deps)
			let a_dep_targets = g_context.deps = a_deps.reduce((a_out, a_in) => [...a_out, ...a_in.map(g => g.target)], []);

			// only if target is newer than all dependencies and mkfile is older
			if(g_context.mtime && this.mtime < g_context.mtime && a_deps.every(a => a.every(g => g.mtimes.every(xt_mtime => g_context.mtime >= xt_mtime)))) {
				// skip build
				debug.warn(`nothing to make for ${s_target}`.yellow);
			}
			// otherwise, build
			else {
				// run recipe
				if(g_recipe.run) {
					let z_run = g_recipe.run;

					await new Promise((fk_recipe) => {
						let s_run = z_run;

						// run is a function
						if('function' === typeof z_run) {
							s_run = z_run(g_context.variables);
						}

						// run is not a string
						if('string' !== typeof s_run) {
							throw new TypeError(`invalid run type: ${s_run}`);
						}

						let s_exec = this.special(s_run, g_context);

						debug.log(`[${s_tag}] args: ${JSON.stringify(a_dep_targets)}`.blue);
						debug.log(`[${s_tag}] vars: ${JSON.stringify(g_context.variables)}`.blue);
						debug.log(`[${s_tag}] > ${gobble(s_exec)}`.green);

						let u_run = bash.spawn(s_exec, g_context.variables, a_dep_targets);

						let s_buffer_stdout = '';
						u_run.stdout.on('data', (s_data) => {
							// append to buffer
							s_buffer_stdout += s_data;

							// print each newline
							let a_lines = s_buffer_stdout.split(/\n/g);
							for(let s_line of a_lines.slice(0, -1)) {
								debug.log(`[[${s_target}]]:`.magenta+` ${s_line}`);
							}

							// set to final un-terminated line
							s_buffer_stdout = a_lines[a_lines.length-1];
						});

						let s_buffer_stderr = '';
						u_run.stderr.on('data', (s_data) => {
							// append to buffer
							s_buffer_stderr += s_data;

							// print each newline
							let a_lines = s_buffer_stderr.split(/\n/g);
							for(let s_line of a_lines.slice(0, -1)) {
								debug.log(`[[${s_target}]]:`.red+` ${s_line}`);
							}

							// set to final un-terminated line
							s_buffer_stderr = a_lines[a_lines.length-1];
						});

						u_run.on('exit', (n_code) => {
							// print last of buffers
							if(s_buffer_stdout) {
								debug.log(`[[${s_target}]]:`.magenta+` ${s_buffer_stdout}`);
							}
							if(s_buffer_stderr) {
								debug.error(`[[${s_target}]]:`.red+` ${s_buffer_stderr}`);
							}

							// error
							if(n_code) {
								// let user know in case they are watching files
								process.stdout.write('\x07');
								throw new Error(`recipe commands resulted in non-zero exit code '${n_code}' for target '${s_target}'`);
							}

							// resolve
							fk_recipe();
						});
					});
				}

				// update mtime
				g_context.mtime = Date.now();
			}

			// remove this invocation from concurrency
			hm_concurrent.get(s_target).delete(a_stack);

			// done running task
			fk_run();
		});

		//
		hm_runners.set(s_target, dp_runner);

		// done with task
		await dp_runner;

		// mtime
		return {
			files: g_context.files,
			mtimes: [g_context.mtime],
		};
	}

	matches(s_target, s_pattern) {
		return targets.parse(s_pattern)(s_target, this);
	}

	special(s_str, g_context) {
		return s_str.replace(/(^|[^\\])\$([@#$%^&*<])/g, (s_base, s_preceed, s_char) => {
			let s_text = (() => {
				switch(s_char) {
					case '@': return g_context.target;
					case '<': return g_context.deps[0];
					case '*': return g_context.deps.join(' ');
					default: throw new Error(`special variable '$${s_char}' not supported`);
				}
			})();

			return `${s_preceed}${s_text}`;
		});
	}

	eval(s_str, g_context) {
		// ref variables
		let h_variables = g_context.variables;

		// exec echo on string
		let g_echo = bash.spawn_sync(`echo -e "${this.special(s_str, g_context)}"`, h_variables);

		// error
		if(g_echo.status) {
			throw new Error(`invalid parameterized bash string: '${s_str}'.\nbash said: ${g_echo.stderr}`);
		}

		return g_echo.stdout
			.replace(/\n$/, '')
			.match(/((?:\\ |[^ ])*(?: |$))/g)
			.slice(0, -1)
			.map(s => s.trim().replace(/\\ /g, ' '));
	}

	resolve(z_dep, g_context, b_avoid_recursion=false, as_family=new Set()) {
		// string dependency
		if('string' === typeof z_dep) {
			let s_dep = z_dep;

			// eval string
			return this.eval(s_dep, g_context);
		}
		// runtime dependency
		else if('function' === typeof z_dep) {
			// avoid recursion
			if(b_avoid_recursion) {
				throw new Error(`detected dependency callback recursion`);
			}

			// fetch deps from callback
			let z_deps = z_dep(g_context.variables);

			// resolve targets (avoiding recursion this time)
			return this.resolve(z_deps, g_context, true);
		}
		// array
		else if(Array.isArray(z_dep)) {
			// already in family
			if(as_family.has(z_dep)) {
				throw new Error(`detected cyclical array`);
			}

			// do not evaluate this object again
			as_family.add(z_dep);

			// each target
			return z_dep.map(z => this.resolve(z, g_context, b_avoid_recursion, as_family));
		}
		// invalid type
		else {
			throw new TypeError(`unrecognized type for dependency: '${z_dep}' under recipe '${g_context.recipe}'`);
		}
	}
}


if(module === require.main) {
	let h_cli = require('commander')
		.version(require('../package.json').version, '-v, --version')
		.option('-n, --dry-run', 'show the targets and commands without executing them')
		.option('-s, --silent', 'do not echo commands')
		.option('-w, --watch', 'watch dependency files and re-mk targets')
		.option('-f, --file', 'use specified mkfile')
		.arguments('[targets...]')
		.parse(process.argv);

	let g_args = {
		targets: h_cli.args,
		watch: h_cli.watch,
	};

	let s_mk_file = h_cli.file || 'mk.js';

	let p_mkfile = path.join(process.cwd(), s_mk_file);

	(async() => {
		try {
			await load(p_mkfile, g_args);
		}
		catch(e_mk) {
			console.error(`\n\nFatal error: ${e_mk.message}`.red+e_mk.stack);
			process.exit(1);
		}
	})();
}

