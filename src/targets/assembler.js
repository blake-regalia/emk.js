
let h_eval = {
	text: g => [g.value.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'), 0],

	label: (g_label) => {
		if(g_label.assignment) {
			let g_assignment = g_label.assignment;
			let a_assign = h_eval[g_assignment.type](g_assignment, k_mk);
			a_assign[2] = g_label.value;
			return a_assign;
		}
		else {
			return [`([^/]*?)`, 1, g_label.value];
		}
	},

	regex: g => [`(${g.value})`, (new RegExp(g.value+'|')).exec('').length, '_'],

	pattern_ref: (g_ref, k_mk) => {
		let s_ref = g_ref.value;
		let s_pattern = k_mk.patterns[s_ref];

		return [`(${s_pattern})`, new RegExp(s_pattern+'|').exec('').length, s_ref];
	},

	glob: (g_ref, k_mk) => {
		debugger;
		throw new Error(`err: globs not yet implemented`);
	},

	capture: (g_capture, k_mk) => {
		let g_contents = g_capture.value;

		// simple pattern
		if('pattern' === g_contents.type) {
			let g_pattern = g_contents.value;
			return h_eval[g_pattern.type](g_pattern, k_mk);
		}
		// labelled pattern use
		else if('label' === g_contents.type) {
			let g_assignment = g_contents.assignment;
			return [...h_eval[g_assignment.type](g_assignment, k_mk).slice(0, -1), g_contents.label];
		}
		// unrecognized type
		else {
			throw new Error(`unexpected token type: ${g_contents.type}`);
		}
	},
};

module.exports = (a_components) => {
	// execute on target string
	return function(s_target, k_mk) {
		// accumulator regex
		let s_pattern = '';

		// capture groups
		let a_groups = [];

		// each component
		for(let g_component of a_components) {
			let a_part = h_eval[g_component.type](g_component, k_mk);
			s_pattern += a_part[0];

			// add groups
			for(let i_add=0, s_var=a_part[2]; i_add<a_part[1]; i_add++) {
				a_groups.push(s_var);
			}
		}

		// compile
		let r_pattern = new RegExp('^('+s_pattern+')$');

		// exec regex
		let m_match = r_pattern.exec(s_target);

		// no match
		if(!m_match) return m_match;

		// prep matches
		let h_matches = {};

		// align groups
		for(let i_group=0, nl_match=m_match.length; i_group<nl_match-2; i_group++) {
			let s_var = a_groups[i_group];

			if(!(s_var in h_matches)) h_matches[s_var] = [m_match[i_group+2]];
			else h_matches[s_var].push(m_match[i_group+2]);
		}

		// return named match groups
		return h_matches;
	};
};
