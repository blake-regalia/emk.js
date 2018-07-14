#!/usr/bin/env node

const fs = require('fs');
const cp = require('child_process');
const path = require('path');
const vm = require('vm');

const chalk = require('chalk');
const yargs = require('yargs');
const yargs_parser = require('yargs-parser');

const component = require('./component/parser.js');
const assembler = require('./component/assembler.js');

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
};


const F_TEXT_TO_REGEX = s => s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
const F_GLOB_TO_REGEX = (s, s_wildcard_quantifier='+') => s
	.replace(/[-/\\^$+?.()|[\]{}]/g, '\\$&')
	.replace(/[*]/g, `([^/]${s_wildcard_quantifier})`);
const T_EVAL_TIMEOUT = 5000;  // allow up to 5 seconds for script to load

const evaluate = (s_script, p_file, pd_dir, t_timeout=T_EVAL_TIMEOUT) => {
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
	return y_script.runInNewContext(h_context, {
		filename: p_file,
		timeout: t_timeout,
	});
};


const parse_target = (s_target, s_split) => {
	// split regex
	let r_split = new RegExp('\\'+s_split, 'g');

	// divide target path into fragments
	let a_fragments = s_target.split(r_split);

	// path components
	let a_path = [];

	// each fragment
	for(let s_frag of a_fragments) {
		// some file
		if('*' === s_frag) {
			a_path.push({
				pattern: new RegExp(`^${F_GLOB_TO_REGEX(s_frag, '*')}$`),
			});
		}
		// wildcard pattern
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


class error_emkfile extends Error {
	constructor(s_msg) {
		super(s_msg);
	}
}

class provenance extends Array {
	last() {
		return this[this.length-1].value;
	}

	toString() {
		return `{${this.map(g => `[${g.value}]`).join(',')}}`;
	}
}

class subtree {
	constructor(h_input, fk_child=null, a_path=[]) {
		let h_tree = {};

		// build subtrees recursively
		for(let s_key in h_input) {
			let z_child = h_input[s_key];

			// subtree
			if('object' === typeof z_child && Object === z_child) {
				h_tree[s_key] = new subtree(z_child, fk_child, [...a_path, s_key]);
			}
			// leaf node
			else {
				// do child callback
				if(fk_child) z_child = fk_child(z_child, a_path);

				// store to tree
				h_tree[s_key] = z_child;
			}
		}

		Object.assign(this, {
			tree: h_tree,
			path: a_path,
		});
	}

	at(s_key) {
		return this.tree[s_key];
	}

	has(s_key) {
		return s_key in this.tree;
	}

	* match(r_pattern) {
		let h_tree = this.tree;
		for(let s_key in h_tree) {
			if(r_pattern.test(s_key)) {
				yield s_key;
			}
		}
	}
}

class task {
	constructor(z_value) {
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

	prepare(s_target, h_args) {
		let {
			deps: a_deps=[],
			run: s_run=null,
		} = this.create(h_args);

		return {
			invocation: `#${s_target}\0${JSON.stringify(h_args)}\0${s_run}`,
			deps: a_deps,
			run() {

			},
		};
	}
}

class output {
	constructor(h_map) {
		Object.assign(this, {
			map: h_map,
			patterns: {},
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
}

class emkfile {
	constructor(g_emkfile={defs:{}, tasks:{}, outputs:{}}, g_args, p_emkfile) {
		// normalize defs
		let h_defs = {};
		for(let [s_key, z_value] of Object.entries(g_emkfile.defs)) {
			// enumeration
			if(Array.isArray(z_value)) {
				let a_items = z_value;

				// convert to regex
				let s_pattern = a_items.map(F_TEXT_TO_REGEX).join('|');

				// create def struct
				h_defs[s_key] = {
					type: 'enumeration',
					value: z_value,
					pattern: [
						`(${s_pattern})`,
						(new RegExp(s_pattern+'|')).exec('').length,
						s_key,
					],
				};
			}
			// glob pattern
			else if('string' === typeof z_value) {
				// create def struct
				h_defs[s_key] = {
					type: 'glob',
					value: z_value,
					pattern: assembler.eval.glob({value:z_value}, this),
				};
			}
			// regular expression
			else if(z_value && 'object' === typeof z_value && z_value instanceof RegExp) {
				// create def struct
				h_defs[s_key] = {
					type: 'regex',
					value: z_value,
					pattern: assembler.eval.regex({value:z_value}, this),
				};
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

			tasks: new subtree(g_emkfile.tasks, (z_leaf, a_path) => {
				let p_task = a_path.join('.');

				// task id contains slashes
				if(p_task.includes('/')) {
					log.warn(p_emkfile, `one of your task names contains a slash \`/\` character: '${p_task}'.\n\tthis may cause an unwanted collision with an output target`);
				}

				// normalize leaf
				return new task(z_leaf);
			}),

			outputs: new subtree(g_emkfile.outputs, (z_leaf, a_path) => {
				// check child type
				if('function' !== typeof z_leaf) {
					this.fail(`expected value of key '${a_path.join('/')}' in output tree to be subtree or function; instead encountered: '${z_leaf}'`);
				}

				// normalize leaf
				return new output(z_leaf);
			}),
		});
	}

	// critical failure
	fail(s_text) {
		log.error(path.relative(process.cwd(), this.source), s_text);
		process.exit(1);
	}

	search(z_node, a_target, s_split, s_path='') {
		// node is a (sub)tree
		if(z_node instanceof subtree) {
			// append separator
			if(s_path) s_path += s_split;

			// reached end of target
			if(!a_target.length) {
				log.warn(this.source, `target '${s_path}' leads to a non-leaf node. if you meant to run all sub-tasks, append a '${s_split}*' to the end`);
				return [];
			}

			// cast to instance
			let k_node = z_node;

			// destructure target
			let {
				text: s_text=null,
				pattern: r_pattern=null,
			} = a_target[0];

			// exact text and key match in node; recurse
			if(s_text && k_node.has(s_text)) {
				return this.search(k_node.at(s_text), a_target.slice(1), s_split, s_path+s_text);
			}
			// pattern
			else if(r_pattern) {
				let a_hits = [];
				let a_subtarget = a_target.slice(1);

				// each key that matches pattern
				for(let s_key of k_node.match(r_pattern)) {
					a_hits.push(...this.search(k_node.at(s_key), a_subtarget, s_split, s_path+s_key));
				}

				return a_hits;
			}
			// something else
			else {
				throw new Error(`unknown target element: ${k_node}`);
			}
		}
		// node is a leaf, more to target
		else if(a_target.length) {
			log.warn(this.source, `cannot navigate to '${s_split}${a_target.join(s_split)}' since '${s_path}' reached a leaf node`);
			return [];
		}
		// end of target
		else {
			return [z_node];
		}
	}

	invoke(a_tasks, h_args, h_nodes, h_graph) {
		let as_invocations = new Set();

		// each matching task
		for(let g_task of a_tasks) {
			let {
				invocation: si_invocation,
				deps: a_deps,
				run: f_run,
			} = g_task.prepare(h_args);

			// add to set
			as_invocations.add(si_invocation);

			// first encounter of node
			if(!(si_invocation in h_nodes)) {
				let as_dep_invocations = new Set();

				// prepare deps
				for(let s_dep_call of a_deps) {
					as_dep_invocations = [
						...as_dep_invocations,
						...this.prepare({
							call: s_dep_call,
							args: h_args,
						}, h_nodes, h_graph),
					];
				}

				// save to nodes map
				h_nodes[si_invocation] = {
					deps: Array.from(as_dep_invocations),
					run: f_run,
				};
			}
		}

		return Array.from(as_invocations);
	}

	prepare(g_call, h_nodes, h_graph) {
		let {
			call: s_call,
			args: h_args_in,
		} = g_call;
debugger;
		// separate target and config
		let [, s_target, s_config] = /^([^\s]+)(?:\s+(.*))?$/.exec(s_call);

		// make args
		let h_args = {
			...h_args_in,
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

		// attempt to match against task
		{
			// turn target string into task descriptor
			let a_target = parse_target(s_target, '.');

			// search tasks
			let a_tasks = this.search(this.tasks, a_target, '.');

			// tasks matched
			if(a_tasks.length) {
				return this.invoke(a_tasks, h_args, h_nodes, h_graph);
			}
		}

		// attempt to match against output
		{
			// turn target string into task descriptor
			let a_target = parse_target(s_target, '/');

			// search outputs
			let a_outputs = this.search(this.outputs, a_target, '/');

			// outputs matched
			if(a_outputs.length) {
				return this.invoke(a_outputs, h_args, h_nodes, h_graph);
			}
		}

		// nothing matched
		this.fail(`target '${s_target}' did not match any task patterns`);
	}

	run(a_calls) {
		let h_nodes = {};
		let h_graph = {};

		let as_invocations = new Set();
		for(let g_call of a_calls) {
			as_invocations = [
				...as_invocations,
				...this.prepare(g_call, h_nodes, h_graph),
			];
		}

		debugger;
	}

}


async function load(p_emkfile, g_args={}) {
	// read emkfile contents
	let s_emkfile = fs.readFileSync(p_emkfile, 'utf8');

	// grab exports from emkfile
	let g_emkfile = evaluate(s_emkfile, p_emkfile, g_args.cwd, g_args.timeout);

	// create emk instance
	let k_emkfile = new emkfile(g_emkfile, g_args, p_emkfile);
debugger;

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

