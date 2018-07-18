
module.exports = class graph {
	static invert(h_edges) {
		let h_invs = {};

		for(let si_node in h_edges) {
			for(let si_dep of h_edges[si_node]) {
				let as_sups = h_invs[si_dep];
				if(!as_sups) as_sups = h_invs[si_dep] = new Set();

				as_sups.add(si_node);
			}

			if(!h_invs[si_node]) h_invs[si_node] = new Set();
		}

		return h_invs;
	}

	constructor() {
		Object.assign(this, {
			nodes: {},
			outs: {},
			invs: null,
		});
	}

	schedule({cycle:fe_cyclic}) {
		let h_outs = this.outs;

		// make inverted graph direction
		let h_invs = this.invs = this.invs || graph.invert(h_outs);

		// check for DAG
		this.sort(this.outs, fe_cyclic);

		// transitive reduction
		this.reduce(h_outs);

		// prep rank hash
		let h_ranks = {};

		// each leaf node
		for(let si_node in h_outs) {
			if(!h_outs[si_node].size) {
				// rank all super nodes
				this.rank(h_invs, si_node, h_ranks);
			}
		}

		// convert to array
		let a_ranks = [];
		for(let [si_node, i_rank] of Object.entries(h_ranks)) {
			(a_ranks[i_rank] = a_ranks[i_rank] || []).push(si_node);
		}

		return a_ranks;
	}

	rank(h_edges, si_node, h_ranks, i_rank=0) {
		// longest path
		h_ranks[si_node] = Math.max(i_rank, h_ranks[si_node] || 0);

		// each super dependency
		for(let si_sup of h_edges[si_node]) {
			this.rank(h_edges, si_sup, h_ranks, i_rank+1);
		}
	}

	reduce(h_edges) {
		// each node
		for(let si_node in h_edges) {
			// prep a hash for marking completion
			let h_done = {};

			// each dependency; reduce it's span of decendents
			for(let si_dep of h_edges[si_node]) {
				this.reduce_pair(h_edges, si_node, si_dep, h_done);
			}
		}
	}

	reduce_pair(h_edges, si_node, si_dep, h_done) {
		// already checked this node
		if(si_node in h_done) return;

		// each sub dependency
		for(let si_subdep of h_edges[si_dep]) {
			// remove transitive edge if one exists
			h_edges[si_node].delete(si_subdep);

			// recurse
			this.reduce_pair(h_edges, si_node, si_subdep, h_done);
		}

		// flag as done
		h_done[si_node] = 1;
	}

	// check_dag(fe_cyclic) {
	// 	let {
	// 		outs: h_outs,
	// 		invs: h_invs,
	// 	} = this;

	// 	// prep marks hash
	// 	let h_marks = {};
	// 	for(let s_key in h_outs) h_marks[s_key] = 0;

	// 	// each root node
	// 	for(let si_node in h_outs) {
	// 		if(!h_invs[si_node].size) {
	// 			this.visit(h_outs, si_node, h_marks, fe_cyclic);
	// 		}
	// 	}
	// }

	sort(h_edges, fe_cyclic) {
		let a_sorted = [];

		// prep marks hash
		let h_marks = {};
		for(let s_key in h_edges) h_marks[s_key] = 0;

		// each unmarked node
		for(let si_node in h_edges) {
			if(!h_marks[si_node]) {
				// visit
				this.visit(h_edges, si_node, h_marks, fe_cyclic, a_sorted);
			}
		}

		return a_sorted;
	}

	visit(h_edges, si_node, h_marks, fe_cyclic, a_sorted=[]) {
		// test mark
		let xc_mark = h_marks[si_node];

		// permanent, ok
		if(2 === xc_mark) return;

		// cycle detected
		if(1 === xc_mark) return fe_cyclic(si_node);

		// mark temporarily
		h_marks[si_node] = 1;

		// each dependency
		for(let si_dep of h_edges[si_node]) {
			this.visit(h_edges, si_dep, h_marks, fe_cyclic, a_sorted);
		}

		// mark permanently
		h_marks[si_node] = 2;

		// add to head of list
		a_sorted.unshift(si_node);
	}

};
