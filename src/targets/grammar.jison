
%{
	// copy abstract syntax tree constructors onto global scope object
	Object.assign(global, require('./ast.js'));
%}

%start targets

/* enable EBNF grammar syntax */
%ebnf

%%
/* ------------------------ */
/* language grammar         */
/* ------------------------ */

targets
	: component*
		{ return Targets($1) }
	;

component
	: TEXT -> type('text', $TEXT)
	| LABEL -> type('label', $LABEL.slice(1))
	| GLOB -> type('glob', $GLOB)
	| '(' capture ')' -> type('capture', $capture)
	;

capture
	: LABEL assignment? -> {type:'label', value:$LABEL.slice(1), assignment:$2}
	| pattern -> type('pattern', $pattern)
	;

assignment
	: '=' pattern -> $pattern
	;

pattern
	: GLOB -> type('glob', $GLOB)
	| REGEX -> type('regex', $REGEX)
	| PATTERN_REF -> type('pattern_ref', $PATTERN_REF.slice(1))
	;
