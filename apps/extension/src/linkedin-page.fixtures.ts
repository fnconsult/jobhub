/**
 * Invented LinkedIn pages for the tests (#1164): their structure follows LinkedIn's (its class names, the hidden text of a
 * screen reader, the « Membre LinkedIn » of a member out of the network, the profile links and photos), never its content.
 * Every name, company and address here is fictional; LinkedIn itself is never fetched: the e2e suite serves these pages.
 */

/** One person's card on a company's « Personnes » page, as LinkedIn draws it: their profile link, photo, name, headline, place. */
const personCard = (slug: string, name: string, headline: string) => `
  <li class="grid org-people-profile-card__profile-card-spacing">
    <section class="artdeco-card org-people-profile-card">
      <a href="https://www.linkedin.com/in/${slug}/"><img class="evi-image" src="https://media.licdn.example/${slug}.jpg" alt="Photo de ${name}"></a>
      <div class="artdeco-entity-lockup">
        <div class="artdeco-entity-lockup__title"><a href="https://www.linkedin.com/in/${slug}/"><span aria-hidden="true">${name}</span><span class="visually-hidden">Voir le profil de ${name}</span></a></div>
        <div class="artdeco-entity-lockup__badge"><span class="visually-hidden">Relation de 2e niveau</span><span aria-hidden="true">· 2e</span></div>
        <div class="artdeco-entity-lockup__subtitle"><div class="lt-line-clamp">${headline}</div></div>
        <div class="artdeco-entity-lockup__caption">Lyon, Auvergne-Rhône-Alpes</div>
      </div>
      <button class="artdeco-button">Se connecter</button>
    </section>
  </li>`;

/** The people of a company, filtered by its « Achats » department, as LinkedIn's « Personnes » tab lists them. */
export const PEOPLE_PAGE_URL = "https://www.linkedin.com/company/exemple-industrie-fictive/people/?facetCurrentFunction=8";
export const PEOPLE_PAGE_HTML = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>(2) Exemple Industrie Fictive : Personnes | LinkedIn</title></head><body>
  <header class="global-nav"><nav><a href="/feed/">Accueil</a><a href="/in/me/">Vous</a></nav></header>
  <main id="main" class="scaffold-layout__main">
    <section class="org-top-card">
      <img class="org-top-card-primary-content__logo" src="https://media.licdn.example/logo.png" alt="Logo">
      <h1 class="org-top-card-summary__title" title="Exemple Industrie Fictive">Exemple Industrie Fictive</h1>
      <div class="org-top-card-summary-info-list">Industrie · Lyon · 1 200 abonnés</div>
    </section>
    <section class="org-people__insights-container">
      <h2>Où ils travaillent</h2>
      <button class="org-people-bar-graph-element org-people-bar-graph-element--is-selected" aria-pressed="true">
        <strong>12</strong><span class="org-people-bar-graph-element__category">Achats</span>
      </button>
      <button class="org-people-bar-graph-element" aria-pressed="false"><strong>40</strong><span class="org-people-bar-graph-element__category">Ingénierie</span></button>
    </section>
    <div class="scaffold-finite-scroll__content"><ul>
      ${personCard("camille-fictive-0a1b2c", "Camille Fictive", "Responsable achats chez Exemple Industrie Fictive")}
      ${personCard("lou-invente-3d4e5f", "Lou Inventé", "Acheteur projets | Métallurgie")}
      <li class="grid"><section class="artdeco-card org-people-profile-card">
        <div class="artdeco-entity-lockup"><div class="artdeco-entity-lockup__title"><span aria-hidden="true">Membre LinkedIn</span></div>
        <div class="artdeco-entity-lockup__subtitle">Acheteuse</div></div></section></li>
      ${personCard("sacha-exemple-6f7a8b", "Sacha Exemple", "Directrice des achats")}
    </ul></div>
  </main>
  <aside class="scaffold-layout__aside"><h2>Autres pages consultées</h2><a href="/company/autre-fictive/">Autre Fictive</a></aside>
</body></html>`;

/** A posting, invented, with the « Rencontrez l'équipe de recrutement » card that names who posted it. */
export const JOB_PAGE_URL = "https://www.linkedin.com/jobs/view/4100000099/?refId=abc&trackingId=def";
export const JOB_PAGE_HTML = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Acheteur industriel H/F | Exemple Industrie Fictive | LinkedIn</title></head><body>
  <header class="global-nav"><nav><a href="/feed/">Accueil</a></nav></header>
  <main id="main" class="scaffold-layout__main">
    <div class="job-details-jobs-unified-top-card__container--two-pane">
      <div class="job-details-jobs-unified-top-card__company-name"><a href="https://www.linkedin.com/company/exemple-industrie-fictive/life/">Exemple Industrie Fictive</a></div>
      <div class="job-details-jobs-unified-top-card__job-title"><h1>Acheteur industriel H/F</h1></div>
      <div>Lyon · il y a 3 jours</div>
    </div>
    <div class="job-details-people-who-can-help__section--two-pane">
      <h2>Rencontrez l'équipe de recrutement</h2>
      <div class="hirer-card__hirer-information">
        <a href="https://www.linkedin.com/in/dominique-fictif-9c8d7e/"><strong><span class="jobs-poster__name">Dominique Fictif</span></strong></a>
        <div class="hirer-card__hirer-job-title">Talent Acquisition chez Exemple Industrie Fictive</div>
        <div class="hirer-card__job-poster">Auteur de l'offre d'emploi</div>
      </div>
    </div>
    <div id="job-details"><h2>À propos de l'offre d'emploi</h2><p>Vous négociez avec nos fournisseurs de pièces usinées.</p></div>
  </main>
</body></html>`;

/** A company's own page, invented: no one named on it. */
export const COMPANY_PAGE_URL = "https://www.linkedin.com/company/exemple-industrie-fictive/";
export const COMPANY_PAGE_HTML = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Exemple Industrie Fictive | LinkedIn</title></head><body>
  <main id="main"><section class="org-top-card"><h1 class="org-top-card-summary__title">Exemple Industrie Fictive</h1>
  <p>Pièces usinées pour l'aéronautique, à Lyon.</p></section></main>
</body></html>`;

/** A person's profile, invented: never read. */
export const PROFILE_PAGE_URL = "https://www.linkedin.com/in/camille-fictive-0a1b2c/";
export const PROFILE_PAGE_HTML = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Camille Fictive | LinkedIn</title></head><body>
  <main id="main"><h1>Camille Fictive</h1><div>Responsable achats chez Exemple Industrie Fictive</div><section><h2>Expérience</h2><p>Acheteuse, 2015-2020</p></section></main>
</body></html>`;
