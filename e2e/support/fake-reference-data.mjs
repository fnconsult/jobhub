// Preloaded into the e2e web server (NODE_OPTIONS=--import) to stand in for the reference data's
// two sources (issue #236): INSEE's SPARQL endpoint (NAF rév. 2) and France Travail's ROME open
// data archive. Nothing reaches the real ones. They answer the captures kept as unit-test fixtures:
// every Sector and Subsector, and the ROME professional domains of grand domains A and M.
import { readFileSync } from "node:fs";
import { crc32, deflateRawSync } from "node:zlib";

const realFetch = globalThis.fetch;
const fixtures = new URL("../../apps/web/src/reference-data/fixtures/", import.meta.url);
const NAF_ANSWER = readFileSync(new URL("insee-naf-sparql.json", fixtures), "utf8");
const ROME_TREE = readFileSync(new URL("rome-arborescence-principale.latin1.json", fixtures));

/** A zip archive of `files` (name: Buffer), each deflated, as France Travail serves its open data. */
function zipOf(files) {
  const parts = [];
  const directory = [];
  let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const compressed = deflateRawSync(data);
    const fileName = Buffer.from(name);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(fileName.length, 26);
    parts.push(local, fileName, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(fileName.length, 28);
    central.writeUInt32LE(offset, 42);
    directory.push(central, fileName);
    offset += local.length + fileName.length + compressed.length;
  }
  const central = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, central, end]);
}

const ROME_ARCHIVE = zipOf({
  "unix_arborescence_principale_v462.json": ROME_TREE,
  "version.txt": Buffer.from("Numero de version : 62\r\n", "latin1"),
});

globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url);
  if (url.origin === "https://rdf.insee.fr" && url.pathname === "/sparql") {
    return new Response(NAF_ANSWER, { headers: { "content-type": "application/sparql-results+json" } });
  }
  if (url.origin === "https://api.francetravail.fr" && url.pathname === "/api-nomenclatureemploi/v1/open-data/json") {
    return new Response(ROME_ARCHIVE, { headers: { "content-type": "application/zip" } });
  }
  return realFetch(input, init);
};
