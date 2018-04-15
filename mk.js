
const pd_build = 'build';
const pdg_component = `${pd_build}/:component`;

let s_dep_self_dir = '$(dirname "$@")';

module.exports = {
	all: 'targets',


	targets: [
		'assembler',
		'ast',
		'parser',
	].map(s => `${pd_build}/targets/${s}.js`),


	[`${pdg_component}`]: {
		run: /* syntax: bash */ `
			# make build dir
			echo "$ mkdir -p $@"

			# copy package.json to build dir
			echo "$ cp package.json > $@/package.json"
		`,
	},


	[`${pdg_component}/parser.js`]: {
		case: true,
		deps: [
			...['*.jison', '*.jisonlex']
				.map(s => `src/$component/${s}`),
			s_dep_self_dir,
		],
		run: /* syntax: bash */ `
			# compile grammar and lex; output to component's build dir
			jison $1 $2 -o $@
		`,
	},


	[`${pdg_component}/:code.js`]: {
		case: true,
		deps: [
			'src/$component/$code.js',
			s_dep_self_dir,
		],
		run: /* syntax: bash */ `
			# copy src file to component's build dir
			cp $1 $@
		`,
	},
};
