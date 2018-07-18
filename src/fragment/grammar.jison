
%{
	// copy abstract syntax tree constructors onto global scope object
	Object.assign(global, require('./ast.js'));
%}

%start Fragment

/* enable EBNF grammar syntax */
%ebnf

%%
/* ------------------------ */
/* language grammar         */
/* ------------------------ */


Fragment
	: fragment EOF
		{ return Fragment($fragment) }
	;

fragment
	: pattern -> type('pattern', $pattern)
	| '[' glob ']' -> type('capture_glob', $glob)
	| '(' regex ')' -> type('capture_regex', $regex)
	;

pattern
	: TEXT pattern -> [type('text', $TEXT), ...$pattern]
	| LABEL pattern_text -> [type('label', $LABEL.slice(1)), ...$pattern_text]
	| -> []
	;

pattern_label
	: LABEL pattern_text -> [type('label', $LABEL.slice(1)), ...$pattern_text]
	| -> []
	;

pattern_text
	: TEXT pattern -> [type('text', $TEXT), ...$pattern]
	| -> []
	;

text
	: TEXT* -> $1.join('')
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
	| text -> type('glob', $text)
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
