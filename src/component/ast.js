const assembler = require('./assembler.js');

module.exports = {
	type: (s_type, z_value) => ({type:s_type, value:z_value}),

	Component: g_component => assembler.compile(g_component),
};
