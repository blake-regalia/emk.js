
/* ------------------------ */
/* regular expressions */
/* ------------------------ */

numeric			((\d+(\.\d*)?)|(\.\d+))
alphanum_u		[A-Za-z_0-9]
word 			{alphanum_u}+
name 			[A-Za-z_]{alphanum_u}*
label			[:]{name}
pattern_ref 	[&]{name}

regex 			[/](?:[^/\n\\]|\\.)+[/][a-z]*
glob 			[^&][^\)]*

single_quoted_string 	['](?:[^'\\]|\\.)*[']
double_quoted_string 	["](?:[^"\\]|\\.)*["]

%x capture

%options flex

%%
/* ------------------------ */
/* lexical vocabulary */
/* ------------------------ */

{label} 	return 'LABEL';
/*{glob}		return 'GLOB';*/

<capture>{regex} 		return 'REGEX';
<capture>{pattern_ref} 	return 'PATTERN_REF';
<capture>"=" 			return '=';

"("				this.begin('capture'); return '(';
<capture>")" 	this.popState(); return ')';

.				return 'TEXT';
