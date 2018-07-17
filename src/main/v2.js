#!/usr/bin/env node

const fs = require('fs');
const cp = require('child_process');
const path = require('path');
const util = require('util');
const vm = require('vm');

const glob = require('bash-glob');
const chalk = require('chalk');
const yargs = require('yargs');
const yargs_parser = require('yargs-parser');

const graph = require('./graph.js');

const fragment_parser = require('./fragment/parser.js');
const {
	fragment_types,
	pattern_fragment,
	pattern_fragment_text,
	pattern_fragment_enum,
	pattern_fragment_regex,
} = require('./fragment/assembler.js');

const pattern_fragment_from_string = (s_key, k_emkfile) => fragment_parser.parse(s_key).bind(k_emkfile);

const log = {
	log(s_tag, s_text) {
		console.log(`|${chalk.white(`[${s_tag}]`)} ${s_text}`);
	},
	good(s_tag, s_text) {
		console.log(`|${chalk.green(`[${s_tag}]`)} ${s_text}`);
	},
	notice(s_tag, s_text) {
		console.log(`|${chalk.blue(`[${s_tag}]`)} ${s_text}`);
	},
	info(s_tag, s_text) {
		console.log(`|${chalk.cyan(`[${s_tag}]`)} ${s_text}`);
	},
	quote(s_tag, s_text) {
		console.log(`|${chalk.magenta(`[${s_tag}]`)} ${s_text}`);
	},
	warn(s_tag, s_text) {
		console.warn(`~${chalk.yellow(`[${s_tag}]`)} ${s_text}`);
	},
	error(s_tag, s_text) {
		console.error(`*${chalk.red(`[${s_tag}]`)} ${s_text}`);
	},
	fail(s_tag, s_text, s_quote='', xc_exit=1) {
		console.error(`${chalk.redBright.bgBlackBright(` ${s_tag} `)} > ${chalk.red(s_text)}`
				+(s_quote
					? chalk.red(`\n${s_quote.split('\n').map(s => `    > ${s}`).join('\n')}`)
					: ''));
		process.exit(xc_exit || 1);
	},
};


const F_TEXT_TO_REGEX = s => s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
const F_GLOB_TO_REGEX = (s, s_wildcard_quantifier='+') => s
	.replace(/[-/\\^$+?.()|[\]{}]/g, '\\$&')
	.replace(/[*]/g, `([^/]${s_wildcard_quantifier})`);
const T_EVAL_TIMEOUT = 5000;  // allow up to 5 seconds for script to load

const evaluate = (s_script, p_file, pd_dir, t_timeout=T_EVAL_TIMEOUT, b_module=false) => {
	let h_module = {exports:{}};
	let h_nodejs_env = {
		__dirname: pd_dir,
		__filename: p_file,
		exports: h_module.exports,
		module: h_module,
		require: require,
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
	let w_eval = y_script.runInNewContext(h_context, {
		filename: p_file,
		timeout: t_timeout,
	});

	return b_module? h_context.__EMK.module.exports: w_eval;
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



const parse_target = (s_target, s_split) => {
	// split regex
	let r_split = new RegExp('\\'+s_split, 'g');

	// divide target path into fragments
	let a_fragments = s_target.split(r_split);

	// no wildcards; return text fragments
	if(!s_target.includes('*')) {
		return a_fragments.map(s => ({text:s}));
	}

	// path components
	let a_path = [];

	// each fragment
	for(let s_frag of a_fragments) {
		// some file
		if('*' === s_frag) {
			a_path.push({
				pattern: new RegExp(`^${F_GLOB_TO_REGEX(s_frag, '*')}$`),
				wild: true,
			});
		}
		// all targets recursively
		else if('**' === s_frag) {
			a_path.push({
				pattern: new RegExp(`^${F_GLOB_TO_REGEX('*', '*')}$`),
				wild: true,
				recurse: true,
			});
		}
		// globstar pattern
		else if(s_frag.includes('*')) {
			a_path.push({
				pattern: new RegExp(`^${F_GLOB_TO_REGEX(s_frag, '+')}$`),
			});
		}
		// exact text
		else {
			a_path.push({
				text: s_frag,
			});
		}
	}

	return a_path;
};


class provenance extends Array {
	last() {
		return this[this.length-1].value;
	}

	toString() {
		return `{${this.map(g => `[${g.value}]`).join(',')}}`;
	}
}

class subtree {
	constructor(k_emkfile, h_input, s_split, fk_child=null, a_prov=[]) {
		let h_tree = {};

		// build subtrees recursively
		for(let s_key in h_input) {
			let z_child = h_input[s_key];

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
						matches: k_frag.binding? {[k_frag.binding]: s_text}: {},
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
				for(let s_frag of k_frag.enum) {
					// struct
					yield {
						key: s_key,
						frag: s_frag,
						matches: k_frag.binding? {[k_frag.binding]:s_frag}: {},
					};
				}
			}
			// regex pattern
			else if(k_frag instanceof pattern_fragment_regex) {
				// issue warning
				log.warn(this.emkfile, `cannot use wildcard target '*' against path pattern at '${this.prov.join(this.split)}'`);
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

class executask {
	constructor(g_this) {
		Object.assign(this, g_this, {
			mark: 0,
		});
	}

	identical(k_other) {
		let as_deps_other = new Set(k_other.deps);
		let as_deps_this = new Set(this.deps);

		return k_other.run === this.run
			&& as_deps_other.size === as_deps_this.size
			&& k_other.deps.every(s => as_deps_this.has(s));
	}
}

class task_creator {
	constructor(a_prov, z_value) {
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
		});
	}

	run(h_args) {
		let {
			deps: a_deps=[],
			run: s_run=null,
		} = this.create(h_args);

		// dependencies

	}

	prepare(s_path, h_args) {
		let {
			deps: a_deps=[],
			run: s_run=null,
		} = this.create(h_args);

		return new executask({
			id: `*task\0${a_deps.join('|')}\0${s_run}`,
			path: s_path,
			deps: a_deps,
			run: s_run,
		});
	}
}

class output_creator {
	constructor(a_prov, f_create) {
		Object.assign(this, {
			prov: a_prov,
			create: f_create,
		});
	}

	match(s_target) {
		let {
			map: h_map,
			patterns: h_patterns,
		} = this;
debugger;
		// list of matches
		let a_matches = [];

		// each pattern in map
		for(let s_pattern in h_map) {
			// already parsed
			if(s_pattern in h_patterns) {
				let g_pattern = h_patterns[s_pattern];

				// does not match against target; continue onto next
				if(!g_pattern.test(s_target)) continue;

				// store match
				a_matches.push(g_pattern);
			}
			// not yet parsed; save parsed pattern
			else {
				h_patterns[s_pattern] = component.parse(s_pattern);
			}
		}
	}

	prepare(a_path, h_args) {
		let {
			deps: a_deps=[],
			run: s_run=null,
			copy: s_src=null,
		} = this.create(h_args);

		// normalize deps
		if('string' === typeof a_deps) a_deps = [a_deps];

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
			`;
		}

		return new executask({
			id: a_path.join('/'),
			path: a_path.join('/'),
			deps: a_deps,
			run: s_run,
		});
	}
}

class dep_graph_node {
	constructor() {

	}
}

class execusrc extends executask {
	constructor(s_file, p_cwd, dk_stats, s_path) {
		super({
			id: s_file,
			path: s_path,
			deps: [],
			run: null,
			file: s_file,
			cwd: p_cwd,
			stats: dk_stats,
		});
	}
}

class emkfile {
	constructor(g_emkfile={defs:{}, tasks:{}, outputs:{}}, g_args, p_emkfile) {
		// normalize defs
		let h_defs = {};
		for(let [s_key, z_value] of Object.entries(g_emkfile.defs)) {
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
			source: p_emkfile,

			args: g_args,

			defs: h_defs,
		});

		// process subtrees
		Object.assign(this, {
			tasks: new subtree(this, g_emkfile.tasks, '.', (z_leaf, a_prov) => {
				let si_task = a_prov.join('.');

				// task id contains slashes
				if(si_task.includes('/')) {
					log.warn(p_emkfile, `one of your task names contains a slash \`/\` character: '${si_task}'.\n\tthis may cause an unwanted collision with an output target`);
				}

				// normalize leaf
				return new task_creator(a_prov, z_leaf);
			}),

			outputs: new subtree(this, g_emkfile.outputs, '/', (z_leaf, a_prov) => {
				let si_output = a_prov.join('/');

				// check child type
				if('function' !== typeof z_leaf) {
					log.fail(si_output, `expected value to be subtree or function; instead encountered: '${z_leaf}'`);
				}

				// normalize leaf
				return new output_creator(a_prov, z_leaf);
			}),
		});
	}

	// warn
	warn(s_text) {
		log.warn(path.relative(this.args.cwd || process.cwd(), this.source), s_text);
	}

	// critical failure
	fail(s_text) {
		log.fail(path.relative(this.args.cwd || process.cwd(), this.source), s_text);
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
				this.warn(`target '${a_path.join(s_split)}' leads to a non-leaf node. if you meant to run all sub-tasks, append a '${s_split}*' to the end, or use a recursive wildcard '**'`);
				return [];
			}

			// cast to instance
			let k_node = z_node;

			// ref target fragment at head of path
			let k_target_frag = a_target[0];

			// create subtarget
			let a_subtarget = a_target.slice(1);

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
				// nothing matched
				else {
					return [];
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
				throw new Error(`unknown target qualifiers: ${a_target[0]}`);
			}
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

				let as_dep_ids = new Set();

				// plot deps
				for(let s_dep_call of k_executask.deps) {
					as_dep_ids = new Set([
						...as_dep_ids,
						...this.plot({
							call: s_dep_call,
							args: h_args,
						}, k_graph, k_executask.path),
					]);
				}

				// save to graph
				k_graph.outs[si_task] = as_dep_ids;
			}
			// node already exists
			else {
				let k_other = k_graph.nodes[si_task];

				// they are not identical
				if(!k_executask.identical(k_other)) {
					log.fail(k_executask.path, `multiple tasks are trying to build the same output file yet are indicating different dependencies or run commands`, util.inspect({
						'a)': {
							deps: k_executask.deps,
							run: k_executask.run,
						},
						'b)': {
							deps: k_other.deps,
							run: k_other.run,
						},
					}));
				}
			}
		}

		return Array.from(as_ids);
	}

	plot(g_call, k_graph, s_path) {
		let {
			call: s_call,
			args: h_args_pre,
		} = g_call;

		// separate target and config
		let [, s_target, s_config] = /^([^\s]+)(?:\s+(.*))?$/.exec(s_call);

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
			let a_srcs = [];

			// each file
			for(let s_file of a_files) {
				// test for exists
				let dk_stats = fs.statSync(path.join(this.args.cwd, s_file));

				// add file dependency
				a_srcs.push(this.add([
					new execusrc(s_file, this.args.cwd, dk_stats, s_target),
				], h_args, k_graph));
			}

			return a_srcs;
		}
	}

	run(a_calls) {
		let k_graph = new graph();

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

		// print
		let c_stages = 0;
		for(let a_tasks of a_rounds) {
			log.info(`stage ${c_stages++}:`, a_tasks.map(si_task => `[${k_graph.nodes[si_task].id}]`).join('\t'));
		}

		debugger;
	}

}


async function load(p_emkfile, g_args={}) {
	// read emkfile contents
	let s_emkfile = fs.readFileSync(p_emkfile, 'utf8');

	// grab exports from emkfile
	let g_emkfile = evaluate(s_emkfile, p_emkfile, g_args.cwd, g_args.timeout, true);

	// create emk instance
	let k_emkfile = new emkfile(g_emkfile, g_args, p_emkfile);

	// run calls
	await k_emkfile.run(g_args.calls);
}


if(module === require.main) {
	let a_args_values_emk = ['-f', '--file', '-t', '--timeout'];

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
		.boolean('s')
			.alias('s', 'silent')
			.describe('s', 'do not echo commands')
		.boolean('w')
			.alias('w', 'watch')
			.describe('w', 'watch dependency files and re-emk targets')
		.string('f')
			.nargs('f', 1)
			.alias('f', 'file')
			.describe('f', 'use specified emk file')
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
					g: s_config => evaluate(`return ${s_config};`, 'command line option', process.cwd(), 1000),
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
	let s_emk_file = g_args.file || 'emk.js';

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

