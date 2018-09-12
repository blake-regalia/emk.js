#!/usr/bin/env node

const fs = require('fs');
const cp = require('child_process');
const path = require('path');
const util = require('util');
const vm = require('vm');

const mkdirp = require('mkdirp-promise');
const watch = require('node-watch');
const glob = require('bash-glob');
const chalk = require('chalk');
const yargs = require('yargs');
const yargs_parser = require('yargs-parser');

const fs_access = util.promisify(fs.access);
const fs_stat = util.promisify(fs.lstat);

const graph = require('./graph.js');

const fragment_parser = require('../fragment/parser.js');
const {
	fragment_types,
	pattern_fragment,
	pattern_fragment_text,
	pattern_fragment_enum,
	pattern_fragment_regex,
} = require('../fragment/assembler.js');

const pattern_fragment_from_string = (s_key, k_emkfile) => fragment_parser.parse(s_key).bind(k_emkfile);


const F_TEXT_TO_REGEX = s => s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
const F_GLOB_TO_REGEX = (s, s_wildcard_quantifier='+') => s
	.replace(/[-/\\^$+?.()|[\]{}]/g, '\\$&')
	.replace(/[*]/g, `([^/]${s_wildcard_quantifier})`);

const T_EVAL_TIMEOUT = 5000;  // allow up to 5 seconds for script to load

const S_ESC_CLEAR_EOL = '\u001B[K';
const S_STATUS_PASS = chalk.keyword('orange')('⚡');
const S_QUOTE_CMD = chalk.dim('> ');
const S_QUOTE_IN = chalk.dim('< ');
const S_LINE_BREAK = '------------------------------------------------------';


const log = {
	log(s_tag, s_text) {
		console.log(`${chalk.white(`[${s_tag}]`)} ${s_text}`);
	},
	good(s_tag, s_text) {
		console.log(`${chalk.green(`[${s_tag}]`)} ${s_text}`);
	},
	notice(s_tag, s_text) {
		console.log(`${chalk.blue(`[${s_tag}]`)} ${s_text}`);
	},
	info(s_tag, s_text) {
		console.log(`${chalk.cyan(`[${s_tag}]`)} ${s_text}`);
	},
	quote(s_tag, s_text) {
		console.log(`${chalk.magenta(`[${s_tag}]`)} ${s_text}`);
	},
	warn(s_tag, s_text) {
		console.warn(`${chalk.yellow(`[${s_tag}]`)} ${s_text}`);
	},
	error(s_tag, s_text) {
		console.error(`${chalk.red(`[${s_tag}]`)} ${s_text}`);
	},
	fail(s_tag, s_text, s_quote='', xc_exit=1) {
		console.error(`-${chalk.redBright.bgBlackBright(` ${s_tag} `)} : ${chalk.red(s_text)}`
				+(s_quote
					? chalk.red(`\n${pad(s_quote)}`)
					: ''));
		process.exit(xc_exit || 1);
	},
};


const gobble = (s_text, s_space='\t') => {
	let m_pad = /^(\s+)/.exec(s_text.replace(/^\n+/, ''));
	if(m_pad) {
		return s_space+s_text.replace(new RegExp(`\\n${m_pad[1]}`, 'g'), '\n'+s_space).trim();
	}
	else {
		return s_space+s_text.trim();
	}
};

const pad = (s_in, s_quote=S_QUOTE_CMD) => s_in.split(/\n/g).map(s => ` ${s_quote}   `+s).join('\n');

const T_SECONDS = 1000;
const T_MINUTES = 60 * T_SECONDS;
const T_HOURS = 60 * T_MINUTES;
const T_DAYS = 24 * T_HOURS;
const T_WEEKS = 7 * T_DAYS;

const time_ago = (t_when) => {
	let t_diff = Date.now() - t_when;

	if(t_diff < T_SECONDS) {
		return '< 1s';
	}
	else if(t_diff < T_MINUTES) {
		return Math.round(t_diff / T_SECONDS)+'s';
	}
	else if(t_diff < T_HOURS) {
		return Math.round(t_diff / T_MINUTES)+'m';
	}
	else if(t_diff < T_DAYS) {
		return Math.round(t_diff / T_HOURS)+'h';
	}
	else if(t_diff < T_WEEKS) {
		return Math.round(t_diff / T_DAYS)+'d';
	}
	else {
		return Math.round(t_diff / T_WEEKS)+'w';
	}
};


const evaluate = (s_script, p_file, pd_dir, t_timeout=T_EVAL_TIMEOUT) => {
	let a_deps = [];
	let h_module = {exports:{}};
	let f_require = (s_package) => {
		// resolve to path
		let p_require = require.resolve(s_package, {
			paths: [
				pd_dir,
			],
		});

		// file dependency; add to dependency list
		if('/' === p_require[0]) a_deps.push(p_require);

		// load module
		return require(p_require);  // eslint-disable-line global-require
	};

	let h_nodejs_env = {
		__dirname: pd_dir,
		__filename: p_file,
		exports: h_module.exports,
		module: h_module,
		require: f_require,
	};

	// build script string; fetch file contents
	let s_emkfile = /* syntax: js */ `
		(function(${Object.keys(h_nodejs_env).join(',')}) {
			${s_script}
		})(${Object.keys(h_nodejs_env).map(s => `__EMK.${s}`).join(',')})`;

	// create script
	let y_script = new vm.Script(s_emkfile, {
		filename: p_file,
	});

	// create context
	let h_context = {};
	for(let _key of Reflect.ownKeys(global)) {
		Reflect.defineProperty(h_context, _key,
			Reflect.getOwnPropertyDescriptor(global, _key));
	}

	// add a global to context
	Object.assign(h_context, {
		__EMK: h_nodejs_env,
	});

	// evaluate code, grab exports
	let w_eval;
	try {
		w_eval = y_script.runInNewContext(h_context, {
			filename: p_file,
			timeout: t_timeout,
		});
	}
	catch(e_run) {
		log.fail(p_file, 'error in emk file script', e_run.stack);
	}

	return {
		returned: w_eval,
		exports: h_context.__EMK.module.exports,
		required: a_deps,
	};
};


class target_fragment {
	static from_command(g_command, s_split) {
		let {
			target: s_target,
			args: h_args,
		} = g_command;

		// split regex
		let r_split = new RegExp('\\'+s_split, 'g');

		// divide target path into fragments
		let a_fragments = s_target.split(r_split);

		// no wildcards; return text fragments
		if(!s_target.includes('*')) {
			return a_fragments.map(s => new target_fragment_text(s));
		}

		// pattern fragments
		let a_pattern = [];

		// each fragment
		for(let s_frag of a_fragments) {
			// some file
			if('*' === s_frag) {
				a_pattern.push(new target_fragment_wild());
			}
			// all targets recursively
			else if('**' === s_frag) {
				a_pattern.push(new target_fragment_wild_recursive());
			}
			// globstar pattern
			else if(s_frag.includes('*')) {
				a_pattern.push(target_fragment_pattern.from_glob(s_frag));
			}
			// exact text
			else {
				a_pattern.push(new target_fragment_text(s_frag));
			}
		}

		return a_pattern;
	}

	constructor(g_this) {
		Object.assign(this, g_this);
	}
}

class target_fragment_text extends target_fragment {
	constructor(s_text) {
		super({
			source: null,
			text: s_text,
		});
	}

	or_wild_recursive() {
		return new target_fragment_pattern({
			source: this,
			pattern: new RegExp(`^(?:${F_TEXT_TO_REGEX(this.text, '+')}|${F_GLOB_TO_REGEX('*', '*')})$`),
		});
	}

	toString() {
		return this.text;
	}
}

class target_fragment_pattern extends target_fragment {
	static from_glob(s_frag) {
		return new target_fragment_pattern({
			source: null,
			pattern: new RegExp(`^${F_GLOB_TO_REGEX(s_frag, '+')}$`),
			frag: s_frag,
		});
	}

	or_wild_recursive() {
		// only if this hasn't been wild_recursed already
		if(!this.source) {
			return new target_fragment_pattern({
				source: this,
				pattern: new RegExp(`^(?:${F_GLOB_TO_REGEX(this.frag, '+')}|${F_GLOB_TO_REGEX('*', '*')})$`),
				frag: this.frag,
			});
		}
		else {
			return this;
		}
	}

	// eslint-disable-next-line class-methods-use-this
	toString() {
		if(this.source) return this.source.toString();
		return `(${this.pattern.toString().slice(1, -1)})`;
	}
}

class target_fragment_wild extends target_fragment {
	constructor(g_extra={}) {
		super({
			source: null,
			wild: true,
			...g_extra,
		});
	}

	// eslint-disable-next-line class-methods-use-this
	or_wild_recursive() {
		return new target_fragment_wild_recursive();
	}

	// eslint-disable-next-line class-methods-use-this
	toString() {
		return '*';
	}
}

class target_fragment_wild_recursive extends target_fragment_wild {
	constructor() {
		super({
			recurse: true,
		});
	}

	or_wild_recursive() {
		return this;
	}

	// eslint-disable-next-line class-methods-use-this
	toString() {
		return '**';
	}
}

class subtree {
	constructor(k_emkfile, h_input, s_split, fk_child=null, a_prov=[]) {
		let h_expanded = {};

		// perform expansion before building subtrees
		for(let s_key in h_input) {
			let z_child = h_input[s_key];

			// enum expansion
			if(Array.isArray(z_child) && z_child.every(z => 'function' === typeof z)) {
				// parse key
				let k_frag = pattern_fragment_from_string(s_key, k_emkfile);

				// prep enum
				let a_enum;

				// text
				if(k_frag instanceof pattern_fragment_text) {
					a_enum = [k_frag.text];
				}
				// enum
				else if(k_frag instanceof pattern_fragment_enum) {
					a_enum = k_frag.enum;
				}
				// pattern/other
				else {
					log.fail(`${a_prov.join(s_split)}${s_split}${s_key}`, `pattern fragment must be enumerable in order to use expansion`);
				}

				// each enum
				for(let s_match of a_enum) {
					// each expander
					for(let f_create of z_child) {
						// create struct
						let h_expand = f_create(s_match);

						// check each key for conflict
						for(let s_expand in h_expand) {
							if(s_expand in h_expanded) {
								log.warn(`${a_prov.join(s_split)}${s_split}${s_expand}`, `this subtree is being dynamically overwritten by the expansion of '${a_prov.join(s_split)}${s_split}${s_key}' on enum item '${s_match}'`);
							}

							// add/overwrite
							h_expanded[s_expand] = h_expand[s_expand];
						}
					}
				}
			}
			// process normally
			else {
				h_expanded[s_key] = z_child;
			}
		}

		// destination tree
		let h_tree = {};

		// build subtrees recursively
		for(let s_key in h_expanded) {
			let z_child = h_expanded[s_key];

			// prep subprov
			let a_subprov = [...a_prov, s_key];

			// subtree
			if('object' === typeof z_child && Object.toString() === z_child.constructor.toString()) {
				h_tree[s_key] = new subtree(k_emkfile, z_child, s_split, fk_child, a_subprov);
			}
			// leaf node
			else {
				// do child callback
				if(fk_child) z_child = fk_child(z_child, a_subprov);

				// store to tree
				h_tree[s_key] = z_child;
			}
		}

		// parse each key in tree for matching
		let h_map = {};
		for(let s_key in h_tree) {
			h_map[s_key] = pattern_fragment_from_string(s_key, k_emkfile);
		}

		Object.assign(this, {
			emkfile: k_emkfile,
			tree: h_tree,
			prov: a_prov,
			split: s_split,
			map: h_map,
		});
	}

	at(s_key) {
		return this.tree[s_key];
	}


	match_text(s_text) {
		let a_texts = [];
		let a_enums = [];
		let a_regexes = [];

		// each pattern frag branch in tree
		for(let [s_key, k_frag] of Object.entries(this.map)) {
			// pattern frag matches text
			if(k_frag.test_text(s_text)) {
				// text pattern
				if(k_frag instanceof pattern_fragment_text) {
					a_texts.push(s_key);
				}
				// enum pattern
				else if(k_frag instanceof pattern_fragment_enum) {
					// matching item in enum
					a_enums.push({
						key: s_key,
						frag: s_text,
						matches: k_frag.binding? {[k_frag.binding]:s_text}: {},
					});
				}
				// regex pattern
				else if(k_frag instanceof pattern_fragment_regex) {
					a_regexes.push({
						key: s_key,
						frag: s_text,
						matches: k_frag.match_text(s_text),
					});
				}
			}
		}

		return {
			texts: a_texts,
			enums: a_enums,
			regexes: a_regexes,
		};
	}

	* match_wild() {
		// each pattern frag branch in tree
		for(let [s_key, k_frag] of Object.entries(this.map)) {
			// text pattern or enum pattern
			if(k_frag instanceof pattern_fragment_text) {
				yield {
					key: s_key,
					frag: s_key,
					matches: {},
				};
			}
			// enum fragment
			else if(k_frag instanceof pattern_fragment_enum) {
				// each item in enum
				for(let {bindings:h_bindings, value:s_frag} of k_frag.combos) {
					// struct
					yield {
						key: s_key,
						frag: s_frag,
						matches: h_bindings || (k_frag.binding
							? {[k_frag.binding]:s_frag}
							: {}),
					};
				}
			}
			// regex pattern
			else if(k_frag instanceof pattern_fragment_regex) {
				// issue warning
				log.warn(this.prov.join(this.split)+this.split+s_key, `cannot use wildcard target '*' against this path pattern`);
			}
		}
	}

	* match_pattern(r_pattern) {
		// each pattern frag branch in tree
		for(let [s_key, k_frag] of Object.entries(this.map)) {
			// text fragment
			if(k_frag instanceof pattern_fragment_text) {
				// matches pattern
				if(k_frag.test_pattern(r_pattern)) {
					yield {
						key: s_key,
						frag: s_key,
						matches: {},
					};
				}
			}
			// enum fragment
			else if(k_frag instanceof pattern_fragment_enum) {
				// matches pattern; yield
				let s_frag = k_frag.match_pattern(r_pattern);
				if(null !== s_frag) {
					yield {
						key: s_key,
						frag: s_frag,
						matches: k_frag.binding? {[k_frag.binding]:s_frag}: {},
					};
				}
			}
			// regex pattern; issue warning
			else if(k_frag instanceof pattern_fragment_regex) {
				log.warn(this.emkfile, `cannot use pattern target '${r_pattern.toString()}' against path pattern at '${this.prov.join(this.split)}'`);
			}
		}
	}
}


class bash {
	static contextify(s_str, g_context) {
		return s_str.replace(/(^|[^\\])\$([@#$%^&*<])/g, (s_base, s_preceed, s_char) => {
			let s_text = (() => {
				switch(s_char) {
					case '@': return `'${g_context.target}'`;
					case '<': return `'${g_context.deps[0]}'`;
					case '*': return `'${g_context.deps.join(' ')}'`;
					default: throw new Error(`special variable '$${s_char}' not supported`);
				}
			})();

			return `${s_preceed}${s_text}`;
		});
	}

	static prepare(h_variables, a_args=[]) {
		// bash variables
		return `set -- ${a_args.map(s => `"${
			s.replace(/"/g, '\\"')
				.replace(/\n/g, '\\n')
		}"`).join(' ')}; `
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
				// value is number
				else if('number' === typeof z_value) {
					return `${s_var}="${z_value}"; `;
				}
				// other
				else {
					throw new Error(`cannot create bash variable '${s_var}' from value: ${z_value}`);
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


class executask {
	constructor(g_this) {
		Object.assign(this, g_this);
	}

	identical(k_other) {
		let as_deps_other = new Set(k_other.deps);
		let as_deps_this = new Set(this.deps);

		return k_other.run === this.run
			&& as_deps_other.size === as_deps_this.size
			&& k_other.deps.every(s => as_deps_this.has(s));
	}

	async update(g_exec) {
		// increment update count
		this.emkfile.updates_pending += 1;

		// execute self
		await this.execute(g_exec);

		// trigger dependent tasks
		let as_sups = this.graph.invs[this.id];

		// ref graph
		let k_graph = this.graph;

		// each super; call update
		for(let si_task of as_sups) {
			k_graph.nodes[si_task].update(g_exec);
		}

		// decrement update count
		this.emkfile.updates_pending -= 1;

		// root node; let emkfile know this update finished
		if(!as_sups.size) {
			this.emkfile.update_finished();
		}
	}

	async execute(g_exec) {
		let s_label = this.path;

		// run
		if(this.run) {
			const run = async(z_run) => {
				// normalize into array
				let a_run = Array.isArray(z_run)? z_run: [z_run];

				// each item in array
				for(let i_item=0, nl_items=a_run.length; i_item<nl_items; i_item++) {
					let z_item = a_run[i_item];

					// give suffix to distinguish
					let s_suffix = a_run.length > 1? '#'+i_item: '';

					// string; run as bash script
					if('string' === typeof z_item) {
						await this.execute_bash(z_item, s_label+s_suffix);
					}
					// function; run as callback
					else if('function' === typeof z_item) {
						// capture result
						let z_res = await this.execute_callback(z_item, s_label+s_suffix);

						// returned something
						if('string' === typeof z_res || 'function' === typeof z_res || Array.isArray(z_res)) {
							await run(z_res);
						}
					}
					// invalid type
					else {
						log.fail(s_label, `invalid run type given : ${z_item}`);
					}
				}
			};

			await run(this.run);
		}
		// completed task group
		else {
			log.good(s_label, `👍`);
		}
	}

	async execute_callback(f_run, s_label) {
		// stringify function
		let s_run = f_run.toString();

		// print
		log.notice(s_label, `${chalk.dim('args:')} ${JSON.stringify(this.xdeps)}; ${chalk.dim('vars:')} ${JSON.stringify(this.args)}\n`
			+`${pad(chalk.keyword('steelblue')(gobble(s_run, '')+'\n'), S_QUOTE_IN)}`);

		// safely execute
		let z_res;
		try {
			z_res = await f_run(this.path, ...this.xdeps);
		}
		catch(e_run) {
			// let user know in case they are watching files
			process.stdout.write('\x07');
			log.fail(s_label, `callback resulted in an error being thrown: '${e_run.message}'\n${e_run.stack}`);
		}

		// success
		log.good(s_label, `${S_STATUS_PASS} done`); // ✔

		// return result
		return z_res;
	}

	async execute_bash(s_script, s_label) {
		// bash command
		let s_bash = bash.contextify(s_script, {
			target: this.path,
			deps: this.xdeps,
		});

		// print
		log.notice(s_label, `${chalk.dim('args:')} ${JSON.stringify(this.xdeps)}; ${chalk.dim('vars:')} ${JSON.stringify(this.args)}\n`
			+`${pad(chalk.keyword('steelblue')(gobble(s_bash, '')+'\n'), S_QUOTE_IN)}`);

		// run process
		let u_run = bash.spawn(s_bash, this.args, this.xdeps);

		let s_buffer_stdout = '';
		u_run.stdout.on('data', (s_data) => {
			// append to buffer
			s_buffer_stdout += s_data;
		});

		let s_buffer_stderr = '';
		u_run.stderr.on('data', (s_data) => {
			// append to buffer
			s_buffer_stderr += s_data;
		});

		await new Promise((fk_run) => {
			u_run.on('exit', (n_code) => {
				// print last of buffers
				if(s_buffer_stdout) {
					log.quote(s_label, S_QUOTE_CMD+'\n'+pad(s_buffer_stdout));
				}
				if(s_buffer_stderr) {
					log.error(s_label, S_QUOTE_CMD+'\n'+pad(s_buffer_stderr));
				}

				// error
				if(n_code) {
					// let user know in case they are watching files
					process.stdout.write('\x07');
					log.fail(s_label, `command(s) resulted in non-zero exit code '${n_code}'`);
				}
				// success
				else {
					log.good(s_label, `${S_STATUS_PASS} done`); // ✔
				}

				// resolve
				fk_run();
			});
		});
	}
}

class task_creator {
	constructor(a_prov, z_value, k_emkfile) {
		let f_create;

		// list of dependencies
		if(Array.isArray(z_value)) {
			f_create = () => ({deps:z_value});
		}
		// single dependency
		else if('string' === typeof z_value) {
			f_create = () => ({deps:[z_value]});
		}
		// call-time struct
		else if('function' === typeof z_value) {
			f_create = z_value;
		}
		// invalid
		else {
			throw new TypeError(`invalid task descriptor: ${z_value}`);
		}

		Object.assign(this, {
			prov: a_prov,
			create: f_create,
			emkfile: k_emkfile,
		});
	}

	prepare(a_path, h_args) {
		let s_path = a_path.join('.');

		// create object
		let g_create = {};
		let z_create;
		try {
			z_create = this.create(h_args);
		}
		catch(e_create) {
			log.fail(s_path, `failed to create task recipe because there was an error in your callback function`, e_create.stack);
		}

		// array; deps
		if(Array.isArray(z_create)) {
			g_create = {deps:z_create};
		}
		// string; dep
		else if('string' === typeof z_create) {
			g_create = {deps:[z_create]};
		}
		// object; reflect
		else if('object' === typeof z_create && Object.toString() === z_create.constructor.toString()) {
			g_create = z_create;
		}
		// something else
		else {
			log.fail(s_path, `invalid type returned from create callback: ${z_create}`);
		}

		let {
			deps: a_deps=[],
			run: s_run=null,
		} = g_create;

		return new executask({
			id: '#'+s_path,  //`@${s_path}\0${a_deps.join('|')}\0${s_run}`,
			args: h_args,
			path: s_path,
			deps: a_deps,
			run: s_run,
			emkfile: this.emkfile,
		});
	}
}

class output_creator {
	constructor(a_prov, f_create, k_emkfile) {
		Object.assign(this, {
			prov: a_prov,
			create: f_create,
			emkfile: k_emkfile,
		});
	}

	prepare(a_path, h_args) {
		let s_path = a_path.join('/');

		let g_create;
		try {
			g_create = this.create(h_args);
		}
		catch(e_create) {
			log.fail(s_path, `failed to create output recipe because there was an error in your callback function`, e_create.stack);
		}

		let {
			deps: a_deps=[],
			run: s_run='',
			copy: s_src=null,
		} = g_create;

		// normalize deps
		if('string' === typeof a_deps) {
			a_deps = [a_deps];
		}
		// check deps
		else if(!Array.isArray(a_deps)) {
			log.fail(s_path, `'.deps' value given is not an array or string: ${a_deps}`);
		}
		// assert all strings
		else if(!a_deps.every(z => 'string' === typeof z)) {
			log.fail(s_path, `'.deps' array must only contain strings`);
		}

		// copy
		if(s_src) {
			// test source is file and read access
			try {
				fs.accessSync(s_src, fs.constants.R_OK);
			}
			catch(e_access) {
				log.fail(a_path.join('/'), `'copy' cannot read source file dependency: '${s_src}'`, e_access.message);
			}

			a_deps = [s_src];
			s_run = /* syntax: bash */ `
				# copy from src to dest
				cp $1 $@
				${s_run}
			`;
		}

		return new execuout({
			id: s_path,
			args: h_args,
			path: s_path,
			deps: a_deps,
			run: s_run,
			emkfile: this.emkfile,
		});
	}
}

class key_space {
	constructor() {
		Object.assign(this, {
			index: 0,
		});
	}

	reset() {
		this.index = 0;
	}

	next() {
		let i_index = this.index++;

		if(i_index < 26) {
			return String.fromCharCode(97+i_index);
		}
		else if(i_index < 52) {
			return String.fromCharCode(65+(i_index-26));
		}
		else {
			return String.fromCodePoint(192+(i_index-52));
		}
	}
}

class diagram {
	constructor(h_edges) {
		Object.assign(this, {
			edges: h_edges,
			refs: {},
			round: 0,
			short: new key_space(),
		});
	}

	draw(h_tree) {
		this.short.reset();
		let s_diagram = this.draw_subtree(h_tree)+`${S_ESC_CLEAR_EOL}\n`;
		this.round += 1;
		return s_diagram;
	}

	draw_subtree(h_tree, n_indent=1) {
		let {
			edges: h_edges,
			refs: h_refs,
			round: i_round,
		} = this;

		let s_diagram = '';
		let s_pre = '  '.repeat(n_indent-1)+' ';

		// sort keys
		let a_keys = Object.keys(h_tree).sort();

		// traverse tree in sorted key order
		for(let s_key of a_keys) {
			let z_value = h_tree[s_key];

			// leaf node
			if('string' === typeof z_value) {
				let s_refs = '';
				let as_deps = h_edges[z_value];
				if(as_deps.size) {
					s_refs = '['+[...as_deps].map(s => h_refs[s]).sort().join(', ')+']';
				}

				// make and save ref
				let s_short = i_round+this.short.next();
				h_refs[z_value] = s_short;

				// format label
				let s_label = z_value;

				// task
				if(s_label.includes('\0')) {
					let [s_task, s_deps] = s_label.split('\0');
					let a_deps = s_deps.split('|');

					s_label = `"${s_task}" {${a_deps.join(', ')}}`;
				}
				// file
				else {
					let a_path = s_label.split('/');
					s_label = a_path[a_path.length-1];
				}

				s_diagram += chalk.dim(`${s_pre}- ${s_short}:`)
					+` ${chalk.white(s_label)}`
					+` ${s_refs? chalk.yellowBright(s_refs)+' ': ''}${S_ESC_CLEAR_EOL}\n`;
			}
			else {
				s_diagram += chalk.dim(`${s_pre}+`)
					+` ${chalk.blueBright(s_key)} ${S_ESC_CLEAR_EOL}\n`
					+this.draw_subtree(z_value, n_indent+1);
			}
		}

		return s_diagram;
	}
}

class execuout extends executask {
	async execute(g_exec={}) {
		let p_file = this.path;

		// output file
		let pd_dir = path.dirname(p_file);

		// prep to get time last modified
		let t_mtime;

		CHECK_MTIME: {
			// assure directory exists and write access OK
			try {
				await fs_access(pd_dir, fs.constants.F_OK);
			}
			// directory does not exist; try to create it
			catch(e_access) {
				try {
					await mkdirp(pd_dir);
					break CHECK_MTIME;
				}
				catch(e_mkdirp) {
					log.fail(pd_dir, 'failed to mkdir recursively');
				}
			}

			// force update
			if(g_exec.force) break CHECK_MTIME;

			// check file exists
			try {
				await fs_access(p_file, fs.constants.F_OK);
			}
			// output file does not exist
			catch(e_access) {
				break CHECK_MTIME;
			}

			// stat file
			let dk_stats;
			try {
				dk_stats = (await fs_stat(p_file));
			}
			catch(e_stat) {
				log.fail(p_file, `failed to stat already existing file`, e_stat.stack);
			}

			// last modified
			t_mtime = this.mtime = dk_stats.mtimeMs;

			// output is newer than all srcs; all done!
			if(this.xdeps.every(si => t_mtime > this.graph.nodes[si].mtime)) {
				log.notice(p_file, `${chalk.dim.yellow('➘')}${chalk.keyword('orange')('➚')} output is up-to-date`); // ⏩
				return;
			}
			// output is symlink; no need to link same target again
			else if(dk_stats.isSymbolicLink()) {
				log.notice(p_file, '🔗  output is already symbolically linked');
				return;
			}
		}

		// bash run
		await super.execute(g_exec);

		// make sure file exists
		try {
			await fs_access(p_file, fs.constants.F_OK);
		}
		// file does not exist
		catch(e_access) {
			log.fail(p_file, 'this output file never got created by your shell command, or it was deleted shortly after it was created', e_access.stack);
		}

		// update modified time
		if(!t_mtime) {
			try {
				t_mtime = this.mtime = (await fs_stat(p_file)).mtimeMs;
			}
			catch(e_stat) {
				log.fail(p_file, `failed to stat previously existing file`, e_stat.stack);
			}
		}
	}
}

class execusrc extends executask {
	constructor(s_file, p_cwd, dk_stats, s_path, k_emkfile) {
		super({
			id: s_file,
			path: s_path,
			deps: [],
			run: null,
			file: s_file,
			cwd: p_cwd,
			stats: dk_stats,
			graph: null,
			watcher: null,
			emkfile: k_emkfile,
		});
	}

	async execute(g_exec={}) {
		let s_label = this.file;

		let dk_stats = await fs_stat(this.file);
		this.mtime = dk_stats.mtimeMs;

		log.good(s_label, `${S_STATUS_PASS} modified ${time_ago(dk_stats.mtimeMs)} ago`);

		// watch file; not already watching
		if(g_exec.watch && !this.watcher) {
			this.watcher = watch(s_label, (s_event, s_file) => {  // eslint-disable-line no-unused-vars
				if('update' === s_event) {
					// print
					log.info(s_label, `file was modified @ ${(new Date()).toISOString()}`);

					// emk is busy updating
					if(this.emkfile.updating) {
						// let user know
						log.warn(s_label, `an update chain is already running; postponing this update until previous one finishes`);

						// run this update afterwards
						return this.emkfile.updates.push(() => {
							this.update(g_exec);
						});
					}

					// let others know we are starting an update chain
					this.emkfile.updating = true;

					// call update
					this.update(g_exec);
				}
				else if('remove' === s_event) {
					log.fail(s_label, '🔥  dependency file was deleted');
				}
				else {
					throw new Error(`the node-watch module emitted and unexpected ${s_event} event`);
				}
			});
		}

		return;
	}
}

class emkfile {
	constructor(g_emkfile={defs:{}, tasks:{}, outputs:{}}, g_args, p_emkfile, a_deps) {
		// normalize defs
		let h_defs = {};
		for(let [s_key, z_value] of Object.entries(g_emkfile.defs || {})) {
			// enumeration; create instance
			if(Array.isArray(z_value)) {
				h_defs[s_key] = pattern_fragment_enum.from_list(this, z_value, s_key);
			}
			// glob pattern; create instance
			else if('string' === typeof z_value) {
				h_defs[s_key] = pattern_fragment_regex.from_glob_str(this, z_value, s_key);
			}
			// regular expression; create instance
			else if(z_value && 'object' === typeof z_value && z_value instanceof RegExp) {
				h_defs[s_key] = pattern_fragment_regex.from_regex_str(this, z_value, s_key);
			}
			// other
			else {
				throw new Error(`invalid definition under key '${s_key}': ${z_value}`);
			}
		}

		// save local fields
		Object.assign(this, {
			updating: false,
			updates: [],
			updates_pending: 0,

			source: p_emkfile,

			args: g_args,

			defs: h_defs,

			deps: a_deps,
		});

		// process subtrees
		Object.assign(this, {
			tasks: new subtree(this, g_emkfile.tasks || {}, '.', (z_leaf, a_prov) => {
				let si_task = a_prov.join('.');

				// task id contains slashes
				if(si_task.includes('/')) {
					log.warn(si_task, `task name contains a slash \`/\` character.\n\tthis may cause an unwanted collision with an output target`);
				}

				// normalize leaf
				return new task_creator(a_prov, z_leaf, this);
			}),

			outputs: new subtree(this, g_emkfile.outputs || {}, '/', (z_leaf, a_prov) => {
				let si_output = a_prov.join('/');

				// check child type
				if('function' !== typeof z_leaf) {
					log.fail(si_output, `expected value to be subtree or function; instead encountered: '${z_leaf}'`);
				}

				// normalize leaf
				return new output_creator(a_prov, z_leaf, this);
			}),
		});
	}

	// info
	info(s_text) {
		log.info(path.relative(this.args.cwd || process.cwd(), this.source), s_text);
	}

	// info
	notice(s_text) {
		log.notice(path.relative(this.args.cwd || process.cwd(), this.source), s_text);
	}

	// warn
	warn(s_text) {
		log.warn(path.relative(this.args.cwd || process.cwd(), this.source), s_text);
	}

	// critical failure
	fail(s_text) {
		log.fail(path.relative(this.args.cwd || process.cwd(), this.source), s_text);
	}

	update_finished() {
		// this was the last one
		if(!this.updates_pending) {
			// done updating
			this.updating = false;

			// print line break
			console.log(S_LINE_BREAK);

			// there are more updates; trigger first
			if(this.updates.length) {
				this.updates.shift()();
			}
		}
	}

	search(g_search) {
		let {
			node: z_node,
			target: a_target,
			split: s_split,
			info: h_info,
			path: a_path=[],
		} = g_search;

		// node is a (sub)tree
		if(z_node instanceof subtree) {
			// reached end of target
			if(!a_target.length) {
				log.warn(a_path.join(s_split), `a target lead to this non-leaf node. if you meant to run all sub-tasks, append a '${s_split}*' to the end, or use a recursive wildcard '**'`);
				return [];
			}

			// cast to instance
			let k_node = z_node;

			// squash texts and enums
			for(let i_squash=1; i_squash<=a_target.length; i_squash++) {
				// ref target fragment at head of path
				let k_target_frag = a_target[0];

				// squashing
				if((i_squash-1)) {
					if(!(a_target[i_squash-1] instanceof target_fragment_text)) {
						return [];
					}

					k_target_frag = new target_fragment_text(a_target.slice(0, i_squash).map(k => k.text).join(s_split));
				}

				// create subtarget
				let a_subtarget = a_target.slice(i_squash);

				// recursive glob; mutate sub pattern if it exists
				if(k_target_frag instanceof target_fragment_wild_recursive) {
					// more after this; OR in wild recursive
					if(a_subtarget.length) {
						a_subtarget[0] = a_subtarget[0].or_wild_recursive();
					}
					// none after this, repeat wild recursive
					else {
						a_subtarget = [k_target_frag];
					}
				}

				// prep subsearch
				let g_subsearch = {
					target: a_subtarget,
					split: s_split,
					info: h_info,
				};


				// target frag is exact text
				if(k_target_frag instanceof target_fragment_text) {
					// ref text from target frag
					let s_text = k_target_frag.text;

					// match text
					let {
						texts: a_texts,
						enums: a_enums,
						regexes: a_regexes,
					} = k_node.match_text(s_text);

					// update path
					g_subsearch.path = [...a_path, s_text];

					// exact text match; take only
					if(a_texts.length) {
						g_subsearch.node = k_node.at(a_texts[0]);
					}
					// one of enum, or one of regex
					else if(a_enums.length || a_regexes.length) {
						// take first
						let {
							key: s_key,
							frag: s_frag,
							matches: h_matches,
						} = a_enums[0] || a_regexes[0];

						// update subsearch
						Object.assign(g_subsearch, {
							node: k_node.at(s_key),
							path: [...a_path, s_frag],
							info: {
								...h_info,
								...h_matches,
							},
						});
					}
					// nothing matched; keep trying
					else {
						continue;
					}

					// recurse
					return this.search(g_subsearch);
				}
				// wild pattern; fork all
				else if(k_target_frag instanceof target_fragment_wild) {
					let a_hits = [];

					// all paths
					for(let {key:s_key, frag:s_frag, matches:h_matches} of k_node.match_wild()) {
						a_hits.push(...this.search({
							...g_subsearch,
							node: k_node.at(s_key),
							path: [...a_path, s_frag],
							info: {
								...h_info,
								...h_matches,
							},
						}));
					}

					return a_hits;
				}
				// non-wild pattern; match each
				else if(k_target_frag instanceof target_fragment_pattern) {
					let a_hits = [];

					// each key that matches pattern
					for(let {key:s_key, frag:s_frag, matches:h_matches} of k_node.match_pattern(k_target_frag.pattern)) {
						a_hits.push(...this.search({
							...g_subsearch,
							node: k_node.at(s_key),
							path: [...a_path, s_frag],
							info: {
								...h_info,
								...h_matches,
							},
						}));
					}

					return a_hits;
				}
				// something else
				else {
					debugger;
					throw new Error(`unknown target qualifiers: ${a_target[0]}`);
				}
			}

			return [];
		}
		// node is a leaf, more to target
		else if(a_target.length && !(a_target[0] instanceof target_fragment_wild_recursive)) {
			log.warn(this.source, `cannot navigate to '${s_split}${a_target.join(s_split)}' since '${a_path.join(s_split)}' reached a leaf node`);
			return [];
		}
		// end of target
		else {
			return [z_node.prepare(a_path, h_info, this.args.cwd)];
		}
	}

	add(a_executasks, h_args, k_graph) {
		let as_ids = new Set();

		// each matching task
		for(let k_executask of a_executasks) {
			let si_task = k_executask.id;

			// add to id set
			as_ids.add(si_task);

			// first encounter of node
			if(!(si_task in k_graph.nodes)) {
				// add to nodes
				k_graph.nodes[si_task] = k_executask;

				// save graph ref
				k_executask.graph = k_graph;

				// plot (expand) deps and add to set
				let as_dep_ids = new Set();
				for(let s_dep_call of k_executask.deps) {
					as_dep_ids = new Set([
						...as_dep_ids,
						...this.plot({
							call: s_dep_call,
							args: h_args,
						}, k_graph, k_executask.path),
					]);
				}

				// update executask
				k_executask.xdeps = [...as_dep_ids];

				// save to graph
				k_graph.outs[si_task] = as_dep_ids;
			}
			// node already exists
			else {
				let k_other = k_graph.nodes[si_task];

				// they are not identical
				if(!k_executask.identical(k_other)) {
					log.fail(k_executask.path, `multiple tasks are trying to build the same output file yet are indicating different dependencies or run commands`, gobble(`
						a: {
							deps: ${k_executask.deps.join(', ')},
							run: >
								${k_executask.run}
							<
						},
						b: {
							deps: ${k_other.deps.join(', ')},
							run: >
								${k_other.run}
							<
						},`));
				}
			}
		}

		return as_ids;
	}

	plot(g_call, k_graph, s_path) {
		let {
			call: s_call,
			args: h_args_pre,
		} = g_call;

		// separate target and config
		let m_call = /^([^:]+)(?::(.*))?$/.exec(s_call);

		// bad call
		if(!m_call) {
			throw new Error(`bad call: ${s_call}`);
		}

		// destructure
		let [, s_target, s_config] = m_call;

		// make args
		let h_args = {
			...h_args_pre,
			...(s_config
				? (() => {
					try {
						return JSON.parse(s_config);
					}
					catch(e_parse) {
						this.fail(`failed to parse config json: '${s_config}'`);
					}
				})()
				: {}),
		};

		// build command
		let g_command = {
			target: s_target,
			args: h_args,
		};

		// attempt to match against task
		{
			// turn target string into task descriptor
			let a_target = target_fragment.from_command(g_command, '.');

			// search tasks
			let a_executasks = this.search({
				node: this.tasks,
				target: a_target,
				split: '.',
				info: h_args,
			});

			// tasks matched
			if(a_executasks.length) {
				return this.add(a_executasks, h_args, k_graph);
			}
		}

		// attempt to match against output
		{
			// turn target string into task descriptor
			let a_target = target_fragment.from_command(g_command, '/');

			// search outputs
			let a_executasks = this.search({
				node: this.outputs,
				target: a_target,
				split: '/',
				info: h_args,
			});

			// outputs matched
			if(a_executasks.length) {
				return this.add(a_executasks, h_args, k_graph);
			}
		}

		// should be a file pattern dependency
		{
			// gather from ls
			let a_files;
			try {
				a_files = glob.sync(s_target, {
					cwd: this.args.cwd,
					failglob: true,
					// globstar: true,
				});
			}
			catch(e_glob) {
				log.fail(s_path, `glob failed on '${s_target}'`, e_glob.message);
			}

			// no files
			if(!a_files.length) {
				log.fail(s_path, `target '${s_target}' did not match any task patterns nor does such a file dependency exist`);
			}

			// sources
			let as_srcs = new Set();

			// each file
			for(let s_file of a_files) {
				// test for exists
				let dk_stats;
				try {
					dk_stats = fs.lstatSync(path.join(this.args.cwd, s_file));
				}
				catch(e_stat) {
					log.fail(s_path, `dependency file does not exist: '${s_file}'`);
				}

				// add file dependency
				as_srcs = new Set([
					...as_srcs,
					...this.add([
						new execusrc(s_file, this.args.cwd, dk_stats, s_target, this),
					], h_args, k_graph)]);
			}

			return as_srcs;
		}
	}

	async run(a_calls, g_config) {
		// no calls
		if(!a_calls.length) {
			this.warn('no task specified. using default "all"');
			a_calls.push({call:'all'});
		}

		let k_graph = this.graph = new graph();

		let as_invocations = new Set();
		for(let g_call of a_calls) {
			as_invocations = [
				...as_invocations,
				...this.plot(g_call, k_graph, 'emk.js'),
			];
		}

		// schedule rounds
		let a_rounds = k_graph.schedule({
			cycle: si_node => log.fail(si_node, 'detected dependency graph cycle at this node'),
		});

		// build a dependency graph diagram
		let s_stages = '';
		let i_stage = 0;

		let k_diagram = new diagram(k_graph.outs);

		for(let a_tasks of a_rounds) {
			let h_tree_files = {};
			let h_tree_tasks = {};
			for(let si_task of a_tasks) {
				// task
				if(si_task.includes('\0')) {
					let [s_task] = si_task.split('\0');

					let h_node = h_tree_tasks;
					let a_frags = s_task.split('.');
					let i_frag = 0;
					for(let nl_frags=a_frags.length-1; i_frag<nl_frags; i_frag++) {
						let s_dir = a_frags[i_frag]+'.';
						h_node = h_node[s_dir] = h_node[s_dir] || {};
					}

					h_node[a_frags[i_frag]] = si_task;
				}
				// file
				else {
					let h_node = h_tree_files;
					let a_dirs = si_task.split('/');
					let i_frag = 0;
					for(let nl_frags=a_dirs.length-1; i_frag<nl_frags; i_frag++) {
						let s_dir = a_dirs[i_frag]+'/';
						h_node = h_node[s_dir] = h_node[s_dir] || {};
					}

					h_node[a_dirs[i_frag]] = si_task;
				}
			}

			s_stages += `\n${chalk.magenta(`[stage ${i_stage++}]:`)}${S_ESC_CLEAR_EOL}\n`;
			if(Object.keys(h_tree_files).length) {
				s_stages += k_diagram.draw(h_tree_files);
			}
			if(Object.keys(h_tree_tasks).length) {
				s_stages += k_diagram.draw(h_tree_tasks);
			}
		}

		// print diagram
		this.info('dependency graph: '+chalk.bgBlackBright(s_stages));

		// execute rounds
		for(let a_tasks of a_rounds) {
			// done
			if(!a_tasks) return;

			// ref nodes
			let h_nodes = k_graph.nodes;

			// each task (in sorted order)
			let a_awaits = [];
			for(let si_task of a_tasks.sort()) {
				a_awaits.push(h_nodes[si_task].execute(g_config));
			}

			// run all async
			await Promise.all(a_awaits);
		}

		console.log(S_LINE_BREAK);

		// watch
		if(g_config.watch) {
			// watch this file and all dependencies
			this.watcher = watch([
				this.source,
				...this.deps,
			], (...a_args) => this.reload(...a_args));

			// print
			this.notice(`👀  watching files...`);
		}
	}

	unwatch() {
		// stop watching this file
		this.watcher.close();

		// close execusrc watchers
		for(let [, k_executask] of Object.entries(this.graph.nodes)) {
			if(k_executask instanceof execusrc && k_executask.watcher) {
				k_executask.watcher.close();
			}
		}
	}

	reload(s_event, s_file) {  // eslint-disable-line no-unused-vars
		// file was modified
		if('update' === s_event) {
			// shutdown this emkfile
			console.log(S_LINE_BREAK);

			// clear require cache
			for(let p_require in require.cache) {
				delete require.cache[p_require];
			}

			// print
			this.warn(`💫  reloading emk file...`);

			// unwatch
			this.unwatch();

			// done
			console.log(S_LINE_BREAK);

			// load new emkfile
			load(this.source, {
				...this.args,
				force: true,
			});
		}
		// file was deleted
		else if('remove' === s_event) {
			// unwatch
			this.unwatch();

			// print
			this.error(`🔥 ${s_file} file was deleted! continuing to watch dependency files...`);
		}
		else {
			throw new Error(`the node-watch module emitted and unexpected ${s_event} event`);
		}
	}
}


async function load(p_emkfile, g_args={}) {
	// read emkfile contents
	let s_emkfile;
	try {
		s_emkfile = fs.readFileSync(p_emkfile, 'utf8');
	}
	catch(e_read) {
		log.fail(p_emkfile, 'no such file');
	}

	// prep emk instance
	let k_emkfile;

	// grab exports from emkfile
	let {
		exports: g_emkfile,
		required: a_deps,
	} = evaluate(s_emkfile, p_emkfile, g_args.cwd, g_args.timeout);

	// create emk instance
	k_emkfile = new emkfile(g_emkfile, g_args, p_emkfile, a_deps);

	// run calls
	await k_emkfile.run(g_args.calls, {
		force: g_args.force,
		watch: g_args.watch,
	});
}


if(module === require.main) {
	let a_args_values_emk = ['-u', '--use', '-t', '--timeout'];

	// separate emk args from target args
	let a_argv = process.argv;
	let a_argv_emk = a_argv;
	let a_argv_calls = [];

	// each arg
	for(let i_arg=2, nl_args=a_argv.length; i_arg<nl_args; i_arg++) {
		let s_arg = a_argv[i_arg];

		// option
		if(s_arg.startsWith('-')) {
			// expect a value; skip next arg
			if(a_args_values_emk.includes(s_arg)) {
				i_arg += 1;
				continue;
			}
		}
		// target; split here
		else {
			a_argv_emk = a_argv.slice(0, i_arg);
			a_argv_calls = a_argv.slice(i_arg);
			break;
		}
	}

	/* eslint-disable indent */
	let g_args = yargs
		.usage('Usage: $0 [EMK_OPTIONS] [TARGET(S)...]')
		.example('$0 -w', 'run the default `all` task indefinitely by watching dependencies for changes')
		.example('$0 --dry-run \'build/*\' \'-g={env:"prod"}\'', 'do a dry run on the output tasks matching the target `build/*` and pass in the config object `{env:\'prod\'} to the task')
		.boolean('n')
			.alias('n', 'dry-run')
			.describe('n', 'show the targets and commands without executing them')
		.boolean('f')
			.alias('f', 'force')
			.describe('f', 'force run all tasks (ignore modified time)')
		.boolean('s')
			.alias('s', 'silent')
			.describe('s', 'do not echo commands')
		.boolean('w')
			.alias('w', 'watch')
			.describe('w', 'watch dependency files and re-emk targets')
		.string('u')
			.nargs('u', 1)
			.alias('u', 'use')
			.describe('u', 'use specified emk file')
		.number('t')
			.nargs('t', 1)
			.alias('t', 'timeout')
			.describe('t', `specify how long to wait for an emkfile to export in ms`)
			.default('t', T_EVAL_TIMEOUT)
		.string('g')
			.alias('g', 'config')
			.describe('g', 'pass a js config object to the specific task')
			.group('g', 'TARGET Options:')
		.alias('h', 'help')
		.alias('v', 'version')
		.help()
		.parse(a_argv_emk);
	/* eslint-enable */

	// commands
	let a_args_values_calls = ['-g', '--config'];
	let a_calls = [];

	// append end-of-list item
	a_argv_calls.push('');

	// each target arg
	let i_arg_start = 0;
	for(let i_arg=1, nl_args=a_argv_calls.length; i_arg<nl_args; i_arg++) {
		let s_arg = a_argv_calls[i_arg];

		// option
		if(s_arg.startsWith('-')) {
			// expects a value; skip next arg
			if(a_args_values_calls.includes(s_arg)) {
				i_arg += 1;
				continue;
			}
		}
		// call; split here
		else {
			// parse subset
			let g_command = yargs_parser.detailed(a_argv_calls.slice(i_arg_start, i_arg), {
				string: ['g'],
				alias: {
					config: 'g',
				},
				coerce: {
					g: s_config => evaluate(`return ${s_config};`, 'command line option', process.cwd(), 1000).returned,
				},
			});

			// error occurred
			if(g_command.error) throw g_command.error;

			// add normalized command struct to list
			a_calls.push({
				call: g_command.argv._[0],
				args: g_command.argv.config,
			});

			// for next command
			i_arg_start = i_arg;
		}
	}

	// extend args with commands
	g_args.calls = a_calls;

	// cwd
	g_args.cwd = process.cwd();

	// emk filename
	let s_emk_file = g_args.use || 'emk.js';

	// path to emk file
	let p_emkfile = path.join(process.cwd(), s_emk_file);

	// load emk file
	(async() => {
		try {
			await load(p_emkfile, g_args);
		}
		catch(e_mk) {
			console.error(`\n\nFatal error: ${e_mk.message}`.red+e_mk.stack);
			process.exit(1);
		}
	})();
}

