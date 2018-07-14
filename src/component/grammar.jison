
%{
	// copy abstract syntax tree constructors onto global scope object
	Object.assign(global, require('./ast.js'));
%}

%start component

/* enable EBNF grammar syntax */
%ebnf

%%
/* ------------------------ */
/* language grammar         */
/* ------------------------ */

component
	: text -> type('text', $text)
	| LABEL -> type('label', $LABEL.slice(1))
	| '(' glob ')' -> type('capture_glob', $glob)
	| '[' regex ']' -> type('capture_regex', $regex)
	;

text
	: TEXT text -> $TEXT+''
	| -> ''
	;

glob
	: NAME glob_assign -> {...$glob_assign, name:$NAME}
	| glob_target
	;

glob_assign
	: '=' glob_target -> $glob_target
	| -> {}
	;

glob_target
	: REFERENCE -> type('reference', $REFERENCE)
	| GLOB -> type('glob', $GLOB)
	;

regex
	: NAME regex_assign -> {...$regex_assign, name:$NAME}
	| regex_target
	;

regex_assign
	: '=' regex_target -> $regex_target
	| -> {}
	;

regex_target
	: REFERENCE -> type('reference', $REFERENCE)
	| REGEX -> type('regex', $REGEX)
	;

pattern
	: GLOB -> type('glob', $GLOB)
	| REGEX -> type('regex', $REGEX)
	| PATTERN_REF -> type('pattern_ref', $PATTERN_REF.slice(1))
	;
