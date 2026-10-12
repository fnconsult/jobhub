# The people search is filtered by country, never by city

Searching for people by employer name alone brought back namesakes abroad (a Capgemini offer in Issy-les-Moulineaux found people at Capgemini in other countries). We narrow the search to the job's country: the one named in the Job Offer's location, else France when the Company Dossier comes from the French register, else no filter. A web-sourced Company Dossier's country is not used: it is usually the head office of a foreign employer, which can differ from where the job is and would hide the right people.

We never filter by city. The job and the registered office are often in different towns, and providers' city data is patchy, so a city filter would drop the right people.

Lusha takes ISO country codes; Apollo takes place names, so the code is converted to its English name before the call.
