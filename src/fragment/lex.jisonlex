
/* ------------------------ */
/* regular expressions */
/* ------------------------ */

numeric			((\d+(\.\d*)?)|(\.\d+))
alphanum_u		[A-Za-z_0-9]
word 				{alphanum_u}+
name 				[A-Za-z_]{alphanum_u}*
label				[:]{name}
reference 		[&]{name}

regex 			[/](?:[^/\n\\]|\\.)+[/][a-z]*
reference 		[^&][^\)]*

single_quoted_string 	['](?:[^'\\]|\\.)*[']
double_quoted_string 	["](?:[^"\\]|\\.)*["]

%x glob glob_nest regex regex_nest

%options flex

%%
/* ------------------------ */
/* lexical vocabulary */
/* ------------------------ */


<INITIAL>"["					this.begin('glob'); return '[';
<INITIAL>"("					this.begin('regex'); return '(';
<INITIAL>{label}				return 'LABEL';

<glob,regex>{name}			return 'NAME';
<glob,regex>"=" 				return '=';
<glob,regex>{reference}		return 'REFERENCE';

<glob>"["						this.pushState("glob_nest"); return 'TEXT';
<glob_nest>"]"					this.popState(); return 'TEXT';
<glob>{glob}					return 'GLOB';
<glob>"]"						this.popState(); return ']';

<regex>"("						this.pushState("regex_nest"); return 'TEXT';
<regex_nest>")"				this.popState(); return 'TEXT';
<regex>{regex} 				return 'REGEX';
<regex>")"						this.popState(); return ')';

.									return 'TEXT';
<<EOF>> 							return 'EOF';
