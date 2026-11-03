---
kind: faq
audience: administrator
topic: fournisseurs-et-tools
title: What do I do with an environment variable that is no longer read?
synonyms: [environment variable, .env, unused variable, variables no longer used, replaced by, environment, old variable, clean up, differs from default, env]
---
The « Environment » tab of Settings lists, under « Variables no longer used », the variables the server's environment still sets but Jobbbox no longer reads. The « Replaced by » column says what replaces them, for example Coaching Playbooks, set in Playbooks. Their value is never shown.

They change nothing: you can remove them from the server's .env at the next deployment. Set what « Replaced by » points to instead. With no unused variable, the list says « No unused variable in the environment. »

Not to be confused with two other cases:

- « Environment settings »: variables still read, which are not changed in the back office (« Why in the environment » says why);
- the warning « … settings come from the environment and differ from the code's default » and the « env » badge in Tools: the variable is read and replaces the code's default. Check that it is intended; a value entered in the back office would win over it.
