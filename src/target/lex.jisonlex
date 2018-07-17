
/* ------------------------ */
/* regular expressions */
/* ------------------------ */

fragment			[^/*]+

%options flex

%%
/* ------------------------ */
/* lexical vocabulary */
/* ------------------------ */

{fragment}			return 'FRAGMENT';
"/"					return '/';
"*"					return '*';

.						return 'INVALID';
