const assembler = require('./assembler.js');

module.exports = {
	type: (s_type, z_value) => ({type:s_type, value:z_value}),

	Targets: a_components => assembler(a_components),
};
