
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

%x glob glob_target glob_nest regex regex_target regex_nest

%options flex

%%
/* ------------------------ */
/* lexical vocabulary */
/* ------------------------ */


<INITIAL>"["					this.begin('glob'); return '[';
<INITIAL>"("					this.begin('regex'); return '(';
<INITIAL>{label}				return 'LABEL';

<glob,regex>{name}			return 'NAME';
<glob>"=" 						this.popState(); this.pushState("glob_target"); return '=';
<regex>"=" 						this.popState(); this.pushState("regex_target"); return '=';
<glob_target,regex_target>{reference}		return 'REFERENCE';

<glob_target>"["						this.pushState("glob_nest"); return 'TEXT';
<glob_nest>"]"					this.popState(); return 'TEXT';
<glob,glob_target>"]"						this.popState(); return ']';

<regex_target>"("						this.pushState("regex_nest"); return 'TEXT';
<regex_nest>")"				this.popState(); return 'TEXT';
<regex_target>{regex} 				return 'REGEX';
<regex,regex_target>")"						this.popState(); return ')';

<INITIAL,glob,glob_target,glob_nest,regex,regex_target,regex_nest>.	return 'TEXT';
<<EOF>> 							return 'EOF';
