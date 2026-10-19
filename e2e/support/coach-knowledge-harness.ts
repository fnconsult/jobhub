import { readCoachKnowledgeFiles } from "@jobhub/coach-knowledge";

// Boots the coach-knowledge package through its public entry point in a fresh process and prints
// what the one-off import of the Coaching Playbooks (#225) would read, as one JSON line. argv: [dir].
const [dir] = process.argv.slice(2);
try {
  const files = readCoachKnowledgeFiles(...(dir ? [dir] : []));
  console.log(
    "CK_RESULT " +
      JSON.stringify({
        playbooks: files.playbooks.map((p) => ({ id: p.id, title: p.title, rules: p.rules, sources: p.sources, hasFrontmatter: p.text.startsWith("---") })),
        digest: { title: files.coreDigest.title, rules: files.coreDigest.rules, text: files.coreDigest.text },
        sources: files.sources.entries.map((source) => source.id),
      }),
  );
} catch (error) {
  console.log("CK_RESULT " + JSON.stringify({ error: { name: (error as Error).name, message: (error as Error).message } }));
}
