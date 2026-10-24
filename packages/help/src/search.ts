/**
 * Help Article search, in memory and without AI (ADR-0035): the query's words, accents folded and stop-words
 * dropped, are matched by their stem against each article's title and synonyms (3 points) or its body (1 point).
 */
import type { HelpArticle } from "./types";

/** Words that say nothing about what is asked, in French and in English (accents folded). */
const STOP_WORDS = new Set(
  [
    // French
    "les une des aux ces cet cette mon mes ton tes son ses notre nos votre vos leur leurs moi toi lui elle elles ils nous vous",
    "que qui quoi quel quelle quels quelles dont est sont suis etre avoir avez ont pour par avec sans sur sous dans entre vers chez",
    "comment quand pourquoi combien pas plus moins tres faire fait faut peux peut puis veux veut voudrais aussi alors donc mais",
    "tout tous toute toutes cela ceci comme encore deja bien etc",
    // English
    "the and for with without from into onto about what when where why which who whom whose how can could would should will",
    "shall may might must does did done doing have has had having are was were been being this that these those there here",
    "your yours you our ours their theirs his her hers its not any all some more most very also just make get got want need",
  ]
    .join(" ")
    .split(" "),
);

/** Lower-cased, accents folded, everything but letters and digits turned into spaces. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function words(text: string): string[] {
  const normalized = normalize(text);
  return normalized ? [...new Set(normalized.split(" "))] : [];
}

/** The start of a query word that other forms of it share: « relancer » → « relanc », never shorter than 4 letters. */
function stem(word: string): string {
  return word.slice(0, Math.max(4, word.length - 2));
}

/** An article's words, read once: those of its title and synonyms, and those of its body. */
export interface IndexedArticle {
  article: HelpArticle;
  titleWords: string[];
  bodyWords: string[];
}

export function indexArticle(article: HelpArticle): IndexedArticle {
  return { article, titleWords: words(`${article.title} ${article.synonyms.join(" ")}`), bodyWords: words(article.body) };
}

const TITLE_WEIGHT = 3;
const BODY_WEIGHT = 1;
const MINIMUM_SCORE = 2;

/** The articles matching `query`, best first (ties keep the index's order), `limit` at most. */
export function searchIndex(index: readonly IndexedArticle[], query: string, limit: number): HelpArticle[] {
  const stems = words(query)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word))
    .map(stem);
  if (stems.length === 0) return [];
  const startsWith = (list: string[], prefix: string) => list.some((word) => word.startsWith(prefix));
  return index
    .map(({ article, titleWords, bodyWords }) => ({
      article,
      score: stems.reduce(
        (score, prefix) => score + (startsWith(titleWords, prefix) ? TITLE_WEIGHT : startsWith(bodyWords, prefix) ? BODY_WEIGHT : 0),
        0,
      ),
    }))
    .filter(({ score }) => score >= MINIMUM_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ article }) => article);
}
