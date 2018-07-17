
%{
	// copy abstract syntax tree constructors onto global scope object
	Object.assign(global, require('./ast.js'));
%}

%start target

/* enable EBNF grammar syntax */
%ebnf

%%
/* ------------------------ */
/* language grammar         */
/* ------------------------ */

target
	: fragment target_ -> $target_.push($fragment)
	;

target_
	: "/" target -> $target
	| -> []
	;

fragment
	: FRAGMENT
	| "*"
	;
