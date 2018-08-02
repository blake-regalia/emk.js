const braces = require('braces');

const F_TEXT_TO_REGEX = s => s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
const F_GLOB_TO_REGEX = (s, s_wildcard_quantifier='+') => s
	.replace(/[-/\\^$+?.()|[\]{}]/g, '\\$&')
	.replace(/[*]/g, `([^/]${s_wildcard_quantifier})`);


class pattern_fragment {
	static from_struct(k_emk, g_fragment) {
		return h_eval[g_fragment.type](k_emk, g_fragment);
	}

	constructor(g_this) {
		Object.assign(this, g_this);
	}

	bind(s_binding) {
		return new this.constructor({
			...this,
			binding: s_binding,
		});
	}

	// textual() {
	// 	let g_eval = this.eval;

	// 	return !!(g_eval.text || g_eval.list);
	// }

	// test(s_target) {
	// 	let g_eval = this.eval;

	// 	// text
	// 	if(g_eval.text) return s_target === g_eval.text;

	// 	// list
	// 	if(g_eval.list) return g_eval.list.some(s => s === g_eval.text);

	// 	// pattern
	// 	return g_eval.pattern.test(s_target);
	// }

	// match(r_pattern) {
	// 	let g_eval = this.eval;

	// 	// text
	// 	if(g_eval.text) return r_pattern.test(g_eval.text)? [g_eval.text]: [];

	// 	// list
	// 	if(g_eval.list) return g_eval.list.filter(s => r_pattern.test(s));

	// 	// pattern
	// 	throw new Error(`encountered pattern on pattern match`);
	// }

}


class pattern_fragment_text extends pattern_fragment {
	static from_text(k_emk, s_text) {
		return new pattern_fragment_text({
			emk: k_emk,
			text: s_text,
			// regex: s_text.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'),
			group_count: 0,
		});
	}

	to_regex() {
		return F_TEXT_TO_REGEX(this.text);
	}

	test_text(s_test) {
		return s_test === this.text;
	}

	test_pattern(r_pattern) {
		return r_pattern.test(this.text);
	}
}

class pattern_fragment_enum extends pattern_fragment {
	static from_list(k_emk, a_enum) {
		// // convert to regex
		// let s_pattern = a_enum.map(F_TEXT_TO_REGEX).join('|');

		// {
		// 	type: 'enumeration',
		// 	value: z_value,
		// 	eval: {
		// 		list: z_value,
		// 		regex: `(${s_pattern})`,
		// 		length: (new RegExp(s_pattern+'|')).exec('').length,
		// 		binding: s_key,
		// 	},
		// };

		return new pattern_fragment_enum({
			emk: k_emk,
			enum: a_enum,
		});
	}

	to_regex() {
		return `(${this.enum.map(s => F_TEXT_TO_REGEX(s)).join('|')})`;
	}

	test_text(s_test) {
		return this.enum.some(s => s_test === s);
	}

	match_pattern(r_pattern) {
		for(let s_item of this.enum) {
			if(r_pattern.test(s_item)) {
				return s_item;
			}
		}

		return null;
	}

}

class match extends Array {
	constructor(z_base) {
		super();
		this.push(z_base);
	}

	matches() {
		return [...this];
	}

	toString() {
		return this[0];
	}
}

// given string prototype methods
for(let s_method in String.prototype) {
	if(!Array.prototype[s_method]) {
		match.prototype[s_method] = function(...a_args) {
			return String.prototype[s_method].apply(this.toString(), a_args);
		};
	}
	// already in array
	else {
		match.prototype[s_method] = function(...a_args) {
			throw new Error(`attempting to call '.${s_method}(${a_args.join(', ')})' on match object, which could be for either String or Array. to call on String, first cast the object to a string (e.g., +''). to call on Array of matches, cast to array by calling member '.matches()'`);
		};
	}
}

class pattern_fragment_regex extends pattern_fragment {
	static from_regex_str(k_emk, s_regex, s_name='_', n_groups=null) {
		return new pattern_fragment_regex({
			emk: k_emk,
			regex: new RegExp(`^(${s_regex})$`),
			group_count: null === n_groups? (new RegExp(s_regex+'|')).exec('').length: n_groups,
			binding: s_name || '_',
		});
	}

	static from_glob_str(k_emk, s_glob, s_name, n_groups=null) {

		// // create def struct
		// h_defs[s_key] = {
		// 	type: 'glob',
		// 	value: z_value,
		// 	eval: fragment_types.glob({value:z_value}, this),
		// };

		let s_regex = F_GLOB_TO_REGEX(s_glob, '*');

		return new pattern_fragment_regex({
			emk: k_emk,
			regex: new RegExp(`^(${s_regex})$`),
			group_count: null === n_groups? (new RegExp(s_regex+'|')).exec('').length: n_groups,
			binding: s_name || '_',
		});
	}

	to_regex() {
		return this.regex;
	}

	test_text(s_test) {
		return this.regex.test(s_test);
	}

	match_text(s_text) {
		// exec regex
		let m_match = this.regex.exec(s_text);

		// no match
		if(!m_match) return null;

		// prep matches
		let h_matches = {};

		// create groups
		let a_groups = [this.binding];
		for(let i_add=0, s_var=this.binding; i_add<this.group_count; i_add++) {
			a_groups.push(s_var);
		}

		// align groups
		for(let i_group=0, nl_match=m_match.length; i_group<nl_match-2; i_group++) {
			let s_var = a_groups[i_group];

			if(!(s_var in h_matches)) h_matches[s_var] = new match(m_match[i_group+2]);
			else h_matches[s_var].push(m_match[i_group+2]);
		}

		// hash of matches
		return h_matches;
	}
}

const permutate = (a_frags, s_current='', a_combos=[]) => {
	if(!a_frags.length) a_combos.push(s_current);

	let k_frag = a_frags[0];
	let a_subfrags = a_frags.slice(1);

	if(k_frag instanceof pattern_fragment_text) {
		permutate(a_subfrags, s_current+k_frag.text, a_combos);
	}
	else if(k_frag instanceof pattern_fragment_enum) {
		for(let s_text of k_frag.enum) {
			permutate(a_subfrags, s_current+s_text, a_combos);
		}
	}

	return a_combos;
};

let h_eval = {
	text: (k_emk, g) => pattern_fragment_text.from_text(k_emk, g.value),

	glob: (k_emk, g) => {
		let s_regex = braces(`/${g.value}/`);

		// globbing
		if(s_regex.includes('*')) {
			return pattern_fragment_regex.from_regex_str(k_emk, s_regex.slice(1, -1), g.name);
		}
		// no globbing! use expansion
		else {
			return pattern_fragment_enum.from_list(k_emk, braces.expand(`/${g.value}/`));
		}

		// convert glob string to regular expression
		// g.value.replace(/\{([^,}]*)(,?)\}/g, '($1');
		// g.value.replace(/\{/g, '(');
	},

	pattern: (k_emk, g_pattern) => {
		// merge adjacent text
		let g_prev = null;
		let a_values = [];
		for(let g_sub of g_pattern.value) {
			if(g_prev && 'text' === g_prev.type && 'text' === g_sub.type) {
				g_prev.value += g_sub.value;
			}
			else {
				g_prev = g_sub;
				a_values.push(g_sub);
			}
		}

		// map to fragments
		let a_frags = a_values.map(g => pattern_fragment.from_struct(k_emk, g));

		// single item
		if(1 === a_frags.length) return a_frags[0];

		// no patterns; make all permutations
		if(a_frags.every(k => !(k instanceof pattern_fragment_regex))) {
			// TODO: match subgroups
			return pattern_fragment_enum.from_list(k_emk, permutate(a_frags));
		}
		// make pattern
		else {
			return pattern_fragment_regex.from_regex_str(k_emk, a_frags.map(k => k.to_regex()).join(''));
		}
	},

	regex: (k_emk, g) => pattern_fragment_regex.from_regex_str(k_emk, g.value),

	reference: (k_emk, g) => k_emk.defs[g.value],

	label: (k_emk, g) => {
		// reference
		if(g.value in k_emk.defs) {
			return k_emk.defs[g.value].bind(g.value);
		}
		// word capture
		else {
			return pattern_fragment_regex.from_regex_str(k_emk, `([^/]*?)`, g.value, 1);
		}
	},

		// if(g.assignment) {
		// 	let g_assignment = g_label.assignment;
		// 	let a_assign = h_eval[g_assignment.type](g_assignment, k_mk);
		// 	a_assign[2] = g_label.value;
		// 	return a_assign;
		// }

	capture_glob: (k_emk, g) => {
		let g_value = g.value;
		let s_value = h_eval[g_value.type](k_emk, g_value);

		return pattern_fragment_regex.from_regex_str(k_emk, s_value, g.name);
	},

	capture_regex: (k_emk, g) => {
		let g_value = g.value;
		let a_value = h_eval[g_value.type](k_emk, g_value);

		return pattern_fragment_regex.from_regex_str(k_emk, a_value[0], g.name, a_value[1]);
	},

	// capture: (g_capture, k_mk) => {
	// 	let g_contents = g_capture.value;

	// 	// simple pattern
	// 	if('pattern' === g_contents.type) {
	// 		let g_pattern = g_contents.value;
	// 		return h_eval[g_pattern.type](g_pattern, k_mk);
	// 	}
	// 	// labelled pattern use
	// 	else if('label' === g_contents.type) {
	// 		let g_assignment = g_contents.assignment;
	// 		return [...h_eval[g_assignment.type](g_assignment, k_mk).slice(0, -1), g_contents.label];
	// 	}
	// 	// unrecognized type
	// 	else {
	// 		throw new Error(`unexpected token type: ${g_contents.type}`);
	// 	}
	// },
};

module.exports = {
	evals: h_eval,

	// execute on target string
	compile: g_fragment => ({
		bind: k_emk => pattern_fragment.from_struct(k_emk, g_fragment),
	}),

	pattern_fragment,
	pattern_fragment_text,
	pattern_fragment_enum,
	pattern_fragment_regex,
};
