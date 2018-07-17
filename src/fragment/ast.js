const assembler = require('./assembler.js');

module.exports = {
	type: (s_type, z_value) => ({type:s_type, value:z_value}),

	Fragment: g_fragment => assembler.compile(g_fragment),
};
